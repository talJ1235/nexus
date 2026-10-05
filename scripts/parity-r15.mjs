// R15 design parity proof: each approved board (docs/design/r15/*.dc.html, rendered by evaluating its own logic class
// and expanding sc-for / sc-if / {{…}}) next to the app at the same viewport. ≤ 20 PNGs (≤ 400 KB) into
// docs/design/parity-r15/. Run against a local server in FULL mode (passkeys + recovery visible), local file DB:
//   AUTH_FULL_LOCAL=1 bash scripts/serve.sh   then   node --env-file=.env.local scripts/parity-r15.mjs [only]
// Signed-in screens use a session minted in the local file DB for the ADMIN_EMAIL user (never a remote DB).
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
async function appShot(path, viewport, { dark, plum, he, signedIn, returning } = {}) {
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
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1200);
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
if (sessionCookie) await db.execute({ sql: "DELETE FROM session WHERE user_agent = 'parity'" });
db.close();
await browser.close();
