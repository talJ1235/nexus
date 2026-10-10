// R17 S3 J2 — web push end to end, offline: a local fake push service receives the request, and the test decrypts it
// with the browser side's keys (RFC 8291 aes128gcm) to prove the payload is encrypted for that device only; 404/410
// deletes the subscription, other failures count up; endpoints outside the push services are refused; the service
// worker's push / click / Received handlers (run in a sandbox with fake clients); and in a real Chromium: a push
// delivered through DevTools shows our notification (title, tag, dir, actions), and Received refuses without a session.
//   npm run build && npm run test:push
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import vm from "node:vm";

const DB = "push-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.PUSH_TEST_LOOPBACK = "1";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

let fails = 0;
const ok = (c: boolean, m: string, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : `  ${extra}`}`);
  if (!c) fails++;
};

/** RFC 8291: the user agent's side of aes128gcm. */
function decrypt(body: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8");
}

async function server() {
  const seen: { path: string; headers: IncomingMessage["headers"]; body: Buffer }[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = req.url?.startsWith("/gone") ? 410 : req.url?.startsWith("/boom") ? 500 : 201;
      res.end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  return { seen, base: `http://127.0.0.1:${port}`, close: () => srv.close() };
}

async function serverSide() {
  const webpush = (await import("web-push")).default;
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "https://nexus.test";
  const { db, schema } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const push = await import("../src/lib/notify/push");
  const n = await import("../src/lib/db-scoped/notify");
  const fake = await server();
  try {
    const d = new Date();
    await db.insert(schema.user).values({ id: "u1", name: "Tal", email: "u1@test.example", emailVerified: true, createdAt: d, updatedAt: d });
    // The browser side: a P-256 key pair + a 16-byte auth secret, as pushManager.subscribe would make.
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const b64 = (b: Buffer) => b.toString("base64url");
    await n.saveSubscription("u1", { endpoint: `${fake.base}/ok/abc`, p256dh: b64(ua.getPublicKey()), auth: b64(auth), device: "phone", label: "Chrome · Android" });
    const payload = { id: "n1", title: "Steam cleaner dropped to ₪899", body: "Was ₪999 at KSP", url: "/api/notify/open?id=n1", tag: "price:r:1", actions: [{ action: "open" as const, title: "Open" }], lang: "en" as const, dir: "ltr" as const };
    const r = await push.sendToUser("u1", payload, 3600);
    ok(r.sent === 1 && fake.seen.length === 1, "the push service got one request", JSON.stringify(r));
    const req = fake.seen[0];
    ok(req.headers["content-encoding"] === "aes128gcm" && req.headers.ttl === "3600" && /^vapid t=.+, k=.+/.test(String(req.headers.authorization)), "aes128gcm, TTL, VAPID authorization", JSON.stringify(req.headers));
    ok(!req.body.toString("latin1").includes("Steam cleaner"), "the body is not readable on the way");
    const plain = decrypt(req.body, ua, auth);
    ok(JSON.parse(plain).title === payload.title && JSON.parse(plain).tag === payload.tag, "decrypted with the device's keys: the same payload", plain.slice(0, 80));
    const [row] = await db.select().from(schema.pushSubscription).where(eq(schema.pushSubscription.userId, "u1"));
    ok(row.lastOkAt != null && row.failCount === 0, "a success is remembered (last_ok_at)");

    // 500 → fail_count + 1 (kept); 410 → deleted.
    await n.saveSubscription("u1", { endpoint: `${fake.base}/boom/1`, p256dh: b64(ua.getPublicKey()), auth: b64(auth), device: "computer", label: null });
    await n.saveSubscription("u1", { endpoint: `${fake.base}/gone/1`, p256dh: b64(ua.getPublicKey()), auth: b64(auth), device: "computer", label: null });
    const r2 = await push.sendToUser("u1", payload, 43200);
    const subs = await db.select().from(schema.pushSubscription).where(eq(schema.pushSubscription.userId, "u1"));
    const boom = subs.find((s) => s.endpoint.includes("/boom/"));
    ok(r2.sent === 1 && r2.failed === 1 && r2.gone === 1, "one ok, one failure, one gone", JSON.stringify(r2));
    ok(!subs.some((s) => s.endpoint.includes("/gone/")) && boom?.failCount === 1, "410 deletes the subscription; 500 counts up", JSON.stringify(subs.map((s) => [s.endpoint.slice(-8), s.failCount])));
    // Five failures in a row → the daily purge drops it.
    await db.update(schema.pushSubscription).set({ failCount: 5 }).where(eq(schema.pushSubscription.id, boom!.id));
    const purged = await n.purgeNotifications();
    ok(purged.subscriptions === 1, "5 failures in a row → deleted by the daily purge");

    // Only browser push services (SSRF guard); loopback only under the test flag.
    ok(push.allowedEndpoint("https://fcm.googleapis.com/fcm/send/x") && push.allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x") && push.allowedEndpoint("https://web.push.apple.com/x") && push.allowedEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x"), "the push services are allowed");
    ok(!push.allowedEndpoint("https://example.com/x") && !push.allowedEndpoint("http://fcm.googleapis.com/x") && !push.allowedEndpoint("https://fcm.googleapis.com:8443/x") && !push.allowedEndpoint("https://user:pw@fcm.googleapis.com/x") && !push.allowedEndpoint("https://fcm.googleapis.com.evil.io/x"), "anything else is refused");
    process.env.PUSH_TEST_LOOPBACK = "";
    ok(!push.allowedEndpoint(`${fake.base}/ok`), "loopback is refused without the test flag");
    process.env.PUSH_TEST_LOOPBACK = "1";
    // No keys → nothing sent, no throw.
    process.env.VAPID_PRIVATE_KEY = "";
    ok((await push.sendToUser("u1", payload, 60)).sent === 0, "without keys: nothing is sent (inbox only)");
  } finally {
    fake.close();
  }
}

/** The service worker's handlers, run in a sandbox with fake `self`, `clients`, `registration`, `fetch`. */
async function swHandlers() {
  const code = readFileSync("public/sw.js", "utf8");
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; opts: Record<string, unknown> }[] = [];
  const posted: unknown[] = [];
  const fetched: { url: string; init: { method: string; body: string } }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const win = { url: "https://app.test/", focus: async () => {}, navigate: async (u: string) => (navigated.push(u), win), postMessage: (m: unknown) => posted.push(m) };
  let wins: (typeof win)[] = [];
  const self = {
    location: { href: "https://app.test/sw.js?v=t", origin: "https://app.test" },
    addEventListener: (k: string, f: (e: unknown) => void) => (handlers[k] = f),
    registration: { showNotification: async (title: string, opts: Record<string, unknown>) => void shown.push({ title, opts }) },
    clients: { matchAll: async () => wins, openWindow: async (u: string) => void opened.push(u), claim: async () => {} },
    skipWaiting: () => {},
  };
  vm.runInNewContext(code, { self, caches: {}, URL, fetch: async (url: string, init: { method: string; body: string }) => (fetched.push({ url, init }), { ok: true }), Response, console });
  const run = async (k: string, e: Record<string, unknown>) => {
    let p: Promise<unknown> = Promise.resolve();
    handlers[k]({ ...e, waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  await run("push", { data: { json: () => ({ id: "n9", title: "Noa finished shopping", body: "Bought 12, 3 left", url: "/api/notify/open?id=n9", tag: "shop:t", renotify: false, lang: "he", dir: "rtl", actions: [] }) } });
  const s = shown[0];
  ok(s?.title === "Noa finished shopping" && s.opts.tag === "shop:t" && s.opts.dir === "rtl" && s.opts.renotify === false && s.opts.badge === "/icons/badge-96.png", "SW push: shows our notification (tag replaces the group, dir, quiet update, badge)", JSON.stringify(s));
  await run("push", { data: { json: () => ({ title: "x", url: "https://evil.example/" }) } });
  ok((shown[1].opts.data as { url: string }).url === "/", "SW push: an off-site url is never kept");
  const n = (data: unknown, action = "") => ({ action, notification: { data, close: () => {} } });
  wins = [];
  await run("notificationclick", n({ id: "n9", url: "/api/notify/open?id=n9" }));
  ok(opened[0] === "https://app.test/api/notify/open?id=n9", "SW click: no window → opens the url", opened.join());
  wins = [win];
  await run("notificationclick", n({ id: "n9", url: "/api/notify/open?id=n9" }));
  ok(navigated[0] === "https://app.test/api/notify/open?id=n9", "SW click: an open Nexus window is focused and navigated");
  await run("notificationclick", n({ id: "d1", url: "/api/notify/open?id=d1" }, "received"));
  ok(fetched[0]?.url === "/api/notify/received" && JSON.parse(fetched[0].init.body).id === "d1" && opened.length === 1, "SW action Received: POSTs the row id (with the cookie), opens nothing", JSON.stringify(fetched));
  ok(posted.some((m) => (m as { type?: string }).type === "nexus-notify"), "SW: open windows are told (the bell updates)");
}

/** A real Chromium: a push delivered through DevTools shows our notification; Received needs a session. */
async function browser() {
  const { chromium } = await import("playwright");
  const { startApp } = await import("./lib/test-app.mjs");
  const app = await startApp({ db: "push-browser-test.db", port: 3113 });
  // The full Chromium (new headless) where it starts (CI); the headless shell (fallback) has no notifications at all.
  const b = await chromium.launch({ channel: "chromium" }).catch(() => chromium.launch());
  try {
    const r401 = await fetch(`${app.base}/api/notify/received`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "x" }) });
    ok(r401.status === 401, "Received refuses without a session", String(r401.status));
    const ctx = await b.newContext();
    await ctx.grantPermissions(["notifications"], { origin: app.base });
    await ctx.addCookies(app.cookies(app.personal, "en"));
    const page = await ctx.newPage();
    await page.goto(app.base);
    await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.evaluate(() => navigator.serviceWorker.addEventListener("message", (e) => ((window as unknown as { __msgs: unknown[] }).__msgs ??= []).push(e.data)));
    const cdp = await ctx.newCDPSession(page);
    const regs = new Promise<string>((resolve) => cdp.on("ServiceWorker.workerRegistrationUpdated", (e: { registrations: { registrationId: string; scopeURL: string }[] }) => e.registrations[0] && resolve(e.registrations[0].registrationId)));
    await cdp.send("ServiceWorker.enable");
    const registrationId = await regs;
    const data = JSON.stringify({ id: "n1", title: "Arrives today", body: "Car vent clip · AliExpress", url: "/api/notify/open?id=n1", tag: "delivery:i:1", lang: "en", dir: "ltr", actions: [{ action: "received", title: "Received" }] });
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: app.base, registrationId, data });
    await page.waitForFunction(() => ((window as unknown as { __msgs?: { type: string }[] }).__msgs ?? []).some((m) => m.type === "nexus-notify"), null, { timeout: 10000 }).catch(() => {});
    const msgs = await page.evaluate(() => (window as unknown as { __msgs?: { type: string; id: string }[] }).__msgs ?? []);
    ok(msgs.some((m) => m.type === "nexus-notify" && m.id === "n1"), "a real push reaches our service worker (it tells the open page)", JSON.stringify(msgs));
    const perm = await page.evaluate(() => Notification.permission);
    if (perm !== "granted") console.log("SKIP shown notification: this Chromium build has no notifications (headless shell) — CI's full Chromium checks it");
    else {
      let v: { title: string; tag: string; actions: string[] } | null = null;
      for (let i = 0; i < 40 && !v; i++) {
        v = await page.evaluate(async () => {
          const n = await (await navigator.serviceWorker.ready).getNotifications();
          return n.length ? { title: n[0].title, tag: n[0].tag, actions: (n[0] as unknown as { actions: { action: string }[] }).actions.map((a) => a.action) } : null;
        });
        if (!v) await page.waitForTimeout(250);
      }
      ok(!!v && v.title === "Arrives today" && v.tag === "delivery:i:1" && v.actions.join() === "received", "a real push in Chromium shows our notification with the Received action", JSON.stringify(v));
    }
    await ctx.close();
  } finally {
    await b.close();
    app.stop();
  }
}

serverSide()
  .then(swHandlers)
  .then(browser)
  .catch((e) => {
    console.error(e);
    fails++;
  })
  .finally(() => {
    console.log(fails ? `FAIL push: ${fails} failed` : "OK push");
    process.exit(fails ? 1 : 0);
  });
