// R15 A1 / A3 / A5 acceptance, on a dev server with the test-only OIDC stub (AUTH_TEST_IDP=1, never in production):
//   A1  sign in (admin links to the migrated user), sign out, the session list shows the device
//   A3  unknown user without invite → no user row, invite-only screen, waitlist row; valid code → user + personal space;
//       used-up / revoked / expired code → refused with a clear message
//   A5  two browser contexts: one signs the other out → the signed-out one gets /login on its next request
// Usage: node scripts/test-auth-flow.mjs   (starts `next dev` on PORT=3104 with a throwaway DB; first compile is slow)
import { createClient } from "@libsql/client";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 3104);
const BASE = `http://localhost:${PORT}`;
const DB = "auth-flow-test.db";
const ADMIN = "admin@auth.test";
const EMERGENCY = "e".repeat(20) + "mergency-token-for-tests-only";
const ENV = {
  ...process.env,
  NODE_ENV: "development",
  AUTH_TEST_IDP: "1",
  TURSO_DATABASE_URL: `file:${DB}`,
  TURSO_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: "auth-flow-test-secret-0123456789abcdefghij",
  BETTER_AUTH_URL: BASE,
  AUTH_FULL_LOCAL: "1", // full mode on localhost: passkeys + email-code recovery are on
  AUTH_SESSION_CACHE: "0",
  ADMIN_EMAIL: ADMIN,
  ADMIN_NAME: "Admin",
  APP_PASSWORD: "",
  GOOGLE_CLIENT_ID: "",
  // R17 E1: the admin emergency sign-in (on only while this is set).
  ADMIN_EMERGENCY_TOKEN: EMERGENCY,
  NEXT_DIST_DIR: undefined,
};
let fails = 0;
const ok = (c, m, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};

for (const f of [DB, `${DB}-journal`]) if (existsSync(f)) rmSync(f);
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: ENV, stdio: "ignore" });
const db = createClient({ url: `file:${DB}` });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
    else server.kill();
  } catch {}
};
process.on("exit", stop);
for (let i = 0; i < 240; i++) {
  try {
    if ((await fetch(`${BASE}/login`)).status === 200) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const browser0 = await chromium.launch();
// Dev server: first compiles of each route are slow.
const browser = { newContext: async (o) => { const c = await browser0.newContext(o); c.setDefaultTimeout(120_000); return c; }, close: () => browser0.close() };
let lastPage = null;
async function signIn(ctx, email, { code } = {}) {
  const p = await ctx.newPage();
  lastPage = p;
  await p.goto(`${BASE}/login`, { timeout: 120_000 });
  if (code) {
    await p.click("text=Use an invite code");
    await p.fill("#invite-code", code);
  }
  await p.click("[data-auth=test-idp]");
  await p.waitForURL((u) => u.pathname.includes("/api/test-idp/authorize"), { timeout: 60_000 });
  await p.fill("#email", email);
  await p.click("#go");
  await p.waitForURL((u) => !u.pathname.startsWith("/api/"), { timeout: 120_000 });
  await p.waitForLoadState("domcontentloaded");
  return p;
}

try {
  // ---- A1: admin signs in through the IdP and is linked to the migrated user (no second user row).
  const admin = await browser.newContext();
  const pa = await signIn(admin, ADMIN);
  await pa.waitForURL((u) => u.pathname === "/" || u.pathname === "/welcome", { timeout: 120_000 });
  const admins = await q(`SELECT id, role FROM "user" WHERE email = ?`, [ADMIN]);
  ok(admins.length === 1 && admins[0].role === "admin", "A1 admin signs in, linked to the migrated user (role admin)", JSON.stringify(admins));
  ok((await q("SELECT count(*) n FROM account WHERE provider_id = 'test-idp'"))[0].n === 1, "A1 the IdP account is linked");

  // ---- R16 A8: on a phone the first screen after the IdP callback is the phone layout (no desktop sidebar, the dock),
  // with no reload.
  {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const pp = await signIn(phone, ADMIN);
    await pp.waitForURL((u) => u.pathname === "/" || u.pathname === "/welcome" || u.pathname === "/passkey", { timeout: 120_000 });
    if (new URL(pp.url()).pathname === "/passkey") await pp.click("[data-auth=not-now]").catch(() => {});
    await pp.waitForSelector("[data-app-shell]", { timeout: 120_000 }).catch(() => {});
    const loads = await pp.evaluate(() => performance.getEntriesByType("navigation").map((n) => n.type));
    // The first screenshot after the callback: what the phone shows before anything else happens.
    const first = await pp.evaluate(() => {
      const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
      return {
        path: location.pathname,
        innerWidth: window.innerWidth,
        viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
        sidebar: vis(document.querySelector("[data-sidebar-logo]")),
      };
    });
    await pp.waitForSelector("[data-dock]", { timeout: 30_000 }).catch(() => {});
    const dock = await pp.locator("[data-dock]").isVisible().catch(() => false);
    if (process.env.SMOKE_OUT) await pp.screenshot({ path: `${process.env.SMOKE_OUT}/a8-after-signin-m.png` });
    ok(first.innerWidth === 390 && !!first.viewportMeta && !first.sidebar && dock && !loads.includes("reload"), "A8 phone: first screen after sign-in is the phone layout (dock, no sidebar, no reload)", JSON.stringify({ ...first, dock, loads }));
    await phone.close();
  }

  // ---- A3: admin creates codes (R17 G3: Admin → Invites; /settings/invites redirects there).
  await pa.goto(`${BASE}/settings/invites`, { timeout: 120_000 });
  ok(new URL(pa.url()).pathname === "/admin/invites", "G0 /settings/invites redirects to /admin/invites", pa.url());
  lastPage = pa;
  pa.on("console", (m) => m.type() === "error" && console.log("  console:", m.text().slice(0, 300)));
  pa.on("response", (r) => r.status() >= 400 && console.log("  http:", r.status(), r.url().slice(0, 120)));
  let prev = "";
  const makeCode = async (uses) => {
    await pa.click("[data-new-code]");
    await pa.fill("#inv-uses", String(uses));
    await pa.click("[data-create-code]");
    await pa.waitForFunction((p) => (document.querySelector("[data-fresh-code] b.mono")?.textContent ?? "").trim() !== p && !!document.querySelector("[data-fresh-code] b.mono"), prev);
    prev = (await pa.textContent("[data-fresh-code] b.mono")).trim();
    return prev;
  };
  const code1 = await makeCode(1);
  const code2 = await makeCode(1);
  const code3 = await makeCode(1);
  ok(/^[A-Z0-9]{3}-[A-Z0-9]{4}$/.test(code1), "A3 admin creates codes (XXX-XXXX)", code1);

  // Unknown user without invite → no user row, invite-only screen, waitlist.
  const stranger = await browser.newContext();
  const ps = await signIn(stranger, "stranger@auth.test");
  await ps.waitForSelector("[data-auth=invite-only]", { timeout: 60_000 });
  ok((await q(`SELECT count(*) n FROM "user" WHERE email = 'stranger@auth.test'`))[0].n === 0, "A3 unknown user without invite → no user row, invite-only screen");
  await ps.click("[data-auth=waitlist]");
  await ps.waitForSelector("text=You're on the waitlist");
  ok((await q("SELECT count(*) n FROM waitlist WHERE email = 'stranger@auth.test'"))[0].n === 1, "A3 waitlist row added");

  // Valid code → user + personal space.
  const newbie = await browser.newContext();
  const pn = await signIn(newbie, "newbie@auth.test", { code: code1 });
  // Full mode: a new account is offered a passkey once (skippable) before the first-run screen.
  await pn.waitForURL((u) => u.pathname === "/passkey", { timeout: 120_000 });
  ok((await pn.locator("[data-auth=not-now]").count()) === 1, "A2 first sign-in in full mode offers a passkey (skippable)");
  await pn.click("[data-auth=not-now]");
  await pn.waitForURL((u) => u.pathname === "/welcome", { timeout: 120_000 });
  const nu = await q(`SELECT u.id, s.kind FROM "user" u JOIN space_member m ON m.user_id = u.id JOIN space s ON s.id = m.space_id WHERE u.email = 'newbie@auth.test'`);
  ok(nu.length === 1 && nu[0].kind === "personal", "A3 valid code → user + personal space, lands on /welcome");

  // Used-up / revoked / expired codes are refused with a message, and create nobody.
  const tryCode = async (email, code, msg) => {
    // The code is checked before the IdP redirect: a bad one never leaves /login.
    const c = await browser.newContext();
    const p = await c.newPage();
    lastPage = p;
    await p.goto(`${BASE}/login`, { timeout: 120_000 });
    await p.click("text=Use an invite code");
    await p.fill("#invite-code", code);
    await p.click("[data-auth=test-idp]");
    void email;
    const shown = await p.waitForSelector(`text=${msg}`, { timeout: 30_000 }).then(() => true, () => false);
    const users = (await q(`SELECT count(*) n FROM "user" WHERE email = ?`, [email]))[0].n;
    if (!shown) console.log("  shown:", await p.locator("[role=alert]").allInnerTexts().catch(() => []), JSON.stringify(await q("SELECT hint, expires_at, revoked_at, uses FROM signup_invite")));
    await c.close();
    return shown && users === 0;
  };
  ok(await tryCode("late@auth.test", code1, "already used"), "A3 used-up code refused (clear message, no user)");
  await q("UPDATE signup_invite SET revoked_at = ? WHERE hint = ?", [Date.now(), code2.slice(-4)]);
  ok(await tryCode("rev@auth.test", code2, "turned off"), "A3 revoked code refused");
  await q("UPDATE signup_invite SET expires_at = ? WHERE hint = ?", [Date.now() - 1000, code3.slice(-4)]);
  ok(await tryCode("exp@auth.test", code3, "expired"), "A3 expired code refused");

  // ---- A5: two contexts for the newbie; one signs the other out.
  const second = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36" });
  const p2 = await signIn(second, "newbie@auth.test");
  await p2.waitForURL((u) => u.pathname === "/", { timeout: 120_000 });
  await pn.goto(`${BASE}/settings/security`, { timeout: 120_000 });
  await pn.waitForSelector("[data-device=other]", { timeout: 60_000 });
  const devices = await pn.locator("[data-device]").count();
  ok(devices === 2, "A1/A5 the session list shows both devices", String(devices));
  ok((await pn.textContent("[data-device=other]")).includes("Android"), "A5 the other device is described (Chrome on Android)");
  await pn.click("[data-sign-out-device]");
  await pn.waitForFunction(() => document.querySelectorAll("[data-device]").length === 1, null, { timeout: 30_000 });
  const r = await p2.goto(`${BASE}/?v=to_buy`, { timeout: 120_000 });
  ok(new URL(p2.url()).pathname === "/login", "A5 the signed-out device gets /login on its next request", `${r?.status()} ${p2.url()}`);
  ok((await q(`SELECT count(*) n FROM security_event e JOIN "user" u ON u.id = e.user_id WHERE u.email = 'newbie@auth.test' AND e.kind = 'sign_out_device'`))[0].n === 1, "A5 security event logged");

  // ---- R17 G2: an account the admin banned can't sign in — a plain message on /login, no session.
  await q(`UPDATE "user" SET banned = 1 WHERE email = 'newbie@auth.test'`);
  const bannedCtx = await browser.newContext();
  const pb = await signIn(bannedCtx, "newbie@auth.test").catch(() => lastPage);
  const shownBan = await pb.waitForSelector("text=This account is blocked", { timeout: 30_000 }).then(() => true, () => false);
  ok(shownBan && new URL(pb.url()).pathname === "/login", "G2 a banned account's sign-in is refused with a plain message", pb.url());
  await q(`UPDATE "user" SET banned = 0 WHERE email = 'newbie@auth.test'`);
  await bannedCtx.close();

  // ---- A2 (full mode): passkey with a virtual authenticator, passkey sign-in, email-code recovery → forced passkey.
  const auth = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  };
  await auth(pn);
  await pn.goto(`${BASE}/passkey?next=/`, { timeout: 120_000 });
  await pn.click("[data-auth=create-passkey]");
  await pn.waitForSelector("[data-auth=passkey-done]");
  const pk = await q(`SELECT count(*) n FROM passkey p JOIN "user" u ON u.id = p.user_id WHERE u.email = 'newbie@auth.test'`);
  ok(pk[0].n === 1, "A2 passkey created (virtual authenticator, user verification required)");
  ok((await q(`SELECT count(*) n FROM security_event e JOIN "user" u ON u.id = e.user_id WHERE u.email = 'newbie@auth.test' AND e.kind = 'passkey_added'`))[0].n === 1, "A2 passkey_added event");
  // Sign out, then back in with the passkey (same browser = same authenticator).
  await pn.evaluate(() => fetch("/api/logout", { method: "POST" }));
  await pn.goto(`${BASE}/login`, { timeout: 120_000 });
  await pn.click("[data-auth=passkey]");
  await pn.waitForURL((u) => u.pathname === "/", { timeout: 120_000 });
  const m = await q(`SELECT s.method FROM session s JOIN "user" u ON u.id = s.user_id WHERE u.email = 'newbie@auth.test' ORDER BY s.created_at DESC LIMIT 1`);
  ok(m[0]?.method === "passkey", "A2 sign in with the passkey", JSON.stringify(m));

  // Email-code recovery on a fresh browser → forced "Add a passkey" (no Not now) → the app redirects until it's done.
  const rec = await browser.newContext();
  const pr = await rec.newPage();
  lastPage = pr;
  await auth(pr);
  const { readFileSync, existsSync: ex } = await import("node:fs");
  const outboxCount = () => (ex(".auth-outbox.jsonl") ? readFileSync(".auth-outbox.jsonl", "utf8").trim().split("\n").length : 0);
  const before = outboxCount();
  await pr.goto(`${BASE}/login/recover`, { timeout: 120_000 });
  await pr.fill("#em", "newbie@auth.test");
  await pr.click("button[type=submit]");
  await pr.waitForSelector(".otp input");
  for (let i = 0; i < 60 && outboxCount() === before; i++) await pr.waitForTimeout(250);
  const last = JSON.parse(readFileSync(".auth-outbox.jsonl", "utf8").trim().split("\n").pop());
  const code = last.text.match(/\b(\d{6})\b/)[1];
  ok(last.to === "newbie@auth.test", "A2 recovery code emailed (local outbox)");
  await pr.locator(".otp input").first().fill(code);
  await pr.waitForURL((u) => u.pathname === "/passkey", { timeout: 120_000 });
  ok((await pr.locator("[data-auth=not-now]").count()) === 0, "A2 after recovery: Add a passkey is forced (no Not now)");
  await pr.goto(`${BASE}/`, { timeout: 120_000 });
  ok(new URL(pr.url()).pathname === "/passkey", "A2 the app redirects to Add a passkey until one is added");
  await pr.click("[data-auth=create-passkey]");
  await pr.waitForSelector("[data-auth=passkey-done]");
  await pr.goto(`${BASE}/`, { timeout: 120_000 });
  ok(new URL(pr.url()).pathname === "/", "A2 after adding a passkey the app opens");
  ok((await q(`SELECT count(*) n FROM security_event e JOIN "user" u ON u.id = e.user_id WHERE u.email = 'newbie@auth.test' AND e.kind = 'recovery'`))[0].n === 1, "A2 recovery event in the activity log");
  await rec.close();

  // ---- A1: sign out.
  const sessionsOf = async () => (await q(`SELECT count(*) n FROM session s JOIN "user" u ON u.id = s.user_id WHERE u.email = 'newbie@auth.test'`))[0].n;
  const beforeOut = await sessionsOf();
  await pn.evaluate(() => {
    const f = document.createElement("form");
    f.method = "post";
    f.action = "/api/logout";
    document.body.appendChild(f);
    f.submit();
  });
  await pn.waitForURL((u) => u.pathname === "/login", { timeout: 60_000 });
  const back = await pn.goto(`${BASE}/`, { timeout: 120_000 });
  ok(new URL(pn.url()).pathname === "/login", "A1 sign out → the session is gone", String(back?.status()));
  ok((await sessionsOf()) === beforeOut - 1, "A1 the signed-out session's row is deleted");
} catch (e) {
  fails++;
  console.log(`FAIL auth flow crashed — ${String(e?.message || e).split("\n")[0]}`);
  console.log(log.split("\n").filter((l) => /settings|POST|GET/.test(l)).slice(-15).join("\n"));
  if (lastPage) console.log("  at " + lastPage.url() + ": " + (await lastPage.innerText("body").catch(() => "")).slice(0, 400).replace(/\s+/g, " "));
  console.log(log.split("\n").filter((l) => /error|⨯/i.test(l)).slice(-12).join("\n"));
}
// ---- R17 E1: no password sign-in; the admin emergency path works with the token + an admin address, and only so ----
try {
  const post = (body, ip) => fetch(`${BASE}/api/emergency`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) });
  ok((await fetch(`${BASE}/api/login`, { method: "POST", redirect: "manual" })).status === 410, "E1 /api/login → 410");
  const login = await (await fetch(`${BASE}/login`)).text();
  ok(!/type="password"/.test(login), "E1 no password field on /login");
  ok((await post({ token: "wrong".repeat(10), email: ADMIN }, "10.0.0.1")).status === 401, "E1 wrong token → 401");
  ok((await post({ token: EMERGENCY, email: "someone@else.test" }, "10.0.0.2")).status === 401, "E1 right token, not an admin → 401");
  const good = await post({ token: EMERGENCY, email: ADMIN }, "10.0.0.3");
  const cookie = good.headers.getSetCookie().find((c) => c.startsWith("nexus_session"))?.split(";")[0];
  ok(good.status === 200 && !!cookie, "E1 token + admin email → a session", String(good.status));
  const home = await fetch(`${BASE}/`, { headers: { cookie: cookie ?? "" }, redirect: "manual" });
  ok(home.status === 200, "E1 that session opens the app", String(home.status));
  const ev = await q(`SELECT kind FROM security_event WHERE kind LIKE 'emergency%' ORDER BY created_at`);
  ok(ev.some((r) => r.kind === "emergency_sign_in"), "E1 logged to the security log", JSON.stringify(ev));
  const codes = [];
  for (let k = 0; k < 4; k++) codes.push((await post({ token: "x".repeat(40), email: ADMIN }, "10.0.0.9")).status);
  ok(codes.slice(0, 3).every((c) => c === 401) && codes[3] === 429, "E1 3 attempts per hour per IP, then 429", codes.join(","));
} catch (e) {
  fails++;
  console.log(`FAIL E1 emergency checks crashed — ${String(e?.message || e).split("\n")[0]}`);
}
await browser.close();
stop();
db.close();
console.log(fails ? `FAIL auth flow: ${fails}` : "OK auth flow (A1 / A3 / A5, E1)");
process.exit(fails ? 1 : 0);
