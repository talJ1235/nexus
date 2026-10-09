// R17 G1 acceptance — Live: two signed sessions (Noa on a phone viewport, Yoav on a desktop) show as online within one
// poll with the right device and screen; Yoav entering shopping mode shows the amber chip with the count; Noa with no
// beat for 75 s moves to "Earlier today"; an added item is one activity row with a count and no title; a visible admin
// tab makes ≤ 1 request per 5 s and a hidden one makes none.
//   npm run build && npm run test:admin-live
import { chromium } from "playwright";
import { actionTable, callAction } from "./lib/actions.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { startApp } from "./lib/test-app.mjs";

let fails = 0;
const ok = (c, m, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : ` ${extra}`}`);
  if (!c) fails++;
};

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const app = await startApp({ db: "admin-live-test.db", port: Number(process.env.PORT || 3123) });
const browser = await chromium.launch();
try {
  const x = (sql, args = []) => app.db.execute({ sql, args });
  await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
  await x("DELETE FROM presence");
  await x("DELETE FROM activity");
  const now = Date.now();
  for (let k = 1; k <= 3; k++) await x("INSERT INTO items (id, space_id, title, status, created_at, updated_at) VALUES (?, 'ad_home', ?, 'to_buy', ?, ?)", [`live_i${k}`, `Live test item ${k}`, now, now]);

  const noa = await app.sessionFor("ad_noa", { ua: ANDROID, space: "ad_home" });
  const yoav = await app.sessionFor("ad_yoav", { space: "ad_home" });
  const noaCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ANDROID });
  await noaCtx.addCookies(noa.cookies);
  const yoavCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await yoavCtx.addCookies(yoav.cookies);
  const pn = await noaCtx.newPage();
  const py = await yoavCtx.newPage();
  await Promise.all([pn.goto(`${app.base}/`), py.goto(`${app.base}/`)]);
  await Promise.all([pn.waitForSelector("[data-app-shell][data-ready]", { timeout: 60_000 }), py.waitForSelector("[data-app-shell][data-ready]", { timeout: 60_000 })]);

  const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await adminCtx.addCookies(app.cookies(app.personal));
  const pa = await adminCtx.newPage();
  const t0 = Date.now();
  await pa.goto(`${app.base}/admin`);
  const row = (id) => pa.locator(`[data-live-row="${id}"]`);
  await pa.waitForSelector('[data-live-row="ad_noa"][data-device="phone"][data-screen="home"]', { timeout: 12_000 }).catch(() => {});
  await pa.waitForSelector('[data-live-row="ad_yoav"][data-device="computer"][data-screen="home"]', { timeout: 12_000 }).catch(() => {});
  ok((await row("ad_noa").getAttribute("data-device")) === "phone" && (await row("ad_noa").getAttribute("data-screen")) === "home", "Noa: online on a phone, on Home", `${await row("ad_noa").count()}`);
  ok((await row("ad_yoav").getAttribute("data-device")) === "computer" && (await row("ad_yoav").getAttribute("data-screen")) === "home", "Yoav: online on a computer, on Home");
  ok(Date.now() - t0 < 12_000, "both within one poll of the admin page opening", `${Date.now() - t0} ms`);

  // Yoav goes shopping (palette → Shopping mode → Everything): the chip with the count.
  await py.keyboard.press("Control+k");
  await py.click("[data-cmd-shop]");
  await py.click('[data-shop-scope="all"]');
  await pa.waitForSelector('[data-live-row="ad_yoav"] [data-live-shopping-chip]', { timeout: 12_000 }).catch(() => {});
  const chip = pa.locator('[data-live-row="ad_yoav"] [data-live-shopping-chip]');
  ok((await chip.count()) === 1 && Number(await chip.getAttribute("data-live-shopping-chip")) === 3, "Yoav in shopping mode → the amber chip, 3 left", `${await chip.count()} ${await chip.getAttribute("data-live-shopping-chip").catch(() => "")}`);
  await pa.waitForSelector('[data-event="shopping_started"]', { timeout: 8_000 }).catch(() => {});
  ok((await pa.locator('[data-event="shopping_started"]').count()) >= 1, "\"started shopping\" in the stream");

  // Noa: no beat for 75 s (her tab closes; the clock is moved past 75 s) → Earlier today.
  await noaCtx.close();
  await x("UPDATE presence SET updated_at = ? WHERE user_id = 'ad_noa'", [Date.now() - 76_000]);
  await pa.waitForSelector('[data-live-earlier-row="ad_noa"]', { timeout: 12_000 }).catch(() => {});
  ok((await pa.locator('[data-live-earlier-row="ad_noa"]').count()) === 1 && (await row("ad_noa").count()) === 0, "Noa after 75 s without a beat → Earlier today");

  // An item added (the real createItem action, as Yoav) → one activity row with a count, no title.
  const create = actionTable().find((a) => a.file === "src/app/actions.ts" && a.name === "createItem");
  const r = await callAction(app.base, yoav.header, create, [{ title: "Secret pistachio grinder", brand: null, imageUrl: null, category: null, tags: [], collectionId: null, source: null }]);
  ok(!r.failed, "createItem as Yoav", r.text.slice(0, 120));
  await pa.waitForSelector('[data-event="items_added"]', { timeout: 12_000 }).catch(() => {});
  const ev = pa.locator('[data-event="items_added"]');
  const rows = (await x("SELECT kind, n FROM activity WHERE user_id = 'ad_yoav' AND kind = 'items_added'")).rows;
  ok(rows.length === 1 && Number(rows[0].n) === 1, "one activity row: items_added × 1", JSON.stringify(rows));
  ok((await ev.count()) === 1 && /Yoav/.test(await ev.innerText()) && /1 item/.test(await ev.innerText()), "the stream shows \"Yoav added 1 item\"", await ev.innerText().catch(() => ""));
  ok(!(await pa.content()).includes("pistachio"), "the item's title is nowhere on the admin page");

  // Requests: visible → ≤ 1 per 5 s; hidden → none.
  let n = 0;
  pa.on("request", (q) => q.method() === "POST" && new URL(q.url()).pathname.startsWith("/admin") && n++);
  await pa.waitForTimeout(15_000);
  ok(n <= 4, `visible: ${n} requests in 15 s (≤ 1 per 5 s)`);
  await pa.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await pa.waitForTimeout(500);
  n = 0;
  await pa.waitForTimeout(12_000);
  ok(n === 0, `hidden: ${n} requests in 12 s`);
} finally {
  await browser.close();
  app.stop();
}
console.log(fails ? `FAIL admin-live: ${fails}` : "OK admin-live");
process.exit(fails ? 1 : 0);
