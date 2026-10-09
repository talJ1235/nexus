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

/** The admin's onboarding at a step, with the board's default answers. */
async function obAt(step, patch = {}) {
  const v = { v: 1, status: "active", step, why: ["home", "super"], stores: ["shufersal", "rami-levy", "ikea", "aliexpress"], custom: [], budget: 2500, currency: "ILS", who: "family", sharedSpaceId: null, notif: null, installed: false, at: Date.now(), ...patch };
  await app.db.execute({ sql: "INSERT INTO user_pref (user_id, key, value, updated_at) VALUES (?, 'pref:onboarding', ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value", args: [app.admin, JSON.stringify(v), Date.now()] });
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
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}), ...(opts.ua ? { userAgent: opts.ua } : {}), colorScheme: opts.dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript((m) => {
    localStorage.setItem("theme", m);
    const d = new Date();
    localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    sessionStorage.setItem("nexus.opened", "1");
  }, opts.dark ? "dark" : "light");
  await ctx.addCookies([...app.cookies(app.personal, opts.he ? "he" : "en"), { name: "nexus_palette", value: opts.plum ? "plum" : "graphite", url: BASE }]);
  if (opts.ob) await obAt(opts.ob.step, opts.ob.patch);
  // Headless Chromium never offers an install: hand the page a stand-in beforeinstallprompt (the step under test).
  if (opts.installable)
    await ctx.addInitScript(() => {
      const add = window.addEventListener.bind(window);
      window.addEventListener = (type, fn, o) => {
        add(type, fn, o);
        if (type === "beforeinstallprompt") setTimeout(() => fn(Object.assign(new Event("beforeinstallprompt"), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "accepted" }) })), 0);
      };
    });
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
  ["g1-live-desktop", [["board · live", "Admin-desktop", { tab: "live" }, DESK], ["app", "/admin", DESK, { wait: W.live }], ["board · plum dark", "Admin-desktop", { tab: "live", dark: true, palette: "plum" }, DESK], ["app · plum dark he", "/admin", DESK, { wait: W.live, dark: true, plum: true, he: true }]], 520],
  ["g2-people-drawer", [["board · people + drawer", "Admin-desktop", { tab: "people", drawer: true }, DESK], ["app", "/admin/people/ad_noa", DESK, { wait: W.person, act: holdHalf }]], 640],
  ["g3-invites-g4-ai", [["board · invites", "Admin-desktop", { tab: "invites" }, DESK], ["app", "/admin/invites", DESK, { wait: W.invites }], ["board · AI", "Admin-desktop", { tab: "ai" }, DESK], ["app", "/admin/ai", DESK, { wait: W.ai }]], 520],
  ["g5-reports-g6-errors", [["board · reports", "Admin-desktop", { tab: "reports" }, DESK], ["app", "/admin/reports", DESK, { wait: W.reports }], ["board · errors", "Admin-desktop", { tab: "errors" }, DESK], ["app", "/admin/errors", DESK, { wait: W.errors }]], 520],
  ["g7-system-1280-dark", [["board · system", "Admin-desktop", { tab: "system" }, DESK], ["app", "/admin/system", DESK, { wait: W.system }], ["app · people 1280×720 dark", "/admin/people", { width: 1280, height: 720 }, { wait: W.people, dark: true }]], 520],
  ["g-phone-live-people", [["board · live", "Admin-phone", { page: "live" }, PHONE], ["app", "/admin", PHONE, { wait: W.live }], ["board · people", "Admin-phone", { page: "people" }, PHONE], ["app", "/admin/people", PHONE, { wait: W.people }]], 300],
  ["g-phone-person-reports-more", [["board · person", "Admin-phone", { page: "person" }, PHONE], ["app", "/admin/people/ad_noa", PHONE, { wait: W.person }], ["board · reports", "Admin-phone", { page: "reports" }, PHONE], ["app", "/admin/reports", PHONE, { wait: "[data-report-row]" }], ["board · more", "Admin-phone", { page: "more" }, PHONE], ["app", "/admin/more", PHONE, { wait: "[data-admin-more]" }]], 260],
  ["g-phone-he-dark-plum", [["app · live he dark", "/admin", PHONE, { wait: W.live, he: true, dark: true }], ["app · person he plum", "/admin/people/ad_noa", PHONE, { wait: W.person, he: true, plum: true }], ["app · people 360", "/admin/people", { width: 360, height: 740 }, { wait: W.people }]], 300],
];
const OB = "[data-ob-step]";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ob = (step, extra = {}) => ({ wait: OB, ob: { step, patch: extra.patch }, installable: step === 5, ...extra });
SHOTS.push(
  ["h-phone-1-2", [["board · 1 why", "Onboarding-phone", { step: "1 why" }, PHONE], ["app", "/welcome", PHONE, ob(1)], ["board · 2 stores", "Onboarding-phone", { step: "2 stores" }, PHONE], ["app", "/welcome", PHONE, ob(2)]], 300],
  ["h-phone-3-4", [["board · 3 budget", "Onboarding-phone", { step: "3 budget" }, PHONE], ["app", "/welcome", PHONE, ob(3)], ["board · 4 who", "Onboarding-phone", { step: "4 who" }, PHONE], ["app", "/welcome", PHONE, ob(4)]], 300],
  ["h-phone-5-6-7", [["board · 5 install", "Onboarding-phone", { step: "5 install" }, PHONE], ["app", "/welcome", PHONE, ob(5)], ["board · 6 notifications", "Onboarding-phone", { step: "6 notifications" }, PHONE], ["app", "/welcome", PHONE, ob(6)], ["board · 7 done", "Onboarding-phone", { step: "7 done" }, PHONE], ["app", "/welcome", PHONE, ob(7)]], 240],
  ["h-phone-iphone-he-dark", [["board · 5 iPhone (he)", "Onboarding-phone", { step: "5 install", device: "iphone", language: "עברית" }, PHONE], ["app · iPhone he", "/welcome", PHONE, { ...ob(5), installable: false, he: true, ua: IPHONE }], ["board · 1 why (he, dark)", "Onboarding-phone", { step: "1 why", language: "עברית", dark: true }, PHONE], ["app · he dark", "/welcome", PHONE, ob(1, { he: true, dark: true })]], 300],
  ["h-desktop-1-3", [["board · 1 why", "Onboarding-desktop", { step: "1 why" }, DESK], ["app", "/welcome", DESK, ob(1)], ["board · 3 budget", "Onboarding-desktop", { step: "3 budget" }, DESK], ["app", "/welcome", DESK, ob(3)]], 520],
  ["h-desktop-4-5-7", [["board · 4 who (plum dark he)", "Onboarding-desktop", { step: "4 who", palette: "plum", dark: true, language: "עברית" }, DESK], ["app", "/welcome", DESK, ob(4, { plum: true, dark: true, he: true })], ["board · 5 install", "Onboarding-desktop", { step: "5 install" }, DESK], ["app", "/welcome", DESK, ob(5)], ["board · 7 done", "Onboarding-desktop", { step: "7 done" }, DESK], ["app", "/welcome", DESK, ob(7)]], 420],
);

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
