// R19 B3 — the catalog: names cleaned (marks, quotes, spaces), the best name across chains (a chain that cut the name
// loses to the full one), brands without "בע"מ", sizes as number + unit, merging a barcode across chains, weighed produce
// / store codes that aren't real barcodes, the chain price as the most common one. npm run test:catalog
import assert from "node:assert/strict";
import { bestName, chainPriceOf, cleanBrand, cleanName, isRealGtin, mergeProduct, sizeOf, unitOf } from "../src/lib/prices/catalog";
import type { PriceRow } from "../src/lib/prices/parse";

const row = (o: Partial<PriceRow>): PriceRow => ({ code: "7290000000001", internal: false, name: "", manufacturer: "", country: "", quantity: null, unit: "", weighted: false, inPackage: null, price: 5, unitPrice: null, updated: null, ...o });

// Name cleanup.
assert.equal(cleanName("  *חלב  תנובה 3%  #"), "חלב תנובה 3%");
assert.equal(cleanName("קוטג'  5%  - "), "קוטג' 5%");
assert.equal(cleanName("‏במבה‏ אסם"), "במבה אסם");
// The best name: most common; a chain's cut name loses to its continuation; ties → the longer.
assert.equal(bestName(["בייבי כיף קרם גוף לפ", "בייבי כיף קרם גוף לפ", "בייבי כיף קרם גוף לפנים ולגוף"]), "בייבי כיף קרם גוף לפנים ולגוף");
assert.equal(bestName(["חלב 3% תנובה", "חלב 3% תנובה", "חלב תנובה 3 אחוז"]), "חלב 3% תנובה");
assert.equal(bestName(["פסטה", "פסטה פנה"]), "פסטה פנה");
// Brands.
assert.equal(cleanBrand('תנובה בע"מ'), "תנובה");
assert.equal(cleanBrand("Unilever Israel Ltd"), "Unilever Israel");
assert.equal(cleanBrand("לא ידוע"), null);
assert.equal(cleanBrand("שטראוס גרופ בע״מ"), "שטראוס גרופ");
// Units and sizes.
assert.equal(unitOf("100 גרם"), "g");
assert.equal(unitOf('ק"ג'), "kg");
assert.equal(unitOf("קילוגרם"), "kg");
assert.equal(unitOf('מ"ל'), "ml");
assert.equal(unitOf("ליטר"), "l");
assert.equal(unitOf("יחידות"), "u");
assert.deepEqual(sizeOf({ quantity: 215, unit: "100 גרם", weighted: false }), { qty: 215, unit: "g" });
assert.deepEqual(sizeOf({ quantity: 1000, unit: "גרם", weighted: false }), { qty: 1, unit: "kg" });
assert.deepEqual(sizeOf({ quantity: 1500, unit: 'מ"ל', weighted: false }), { qty: 1.5, unit: "l" });
assert.deepEqual(sizeOf({ quantity: 1, unit: "קילוגרם", weighted: true }), { qty: 1, unit: "kg" });
// Real barcodes vs store codes: weighed produce (short codes) and in-store EAN-13 ("2…") never merge across chains.
assert.ok(isRealGtin("7290000066318"));
assert.ok(isRealGtin("87157239"));
assert.ok(!isRealGtin("116"));
assert.ok(!isRealGtin("2000000123456"));
assert.ok(!isRealGtin("0000000000000"));
// Merge across chains by gtin.
const m = mergeProduct("7290000066318", [
  ["rami-levy", row({ code: "7290000066318", name: "חלב טרי 3% תנובה", manufacturer: 'תנובה בע"מ', quantity: 1, unit: "ליטר" })],
  ["shufersal", row({ code: "7290000066318", name: "חלב טרי 3% תנובה", manufacturer: "תנובה", quantity: 1, unit: "ליטר" })],
  ["king-store", row({ code: "7290000066318", name: "חלב 3% תנובה 1 ל", manufacturer: "לא ידוע", quantity: 1000, unit: 'מ"ל' })],
]);
assert.equal(m.name, "חלב טרי 3% תנובה");
assert.equal(m.brand, "תנובה");
assert.deepEqual([m.qty, m.unit], [1, "l"]);
assert.equal(m.chains, 3);
assert.equal(m.weighted, false);
assert.equal(m.internal, false);
assert.equal(m.section, "dairy", "the dictionary places milk in dairy");
// Weighed produce: a store code, weighted, per kg.
const w = mergeProduct("116", [["rami-levy", row({ code: "116", internal: true, name: "תפוח עץ ירוק גרנד סמיט", weighted: true, quantity: 1, unit: 'ק"ג' })]]);
assert.ok(w.internal && w.weighted && w.unit === "kg");
assert.equal(w.section, "produce");
// A long name gets a short display name.
const long = mergeProduct("7290000000002", [["shufersal", row({ name: "שוקולד חלב עם אגוזי לוז שלמים וקרם במילוי מיוחד במהדורה מוגבלת 100 גרם" })]]);
assert.ok(long.short && long.short.length <= 40, `short: ${long.short}`);
// The chain's price: the most common across its branches; ties → the lower.
assert.deepEqual(chainPriceOf([5.9, 5.9, 6.5, 4.9]), { price: 5.9, low: 4.9, high: 6.5 });
assert.equal(chainPriceOf([7, 6]).price, 6);
console.log("OK test:catalog (names, best name across chains, brands, sizes, store codes, merge by gtin, chain price)");
