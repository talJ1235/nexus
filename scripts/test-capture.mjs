// R18 S2 B3 — scan + photo for the supermarket, each state through the actions (built app, throwaway DB, mock AI):
//   scan: unknown barcode → named once (section kept, barcode kept for the home) → the next scan finds it at once ("found",
//   known to this home) and, while it's on the list, shows the merged count; a barcode of another product the home bought
//   (purchased row) → found; photo: a sure read matched to the home's product, an unsure read → 3 choices (the home's
//   first), the daily AI limit → "limit" (and the photo counted in the quota: feature `grocery`). R18 S3 C2: the same read
//   says receipt / list (+ lines) / unsure / not a grocery (→ Products), one AI call each.
//   npm run build && npm run test:capture
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startApp } from "./lib/test-app.mjs";

/** A valid EAN-13 from 12 digits (the check digit appended). */
const ean = (d12) => {
  const s = [...d12].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return d12 + ((10 - (s % 10)) % 10);
};
const img = (text) => `data:image/png;base64,${Buffer.from(text, "utf8").toString("base64")}`;

const app = await startApp({ db: "capture-test.db", port: Number(process.env.PORT || 3131) });
const browser = await chromium.launch();
let failed = false;
try {
  const ctx = await browser.newContext();
  await ctx.addCookies(app.cookies(app.personal, "en"));
  await ctx.addInitScript(() => localStorage.setItem("nexus.smBridge", "1"));
  const page = await ctx.newPage();
  await page.goto(`${app.base}/supermarket`);
  await page.waitForFunction(() => !!window.__nexusSm, null, { timeout: 30_000 });
  const call = (name, ...args) => page.evaluate(([n, a]) => window.__nexusSm[n](...a), [name, args]);

  // A product the home bought before, with its barcode (a purchased row).
  const bought = ean("729000000101");
  await app.db.execute({
    sql: "INSERT INTO items (id, space_id, title, list, status, priority, quantity, product_key, section, art_key, gtin, watch, purchased_at, created_at, updated_at) VALUES ('cap-bought', ?, 'Cottage cheese 5%', 'supermarket', 'purchased', 'normal', 1, 'cottage 5%', 'dairy', 'cot', ?, 0, ?, ?, ?)",
    args: [app.personal, bought, Date.now() - 86_400_000, Date.now() - 86_400_000, Date.now() - 86_400_000],
  });

  // ---- scan: unknown → named once → found next time, with the merged count while it's listed
  const fresh = ean("729000000202");
  const u = await call("smScan", fresh);
  assert.equal(u.state, "unknown", "a barcode nobody knows");
  assert.equal(u.sections.length, 3, "three section guesses");
  const named = await call("addToSupermarket", { title: "Rice crackers Pereg", section: "snack", gtin: fresh, qty: 1 });
  assert.equal(named.item.gtin, fresh, "the barcode is kept for the home");
  assert.equal(named.item.section, "snack", "the chosen section");
  const again = await call("smScan", fresh);
  assert.equal(again.state, "found");
  assert.equal(again.known, "home", "found at once the next time");
  assert.equal(again.product.title, "Rice crackers Pereg");
  assert.ok(again.listed && again.listed.id === named.item.id, "already on the list: the row it merges into");
  const merged = await call("addToSupermarket", { title: again.product.title, productKey: again.product.productKey, gtin: fresh, qty: 2 });
  assert.equal(merged.merged, true);
  assert.equal(merged.item.quantity, 3, "the merged count");

  // ---- scan: a product the home bought before (not on the list now)
  const b = await call("smScan", bought);
  assert.equal(b.state, "found");
  assert.equal(b.known, "home");
  assert.equal(b.product.title, "Cottage cheese 5%");
  assert.equal(b.product.section, "dairy");
  assert.equal(b.listed?.productKey, "cottage 5%", "the same product is on the list (the seeded row): its merged count shows");
  console.log("ok scan: unknown → named once (barcode + section kept) → found next time; merged count on the list; bought before → found (+ its listed row)");

  // ---- photo: sure read matched to the home's own product; unsure → 3 choices, the home's first
  const usedBefore = (await call("smAiAllowance")).used;
  const sure = await call("smPhoto", { image: img("mock:Cottage cheese 5%|0.9") });
  assert.equal(sure.state, "read");
  assert.equal(sure.kind, "product");
  assert.equal(sure.product.state, "matched");
  assert.equal(sure.product.product.mine, true, "matched to the home's product");
  assert.equal(sure.product.product.productKey, "cottage 5%");
  const unsure = await call("smPhoto", { image: img("mock:Cottage|0.5|Greek yogurt|Labneh") });
  assert.equal(unsure.product.state, "unsure");
  assert.equal(unsure.product.choices.length, 3);
  assert.equal(unsure.product.choices[0].mine, true, "the home's product first");
  assert.deepEqual(unsure.product.choices.slice(1).map((c) => c.mine), [false, false], "then new ones");
  const usedAfter = (await call("smAiAllowance")).used;
  assert.equal(usedAfter - usedBefore, 2, "each photo counts in the person's AI quota");
  // R18 S3 C2: the same one read says what the photo is — a receipt, a list (its lines), not sure, not a grocery.
  const receipt = await call("smPhoto", { image: img("mockreceipt:") });
  assert.equal(receipt.kind, "receipt");
  const list = await call("smPhoto", { image: img("mocklist:2 milk\nלחם\n\nhalf a kilo of tomatoes") });
  assert.equal(list.kind, "list");
  assert.deepEqual(list.lines, ["2 milk", "לחם", "half a kilo of tomatoes"], "the list's lines, blank ones dropped");
  assert.equal(list.product, null, "no product named on a list");
  const what = await call("smPhoto", { image: img("mockunsure:") });
  assert.equal(what.kind, "unsure");
  assert.ok(what.product, "not sure still carries the product reading for the switch");
  const other = await call("smPhoto", { image: img("mockother:Bluetooth headphones") });
  assert.equal(other.kind, "product");
  assert.deepEqual(other.product, { state: "other", title: "Bluetooth headphones" }, "not a grocery → Products");
  const milk = await call("smPhoto", { image: img("mockother:Milk 3%") });
  assert.notEqual(milk.product.state, "other", "the dictionary knows milk: the model's 'not a grocery' is overruled");
  assert.equal((await call("smAiAllowance")).used - usedAfter, 5, "one AI call per photo, whatever it is");
  const kinds = (await app.db.execute("SELECT feature FROM ai_usage WHERE feature = 'grocery'")).rows.length;
  assert.ok(kinds >= 2, "recorded as feature grocery");
  console.log("ok photo: sure → matched to the home's product; unsure → 3 choices (home first); counted in the quota (grocery)");

  // ---- photo: the daily limit reached → "limit" (typing and scanning still work)
  // The test user is an admin (unlimited): a normal person from here on, with a daily limit of 0.
  await app.db.execute({ sql: `UPDATE "user" SET role = 'user' WHERE id = ?`, args: [app.admin] });
  await app.db.execute({ sql: "INSERT INTO user_pref (user_id, key, value, updated_at) VALUES (?, 'ai:quota', '0', ?) ON CONFLICT (user_id, key) DO UPDATE SET value = '0'", args: [app.admin, Date.now()] });
  const lim = await call("smPhoto", { image: img("mock:Cottage cheese 5%|0.9") });
  assert.equal(lim.state, "limit");
  assert.equal((await call("smPhoto", { image: img("mocklist:milk") })).state, "limit", "every kind waits for the limit");
  assert.equal((await call("smScan", bought)).state, "found", "the barcode still works at the limit");
  const typed = await call("addToSupermarket", { title: "Labneh" });
  assert.ok(typed.item.id, "typing still works at the limit");
  console.log("ok photo at the daily limit → limit; scan + typing still work");

  // ---- the UI: the capture screen opens from the add field and reads a typed barcode
  await page.reload();
  await page.waitForSelector("[data-sm-add-scan]");
  await page.click("[data-sm-add-scan]");
  await page.waitForSelector("[data-sm-capture]");
  await page.click("[data-cap-type-code]").catch(() => {});
  await page.fill("[data-cap-code]", bought);
  await page.click("[data-cap-lookup]");
  // Cottage cheese 5% is on the seeded list ×3: the sheet says so and adding makes it ×4.
  await page.waitForSelector('[data-cap-sheet="onlist"] [data-cap-onlist]', { timeout: 10_000 });
  const label = await page.locator("[data-cap-add]").textContent();
  assert.match(label, /now ×4/);
  await page.click("[data-cap-add]");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-sm-row]")].some((e) => e.textContent.includes("Cottage cheese 5%") && e.querySelector(".gro-q")?.textContent === "×4"), null, { timeout: 10_000 });
  console.log("ok capture screen: typed barcode → already-on-the-list sheet (×3 → ×4) → merged on the list");
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  app.stop();
}
console.log(failed ? "FAIL capture" : "OK capture");
process.exit(failed ? 1 : 0);
