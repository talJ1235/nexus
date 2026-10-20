// R19 D6 — the list's estimate (header, Home "Next shop", trip bar, start screen, store mode): rows with their product
// use the store's price with the deal that fits; rows without one fall back to the last price paid; weighed products
// count kg (pieces × the home's kg per piece); nothing priced → null. Also the row's own price (D1). npm run test:estimate
import assert from "node:assert/strict";
import { estimateList, rowPrice, type Shelf, type ShelfItem } from "../src/components/app/supermarket/shelf";

const item = (o: Partial<ShelfItem>): ShelfItem => ({ gtin: "1", name: "", short: null, brand: null, qty: null, unit: null, weighted: false, imageUrl: null, section: null, price: 5, unitPrice: null, deals: [], ...o });
const shelf: Shelf = {
  chain: "shufersal",
  branchId: null,
  branchName: null,
  updatedAt: 0,
  stale: false,
  items: {
    yog: item({ price: 4.1, deals: [{ kind: "n_for", n: 4, price: 12, rate: null, club: false, minBasket: null, ends: null, description: "4 ב-12" }] }),
    pen: item({ price: 7.5, qty: 500, unit: "g" }),
    ban: item({ price: 7.9, weighted: true, unit: "kg", qty: 1 }),
    gone: item({ price: null }),
  },
};
const row = (id: string, o: Partial<{ productKey: string | null; quantity: number; count: number | null; amount: number | null; unit: string | null }> = {}) => ({ id, productKey: id, quantity: 1, count: null, amount: null, unit: null, ...o });

// 4 yogurts on "4 for ₪12" = ₪12; 2 penne = ₪15; 6 bananas at 0.15 kg each = 0.9 kg × ₪7.9 = ₪7.11.
assert.equal(estimateList([row("yog", { quantity: 4 }), row("pen", { quantity: 2 }), row("ban", { quantity: 6 })], { shelf, unitKg: { ban: 0.15 } }), 34.11);
// A row without its product (or not sold there) → the last price paid; none at all → not counted.
assert.equal(estimateList([row("gone", { quantity: 2 }), row("milk", { quantity: 2 })], { shelf, last: { gone: 3, milk: 6.9 } }), 19.8);
assert.equal(estimateList([row("tahini")], { shelf, last: {} }), null);
// A weight said in kg is the kg.
assert.equal(estimateList([row("ban", { amount: 1.5, unit: "kg" })], { shelf }), 11.85);
// No shelf at all (no store yet) = the old estimate from the last prices.
assert.equal(estimateList([row("pen", { quantity: 2 })], { last: { pen: 6.5 } }), 13);
// The row's own price: the deal's total + the struck regular one, ₪ per 100 g.
const rp = rowPrice({ quantity: 4, count: null, amount: null, unit: null }, shelf.items.yog, null)!;
assert.deepEqual([rp.total, rp.regular, rp.deal?.hint], [12, 16.4, "have"]);
const pen = rowPrice({ quantity: 1, count: null, amount: null, unit: null }, shelf.items.pen, null)!;
assert.deepEqual(pen.per, { v: 1.5, unit: "100g" });
const three = rowPrice({ quantity: 3, count: null, amount: null, unit: null }, shelf.items.yog, null)!;
assert.equal(three.deal?.hint, "take", "3 yogurts + 4 for ₪12 → worth taking 4");
assert.equal(rowPrice({ quantity: 1, count: null, amount: null, unit: null }, shelf.items.gone, null), null);
console.log("OK test:estimate (store prices + deals, last-paid fallback, weighed kg, no store, the row's price)");
