// R16 A1 — no status change loses a price.  npx tsx scripts/test-status.ts
// statusPatch for all 9 transitions × with/without a store price (the client sends `paid` from the active store, or null),
// plus the receipt round trip (Received → To buy → Received keeps the paid price) and the "Last paid" estimate.
import assert from "node:assert/strict";
import { lastPaidEstimate, sumTotals, unitPrice } from "../src/lib/calc";
import { FALLBACK_RATES } from "../src/lib/money";
import { statusPatch, type Paid, type Status } from "../src/lib/status";
import type { ItemWithSources, Source } from "../src/lib/types";

const T = 1_000;
const STATUSES: Status[] = ["to_buy", "ordered", "purchased"];
const rates = FALLBACK_RATES;

const item = (status: Status, withSource: boolean, extra: Partial<ItemWithSources> = {}): ItemWithSources => {
  const src = { id: "s1", itemId: "i1", store: "S", storeKey: "s", url: "https://s.test", price: 50, currency: "ILS", shipping: null } as Source;
  const paid = status === "to_buy" ? {} : { purchasedPrice: 42, purchasedCurrency: "ILS" };
  return {
    id: "i1", title: "Milk", status, priority: "normal", quantity: 2, chosenSourceId: null, altGroupId: null,
    orderedAt: status === "to_buy" ? null : 500, purchasedAt: status === "purchased" ? 600 : null,
    purchasedPrice: null, purchasedCurrency: null, lastPaidPrice: null, lastPaidCurrency: null,
    updatedAt: 0, points: [], attachments: [], sources: withSource ? [src] : [], ...paid, ...extra,
  } as ItemWithSources;
};
const apply = (i: ItemWithSources, to: Status, paid: Paid) => ({ ...i, ...statusPatch(to, paid, i, T) }) as ItemWithSources;
// What the client sends: the active store's price when an item leaves To buy, otherwise nothing.
const clientPaid = (i: ItemWithSources, to: Status): Paid => (to !== "to_buy" && i.status === "to_buy" && i.sources[0]?.price != null ? { price: i.sources[0].price!, currency: "ILS" } : null);

let cases = 0;
for (const from of STATUSES)
  for (const to of STATUSES)
    for (const withSource of [true, false]) {
      const before = item(from, withSource);
      const after = apply(before, to, clientPaid(before, to));
      const tag = `${from} → ${to} (${withSource ? "with" : "no"} source)`;
      assert.equal(after.status, to, tag);
      const hadPaid = before.purchasedPrice != null;
      if (to === "to_buy") {
        assert.equal(after.purchasedPrice, null, `${tag}: no paid price in To buy`);
        assert.equal(after.orderedAt, null, tag);
        assert.equal(after.purchasedAt, null, tag);
        if (hadPaid) assert.equal(after.lastPaidPrice, 42, `${tag}: paid price kept as last paid`);
        // A price is still visible: the store's, or the last paid one.
        const unit = unitPrice(after, rates, "ILS");
        if (withSource) assert.equal(unit, 50, tag);
        else assert.equal(unit, hadPaid ? 42 : null, tag);
        assert.equal(lastPaidEstimate(after, rates), !withSource && hadPaid, tag);
      } else {
        if (hadPaid) assert.equal(after.purchasedPrice, 42, `${tag}: paid price unchanged`);
        else if (withSource) assert.equal(after.purchasedPrice, 50, `${tag}: paid = store price`);
        else assert.equal(after.purchasedPrice, null, `${tag}: nothing to fill`);
        if (to === "ordered") assert.equal(after.orderedAt, T, tag);
        if (to === "purchased") assert.equal(after.purchasedAt, T, tag);
      }
      cases++;
    }
assert.equal(cases, 18);

// Receipt items (no source): Received → To buy → Received / On the way → paid price = the original; bulk + Undo send paid=null.
for (const back of ["purchased", "ordered"] as const) {
  const receipt = item("purchased", false, { purchasedPrice: 12.9, purchasedCurrency: "ILS" });
  const toBuy = apply(receipt, "to_buy", null);
  assert.equal(toBuy.lastPaidPrice, 12.9);
  assert.equal(unitPrice(toBuy, rates, "ILS"), 12.9, "visible as last paid");
  const again = apply(toBuy, back, null);
  assert.equal(again.purchasedPrice, 12.9, `back to ${back}: paid price restored`);
  assert.equal(again.purchasedCurrency, "ILS");
  // A new price given (e.g. shopping mode) wins over last paid.
  assert.equal(apply(toBuy, back, { price: 11, currency: "ILS" }).purchasedPrice, 11);
}
// Going to To buy twice doesn't wipe last paid (purchasedPrice is already null the second time).
{
  const once = apply(item("purchased", false), "to_buy", null);
  const twice = apply(once, "to_buy", null);
  assert.equal(twice.lastPaidPrice, 42);
}
// A store price beats last paid; totals count last-paid lines as estimates.
{
  const withLive = apply(item("purchased", true), "to_buy", null);
  assert.equal(unitPrice(withLive, rates, "ILS"), 50);
  assert.equal(lastPaidEstimate(withLive, rates), false);
  const est = apply(item("purchased", false), "to_buy", null);
  const tot = sumTotals([withLive, est, item("to_buy", false)], rates, "ILS");
  assert.deepEqual(tot, { total: 50 * 2 + 42 * 2, missing: 1, estimated: 1 });
}
console.log(`test-status: OK (${cases} transitions + receipt round trip + estimates)`);
