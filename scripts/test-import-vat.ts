// Unit test for src/lib/import-vat.ts.  npx tsx scripts/test-import-vat.ts
import assert from "node:assert/strict";
import { importCheck, isForeignStore, overLimitStores } from "../src/lib/import-vat";
import { FALLBACK_RATES } from "../src/lib/money";
import type { ItemWithSources, Source } from "../src/lib/types";

const rates = FALLBACK_RATES; // 1 USD = 3.7 ILS
let n = 0;
const item = (id: string, priceUsd: number, p: Partial<ItemWithSources> = {}, storeKey = "aliexpress", currency = "USD") =>
  ({
    id, title: id, status: "to_buy", priority: "normal", quantity: 1, chosenSourceId: null, altGroupId: null, points: [], attachments: [],
    sources: [{ id: `s${++n}`, itemId: id, store: storeKey, storeKey, url: `https://${storeKey}.test/${n}`, price: priceUsd, currency, shipping: null } as Source],
    ...p,
  }) as ItemWithSources;
const opts = { rates, currency: "ILS", limitUsd: 130 };

assert.ok(isForeignStore("aliexpress", "ILS"));
assert.ok(isForeignStore("someshop", "USD"));
assert.ok(!isForeignStore("ksp", "ILS"));

// Under the limit.
let c = importCheck([item("a", 50), item("b", 60)], opts);
assert.equal(c.over, false);
assert.equal(c.totalUsd, 110);

// Over: shipping counts; 18 % VAT on the whole order; the cheapest single item that's enough is suggested.
c = importCheck([item("a", 50), item("b", 60), item("c", 25)], { ...opts, shipping: 3.7 * 5 }); // 140 USD
assert.equal(c.over, true);
assert.equal(c.totalUsd, 140);
assert.equal(c.removeUsd, 10);
assert.deepEqual(c.split.map((i) => i.id), ["c"]);
assert.ok(Math.abs(c.vat - 140 * 3.7 * 0.18) < 0.01);

// No single item is enough → biggest items until it is, never the whole order.
c = importCheck([item("a", 70), item("b", 70), item("c", 70)], opts); // 210 → remove 80
assert.deepEqual(c.split.map((i) => i.id), ["a", "b"].slice(0, 2));
assert.equal(c.split.length, 2);
// One item alone over the limit: nothing to split.
c = importCheck([item("big", 200)], opts);
assert.equal(c.over, true);
assert.deepEqual(c.split, []);

// Quantity counts.
c = importCheck([item("q", 45, { quantity: 3 })], opts);
assert.equal(c.totalUsd, 135);

// Per store: someday items are left out; local stores ignored.
const list = [item("a", 100), item("b", 40), item("s", 500, { priority: "someday" }), item("k", 900, {}, "ksp", "ILS")];
const over = overLimitStores(list, opts);
assert.deepEqual(over.map((g) => g.key), ["aliexpress"]);
assert.equal(over[0].check.totalUsd, 140);

console.log("OK import VAT: limit, shipping, VAT estimate, split suggestion, per-store grouping");
