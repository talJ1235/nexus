// R18 S2 design parity proof: each board (docs/design/r18/*.dc.html, rendered with scripts/lib/board.mjs) next to the app
// at the same viewport for its main states — phone 390 (+ 360), desktop 1366, light + dark, Graphite + Plum, he + en.
// PNGs (≤ 400 KB each) into docs/design/parity-r18/ (`OUT=dir` writes elsewhere while iterating). Runs its own server on a
// throwaway DB (scripts/lib/test-app.mjs: migrated + demo seeds incl. the supermarket demo, scripts/lib/seed-sm.mjs).
//   npm run build && node scripts/parity-r18.mjs [only-prefix]
import { mkdirSync, statSync } from "node:fs";
import { chromium } from "playwright";
import { renderBoard } from "./lib/board.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { seedInbox } from "./lib/seed-notify.mjs";
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

// An AI key (calls are mocked: NEXUS_AI_MOCK) — the floating Ask (R18 S5 C) shows only when the assistant is available.
const app = await startApp({ db: "parity-r18.db", port: Number(process.env.PORT || 3118), env: { GEMINI_API_KEY: "mock" } });
const BASE = app.base;
await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
const browser = await chromium.launch();

async function mockShot(name, props, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  // R18 S5: "s5:<board>" = a board from docs/design/r18-s5; R19: "r19:<board>" from docs/design/r19.
  const s5 = name.startsWith("s5:");
  const r19 = name.startsWith("r19:");
  await renderBoard(p, s5 ? "docs/design/r18-s5" : r19 ? "docs/design/r19" : MOCK, s5 ? name.slice(3) : r19 ? name.slice(4) : name, { motion: "reduced", ...props });
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
  // F2: `fresh` = a new person who hasn't done onboarding (the /welcome flow).
  const who = opts.fresh ? (await freshPerson(opts.he ? "he" : "en")).cookies : app.cookies(opts.space ?? app.personal, opts.he ? "he" : "en");
  await ctx.addCookies([...who, { name: "nexus_palette", value: opts.plum ? "plum" : "graphite", url: BASE }]);
  await tripOn(!!opts.trip);
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
let freshN = 0;
async function freshPerson(locale) {
  const id = `parity_ob_${Date.now()}_${++freshN}`;
  const now = Date.now();
  await app.db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, 'Tal', ?, 1, 'user', ?, ?)`, args: [id, `${id}@example.com`, now, now] });
  return app.sessionFor(id, { locale });
}
/** Onboarding: why = supermarket → stores (Shufersal) → chains (+ Rami Levy) [→ branch]. */
const obTo = (phase) => async (p) => {
  await p.waitForSelector("[data-ob-step]");
  await p.click('[data-ob-why="super"]');
  await p.click("[data-ob-primary]");
  await p.waitForSelector('[data-ob-store="shufersal"]');
  await p.click('[data-ob-store="shufersal"]');
  await p.click("[data-ob-primary]");
  await p.waitForSelector("[data-ob-chains]");
  await p.click('[data-ob-chain="rami-levy"]');
  if (phase === "branch") {
    await p.click("[data-ob-primary]");
    await p.waitForSelector("[data-ob-branch]");
    await p.fill("[data-ob-branch-input]", "Herzl St., Modi'in");
  }
};
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
const addType = (text, steppers = false) => async (p) => {
  await p.click("[data-sm-add-open]");
  await p.fill("[data-add-input]", text);
  await p.waitForSelector("[data-add-hit]", { timeout: 8000 }).catch(() => {});
  if (steppers) await p.click("[data-add-measure]").catch(() => {});
};
const addPaste = async (p) => {
  await p.click("[data-sm-add-open]");
  await p.click("[data-add-chip=paste]");
  await p.fill("[data-add-paste]", ["Noa: for tomorrow", "milk", "2 cucumbers", "toilet paper!!", "something nice for Shabbat"].join(String.fromCharCode(10)));
};
const scanCode = (code) => async (p) => {
  await p.click("[data-sm-add-scan]");
  await p.click("[data-cap-type-code]").catch(() => {});
  await p.fill("[data-cap-code]", code);
  await p.click("[data-cap-lookup]");
  await p.waitForSelector("[data-cap-sheet=unknown], [data-cap-sheet=found]", { timeout: 8000 }).catch(() => {});
};
const openRow = (title) => async (p) => {
  await p.locator(`[data-sm-row]:has-text("${title}") [data-sm-row-tile]`).first().click();
  await p.waitForSelector("[data-sm-sheet] [data-learned]", { timeout: 10000 }).catch(() => {});
};
const storeIn = async (p) => {
  await p.click("[data-sm-start]");
  await p.click("[data-store-go]");
  await p.waitForSelector("[data-store-row]");
  const rows = p.locator("[data-store-row]");
  await rows.nth(3).click();
  await rows.nth(4).click();
};
const openLists = async (p) => {
  await p.click("[data-sm-more]");
  await p.click("[data-sm-menu-lists]");
  await p.waitForSelector("[data-sm-lists] [data-sm-template]");
};
const openTemplate = async (p) => {
  await openLists(p);
  await p.locator("[data-sm-template]").first().click();
  await p.waitForSelector("[data-sm-template-page]");
};
const openPast = async (p) => {
  await openLists(p);
  await p.click('[data-sm-lists-tab="past"]');
  await p.waitForSelector("[data-sm-trip]");
};
/** A1: hold the dock's "+" (the quick menu: Add to list · Scan · Photo · Start shopping). */
const longPlus = async (p) => {
  const plus = p.locator('[data-dock-target="plus"]');
  await plus.waitFor();
  const b = await plus.boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.mouse.up();
  await p.waitForSelector('[data-quick-menu="open"] [data-quick]');
};
/** R18 S5: Continue until onboarding shows step `k` (the stores step's chains phase takes one more Continue). */
function obStep(k) {
  return async (p) => {
    await p.waitForSelector("[data-ob-step]", { timeout: 20000 });
    for (let i = 0; i < 12; i++) {
      const at = Number(await p.getAttribute("[data-ob-step]", "data-ob-step").catch(() => 0));
      if (at === k) break;
      await p.click("[data-ob-primary]");
      await p.waitForTimeout(700);
    }
  };
}
const SHOTS = [
  // A1 — navigation: the dock's long-press menu and Products' segments.
  ["a1-nav", [["board · long-press +", "Nav-phone", { ...EN, screen: "long-press +" }, PHONE], ["app", "/?v=to_buy", PHONE, { wait: '[data-dock-target="plus"]', act: longPlus }], ["board · Products · To buy", "Nav-phone", { ...EN, screen: "Products · To buy" }, PHONE], ["app", "/?v=to_buy", PHONE, { wait: '[data-dock-target="plus"]' }], ["board · he dark", "Nav-phone", { ...HE, screen: "long-press +", dark: true }, PHONE], ["app · he dark", "/?v=to_buy", PHONE, { wait: '[data-dock-target="plus"]', he: true, dark: true, act: longPlus }]], 300],
  // A2 — the Supermarket tab.
  ["a2-main-phone", [["board · normal", "Supermarket-phone", { ...EN, state: "normal" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM }], ["board · he dark plum", "Supermarket-phone", { ...HE, state: "normal", dark: true, palette: "plum" }, PHONE], ["app · he dark plum", "/supermarket", PHONE, { wait: SM, he: true, dark: true, plum: true }]], 300],
  ["a2-tiles-first-360", [["board · tiles", "Supermarket-phone", { ...EN, layout: "tiles" }, PHONE], ["app · tiles", "/supermarket", PHONE, { wait: SM, act: tiles }], ["board · first time", "Supermarket-phone", { ...EN, state: "first time" }, PHONE], ["app · first time (empty space)", "/supermarket", PHONE, { wait: "[data-sm-first]", space: "ad_home" }], ["app · 360 dark", "/supermarket", NARROW, { wait: SM, dark: true }]], 260],
  // A3 — Home "Next shop" card + the trip bar (a trip of 23 with 12 checked, ₪187.40 so far).
  ["a3-home-card", [["board · normal", "HomeCard-phone", { ...EN, state: "normal" }, PHONE], ["app", "/", PHONE, { wait: "[data-next-card]" }], ["board · trip in progress", "HomeCard-phone", { ...EN, state: "trip in progress" }, PHONE], ["app · trip", "/", PHONE, { wait: "[data-trip-card]", trip: true }]], 300],
  ["a3-trip-bar", [["board · mine", "TripBar-phone", { ...EN, trip: "I am shopping" }, PHONE], ["app · Products", "/?v=to_buy", PHONE, { wait: "[data-trip-bar]", trip: true }], ["board · he dark", "TripBar-phone", { ...HE, trip: "I am shopping", dark: true }, PHONE], ["app · he dark Insights", "/?v=spending", PHONE, { wait: "[data-trip-bar]", trip: true, he: true, dark: true }]], 300],
  // B2 — the Add screen: type-ahead, a quantity merged into a row on the list, a pasted list.
  ["b2-add", [["board · type-ahead", "Add-phone", { ...EN, state: "type-ahead" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: addType("mil") }], ["board · quantity", "Add-phone", { ...EN, state: "quantity parse" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: addType("2 milk 3%", true) }], ["board · paste", "Add-phone", { ...EN, state: "paste a list" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: addPaste }], ["board · he dark", "Add-phone", { ...HE, state: "type-ahead", dark: true }, PHONE], ["app · he dark", "/supermarket", PHONE, { wait: SM, he: true, dark: true, act: addType("חל") }]], 240],
  // B3 — capture: an unknown barcode (name it once) and the photo mode at rest (headless has no camera: dark frame).
  ["b3-capture", [["board · unknown barcode", "Capture-phone", { ...EN, state: "scan · unknown barcode" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: scanCode("7290000002025") }], ["board · photo aiming", "Capture-phone", { ...EN, state: "photo · aiming" }, PHONE], ["app · photo", "/supermarket", PHONE, { wait: SM, act: async (p) => { await p.click("[data-sm-add-photo]"); } }]], 300],
  // C2 — the item sheet (tomatoes: count + weight, regular) and a suggestion's actions.
  ["c2-item-sheet", [["board · item sheet", "ItemSheet-phone", { ...EN, view: "item sheet", product: "tomatoes (count + weight)", "what Nexus knows": "regular" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: openRow("Tomatoes") }], ["board · suggestion actions", "ItemSheet-phone", { ...EN, view: "suggestion actions" }, PHONE], ["app", "/supermarket", PHONE, { wait: "[data-sm-sug]", act: async (p) => { await p.locator("[data-sm-sug-open]").first().click(); } }], ["board · he dark", "ItemSheet-phone", { ...HE, view: "item sheet", dark: true }, PHONE], ["app · he dark", "/supermarket", PHONE, { wait: SM, he: true, dark: true, act: openRow("Tomatoes") }]], 280],
  // D2 — the store picker and the section order with the learned suggestion.
  ["d2-store-order", [["board · picker", "Store-phone", { ...EN, state: "store picker" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: async (p) => { await p.click("[data-sm-store]"); await p.waitForSelector("[data-store-picker]"); } }], ["board · learned order", "Store-phone", { ...EN, state: "section order · learned suggestion" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: async (p) => { await p.click("[data-sm-more]"); await p.click("[data-sm-menu-order]"); await p.waitForSelector("[data-order-list]"); } }], ["app · he dark search", "/supermarket", PHONE, { wait: SM, he: true, dark: true, act: async (p) => { await p.click("[data-sm-store]"); await p.fill("[data-store-search]", "רמי לוי רחובות"); } }]], 280],
  // D3 — store mode: the start screen, in progress (two rows checked), the finish summary.
  ["d3-store-mode", [["board · start", "StoreMode-phone", { ...EN, state: "start" }, PHONE], ["app", "/supermarket", PHONE, { wait: "[data-sm-start]", act: async (p) => { await p.click("[data-sm-start]"); await p.waitForSelector("[data-store-start]"); } }], ["board · in progress", "StoreMode-phone", { ...EN, state: "in progress" }, PHONE], ["app", "/supermarket", PHONE, { wait: "[data-sm-start]", act: storeIn }], ["board · summary", "Finish-phone", { ...EN, step: "summary" }, PHONE], ["app", "/supermarket", PHONE, { wait: "[data-sm-start]", act: async (p) => { await storeIn(p); await p.click("[data-store-finish]"); await p.click("[data-store-finish-confirm]"); await p.waitForSelector("[data-store-summary]"); } }]], 260],
  // D4 — the supermarket pushes in the inbox (the draft, sent from the computer, adds while you shopped: own badges).
  ["d4-push-inbox", [["board · inbox", "Push-phone", { ...EN, state: "inbox" }, PHONE], ["app", "/inbox", PHONE, { wait: "[data-kind=draft]" }], ["board · he dark", "Push-phone", { ...HE, state: "inbox", dark: true }, PHONE], ["app · he dark plum", "/inbox", PHONE, { wait: "[data-kind=draft]", he: true, dark: true, plum: true }]], 300],
  // E1 — templates: the list (routine offer, Made by Nexus, a person's), the Nexus template's page, the apply sheet.
  ["e1-templates", [["board · templates", "Lists-phone", { ...EN, state: "templates" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: openLists }], ["board · template open", "Lists-phone", { ...EN, state: "template open" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: openTemplate }], ["board · apply", "Lists-phone", { ...EN, state: "apply a template" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: async (p) => { await openTemplate(p); await p.click("[data-sm-template-apply]"); await p.waitForSelector("[data-sm-apply-line]"); } }], ["board · he dark plum", "Lists-phone", { ...HE, state: "templates", dark: true, palette: "plum" }, PHONE], ["app · he dark plum", "/supermarket", PHONE, { wait: SM, he: true, dark: true, plum: true, act: openLists }]], 240],
  // E2 — past trips by month, a past trip open, editing a template.
  ["e2-past-edit", [["board · past trips", "Lists-phone", { ...EN, state: "past trips" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: openPast }], ["board · past trip open", "Lists-phone", { ...EN, state: "past trip open" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: async (p) => { await openPast(p); await p.locator("[data-sm-trip]").first().click(); await p.waitForSelector("[data-sm-trip-page]"); } }], ["board · edit", "Lists-phone", { ...EN, state: "edit a template" }, PHONE], ["app", "/supermarket", PHONE, { wait: SM, act: async (p) => { await openTemplate(p); await p.click("[data-sm-template-edit]"); await p.waitForSelector("[data-sm-template-editor]"); } }], ["board · he dark", "Lists-phone", { ...HE, state: "past trips", dark: true }, PHONE], ["app · he dark", "/supermarket", PHONE, { wait: SM, he: true, dark: true, act: openPast }]], 240],
  // F1 — Settings → Supermarket and What Nexus learned (phone pages; desktop label + control columns).
  ["f1-settings-phone", [["board · supermarket", "Settings-phone", { ...EN, state: "settings · supermarket" }, PHONE], ["app", "/settings/supermarket", PHONE, { wait: "[data-settings-sm]" }], ["board · learned", "Settings-phone", { ...EN, state: "settings · what Nexus learned" }, PHONE], ["app", "/settings/smLearned", PHONE, { wait: "[data-sm-fact]" }], ["board · he dark", "Settings-phone", { ...HE, state: "settings · what Nexus learned", dark: true }, PHONE], ["app · he dark", "/settings/smLearned", PHONE, { wait: "[data-sm-fact]", he: true, dark: true }]], 300],
  ["f1-settings-desktop", [["board", "Settings-desktop", { ...EN, section: "Supermarket" }, DESK], ["app", "/settings/supermarket", DESK, { wait: "[data-settings-sm]" }], ["board · learned", "Settings-desktop", { ...EN, section: "What Nexus learned" }, DESK], ["app", "/settings/smLearned", DESK, { wait: "[data-sm-fact]" }]], 680],
  // F2 — the onboarding store step: chains (first = main) → the main chain's branch.
  ["f2-onboarding-store", [["board · chains", "Settings-phone", { ...EN, state: "onboarding · chain" }, PHONE], ["app", "/welcome", PHONE, { fresh: true, act: obTo("chains") }], ["board · branch", "Settings-phone", { ...EN, state: "onboarding · branch" }, PHONE], ["app", "/welcome", PHONE, { fresh: true, act: obTo("branch") }], ["board · he dark", "Settings-phone", { ...HE, state: "onboarding · chain", dark: true }, PHONE], ["app · he dark", "/welcome", PHONE, { fresh: true, he: true, dark: true, act: obTo("chains") }]], 300],
  // F3 — the computer's Supermarket page: list + side panel, the item drawer, Send to phone.
  ["f3-desktop", [["board", "Supermarket-desktop", { ...EN, state: "normal" }, DESK], ["app", "/supermarket", DESK, { wait: "[data-sm-desk-templates]" }], ["board · send to phone", "Supermarket-desktop", { ...EN, state: "send to phone" }, DESK], ["app", "/supermarket", DESK, { wait: "[data-sm-desk-templates]", act: async (p) => { await p.click("[data-sm-send]"); await p.waitForSelector("[data-sm-send-target]"); } }], ["board · item open", "Supermarket-desktop", { ...EN, state: "item open" }, DESK], ["app", "/supermarket", DESK, { wait: "[data-sm-desk-templates]", act: async (p) => { await p.locator("[data-sm-desk] [data-sm-row] [data-sm-row-tile]").first().click(); await p.waitForTimeout(500); } }], ["board · he dark", "Supermarket-desktop", { ...HE, state: "normal", dark: true }, DESK], ["app · he dark", "/supermarket", DESK, { wait: "[data-sm-desk-templates]", he: true, dark: true }]], 680],
  // ---- R19 (boards in docs/design/r19, Hebrew; the app in he with the demo price files, scripts/lib/demo-prices.ts).
  ["r19-main", [["board", "r19:Main", {}, PHONE], ["app · he", "/supermarket", PHONE, { wait: "[data-sm-basket]", he: true }], ["app · he dark plum", "/supermarket", PHONE, { wait: "[data-sm-basket]", he: true, dark: true, plum: true }]], 300],
  ["r19-product", [["board", "r19:Product-phone", {}, PHONE], ["app · he", "/supermarket", PHONE, { wait: "[data-sm-basket]", he: true, act: async (p) => { await p.evaluate(() => window.dispatchEvent(new CustomEvent("nexus:sm-product", { detail: { gtin: "8076800195057", itemId: null } }))); await p.waitForSelector("[data-product-here]"); await p.waitForTimeout(600); } }]], 300],
  ["r19-product-desktop", [["board", "r19:Product-desktop", {}, DESK], ["app · he", "/supermarket", DESK, { wait: "[data-sm-basket]", he: true, act: async (p) => { await p.evaluate(() => window.dispatchEvent(new CustomEvent("nexus:sm-product", { detail: { gtin: "8076800195057", itemId: null } }))); await p.waitForSelector("[data-product-here]"); await p.waitForTimeout(600); } }]], 680],
  ["r19-compare", [["board", "r19:Compare-phone", {}, PHONE], ["app · he", "/supermarket", PHONE, { wait: "[data-sm-cheaper]", he: true, act: async (p) => { await p.waitForTimeout(1500); await p.click("[data-sm-cheaper]"); await p.waitForSelector("[data-compare-store]"); await p.waitForTimeout(500); } }]], 300],
  ["r19-stores", [["board", "r19:Stores-phone", {}, PHONE], ["app · he", "/supermarket", PHONE, { wait: "[data-sm-store]", he: true, act: async (p) => { await p.waitForTimeout(1500); await p.locator("[data-sm-store]").first().click(); await p.waitForSelector("[data-store-chains]"); await p.waitForTimeout(500); } }]], 300],
  ["r19-match", [["board", "r19:Match-phone", {}, PHONE], ["app · he", "/supermarket", PHONE, { wait: "[data-sm-choose]", he: true, act: async (p) => { await p.locator("[data-sm-choose]").first().click(); await p.waitForSelector("[data-choose-option]"); await p.waitForTimeout(500); } }]], 300],
  ["r19-fixes", [["board", "r19:Fixes-phone", { state: "+ menu on Home" }, PHONE], ["app · he", "/", PHONE, { wait: "[data-dock]", he: true, act: async (p) => { await p.waitForTimeout(1500); await p.click('[data-dock-target="plus"]'); await p.waitForTimeout(500); } }]], 300],
  // ---- R18 S5 (boards in docs/design/r18-s5, their default state next to the app).
  // A — the list v2 (one card, section bands, 60 px rows, add bar), phone + computer.
  ["s5-a-list", [["board", "s5:List-phone", EN, PHONE], ["app", "/supermarket", PHONE, { wait: SM }], ["app · he dark", "/supermarket", PHONE, { wait: SM, he: true, dark: true }]], 300],
  ["s5-a-list-desktop", [["board", "s5:List-desktop", EN, DESK], ["app", "/supermarket", DESK, { wait: "[data-sm-desk-templates]" }]], 680],
  // B — the start screen in the person's colour.
  ["s5-b-start", [["board", "s5:StartTrip-phone", EN, PHONE], ["app", "/supermarket", PHONE, { wait: "[data-sm-start]", act: async (p) => { await p.click("[data-sm-start]"); await p.waitForSelector("[data-store-start]"); } }]], 300],
  // C — the floating Ask (final: pearl + ring).
  ["s5-c-ask", [["board", "s5:Ask-final-phone", EN, { width: 1330, height: 760 }], ["app · light", "/", PHONE, { wait: "[data-ask-fab]" }], ["app · dark plum", "/", PHONE, { wait: "[data-ask-fab]", dark: true, plum: true }]], 300],
  // D — Home widgets v2, phone + computer.
  ["s5-d-home", [["board", "s5:Home-widgets-phone", EN, PHONE], ["app", "/", PHONE, { wait: "[data-home]" }], ["app · he dark", "/", PHONE, { wait: "[data-home]", he: true, dark: true }]], 300],
  ["s5-d-home-desktop", [["board", "s5:Home-widgets-desktop", EN, DESK], ["app", "/", DESK, { wait: "[data-home]" }]], 680],
  // E — Spending's month, phone + computer.
  ["s5-e-spending", [["board", "s5:Spending-month-phone", EN, PHONE], ["app", "/?v=spending", PHONE, { wait: "[data-spm-hero]" }], ["app · he dark", "/?v=spending", PHONE, { wait: "[data-spm-hero]", he: true, dark: true }]], 300],
  ["s5-e-spending-desktop", [["board", "s5:Spending-month-desktop", EN, DESK], ["app", "/?v=spending", DESK, { wait: "[data-spm-hero]" }]], 680],
  // F — onboarding's new steps (2 your home, 4 how you shop).
  ["s5-f-onboarding", [["board", "s5:Onboarding-v2-phone", EN, PHONE], ["app · step 2", "/welcome", PHONE, { fresh: true, act: obStep(2) }], ["app · step 4", "/welcome", PHONE, { fresh: true, act: obStep(4) }], ["app · step 5 he dark", "/welcome", PHONE, { fresh: true, he: true, dark: true, act: obStep(5) }]], 300],
];

/** A trip of mine in the personal space: 23 planned, the first 12 listed rows checked with their prices. */
async function tripOn(on) {
  // Every shot starts with no open trip of mine (store mode's shots start one through the app).
  await app.db.execute({ sql: "DELETE FROM trip_check WHERE trip_id IN (SELECT id FROM trip WHERE space_id = ? AND user_id = ? AND finished_at IS NULL)", args: [app.personal, app.admin] });
  await app.db.execute({ sql: "DELETE FROM trip WHERE space_id = ? AND user_id = ? AND finished_at IS NULL", args: [app.personal, app.admin] });
  if (!on) return;
  const now = Date.now();
  await app.db.execute({ sql: "INSERT INTO trip (id, space_id, user_id, chain, branch, started_at, planned, currency) VALUES ('parity-trip', ?, ?, 'shufersal', 'Herzl St.', ?, 23, 'ILS')", args: [app.personal, app.admin, now - 25 * 60_000] });
  const rows = (await app.db.execute({ sql: "SELECT id, product_key, section FROM items WHERE space_id = ? AND list = 'supermarket' AND status = 'to_buy' ORDER BY created_at LIMIT 12", args: [app.personal] })).rows;
  const prices = [7.9, 6.9, 7.2, 6, 9.8, 44.9, 19.8, 13, 12.9, 17.7, 18.9, 22.3];
  for (const [k, r] of rows.entries())
    await app.db.execute({ sql: "INSERT INTO trip_check (space_id, trip_id, item_id, product_key, section, action, price, by_user, at, seq) VALUES (?, 'parity-trip', ?, ?, ?, 'check', ?, ?, ?, ?)", args: [app.personal, r.id, r.product_key, r.section, prices[k], app.admin, now - (20 - k) * 60_000, k + 1] });
}

try {
  for (const [file, cells, w] of SHOTS) {
    if (ONLY && !file.startsWith(ONLY)) continue;
    if (file.startsWith("d4")) await seedInbox(app.db, { userId: app.admin, spaceId: app.personal, supermarket: true });
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
