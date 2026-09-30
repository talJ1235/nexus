// Unit test for src/lib/receipt-match.ts (receipt line → item matching).  npx tsx scripts/test-receipt.ts
import assert from "node:assert/strict";
import { matchReceipt, storeMatches, titleScore, type MatchCandidate, type ReceiptLine } from "../src/lib/receipt-match";

const c = (id: string, title: string, p: Partial<MatchCandidate> = {}): MatchCandidate => ({ id, title, quantity: 1, stores: [], unitPrice: null, ...p });
const line = (name: string, qty = 1, unitPrice: number | null = null): ReceiptLine => ({ name, qty, unitPrice, lineTotal: unitPrice != null ? unitPrice * qty : null });
const ids = (m: ReturnType<typeof matchReceipt>[number]) => m.allocations.map((a) => `${a.itemId}×${a.qty}`);

// Titles: English, model numbers, Hebrew with glued prefixes, mixed Hebrew + Latin.
assert.ok(titleScore("NEMA 17 Stepper Motor 42-40 1.5A", "NEMA17 stepper motor 42-40") > 0.5);
assert.ok(titleScore("המנוע צעד NEMA 17", "מנוע צעד NEMA 17") > 0.8);
assert.ok(titleScore("ולמברג אלחוטי", "מברג אלחוטי 18V") > 0.6);
assert.ok(titleScore("USB-C cable 1m", "Bambu Lab PLA filament") < 0.1);
assert.equal(titleScore("", "anything"), 0);

// Stores: receipt spelling vs storeKey / display name.
const amazon = [{ key: "amazon", name: "Amazon" }];
assert.ok(storeMatches("Amazon.com", amazon));
assert.ok(storeMatches("AliExpress Israel", [{ key: "aliexpress", name: "AliExpress" }]));
assert.ok(storeMatches("KSP", [{ key: "ksp", name: "KSP" }]));
assert.ok(!storeMatches("eBay", amazon));
assert.ok(!storeMatches(null, amazon));

const items = [
  c("motor", "NEMA 17 stepper motor 42-40", { stores: amazon, unitPrice: 45 }),
  c("driver", "TMC2209 stepper driver", { stores: amazon, unitPrice: 15 }),
  c("drill", "מברג אלחוטי 18V Makita", { stores: [{ key: "ksp", name: "KSP" }], unitPrice: 400 }),
  c("pla", "Bambu Lab PLA Basic filament 1kg", { quantity: 2, stores: [{ key: "bambulab", name: "Bambu Lab" }], unitPrice: 80 }),
  c("pla2", "Bambu Lab PLA Basic filament 1kg black", { quantity: 1, unitPrice: 80 }),
];

// English + Hebrew lines, each to its own item.
let m = matchReceipt([line("STEPPERONLINE Nema 17 Stepper Motor 42-40 1.5A", 1, 44.9), line("BIGTREETECH TMC2209 V1.3 Stepper Motor Driver", 1, 14.5), line("מברג אלחוטי מקיטה 18V", 1, 389)], items, "Amazon.com");
assert.deepEqual(m.map(ids), [["motor×1"], ["driver×1"], ["drill×1"]]);
assert.ok(m[0].ranked[0].itemId === "motor");

// Qty split: 4 spools bought, one item needs 2, a similar item needs 1 → 2 + 1 (the 4th unit is extra).
m = matchReceipt([line("Bambu Lab PLA Basic filament 1kg", 4, 79)], items, "Bambu Lab");
assert.deepEqual(ids(m[0]), ["pla×2", "pla2×1"]);

// Partial: bought 1 of an item that needs 2 → allocation of 1 (caller splits the item).
m = matchReceipt([line("PLA Basic filament Bambu Lab", 1, 80)], items, "Bambu Lab");
assert.deepEqual(ids(m[0]), ["pla×1"]);

// Each item is used once: two lines for the same thing → the second finds nothing better and stays unmatched
// unless another candidate fits.
m = matchReceipt([line("TMC2209 driver"), line("TMC2209 stepper driver")], items, null);
assert.equal(m.flatMap((x) => x.allocations).filter((a) => a.itemId === "driver").length, 1);

// No match: unrelated line, empty candidate list.
m = matchReceipt([line("Gift card 100"), line("Shipping insurance")], items, "Amazon");
assert.deepEqual(m.map(ids), [[], []]);
assert.deepEqual(matchReceipt([line("NEMA 17")], [], null).map(ids), [[]]);

// Store and price break ties between two similar titles.
const twins = [c("a", "USB-C cable 1m braided", { stores: [{ key: "aliexpress", name: "AliExpress" }], unitPrice: 3 }), c("b", "USB-C cable 1m braided", { stores: amazon, unitPrice: 12 })];
assert.deepEqual(ids(matchReceipt([line("USB-C Cable 1m Braided", 1, 11.99)], twins, "Amazon")[0]), ["b×1"]);
assert.deepEqual(ids(matchReceipt([line("USB-C Cable 1m Braided", 1, 2.8)], twins, "AliExpress")[0]), ["a×1"]);

console.log("OK receipt matcher");
