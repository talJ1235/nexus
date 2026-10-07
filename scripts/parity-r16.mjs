// R16 design parity proof (Session 2: D1–D5, E1–E2): each approved board (docs/design/r16/*.dc.html, rendered with
// scripts/lib/board.mjs) next to the app at the same viewport. ≤ 20 PNGs (≤ 400 KB) into docs/design/parity-r16/.
// Signed-in screens use a session minted in a LOCAL file DB for the ADMIN_EMAIL user; a "Cohen home" shared space with
// two more people is added for the shots and removed after. Run against the R16 server (a copy of local.db):
//   bash scripts/serve-r16.sh --fresh-copy   then   TURSO_DATABASE_URL=file:r16-smoke.db node --env-file=.env.local scripts/parity-r16.mjs [only]
// `OUT=dir` writes elsewhere (e.g. a scratch folder while iterating).
import { createClient } from "@libsql/client";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { chromium } from "playwright";
import { renderBoard } from "./lib/board.mjs";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const OUT = process.env.OUT || "docs/design/parity-r16";
const MOCK = "docs/design/r16";
const ONLY = process.argv[2];
const SECRET = process.env.BETTER_AUTH_SECRET;
const DBURL = process.env.TURSO_DATABASE_URL ?? "file:local.db";
if (!DBURL.startsWith("file:")) throw new Error("parity-r16 only mints sessions in a local file DB");
mkdirSync(OUT, { recursive: true });

const DESK = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };

const db = createClient({ url: DBURL });
const admin = (await db.execute({ sql: `SELECT id, name, email FROM "user" WHERE email = ?`, args: [String(process.env.ADMIN_EMAIL ?? "").toLowerCase()] })).rows[0];
if (!admin || !SECRET) throw new Error("needs ADMIN_EMAIL's user in the DB and BETTER_AUTH_SECRET");
const token = randomBytes(24).toString("base64url");
const now = Date.now();
await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, 'parity', 'passkey')`, args: [`parity_${token.slice(0, 10)}`, now + 3_600_000, token, now, now, admin.id] });
const sessionCookie = encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);

// The shared space for the shots.
const shared = "parity_cohen";
async function dropShared() {
  await db.execute({ sql: "DELETE FROM space_invite WHERE space_id = ?", args: [shared] });
  await db.execute({ sql: "DELETE FROM space_member WHERE space_id = ?", args: [shared] });
  await db.execute({ sql: "DELETE FROM space WHERE id = ?", args: [shared] });
  await db.execute({ sql: `DELETE FROM "user" WHERE id IN ('parity_noa', 'parity_yoav')` });
}
await dropShared();
await db.execute({ sql: "INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES (?, 'Cohen home', 's-parity', 'shared', 'ILS', 'green', 'home', ?, ?)", args: [shared, admin.id, now - 2 * 86_400_000] });
await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)", args: ["pm_admin", shared, admin.id, now] });
for (const [uid, name, email, role] of [["parity_noa", "Noa Cohen", "noa.cohen@example.com", "member"], ["parity_yoav", "Yoav Cohen", "yoav.c@example.com", "viewer"]]) {
  await db.execute({ sql: `INSERT OR IGNORE INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'user', ?, ?)`, args: [uid, name, email, now, now] });
  await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)", args: [`pm_${uid}`, shared, uid, role, now + 1] });
}
const personal = (await db.execute({ sql: "SELECT s.id FROM space s JOIN space_member m ON m.space_id = s.id WHERE m.user_id = ? AND s.kind = 'personal' LIMIT 1", args: [admin.id] })).rows[0]?.id;

const browser = await chromium.launch();
async function mockShot(name, props, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await renderBoard(p, MOCK, name, props);
  const buf = await p.screenshot();
  await ctx.close();
  return buf;
}
export async function appPage(viewport, { dark, plum, he, space, reduce } = {}) {
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}), colorScheme: dark ? "dark" : "light", reducedMotion: reduce ? "reduce" : "no-preference" });
  await ctx.addInitScript((m) => {
    localStorage.setItem("theme", m);
    localStorage.setItem("nexus.bootDay", "x");
    sessionStorage.setItem("nexus.opened", "1");
  }, dark ? "dark" : "light");
  const cookies = [
    { name: "nexus_palette", value: plum ? "plum" : "graphite", url: BASE },
    { name: "nexus_locale", value: he ? "he" : "en", url: BASE },
    { name: "nexus_session_dev", value: sessionCookie, url: BASE },
    { name: "nexus_space", value: space ?? shared, url: BASE },
  ];
  await ctx.addCookies(cookies);
  return { ctx, page: await ctx.newPage() };
}
async function appShot(path, viewport, opts = {}) {
  const { ctx, page } = await appPage(viewport, opts);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  if (opts.act) {
    await opts.act(page);
    await page.waitForTimeout(600);
  }
  const buf = await page.screenshot();
  await ctx.close();
  return buf;
}
async function compose(file, cells, w) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const tile = ([label, buf]) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${buf.toString("base64")}" width="${w}"></figure>`;
  await p.setContent(`<style>body{margin:0;background:#888;font:600 13px system-ui}#c{display:inline-flex;gap:8px;padding:8px;flex-wrap:wrap;max-width:${4 * (w + 8) + 8}px}figure{margin:0}figcaption{color:#fff;padding:0 0 6px}img{display:block}</style><div id="c">${cells.map(tile).join("")}</div>`);
  const path = `${OUT}/${file}.png`;
  await p.locator("#c").screenshot({ path, type: "png" });
  await ctx.close();
  if (statSync(path).size > 400_000 && w > 260) return compose(file, cells, Math.round(w * 0.82));
  console.log(`OK ${path} (${Math.round(statSync(path).size / 1024)} KB)`);
}

const FIXTURE = "scripts/fixtures/space-photo-gps.jpg";
const SHOTS = [
  // [file, [[label, board, props, viewport] | [label, path, viewport, opts]], width]
  ["d1-settings-account", [["mockup", "Settings-desktop", { section: "account" }, DESK], ["app", "/settings/account", DESK, {}]], 640],
  ["d1-settings-display-plum-dark", [["mockup", "Settings-desktop", { section: "display", dark: true, palette: "plum" }, DESK], ["app", "/settings/display", DESK, { dark: true, plum: true }]], 640],
  ["d1-settings-notif-ai", [["mockup · notifications", "Settings-desktop", { section: "notif" }, DESK], ["app", "/settings/notif", DESK, {}], ["mockup · AI", "Settings-desktop", { section: "ai" }, DESK], ["app", "/settings/ai", DESK, {}]], 520],
  ["d1-settings-calendar-data", [["mockup · calendar", "Settings-desktop", { section: "calendar" }, DESK], ["app", "/settings/calendar", DESK, {}], ["mockup · data", "Settings-desktop", { section: "data" }, DESK], ["app", "/settings/data", DESK, {}]], 520],
  ["d3-settings-phone", [["mockup · list", "Settings-phone", { screen: "list" }, PHONE], ["app", "/settings", PHONE, {}], ["mockup · display", "Settings-phone", { screen: "display" }, PHONE], ["app", "/settings/display", PHONE, {}]], 300],
  ["d3-settings-phone-he-dark", [["app · list (he, dark)", "/settings", PHONE, { he: true, dark: true }], ["app · account (he)", "/settings/account", PHONE, { he: true }], ["app · notifications (he)", "/settings/notif", PHONE, { he: true }]], 300],
  ["d2-space-general-people", [["mockup · general", "SpaceSettings-desktop", { section: "general" }, DESK], ["app", "/settings/general", DESK, {}], ["mockup · people", "SpaceSettings-desktop", { section: "people" }, DESK], ["app", "/settings/people", DESK, {}]], 520],
  ["d2-space-budget-danger", [["mockup · budget", "SpaceSettings-desktop", { section: "budget" }, DESK], ["app", "/settings/budget", DESK, {}], ["mockup · danger", "SpaceSettings-desktop", { section: "danger" }, DESK], ["app", "/settings/danger", DESK, {}]], 520],
  ["d2-space-phone", [["mockup · list", "SpaceSettings-phone", { screen: "list" }, PHONE], ["app", "/settings/space", PHONE, {}], ["mockup · people", "SpaceSettings-phone", { screen: "people" }, PHONE], ["app", "/settings/people", PHONE, {}]], 300],
  ["d2-space-1280", [["app · people 1280×720", "/settings/people", { width: 1280, height: 720 }, {}], ["app · general 1280×720 dark", "/settings/general", { width: 1280, height: 720 }, { dark: true }]], 640],
  [
    "d5-identity-desktop",
    [
      ["mockup · icon", "SpaceIdentity-desktop", { tab: "icon" }, DESK],
      ["app", "/settings/general", DESK, { act: async (p) => (await p.click("[data-space-look-change]"), await p.waitForSelector("[data-identity]")) }],
      ["mockup · crop", "SpaceIdentity-desktop", { tab: "photo-crop" }, DESK],
      ["app", "/settings/general", DESK, { act: async (p) => (await p.click("[data-space-look-change]"), await p.setInputFiles("[data-identity-file]", FIXTURE), await p.waitForSelector("[data-identity-cropper]")) }],
    ],
    520,
  ],
  [
    "d5-identity-phone",
    [
      ["mockup · icon", "SpaceIdentity-phone", { screen: "icon" }, PHONE],
      ["app", "/settings/space", PHONE, { act: async (p) => (await p.click("[data-edit-look]"), await p.waitForSelector("[data-identity]")) }],
      ["mockup · crop", "SpaceIdentity-phone", { screen: "crop" }, PHONE],
      ["app", "/settings/space", PHONE, { act: async (p) => (await p.click("[data-edit-look]"), await p.setInputFiles("[data-identity-file]", FIXTURE), await p.waitForSelector("[data-identity-crop]")) }],
    ],
    300,
  ],
  ["d5-create-space", [["mockup · create", "SpaceIdentity-desktop", { mode: "create" }, DESK], ["app", "/", DESK, { act: async (p) => (await p.click("[data-space-switcher]"), await p.click("[data-space-create]"), await p.fill("[data-identity-name]", "Workshop"), await p.click('[data-identity-icon="maker"]')) }]], 640],
];

for (const [file, cells, w] of SHOTS) {
  if (ONLY && !file.includes(ONLY)) continue;
  const out = [];
  for (const c of cells) {
    if (typeof c[1] === "string" && c[1].startsWith("/")) out.push([c[0], await appShot(c[1], c[2], c[3])]);
    else out.push([c[0], await mockShot(c[1], c[2], c[3])]);
  }
  await compose(file, out, w);
}

await dropShared();
await db.execute({ sql: "DELETE FROM session WHERE user_agent = 'parity'" });
if (personal) void personal;
db.close();
await browser.close();
