// Unit test for src/lib/budget.ts (monthly cap history + forecast).  npx tsx scripts/test-budget.ts
import assert from "node:assert/strict";
import { budgetState, capFor, monthForecast, monthKey, monthKeyIn, monthStartIn, nextMonthKey, shouldNotifyBudget } from "../src/lib/budget";
import { FALLBACK_RATES } from "../src/lib/money";
import type { AltGroup, ItemWithSources, Source } from "../src/lib/types";

const rates = FALLBACK_RATES; // 1 USD = 3.7 ILS
const from = new Date(2026, 9, 1).getTime();
const to = new Date(2026, 10, 1).getTime();
const inMonth = new Date(2026, 9, 10).getTime();
const lastMonth = new Date(2026, 8, 20).getTime();
let n = 0;
const item = (p: Partial<ItemWithSources> & { price?: number | null; currency?: string }) => {
  const id = `i${++n}`;
  const { price = 100, currency = "ILS", ...rest } = p;
  const src = { id: `s${n}`, itemId: id, store: "S", storeKey: "s", url: "https://s.test", price, currency, shipping: null } as Source;
  return { id, title: id, status: "to_buy", priority: "normal", quantity: 1, chosenSourceId: null, altGroupId: null, orderedAt: null, purchasedAt: null, purchasedPrice: null, purchasedCurrency: null, updatedAt: inMonth, points: [], attachments: [], sources: [src], ...rest } as ItemWithSources;
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

// Month keys + cap carried forward from the last month it was set; cleared cap → none.
assert.equal(monthKey(new Date(2026, 0, 31)), "2026-01");
assert.equal(monthKeyIn(Date.UTC(2026, 8, 30, 22, 30), "Asia/Jerusalem"), "2026-10"); // 01:30 on Oct 1 in Israel
const history = { "2026-07": { cap: 1000, currency: "ILS" }, "2026-09": { cap: 500, currency: "USD" }, "2026-11": { cap: null, currency: "ILS" } };
assert.equal(capFor("2026-06", history), null);
assert.deepEqual(capFor("2026-08", history), { cap: 1000, currency: "ILS" });
assert.deepEqual(capFor("2026-10", history), { cap: 500, currency: "USD" });
assert.equal(capFor("2026-12", history), null);

// States.
assert.equal(budgetState(100, null), "none");
assert.equal(budgetState(89.9, 100), "ok");
assert.equal(budgetState(90, 100), "near");
assert.equal(budgetState(100, 100), "near");
assert.equal(budgetState(100.5, 100), "over");

// Forecast: spent (received) + committed (ordered) this month + urgent to-buy (+ normal when toggled).
const altGroups = [{ id: "g1", name: "fan", chosenItemId: null }] as AltGroup[];
const items = [
  item({ status: "purchased", purchasedAt: inMonth, purchasedPrice: 200, purchasedCurrency: "ILS", quantity: 2 }), // spent 400
  item({ status: "purchased", orderedAt: lastMonth, purchasedAt: inMonth, purchasedPrice: 999, purchasedCurrency: "ILS" }), // ordered last month → not this month
  item({ status: "ordered", orderedAt: inMonth, purchasedPrice: 50, purchasedCurrency: "USD" }), // committed 185
  item({ status: "to_buy", priority: "urgent", price: 100 }), // forecast 100
  item({ status: "to_buy", priority: "urgent", price: null }), // unpriced
  item({ status: "to_buy", priority: "urgent", price: 300, altGroupId: "g1" }), // alternatives: only the cheaper counts
  item({ status: "to_buy", priority: "urgent", price: 120, altGroupId: "g1" }),
  item({ status: "to_buy", priority: "normal", price: 80 }), // only with includeNormal
  item({ status: "to_buy", priority: "someday", price: 5000 }), // never
];
let f = monthForecast({ items, altGroups, rates, currency: "ILS", from, to, cap: { cap: 1000, currency: "ILS" }, includeNormal: false });
near(f.spent, 400);
near(f.committed, 185);
near(f.forecast, 220);
assert.equal(f.forecastCount, 3);
assert.equal(f.unpriced, 1);
near(f.total, 805);
assert.equal(f.cap, 1000);
assert.equal(f.state, "ok");
f = monthForecast({ items, altGroups, rates, currency: "ILS", from, to, cap: { cap: 1000, currency: "ILS" }, includeNormal: true });
near(f.forecast, 300);
assert.equal(f.forecastCount, 4);
near(f.total, 885);
// Cap in another currency, near and over.
f = monthForecast({ items, altGroups, rates, currency: "ILS", from, to, cap: { cap: 235, currency: "USD" }, includeNormal: true }); // 869.5
assert.equal(f.state, "over");
near(f.cap!, 869.5);
f = monthForecast({ items, altGroups, rates, currency: "ILS", from, to, cap: { cap: 880, currency: "ILS" }, includeNormal: false });
assert.equal(f.state, "near");
near(f.pct!, (805 / 880) * 100);
// No cap.
f = monthForecast({ items, altGroups, rates, currency: "USD", from, to, cap: null, includeNormal: false });
assert.deepEqual([f.cap, f.pct, f.state], [null, null, "none"]);
near(f.committed, 50);

// Digest: once per state per month; no "near" after "over".
assert.equal(shouldNotifyBudget("ok", []), false);
assert.equal(shouldNotifyBudget("none", []), false);
assert.equal(shouldNotifyBudget("near", []), true);
assert.equal(shouldNotifyBudget("near", ["near"]), false);
assert.equal(shouldNotifyBudget("over", ["near"]), true);
assert.equal(shouldNotifyBudget("over", ["near", "over"]), false);
assert.equal(shouldNotifyBudget("near", ["over"]), false);

// Israel month boundaries (UTC+3 in October, UTC+2 in December).
assert.equal(monthStartIn("2026-10", "Asia/Jerusalem"), Date.UTC(2026, 8, 30, 21));
assert.equal(monthStartIn("2026-12", "Asia/Jerusalem"), Date.UTC(2026, 10, 30, 22));
assert.equal(nextMonthKey("2026-12"), "2027-01");
assert.equal(nextMonthKey("2026-09"), "2026-10");

console.log("OK budget");
