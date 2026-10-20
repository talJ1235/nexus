// R19 D1 — deal maths: "N for ₪X" below / at / above N (and "worth taking N"), a deal price, % off, the 2nd at a price
// or %, club deals, a minimum basket, weighed products; reading the Promo files' descriptions + fields. npm run test:deals
import assert from "node:assert/strict";
import { applyDeal, bestDeal, dealOf, type Deal } from "../src/lib/prices/deals";

const D = (o: Partial<Deal>): Deal => ({ kind: "other", n: 1, price: null, rate: null, club: false, minBasket: null, ends: null, description: "", ...o });
const promo = (description: string, more: Record<string, unknown> = {}) => dealOf({ description, minQty: null, discountedPrice: null, discountRate: null, reward: null, club: false, minBasket: null, end: null, ...more } as Parameters<typeof dealOf>[0]);

// Reading deals.
assert.deepEqual([promo("קוטג' 5% 3 ב-15").kind, promo("קוטג' 5% 3 ב-15").n, promo("קוטג' 5% 3 ב-15").price], ["n_for", 3, 15]);
assert.deepEqual([promo("2 יח' ב 10 ₪").kind, promo("2 יח' ב 10 ₪").n, promo("2 יח' ב 10 ₪").price], ["n_for", 2, 10]);
assert.deepEqual([promo("מיץ ענבים ב11.90 כולל").kind, promo("מיץ ענבים ב11.90 כולל").price], ["price", 11.9]);
assert.deepEqual([promo("20% הנחה על כל המדף").kind, promo("20% הנחה על כל המדף").rate], ["pct", 20]);
assert.deepEqual([promo("1+1 על שמפו").kind, promo("1+1 על שמפו").price], ["second", 0]);
assert.deepEqual([promo("השני ב-50%").kind, promo("השני ב-50%").rate], ["second", 50]);
// Fields when the words don't say: MinQty 3 with a bundle total / with a per-unit price.
assert.deepEqual([promo("מבצע יוגורט", { minQty: 3, discountedPrice: 12 }).kind, promo("מבצע יוגורט", { minQty: 3, discountedPrice: 12 }).price], ["n_for", 12]);
assert.equal(promo("4 ב-12 יוגורט", { minQty: 4, discountedPrice: 3 }).price, 12, "a per-unit DiscountedPrice is turned into the bundle total");
assert.equal(promo("מבצע", { discountRate: 15 }).kind, "pct");
assert.equal(promo("בשר טחון", { club: true, discountedPrice: 39.9 }).club, true);
assert.equal(promo("עד 75 ש\"ח", { minBasket: 75, discountedPrice: 9.9 }).minBasket, 75);

// N for ₪X at a ₪6 unit price.
const three = D({ kind: "n_for", n: 3, price: 15 });
assert.equal(applyDeal(three, 1, 6).hint, "none", "1 of 3: ₪15 for 3 is far from ₪6 — just the deal line, no nudge");
assert.deepEqual(applyDeal(three, 2, 6), { total: 12, regular: 12, saved: 0, hint: "take", take: 1 }, "2 of 3: worth taking 3 (₪15 instead of ₪12)");
assert.deepEqual(applyDeal(three, 3, 6), { total: 15, regular: 18, saved: 3, hint: "have", take: 0 }, "at N: you have 3");
assert.deepEqual(applyDeal(three, 4, 6), { total: 21, regular: 24, saved: 3, hint: "have", take: 0 }, "above N: one bundle + the 4th at the full price");
assert.deepEqual(applyDeal(three, 5, 6), { total: 27, regular: 30, saved: 3, hint: "take", take: 1 }, "5: the 6th makes the second bundle");
assert.deepEqual(applyDeal(three, 6, 6), { total: 30, regular: 36, saved: 6, hint: "have", take: 0 });
// A bundle that costs more than buying them one by one is no deal.
assert.equal(applyDeal(D({ kind: "n_for", n: 2, price: 13 }), 2, 6).hint, "none");
// "Worth taking" only when filling the bundle costs about what's on the list now: 1 at ₪10 vs 4 for ₪30 → not worth it.
assert.equal(applyDeal(D({ kind: "n_for", n: 4, price: 30 }), 1, 10).hint, "none");
// A deal price, % off, the 2nd.
assert.deepEqual(applyDeal(D({ kind: "price", price: 4.9 }), 2, 5.9).total, 9.8);
assert.equal(applyDeal(D({ kind: "price", price: 6.9 }), 2, 5.9).hint, "none", "a 'deal' above the shelf price doesn't apply");
assert.equal(applyDeal(D({ kind: "pct", rate: 20 }), 2, 10).total, 16);
assert.deepEqual(applyDeal(D({ kind: "second", n: 2, rate: 50 }), 2, 10), { total: 15, regular: 20, saved: 5, hint: "have", take: 0 });
assert.deepEqual(applyDeal(D({ kind: "second", n: 2, rate: 50 }), 1, 10).hint, "take");
assert.equal(applyDeal(D({ kind: "second", n: 2, price: 0 }), 2, 10).total, 10, "1+1");
// Club: not a member → no deal; a minimum basket not reached → no deal.
assert.equal(applyDeal(D({ kind: "price", price: 8.9, club: true }), 1, 9.9, { club: false }).hint, "none");
assert.equal(applyDeal(D({ kind: "price", price: 8.9, club: true }), 1, 9.9).total, 8.9);
assert.equal(applyDeal(D({ kind: "price", price: 8.9, minBasket: 100 }), 1, 9.9, { basket: 60 }).hint, "none");
// Weighed: a per-kg price applies to the weight, bundles never.
assert.equal(applyDeal(D({ kind: "price", price: 29.9 }), 1.5, 39.9, { weighted: true }).total, 44.85);
assert.equal(applyDeal(D({ kind: "n_for", n: 2, price: 50 }), 2, 39.9, { weighted: true }).hint, "none");
// The best of several: the lowest total.
const best = bestDeal([D({ kind: "pct", rate: 10 }), D({ kind: "n_for", n: 2, price: 9 })], 2, 6);
assert.equal(best?.deal.kind, "n_for");
assert.equal(best?.use.total, 9);
assert.equal(bestDeal([], 2, 6), null);
console.log("OK test:deals (N for X below / at / above, worth taking, price, %, 2nd, 1+1, club, min basket, weighed, best of several)");
