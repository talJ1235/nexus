// R18 S2 design parity proof: each board (docs/design/r18/*.dc.html, rendered with scripts/lib/board.mjs) next to the app
// at the same viewport for its main states — phone 390 (+ 360), desktop 1366, light + dark, Graphite + Plum, he + en.
// PNGs (≤ 400 KB each) into docs/design/parity-r18/ (`OUT=dir` writes elsewhere while iterating). Runs its own server on a
// throwaway DB (scripts/lib/test-app.mjs: migrated + demo seeds incl. the supermarket demo, scripts/lib/seed-sm.mjs).
//   npm run build && node scripts/parity-r18.mjs [only-prefix]
import { mkdirSync, statSync } from "node:fs";
import { chromium } from "playwright";
import { renderBoard } from "./lib/board.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { startApp } from "./lib/test-app.mjs";
import { PHONE_UA } from "./lib/phone.mjs";

const OUT = process.env.OUT || "docs/design/parity-r18";
const MOCK = "docs/design/r18";
const ONLY = process.argv[2];
mkdirSync(OUT, { recursive: true });
const DESK = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 360, height: 780 };
const EN = { language: "English" };
const HE = { language: "עברית" };

const app = await startApp({ db: "parity-r18.db", port: Number(process.env.PORT || 3118) });
const BASE = app.base;
await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
const browser = await chromium.launch();

async function mockShot(name, props, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await renderBoard(p, MOCK, name, { motion: "reduced", ...props });
  await p.waitForTimeout(900);
  const buf = await p.screenshot();
  await ctx.close();
  return buf;
}
async function appShot(path, viewport, opts = {}) {
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true, userAgent: PHONE_UA } : {}), colorScheme: opts.dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript((m) => {
    localStorage.setItem("theme", m);
    const d = new Date();
    localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    sessionStorage.setItem("nexus.opened", "1");
  }, opts.dark ? "dark" : "light");
  await ctx.addCookies([...app.cookies(opts.space ?? app.personal, opts.he ? "he" : "en"), { name: "nexus_palette", value: opts.plum ? "plum" : "graphite", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  if (opts.wait) await page.waitForSelector(opts.wait, { timeout: 30000 }).catch(() => console.log(`  (no ${opts.wait} on ${path})`));
  await page.waitForTimeout(900);
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
  if (statSync(path).size > 400_000 && w > 200) return compose(file, cells, Math.round(w * 0.82));
  console.log(`OK ${path} (${Math.round(statSync(path).size / 1024)} KB)`);
}

const SM = "[data-sm-view] [data-sm-row]";
const tiles = async (p) => {
  await p.click("[data-sm-more]");
  await p.click('[data-sm-layout-pick="tiles"]');
};
const SHOTS = [
  // A2 — the Supermarket tab.
  ["a2-main-phone", [["board · normal", "Supermarket-phone", { ...EN, state: "normal" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM }], ["board · he dark plum", "Supermarket-phone", { ...HE, state: "normal", dark: true, palette: "plum" }, PHONE], ["app · he dark plum", "/supermarket", PHONE, { wait: SM, he: true, dark: true, plum: true }]], 300],
  ["a2-tiles-first-360", [["board · tiles", "Supermarket-phone", { ...EN, layout: "tiles" }, PHONE], ["app · tiles", "/supermarket", PHONE, { wait: SM, act: tiles }], ["board · first time", "Supermarket-phone", { ...EN, state: "first time" }, PHONE], ["app · first time (empty space)", "/supermarket", PHONE, { wait: "[data-sm-first]", space: "ad_home" }], ["app · 360 dark", "/supermarket", NARROW, { wait: SM, dark: true }]], 260],
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
