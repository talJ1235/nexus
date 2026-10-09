// R17 Session 2 design parity proof: each approved board (docs/design/r17/*.dc.html, rendered with scripts/lib/board.mjs)
// next to the app at the same viewport, for every board × its main states. ≤ 20 PNGs (≤ 400 KB) into
// docs/design/parity-r17/ (`OUT=dir` writes elsewhere while iterating). Runs its own server on a throwaway DB
// (scripts/lib/test-app.mjs: migrated + demo seeds) plus the admin demo people (scripts/lib/seed-admin.mjs).
//   npm run build && node scripts/parity-r17.mjs [only-prefix]
import { mkdirSync, statSync } from "node:fs";
import { chromium } from "playwright";
import { renderBoard } from "./lib/board.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { startApp } from "./lib/test-app.mjs";

const OUT = process.env.OUT || "docs/design/parity-r17";
const MOCK = "docs/design/r17";
const ONLY = process.argv[2];
mkdirSync(OUT, { recursive: true });
const DESK = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };

const app = await startApp({ db: "parity-r17.db", port: Number(process.env.PORT || 3117), env: { NEXUS_ONBOARDING_TEST: "1" } });
const BASE = app.base;
await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
/** Presence goes stale after 75 s: put the online ones back to "a few seconds ago" before each shot. */
async function freshen() {
  const now = Date.now();
  await app.db.execute({ sql: "UPDATE presence SET updated_at = ? WHERE session_id IN ('ads_noa_p', 'ads_yoav', 'ads_maya')", args: [now - 8000] });
  await app.db.execute({ sql: "UPDATE presence SET updated_at = ? WHERE session_id = 'ads_ron'", args: [now - 18 * 60_000] });
}

const browser = await chromium.launch();
async function mockShot(name, props, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await renderBoard(p, MOCK, name, props);
  const buf = await p.screenshot();
  await ctx.close();
  return buf;
}
async function appShot(path, viewport, opts = {}) {
  await freshen();
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}), colorScheme: opts.dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript((m) => {
    localStorage.setItem("theme", m);
    const d = new Date();
    localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    sessionStorage.setItem("nexus.opened", "1");
  }, opts.dark ? "dark" : "light");
  await ctx.addCookies([...app.cookies(app.personal, opts.he ? "he" : "en"), { name: "nexus_palette", value: opts.plum ? "plum" : "graphite", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  if (opts.wait) await page.waitForSelector(opts.wait, { timeout: 30000 }).catch(() => console.log(`  (no ${opts.wait} on ${path})`));
  await page.waitForTimeout(700);
  if (opts.act) {
    await opts.act(page);
    await page.waitForTimeout(700);
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
  if (statSync(path).size > 400_000 && w > 240) return compose(file, cells, Math.round(w * 0.82));
  console.log(`OK ${path} (${Math.round(statSync(path).size / 1024)} KB)`);
}

const W = { live: "[data-live-stats], [data-live]", people: "[data-person-row]", person: "[data-person-ai]", invites: "[data-codes]", ai: "[data-ai-stats]", reports: "[data-report]", errors: "[data-errors-admin]", system: "[data-system]" };
const holdHalf = async (p) => {
  const b = p.locator("[data-person-hold]").first();
  await b.hover();
  await p.mouse.down();
  await p.waitForTimeout(900);
};
const SHOTS = [
  ["g1-live-desktop", [["board · live", "Admin-desktop", { tab: "live" }, DESK], ["app", "/admin", DESK, { wait: W.live }]], 640],
  ["g1-live-desktop-plum-dark-he", [["board · plum dark", "Admin-desktop", { tab: "live", dark: true, palette: "plum" }, DESK], ["app · plum dark he", "/admin", DESK, { wait: W.live, dark: true, plum: true, he: true }]], 640],
  ["g2-people-drawer", [["board · people + drawer", "Admin-desktop", { tab: "people", drawer: true }, DESK], ["app", "/admin/people/ad_noa", DESK, { wait: W.person, act: holdHalf }]], 640],
  ["g3-invites-g4-ai", [["board · invites", "Admin-desktop", { tab: "invites" }, DESK], ["app", "/admin/invites", DESK, { wait: W.invites }], ["board · AI", "Admin-desktop", { tab: "ai" }, DESK], ["app", "/admin/ai", DESK, { wait: W.ai }]], 520],
  ["g5-reports-g6-errors", [["board · reports", "Admin-desktop", { tab: "reports" }, DESK], ["app", "/admin/reports", DESK, { wait: W.reports }], ["board · errors", "Admin-desktop", { tab: "errors" }, DESK], ["app", "/admin/errors", DESK, { wait: W.errors }]], 520],
  ["g7-system-1280-dark", [["board · system", "Admin-desktop", { tab: "system" }, DESK], ["app", "/admin/system", DESK, { wait: W.system }], ["app · people 1280×720 dark", "/admin/people", { width: 1280, height: 720 }, { wait: W.people, dark: true }]], 520],
  ["g-phone-live-people", [["board · live", "Admin-phone", { page: "live" }, PHONE], ["app", "/admin", PHONE, { wait: W.live }], ["board · people", "Admin-phone", { page: "people" }, PHONE], ["app", "/admin/people", PHONE, { wait: W.people }]], 300],
  ["g-phone-person-reports-more", [["board · person", "Admin-phone", { page: "person" }, PHONE], ["app", "/admin/people/ad_noa", PHONE, { wait: W.person }], ["board · reports", "Admin-phone", { page: "reports" }, PHONE], ["app", "/admin/reports", PHONE, { wait: "[data-report-row]" }], ["board · more", "Admin-phone", { page: "more" }, PHONE], ["app", "/admin/more", PHONE, { wait: "[data-admin-more]" }]], 260],
  ["g-phone-he-dark-plum", [["app · live he dark", "/admin", PHONE, { wait: W.live, he: true, dark: true }], ["app · person he plum", "/admin/people/ad_noa", PHONE, { wait: W.person, he: true, plum: true }], ["app · people 360", "/admin/people", { width: 360, height: 740 }, { wait: W.people }]], 300],
];

try {
  for (const [file, cells, w] of SHOTS) {
    if (ONLY && !file.startsWith(ONLY)) continue;
    const bufs = [];
    for (const c of cells) {
      if (typeof c[1] === "string" && c[1].startsWith("/")) bufs.push([c[0], await appShot(c[1], c[2], c[3])]);
      else bufs.push([c[0], await mockShot(c[1], c[2], c[3])]);
    }
    await compose(file, bufs, w);
  }
} finally {
  await browser.close();
  app.stop();
}
process.exit(0);
