// R19 C1 — matching a list row to a catalog product: an exact barcode, the remembered choice, the home's usual brand
// (+ the size typed), a single clear candidate, ambiguous → ask once, "doesn't matter which" → the cheapest of the type,
// and forgetting the choice; the search ranking (D5). npm run test:match
import assert from "node:assert/strict";
import { cheapest, decideMatch, nameKey, rankCandidates, sizeIn, type Cand } from "../src/lib/prices/match";

const c = (gtin: string, name: string, brand: string | null, qty: number | null, unit: string | null, price: number | null, more: Partial<Cand> = {}): Cand => ({ gtin, name, brand, qty, unit, chains: 5, price, ...more });
const milk = [
  c("7290000066318", "חלב טרי 3% תנובה 1 ליטר", "תנובה", 1, "l", 6.8),
  c("7290004131074", "חלב טרי 3% טרה 1 ליטר", "טרה", 1, "l", 6.5),
  c("7290011194246", "חלב 1% יטבתה 1 ליטר", "יטבתה", 1, "l", 7.2),
  c("7290000066325", "חלב טרי 3% תנובה 2 ליטר", "תנובה", 2, "l", 12.9),
  c("7290000168791", "שוקולד חלב פרה עלית 100 גרם", "עלית", 100, "g", 6.9),
];

// Sizes in a title.
assert.deepEqual(sizeIn("חלב 1 ליטר"), { qty: 1, unit: "l" });
assert.deepEqual(sizeIn("קוטג' 250 גרם"), { qty: 250, unit: "g" });
assert.deepEqual(sizeIn("שמן 1500 מל"), { qty: 1.5, unit: "l" });
assert.equal(sizeIn("חלב"), null);
assert.equal(nameKey("  חלב   3% "), nameKey("חלב 3%"));

// 1. Barcode adds map exactly.
assert.deepEqual(decideMatch({ title: "Milk", gtin: "7290004131074", cands: milk }), { state: "auto", gtin: "7290004131074", why: "barcode" });
// 2. The home's usual brand (+ the typed size) → silently.
assert.deepEqual(decideMatch({ title: "חלב", usualBrand: "תנובה", cands: milk.slice(0, 3) }), { state: "auto", gtin: "7290000066318", why: "brand" });
assert.deepEqual(decideMatch({ title: "חלב 2 ליטר", usualBrand: "תנובה", cands: milk }), { state: "auto", gtin: "7290000066325", why: "brand" }, "the size picks between the brand's packs");
// 3. Ambiguous → ask once (only milks — chocolate isn't milk), best first.
const ask = decideMatch({ title: "חלב", cands: milk });
assert.equal(ask.state, "ask");
assert.ok(ask.state === "ask" && ask.cands.length === 4 && ask.cands.every((x) => !/שוקולד/.test(x.name)), "the type filters the candidates");
// One clear candidate → silently.
assert.deepEqual(decideMatch({ title: "חלב 1% יטבתה", cands: milk.filter((x) => x.brand === "יטבתה") }), { state: "auto", gtin: "7290011194246", why: "only" });
// 4. The remembered choice wins; "doesn't matter which" = the cheapest of the type at the store (per litre).
assert.deepEqual(decideMatch({ title: "חלב", choice: { gtin: "7290011194246", anyType: null }, cands: milk }), { state: "auto", gtin: "7290011194246", why: "choice" });
const any = decideMatch({ title: "חלב", choice: { gtin: null, anyType: "milk" }, cands: milk });
assert.equal(any.state, "any");
// Per litre: Tnuva's 2 L (₪6.45 / l) beats Tara's 1 L (₪6.50).
assert.ok(any.state === "any" && any.gtin === "7290000066325", `cheapest milk: ${JSON.stringify(any)}`);
assert.equal(cheapest(milk.slice(0, 3), "milk"), "7290004131074");
// 5. Forget: without the choice it asks again.
assert.equal(decideMatch({ title: "חלב", choice: null, cands: milk }).state, "ask");
// Nothing in the catalog → none (the row stays as typed, "choose a product").
assert.deepEqual(decideMatch({ title: "משהו שלא קיים", cands: [] }), { state: "none" });

// Ranking (D5): "פסט" → pasta first, not "פופסטאר"; the home's products lead; word starts beat substrings.
const pasta = [
  c("1", "פופסטאר מופחת שומן", "פופסטאר", 500, "g", 8.9, { chains: 12 }),
  c("2", "פסטה פנה 500 גרם", "ברילה", 500, "g", 6.9, { chains: 9 }),
  c("3", "רביולי פסטה נונה", "נונה", 300, "g", 19.9, { chains: 2 }),
  c("4", "פסטה פוזילי 500 גרם", "אסם", 500, "g", 5.9, { chains: 8, mine: true }),
];
const ranked = rankCandidates("פסט", pasta).map((x) => x.gtin);
assert.deepEqual(ranked.slice(0, 2), ["4", "2"], `ranking ${ranked}`);
assert.equal(ranked.at(-1), "1");
console.log("OK test:match (barcode, usual brand + size, ambiguous → ask, only one, choice, any → cheapest, forget, ranking)");
