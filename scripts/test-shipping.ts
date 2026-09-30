// Unit test for src/lib/shipping.ts (free-shipping gap + suggestions).  npx tsx scripts/test-shipping.ts
import assert from "node:assert/strict";
import { FALLBACK_RATES } from "../src/lib/money";
import { gapSuggestions, shippingGap, shippingRule } from "../src/lib/shipping";
import type { ItemWithSources, Source, StoreSetting } from "../src/lib/types";

const rates = FALLBACK_RATES; // 1 USD = 3.7 ILS
let n = 0;
const src = (itemId: string, storeKey: string, price: number | null, currency = "ILS", shipping: number | null = null) =>
  ({ id: `s${++n}`, itemId, store: storeKey.toUpperCase(), storeKey, url: `https://${storeKey}.test/${n}`, price, currency, shipping }) as Source;
const item = (id: string, sources: Source[], p: Partial<ItemWithSources> = {}) =>
  ({ id, title: id, status: "to_buy", priority: "normal", quantity: 1, chosenSourceId: null, altGroupId: null, points: [], attachments: [], sources, ...p }) as ItemWithSources;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

// Rules: a saved row wins over the pre-filled default; unknown store → none.
const saved: StoreSetting[] = [{ storeKey: "amazon", freeShippingMin: 200, shippingFee: 30, currency: "ILS", updatedAt: 0 }];
assert.equal(shippingRule("amazon", saved)?.freeShippingMin, 200);
assert.equal(shippingRule("amazon", saved)?.saved, true);
assert.deepEqual(shippingRule("amazon", []), { freeShippingMin: 49, shippingFee: null, currency: "USD", saved: false });
assert.equal(shippingRule("ksp", []), null);

// Gap: under the threshold → fee charged, remaining; converted from the rule's currency.
const rule = { freeShippingMin: 200, shippingFee: 30, currency: "ILS" };
let g = shippingGap(150, rule, rates, "ILS");
assert.deepEqual([g.threshold, g.fee, g.subtotal, g.remaining, g.free], [200, 30, 180, 50, false]);
near(g.progress, 0.75);
g = shippingGap(200, rule, rates, "ILS");
assert.deepEqual([g.fee, g.subtotal, g.remaining, g.free, g.progress], [0, 200, 0, true, 1]);
g = shippingGap(10, rule, rates, "USD");
near(g.threshold!, 200 / 3.7);
near(g.remaining, 200 / 3.7 - 10);
// FX rounding: a hair under still counts as free.
assert.equal(shippingGap(199.999, rule, rates, "ILS").free, true);
// No threshold: fee only; no suggestions.
g = shippingGap(80, { freeShippingMin: null, shippingFee: 20, currency: "ILS" }, rates, "ILS");
assert.deepEqual([g.threshold, g.fee, g.subtotal, g.remaining], [null, 20, 100, 0]);
assert.deepEqual(gapSuggestions("amazon", g, [], [], rates, "ILS"), []);
// Empty order: no fee.
assert.equal(shippingGap(0, rule, rates, "ILS").fee, 0);

// Suggestions for amazon (gap 50): (a) switches cheapest-difference first, then (b) someday items.
const a1 = item("in-order-amazon", [src("in-order-amazon", "amazon", 150)]);
const sw1 = item("ksp-cheaper-at-amazon", [src("ksp-cheaper-at-amazon", "ksp", 60), src("ksp-cheaper-at-amazon", "amazon", 70)], { chosenSourceId: null });
// Chosen at ksp though amazon is cheaper → switching saves money.
const sw2Sources = [src("x", "ksp", 90), src("x", "amazon", 40, "ILS", 5)];
const sw2 = item("chosen-ksp", sw2Sources, { chosenSourceId: sw2Sources[0].id, quantity: 2 });
const noAmazon = item("only-ksp", [src("only-ksp", "ksp", 10)]);
const unpricedAtAmazon = item("unpriced", [src("unpriced", "ksp", 10), src("unpriced", "amazon", null)]);
const sd1 = item("someday-small", [src("someday-small", "amazon", 20)], { priority: "someday" });
const sd2 = item("someday-big", [src("someday-big", "amazon", 80)], { priority: "someday" });
const sd3 = item("someday-closer", [src("someday-closer", "amazon", 55)], { priority: "someday" });
const sdElsewhere = item("someday-ksp", [src("someday-ksp", "ksp", 500)], { priority: "someday" });
g = shippingGap(150, rule, rates, "ILS");
const out = gapSuggestions("amazon", g, [a1, sw1, sw2, noAmazon, unpricedAtAmazon], [sd1, sd2, sd3, sdElsewhere], rates, "ILS", 10);
assert.deepEqual(
  out.map((x) => [x.kind, x.item.id]),
  [
    ["switch", "chosen-ksp"],
    ["switch", "ksp-cheaper-at-amazon"],
    ["include", "someday-closer"],
    ["include", "someday-big"],
    ["include", "someday-small"],
  ],
);
const first = out[0];
assert.ok(first.kind === "switch");
if (first.kind === "switch") {
  assert.equal(first.sourceId, sw2Sources[1].id);
  near(first.adds, 90); // (40 + 5 shipping) × 2
  near(first.diff, 90 - 180); // cheaper by 90
  assert.equal(first.closes, true);
  assert.equal(first.fromStore, "KSP");
}
const second = out[1];
if (second.kind === "switch") {
  near(second.diff, 10);
  assert.equal(second.closes, true);
}
assert.equal(out[4].closes, false); // 20 < 50
// Limit keeps the order.
assert.deepEqual(gapSuggestions("amazon", g, [a1, sw1, sw2], [sd1, sd2, sd3], rates, "ILS", 3).map((x) => x.item.id), ["chosen-ksp", "ksp-cheaper-at-amazon", "someday-closer"]);
// Reached free shipping → nothing to suggest.
assert.deepEqual(gapSuggestions("amazon", shippingGap(250, rule, rates, "ILS"), [sw1], [sd1], rates, "ILS"), []);

console.log("OK shipping");
