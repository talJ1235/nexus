// R16 B2/B3 acceptance — live shared spaces with two browser contexts (A and B, members of shared space S; V = viewer):
//   fake transport (REALTIME_FAKE=1): A adds, edits, moves to a list, changes status, deletes → B (and V) see each
//   within 1.5 s; V still can't write. Polling mode (no key): the same within 12 s. Conflicts (B3): A and B change the
//   same item's price from the same revision → the second gets { conflict } and nothing is lost; A changes the price
//   while B moves it to a list → both kept, no conflict.
// Usage: node scripts/test-live.mjs   (starts `next dev` on PORT=3105 twice, throwaway DB; the first compile is slow)
import { createClient } from "@libsql/client";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 3105);
const BASE = `http://localhost:${PORT}`;
const DB = "live-test.db";
const SECRET = "live-test-secret-0123456789abcdef-xyz-12";
const ENV = {
  ...process.env,
  NODE_ENV: "development",
  TURSO_DATABASE_URL: `file:${DB}`,
  TURSO_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: BASE,
  AUTH_FULL_LOCAL: "0",
  AUTH_SESSION_CACHE: "0",
  ADMIN_EMAIL: "",
  APP_PASSWORD: "",
  GEMINI_API_KEY: "",
  GROQ_API_KEY: "",
  SERPER_API_KEY: "",
  BLOB_READ_WRITE_TOKEN: "",
  GOOGLE_CLIENT_ID: "",
  ABLY_API_KEY: "",
  NEXT_DIST_DIR: undefined,
};
let fails = 0;
const ok = (c, m, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};
const id = () => randomBytes(12).toString("base64url");

// ---------- DB: A, B members of S (A owner), V viewer ----------
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: ENV, stdio: "ignore" });
const db = createClient({ url: `file:${DB}` });
// The server writes too (R17 presence beats): wait for the lock instead of failing.
await db.execute("PRAGMA busy_timeout = 10000");
await db.execute("PRAGMA journal_mode = WAL");
const now = Date.now();
const U = { A: "uA_" + id(), B: "uB_" + id(), V: "uV_" + id() };
const S = "sS_" + id();
const LIST = "c_" + id();
for (const [k, name] of [["A", "Noa"], ["B", "Yoav"], ["V", "Vera"]]) {
  await db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'user', ?, ?)`, args: [U[k], name, `${k.toLowerCase()}@live.test`, now, now] });
  const p = "sP_" + id();
  await db.execute({ sql: `INSERT INTO space (id, name, slug, kind, created_by, created_at) VALUES (?, ?, ?, 'personal', ?, ?)`, args: [p, `P${k}`, `p-${p}`, U[k], now] });
  await db.execute({ sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`, args: [id(), p, U[k], now] });
}
await db.execute({ sql: `INSERT INTO space (id, name, slug, kind, created_by, created_at) VALUES (?, 'Jacoby Home', ?, 'shared', ?, ?)`, args: [S, `s-${S}`, U.A, now] });
for (const [k, role] of [["A", "owner"], ["B", "member"], ["V", "viewer"]]) await db.execute({ sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`, args: [id(), S, U[k], role, now] });
await db.execute({ sql: `INSERT INTO collections (id, space_id, kind, name, created_at) VALUES (?, ?, 'list', 'Groceries', ?)`, args: [LIST, S, now] });
const sign = (token) => encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
const cookie = {};
for (const k of ["A", "B", "V"]) {
  const token = id() + id();
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [id(), now + 86_400_000, token, now, now, U[k]] });
  cookie[k] = sign(token);
}

// ---------- server ----------
let server = null;
let log = "";
const stop = () => {
  if (!server) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
    else server.kill();
  } catch {}
  server = null;
};
process.on("exit", stop);
async function start(extra) {
  stop();
  log = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], { env: { ...ENV, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server did not start");
}

const browser = await chromium.launch();
async function open(who) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  c.setDefaultTimeout(120_000);
  await c.addCookies([
    { name: "nexus_session_dev", value: cookie[who], url: BASE },
    { name: "nexus_space", value: S, url: BASE },
    { name: "nexus_locale", value: "en", url: BASE },
  ]);
  await c.addInitScript(() => {
    try {
      sessionStorage.setItem("nexus.opened", "1");
      localStorage.setItem("nexus.bootDay", new Date().getFullYear() + "-" + (new Date().getMonth() + 1) + "-" + new Date().getDate());
    } catch {}
  });
  const p = await c.newPage();
  await p.goto(`${BASE}/?v=to_buy`, { timeout: 180_000 });
  await p.waitForFunction(() => !!window.__nexusTest, null, { timeout: 180_000 });
  return { c, p };
}
const act = (p, name, ...args) => p.evaluate(([n, a]) => window.__nexusTest.act[n](...a), [name, args]);
const itemOf = (p, iid) => p.evaluate((x) => window.__nexusTest.items().find((i) => i.id === x) ?? null, iid);
/** ms until `pred(item)` holds in `p`'s store (or -1 after `limit`). */
async function until(p, iid, pred, limit) {
  const t0 = Date.now();
  const fn = `(() => { const i = window.__nexusTest.items().find((x) => x.id === ${JSON.stringify(iid)}) ?? null; return (${pred})(i); })()`;
  try {
    await p.waitForFunction(fn, null, { timeout: limit, polling: 50 });
    return Date.now() - t0;
  } catch {
    return -1;
  }
}

/**
 * B3: both start from the same revision. Same field (the store link's price) → the second write gets { conflict, by A }
 * and A's price stays; different fields (A: price, B: list) → both applied, no conflict.
 */
async function conflicts(A, B) {
  const it = await act(A.p, "createItem", { title: "Drill", brand: null, imageUrl: null, category: null, tags: [], collectionId: null, source: { url: "https://shop.example/drill", normalizedUrl: "shop.example/drill", store: "Shop", storeKey: "shop.example", price: 50, currency: "ILS", shipping: null, availability: null, rawTitle: "Drill", extractMethod: "manual", gtin: null } });
  await until(B.p, it.id, "(i) => i?.sources?.length === 1", 5000);
  // What each side "saw" before editing (the same revision).
  const seenA = await itemOf(A.p, it.id) ?? it;
  const seenB = await itemOf(B.p, it.id);
  const srcA = seenA.sources[0];
  const srcB = seenB.sources[0];
  const a = await act(A.p, "updateSource", srcA.id, { price: 60 }, { rev: srcA.rev, values: { price: srcA.price } });
  const b = await act(B.p, "updateSource", srcB.id, { price: 70 }, { rev: srcB.rev, values: { price: srcB.price } });
  const row = (await db.execute({ sql: "SELECT price FROM sources WHERE id = ?", args: [srcA.id] })).rows[0];
  ok(!a.conflict && b.conflict === true && b.by === U.A && b.row.sources[0].price === 60 && row.price === 60, "B3 same price from the same revision → the second gets the conflict (by A), A's price kept", JSON.stringify({ a: !!a.conflict, b: [b.conflict, b.by === U.A, b.row?.sources?.[0]?.price], db: row.price }));
  // "Apply mine" = send again from the fresh row → B's price wins, nothing lost on the way.
  const fresh = b.row.sources[0];
  const b2 = await act(B.p, "updateSource", fresh.id, { price: 70 }, { rev: fresh.rev, values: { price: fresh.price } });
  ok(!b2.conflict && (await db.execute({ sql: "SELECT price FROM sources WHERE id = ?", args: [srcA.id] })).rows[0].price === 70, "B3 Apply mine re-sends from the fresh row");
  // Different fields from the same revision: A changes the price, B moves the item to a list → both kept.
  await until(B.p, it.id, "(i) => i?.sources?.[0]?.price === 70", 5000);
  const itA = await itemOf(A.p, it.id);
  const itB = await itemOf(B.p, it.id);
  const s2 = itA.sources[0];
  const pa = await act(A.p, "updateSource", s2.id, { price: 80 }, { rev: s2.rev, values: { price: s2.price } });
  const mb = await act(B.p, "bulkUpdate", [it.id], { collectionId: LIST }, { [it.id]: { rev: itB.rev, values: { collectionId: itB.collectionId } } });
  const end = (await db.execute({ sql: "SELECT i.collection_id c, s.price p FROM items i JOIN sources s ON s.item_id = i.id WHERE i.id = ?", args: [it.id] })).rows[0];
  ok(!pa.conflict && mb.conflicts.length === 0 && end.c === LIST && end.p === 80, "B3 A changes the price while B moves it to a list → both kept, no conflict", JSON.stringify({ pa: !!pa.conflict, mb: mb.conflicts.length, end }));
  await act(A.p, "bulkDelete", [it.id]);
}

async function scenario(label, limit) {
  const A = await open("A");
  const B = await open("B");
  const V = await open("V");
  // Warm up (first compiles of the actions/routes on the dev server) — not measured.
  const warm = await act(A.p, "createItem", { title: "warm-up", brand: null, imageUrl: null, category: null, tags: [], collectionId: null, source: null });
  await until(B.p, warm.id, "(i) => !!i", 60_000);
  await act(A.p, "bulkDelete", [warm.id]);
  await until(B.p, warm.id, "(i) => !i", 60_000);

  // B4 (fake transport has presence; polling has none): A sees B and V online.
  if (label === "fake transport") {
    const seen = await A.p
      .waitForFunction((ids) => ids.every((x) => window.__nexusTest.present().some(([id]) => id === x)), [U.B, U.V], { timeout: 5000 })
      .then(() => true, () => false);
    ok(seen, "B4 presence: A sees B and V online in the space");
  } else ok((await A.p.evaluate(() => window.__nexusTest.present().length)) === 0, "B4 polling: no presence (dots hidden)");

  const lat = [];
  const step = async (name, run, pred) => {
    await run();
    const ms = await until(B.p, iid, pred, limit);
    const vms = await until(V.p, iid, pred, limit);
    lat.push(ms);
    ok(ms >= 0 && vms >= 0, `${label}: B and V see "${name}" within ${limit / 1000} s`, `B ${ms} ms, V ${vms} ms`);
  };
  let iid = null;
  await step("add", async () => (iid = (await act(A.p, "createItem", { title: "Oat milk", brand: null, imageUrl: null, category: null, tags: [], collectionId: null, source: null })).id), "(i) => i?.title === 'Oat milk'");
  // B4: B gets a batched activity toast for A's add ("Noa added …" — on a warm server the warm-up add + delete and this
  // add arrive within one batch: "Noa added 2 items · removed an item").
  // (≤ 1 toast per person per 10 s: the warm-up already showed one, so this one may wait for the gap.)
  const toastSeen = await B.p.getByText(/Noa added/).first().waitFor({ timeout: 12_000 }).then(() => true, () => false);
  const toastsB = toastSeen ? "" : JSON.stringify(await B.p.locator("[data-sonner-toast]").allInnerTexts());
  ok(toastSeen, `${label}: B gets "Noa added …" (batched)`, toastsB);
  await step("edit (qty 4)", () => act(A.p, "updateItem", iid, { quantity: 4 }), "(i) => i?.quantity === 4");
  await step("move to a list", () => act(A.p, "bulkUpdate", [iid], { collectionId: LIST }), `(i) => i?.collectionId === ${JSON.stringify(LIST)}`);
  await step("status → Received", () => act(A.p, "setStatus", iid, "purchased", null), "(i) => i?.status === 'purchased'");
  await step("delete", () => act(A.p, "bulkDelete", [iid]), "(i) => !i");
  // The viewer gets updates but still can't write.
  const vWrite = await act(V.p, "createItem", { title: "viewer try", brand: null, imageUrl: null, category: null, tags: [], collectionId: null, source: null }).then(() => "wrote", () => "refused");
  ok(vWrite === "refused" && (await db.execute({ sql: "SELECT count(*) n FROM items WHERE title = 'viewer try'", args: [] })).rows[0].n === 0, `${label}: the viewer still can't write`, vWrite);
  if (label === "fake transport") await conflicts(A, B);
  for (const x of [A, B, V]) await x.c.close();
  return lat.filter((x) => x >= 0);
}

const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null);
try {
  await start({ REALTIME_FAKE: "1" });
  const fast = await scenario("fake transport", 1500);
  console.log(`INFO fake transport A→B latency: p50 ${pct(fast, 0.5)} ms, max ${Math.max(...fast)} ms`);
  await start({ REALTIME_FAKE: "" });
  const slow = await scenario("polling", 12_000);
  console.log(`INFO polling A→B latency: p50 ${pct(slow, 0.5)} ms, max ${Math.max(...slow)} ms`);
  // LIVE_ABLY=1: the real Ably key from .env.local (manual check, never in CI): A→B over 20 edits.
  if (process.env.LIVE_ABLY === "1") {
    const { readFileSync } = await import("node:fs");
    const { parseEnv } = await import("node:util");
    const key = parseEnv(readFileSync(".env.local", "utf8")).ABLY_API_KEY;
    if (!key) console.log("SKIP ably: no ABLY_API_KEY in .env.local");
    else {
      await start({ REALTIME_FAKE: "", ABLY_API_KEY: key });
      const A = await open("A");
      const B = await open("B");
      const it = await act(A.p, "createItem", { title: "ably probe", brand: null, imageUrl: null, category: null, tags: [], collectionId: null, source: null });
      await until(B.p, it.id, "(i) => !!i", 60_000);
      const xs = [];
      for (let q = 2; q <= 21; q++) {
        const t0 = Date.now();
        await act(A.p, "updateItem", it.id, { quantity: q });
        const saved = Date.now() - t0;
        const ms = await until(B.p, it.id, `(i) => i?.quantity === ${q}`, 15_000);
        xs.push(ms < 0 ? 15_000 : ms + saved);
      }
      console.log(`INFO ably A→B (action start → B's store), 20 edits: p50 ${pct(xs, 0.5)} ms, p95 ${pct(xs, 0.95)} ms, max ${Math.max(...xs)} ms`);
      ok(pct(xs, 0.5) < 3000, "ably: B sees A's edits (p50 < 3 s)", JSON.stringify(xs));
      for (const x of [A, B]) await x.c.close();
    }
  }
} catch (e) {
  fails++;
  console.log(`FAIL live crashed — ${String(e?.message || e).split("\n")[0]}`);
  console.log(log.split("\n").filter((l) => /error|⨯/i.test(l)).slice(-12).join("\n"));
}
await browser.close();
stop();
db.close();
console.log(fails ? `FAIL live: ${fails}` : "OK live");
process.exit(fails ? 1 : 0);
