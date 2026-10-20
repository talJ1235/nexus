// R19 D3 — "where is my list cheapest": totals with deals (club on / off), a store missing a row counts it at the
// average elsewhere, the order (cheapest, then more of the list), the saving vs mine, the split hint. npm run test:compare
import assert from "node:assert/strict";
import { compareStores, splitHint, type CompareRow } from "../src/lib/prices/compare";
import type { Deal } from "../src/lib/prices/deals";

const D = (o: Partial<Deal>): Deal => ({ kind: "other", n: 1, price: null, rate: null, club: false, minBasket: null, ends: null, description: "", ...o });
const rows: CompareRow[] = [
  { id: "milk", title: "Milk", units: 2, weighted: false, at: { shufersal: { price: 6.9, deals: [] }, "rami-levy": { price: 6.5, deals: [] }, victory: { price: 6.7, deals: [] } } },
  { id: "pasta", title: "Penne", units: 2, weighted: false, at: { shufersal: { price: 7.5, deals: [D({ kind: "n_for", n: 2, price: 10 })] }, "rami-levy": { price: 6.9, deals: [] }, victory: { price: 7.2, deals: [] } } },
  { id: "hummus", title: "Hummus", units: 1, weighted: false, at: { shufersal: { price: 10.5, deals: [] }, "rami-levy": { price: 9.9, deals: [D({ kind: "price", price: 8.9, club: true })] } } },
  { id: "tomato", title: "Tomatoes", units: 1.5, weighted: true, at: { shufersal: { price: 8.9, deals: [] }, "rami-levy": { price: 7.9, deals: [] }, victory: { price: 9.9, deals: [] } } },
];
const stores = ["shufersal", "rami-levy", "victory"];
const r = compareStores(rows, stores, "shufersal");
// Shufersal: 13.8 + 10 (2 for 10) + 10.5 + 13.35 = 47.65; Rami Levy: 13 + 13.8 + 8.9 (club) + 11.85 = 47.55;
// Victory lacks hummus → counted at its average (10.5 + 8.9) / 2 = 9.7: 13.4 + 14.4 + 9.7 + 14.85 = 52.35.
assert.deepEqual(r.map((x) => [x.store, x.total]), [["rami-levy", 47.55], ["shufersal", 47.65], ["victory", 52.35]]);
assert.equal(r[0].saving, 0.1);
assert.equal(r[2].found, 3);
assert.deepEqual(r[2].missing, [{ id: "hummus", title: "Hummus", avg: 9.7 }]);
assert.equal(r.find((x) => x.store === "shufersal")!.deals, 1);
// Club off: Rami Levy's hummus at the shelf price → Shufersal is cheapest.
const noClub = compareStores(rows, stores, "shufersal", { club: false });
assert.equal(noClub[0].store, "shufersal");
assert.equal(noClub.find((x) => x.store === "rami-levy")!.total, 48.55);
// A store with nothing on the list doesn't show.
assert.equal(compareStores(rows, [...stores, "yellow"], "shufersal").length, 3);
// Mine unknown → no saving numbers.
assert.ok(compareStores(rows, stores, null).every((x) => x.saving === 0));
// Split: every row where it's cheaper (Shufersal's pasta deal, Rami Levy's rest) — ₪47.55 → ₪43.75; worth it only above the minimum.
const sp = splitHint(rows, r, { min: 3 })!;
assert.deepEqual([sp.a, sp.b, sp.total, sp.saving, sp.worth], ["rami-levy", "shufersal", 43.75, 3.8, true]);
assert.equal(splitHint(rows, r)!.worth, false, "₪3.80 isn't worth a second store (min ₪25)");
console.log("OK test:compare (totals with deals, club on / off, missing at the average, order, saving, split)");
