// R15 design parity proof: each approved board (docs/design/r15/*.dc.html, rendered by evaluating its own logic class
// and expanding sc-for / sc-if / {{…}}) next to the app at the same viewport. ≤ 20 PNGs (≤ 400 KB) into
// docs/design/parity-r15/. Run against a local server in FULL mode (passkeys + recovery visible), local file DB:
//   AUTH_FULL_LOCAL=1 bash scripts/serve.sh   then   node --env-file=.env.local scripts/parity-r15.mjs [only]
// Signed-in screens use a session minted in the local file DB for the ADMIN_EMAIL user (never a remote DB).
// Part C (spaces-*): a "Cohen home" space with two people is added to that file DB for the shots and removed after;
// run them on a throwaway DB: SEED_PROFILE=sparse bash scripts/serve-fresh.sh, then
//   BASE=http://localhost:3102 TURSO_DATABASE_URL=file:sparse-smoke.db node --env-file=.env.local scripts/parity-r15.mjs spaces
import { createClient } from "@libsql/client";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const OUT = "docs/design/parity-r15";
const MOCK = "docs/design/r15";
const ONLY = process.argv[2];
const SECRET = process.env.BETTER_AUTH_SECRET;
const DBURL = process.env.TURSO_DATABASE_URL ?? "file:local.db";
if (!DBURL.startsWith("file:")) throw new Error("parity-r15 only mints sessions in a local file DB");
mkdirSync(OUT, { recursive: true });

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// ---- a session for the admin user + the returning-account chip (same formats as Better Auth / lib/auth) ----
const db = createClient({ url: DBURL });
const admin = (await db.execute({ sql: `SELECT id, name, email FROM "user" WHERE email = ?`, args: [String(process.env.ADMIN_EMAIL ?? "").toLowerCase()] })).rows[0];
let sessionCookie = null;
let lastCookie = null;
if (admin && SECRET) {
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, 'parity', 'passkey')`, args: [`parity_${token.slice(0, 10)}`, now + 3_600_000, token, now, now, admin.id] });
  sessionCookie = encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
  const body = Buffer.from(JSON.stringify({ name: String(admin.name).split(" ")[0], email: admin.email, exp: now + 86_400_000 })).toString("base64url");
  lastCookie = `${body}.${createHmac("sha256", SECRET).update(`v1:${body}`).digest("base64url")}`;
}

// ---- the boards ----
function renderBoard(name, props) {
  const src = readFileSync(`${MOCK}/${name}.dc.html`, "utf8");
  const script = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const Component = new Function("DCLogic", `${script}; return Component;`)(class {
    constructor(p) {
      this.props = p;
    }
  });
  const vals = new Component(props).renderVals();
  let tpl = src.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
  const helmet = (tpl.match(/<helmet>([\s\S]*?)<\/helmet>/) ?? [, ""])[1];
  tpl = tpl.replace(/<helmet>[\s\S]*?<\/helmet>/, "");
  tpl = tpl.replace(/<sc-for list="\{\{(\w+)\}\}" as="(\w+)"[^>]*>([\s\S]*?)<\/sc-for>/g, (_, list, as, inner) => (vals[list] ?? []).map((it) => inner.replace(new RegExp(`\\{\\{${as}\\.(\\w+)\\}\\}`, "g"), (_m, k) => it[k])).join(""));
  for (let guard = 0; guard < 50 && /<sc-if/.test(tpl); guard++) tpl = tpl.replace(/<sc-if value="\{\{(\w+)\}\}"[^>]*>((?:(?!<sc-if)[\s\S])*?)<\/sc-if>/g, (_, k, inner) => (vals[k] ? inner : ""));
  tpl = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k] ?? "");
  const css = readFileSync(`${MOCK}/nx.css`, "utf8");
  const dir = /<html[^>]*dir="rtl"/.test(src) ? ' dir="rtl"' : "";
  return `<!doctype html><html${dir}><head><meta charset="utf-8"><style>${css}</style>${helmet}</head><body style="margin:0">${tpl}</body></html>`;
}

const browser = await chromium.launch();
async function mockShot(name, props, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(renderBoard(name, props), { waitUntil: "load" });
  await p.waitForTimeout(900);
  const buf = await p.screenshot();
  await ctx.close();
  return buf;
}
async function appShot(path, viewport, { dark, plum, he, signedIn, returning, space, act } = {}) {
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}), colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((m) => {
    localStorage.setItem("theme", m);
    localStorage.setItem("nexus.bootDay", "x");
    sessionStorage.setItem("nexus.opened", "1");
  }, dark ? "dark" : "light");
  const cookies = [
    { name: "nexus_palette", value: plum ? "plum" : "graphite", url: BASE },
    { name: "nexus_locale", value: he ? "he" : "en", url: BASE },
  ];
  if (signedIn && sessionCookie) cookies.push({ name: "nexus_session_dev", value: sessionCookie, url: BASE });
  if (returning && lastCookie) cookies.push({ name: "nexus_last", value: lastCookie, url: BASE });
  if (space) cookies.push({ name: "nexus_space", value: space, url: BASE });
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1200);
  if (act) {
    await act(p);
    await p.waitForTimeout(700);
  }
  const buf = await p.screenshot();
  await ctx.close();
  return buf;
}
async function compose(file, cells, w) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const tile = ([label, buf]) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${buf.toString("base64")}" width="${w}"></figure>`;
  await p.setContent(`<style>body{margin:0;background:#888;font:600 13px system-ui}#c{display:inline-flex;gap:8px;padding:8px}figure{margin:0}figcaption{color:#fff;padding:0 0 6px}img{display:block}</style><div id="c">${cells.map(tile).join("")}</div>`);
  const path = `${OUT}/${file}.png`;
  await p.locator("#c").screenshot({ path, type: "png" });
  await ctx.close();
  // Keep each file ≤ 400 KB: re-shoot smaller when needed.
  if (statSync(path).size > 400_000 && w > 300) return compose(file, cells, Math.round(w * 0.8));
  console.log(`OK ${path} (${Math.round(statSync(path).size / 1024)} KB)`);
}

const themes = [
  ["graphite-light", { dark: false, palette: "graphite" }, {}],
  ["graphite-dark", { dark: true, palette: "graphite" }, { dark: true }],
  ["plum-light", { dark: false, palette: "plum" }, { plum: true }],
  ["plum-dark", { dark: true, palette: "plum" }, { dark: true, plum: true }],
];
const SHOTS = [];
for (const [t, mp, ap] of themes) {
  SHOTS.push([`login-desktop-${t}`, "SignIn-desktop", { ...mp, state: "returning", mode: "full" }, "/login", DESK, { ...ap, returning: true }, 700]);
  SHOTS.push([`login-phone-${t}`, "SignIn-phone", { ...mp, state: "returning", mode: "full" }, "/login", PHONE, { ...ap, returning: true }, 390]);
}
SHOTS.push(["login-phone-he", "SignIn-he", { dark: false, palette: "graphite" }, "/login", PHONE, { he: true }, 390]);
SHOTS.push(["recovery-phone", "Recovery-phone", { state: "email" }, "/login/recover", PHONE, {}, 390]);
SHOTS.push(["invite-only-phone", "InviteOnly-phone", { state: "no-invite" }, "/login?error=invite_required", PHONE, {}, 390]);
SHOTS.push(["passkey-phone", "Passkey-phone", { state: "offer" }, "/passkey?next=/", PHONE, { signedIn: true }, 390]);
SHOTS.push(["welcome-phone", "Welcome-phone", {}, "/welcome", PHONE, { signedIn: true }, 390]);
SHOTS.push(["security-desktop", "Security-desktop", {}, "/settings/security", { width: 1440, height: 1040 }, { signedIn: true }, 700]);
SHOTS.push(["security-phone-dark", "Security-phone", { dark: true }, "/settings/security", PHONE, { signedIn: true, dark: true }, 390]);
SHOTS.push(["invites-admin-desktop", "InvitesAdmin-desktop", {}, "/settings/invites", DESK, { signedIn: true }, 700]);

for (const [file, board, props, path, vp, app, w] of SHOTS) {
  if (ONLY && !file.includes(ONLY)) continue;
  const [m, a] = [await mockShot(board, props, vp), await appShot(path, vp, app)];
  await compose(file, [["mockup", m], ["app", a]], w);
}

// ---- Part C (spaces): mockup | app pairs, two pairs per file ----
let shared = null;
let joinToken = null;
if (admin && (!ONLY || "spaces".includes(ONLY) || ONLY.startsWith("spaces"))) {
  const now = Date.now();
  shared = "parity_cohen";
  await db.execute({ sql: "DELETE FROM space_member WHERE space_id = ?", args: [shared] });
  await db.execute({ sql: "DELETE FROM space WHERE id = ?", args: [shared] });
  await db.execute({ sql: "INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES (?, 'Cohen home', 's-parity', 'shared', 'ILS', 'green', 'home', ?, ?)", args: [shared, admin.id, now] });
  await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)", args: ["pm_admin", shared, admin.id, now] });
  for (const [uid, name, email, role] of [["parity_noa", "Noa Cohen", "noa.cohen@example.com", "member"], ["parity_yoav", "Yoav Cohen", "yoav.c@example.com", "viewer"]]) {
    await db.execute({ sql: `INSERT OR IGNORE INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'user', ?, ?)`, args: [uid, name, email, now, now] });
    await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)", args: [`pm_${uid}`, shared, uid, role, now + 1] });
  }
  joinToken = randomBytes(32).toString("base64url");
  const { createHash } = await import("node:crypto");
  await db.execute({ sql: "DELETE FROM space_invite WHERE space_id = ?", args: [shared] });
  await db.execute({ sql: "INSERT INTO space_invite (id, token_hash, space_id, role, max_uses, uses, expires_at, created_by, created_at) VALUES ('pi_parity', ?, ?, 'member', 5, 0, ?, ?, ?)", args: [createHash("sha256").update(joinToken).digest("hex"), shared, now + 6.5 * 86_400_000, admin.id, now] });
}
const ready = (p) => p.waitForSelector("[data-app-shell][data-ready]", { timeout: 20000 });
const SPACES = [
  ["spaces-switcher", [
    ["Switcher-desktop", {}, "/", DESK, { signedIn: true, space: shared, act: async (p) => { await ready(p); await p.click("[data-space-switcher]"); } }, "mockup · desktop", "app · desktop"],
    ["Switcher-phone", {}, "/", PHONE, { signedIn: true, space: shared, act: async (p) => { await ready(p); await p.click("[data-phone-space]"); } }, "mockup · phone", "app · phone"],
  ], 520],
  ["spaces-create-invite", [
    ["CreateSpace-desktop", { step: "details" }, "/", DESK, { signedIn: true, space: shared, act: async (p) => { await ready(p); await p.click("[data-space-switcher]"); await p.click("[data-space-create]"); await p.fill("#space-name", "Cohen home"); } }, "mockup · create", "app · create"],
    ["Invite-phone", {}, "/", PHONE, { signedIn: true, space: shared, act: async (p) => { await ready(p); await p.click("[data-phone-space]"); await p.click("[data-space-invite]"); await p.waitForSelector("[data-invite-qr-toggle]:not([disabled])"); await p.click("[data-invite-qr-toggle]"); await p.waitForSelector('[data-invite-qr="ready"]', { timeout: 15000 }); } }, "mockup · invite", "app · invite"],
  ], 520],
  ["spaces-join", [
    ["Join-phone", { state: "preview" }, () => `/join/${joinToken}`, PHONE, {}, "mockup · preview", "app · preview (signed out)"],
    ["Join-phone", { state: "expired" }, "/join/" + "x".repeat(43), PHONE, {}, "mockup · expired", "app · dead link"],
  ], 330],
  ["spaces-settings", [
    ["SpaceSettings-desktop", {}, "/", { width: 1440, height: 960 }, { signedIn: true, space: shared, act: async (p) => { await ready(p); await p.click("[data-space-switcher]"); await p.click("[data-space-settings]"); await p.waitForSelector("[data-person]"); } }, "mockup · settings", "app · settings"],
    ["Dialogs-desktop", { dialog: "delete-space" }, "/", DESK, { signedIn: true, space: shared, act: async (p) => { await ready(p); await p.click("[data-space-switcher]"); await p.click("[data-space-settings]"); await p.waitForSelector("[data-person]"); await p.click("[data-space-delete]"); await p.fill("[data-delete-typed]", "Cohen ho"); } }, "mockup · delete", "app · delete"],
  ], 520],
];
for (const [file, pairs, w] of SPACES) {
  if (!shared || (ONLY && !file.includes(ONLY))) continue;
  const cells = [];
  for (const [board, props, path, vp, app, ml, al] of pairs) {
    cells.push([ml, await mockShot(board, props, vp)]);
    cells.push([al, await appShot(typeof path === "function" ? path() : path, vp, app)]);
  }
  await compose(file, cells, w);
}
if (shared) {
  await db.execute({ sql: "DELETE FROM space_invite WHERE space_id = ?", args: [shared] });
  await db.execute({ sql: "DELETE FROM space_member WHERE space_id = ?", args: [shared] });
  await db.execute({ sql: "DELETE FROM space WHERE id = ?", args: [shared] });
  await db.execute({ sql: `DELETE FROM "user" WHERE id IN ('parity_noa', 'parity_yoav')` });
}
if (sessionCookie) await db.execute({ sql: "DELETE FROM session WHERE user_agent = 'parity'" });
db.close();
await browser.close();
