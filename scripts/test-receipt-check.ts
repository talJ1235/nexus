// Unit test for src/lib/receipt-check.ts (post-read checks, retry choice, PDF text detection, tall-receipt tiles).
//   npx tsx scripts/test-receipt-check.ts
import assert from "node:assert/strict";
import { checkReceipt, hasRealText, linesToRecheck, pickBetter, tileRanges } from "../src/lib/receipt-check";
import type { ReceiptLine } from "../src/lib/receipt-match";

const L = (name: string, qty: number, unitPrice: number | null, lineTotal: number | null): ReceiptLine => ({ name, qty, unitPrice, lineTotal });

// 1) Hebrew supermarket receipt (Shufersal-style): weights, multi-buy, a deposit-free total.
const superHe = {
  lines: [L("חלב 3% טרה 1 ל׳", 2, 6.9, 13.8), L("עגבניות שרי", 1, 12.45, 12.45), L("לחם אחיד פרוס", 1, 7.4, 7.4), L("שמפו הד אנד שולדרס", 1, 24.9, 24.9)],
  shipping: null,
  discount: 5,
  total: 53.55,
};
let c = checkReceipt(superHe);
assert.ok(c.ok, JSON.stringify(c));
assert.equal(c.computed, 53.55);

// A misread line total (model read 13.80 as 18.30): that line is flagged, and the sum is off too.
const misread = { ...superHe, lines: superHe.lines.map((l, i) => (i === 0 ? { ...l, lineTotal: 18.3 } : l)) };
c = checkReceipt(misread);
assert.deepEqual(c.badLines, [0]);
assert.equal(c.sumOk, false);
assert.deepEqual(linesToRecheck(misread, c), [0]);

// 2) AliExpress order (USD): unit prices only, shipping, coupon; total within 2 % (rounding) passes.
const ali = { lines: [L("NEMA 17 stepper motor 42-40", 2, 8.9, null), L("GT2 timing belt 6mm 5m", 1, 4.15, null)], shipping: 2.1, discount: 1.5, total: 22.6 };
c = checkReceipt(ali);
assert.ok(c.ok && c.sumOk, JSON.stringify(c));
// The sum is off by more than 2 % and no line is individually wrong → recheck the priciest lines.
const aliOff = { ...ali, total: 30 };
c = checkReceipt(aliOff);
assert.equal(c.sumOk, false);
assert.deepEqual(linesToRecheck(aliOff, c), [0, 1]);

// 3) Amazon invoice: line totals printed, no total read → nothing to compare, lines still checked.
const amazon = { lines: [L("Anker USB-C cable 2-pack", 1, 12.99, 12.99), L("SanDisk 128GB microSD", 3, 14.5, 43.5)], shipping: 0, discount: null, total: null };
c = checkReceipt(amazon);
assert.equal(c.sumOk, null);
assert.ok(c.ok);

// Retry choice: the retry wins only when it has fewer problems; the kept read marks its bad lines "check".
const better = pickBetter(misread, superHe);
assert.ok(better.check.ok);
assert.ok(better.lines.every((l) => !l.check));
const worse = pickBetter(superHe, misread);
assert.ok(worse.check.ok && worse.lines.every((l) => !l.check));
const still = pickBetter(misread, { ...misread });
assert.equal(still.lines[0].check, true);
assert.ok(!still.lines[1].check);
assert.equal(pickBetter(misread, null).lines[0].check, true);

// 4) Multi-page PDF text layer: real text → read as text; a scan's empty/garbage layer → vision.
const pdfText = `INVOICE  Page 1 of 2\nKSP Computers Ltd.  Order 4410023\nDate 2026-09-12\nItem Qty Price Total\nLogitech MX Master 3S 1 349.00 349.00\nSamsung T7 1TB SSD 1 399.90 399.90\n--- Page 2 ---\nShipping 29.00\nTotal 777.90 ILS`;
assert.ok(hasRealText(pdfText));
assert.ok(!hasRealText(""));
assert.ok(!hasRealText("   \n\n  ")); // scanned PDF: no text layer
assert.ok(!hasRealText("Scanned by CamScanner")); // a watermark only
const pdf = { lines: [L("Logitech MX Master 3S", 1, 349, 349), L("Samsung T7 1TB SSD", 1, 399.9, 399.9)], shipping: 29, discount: null, total: 777.9 };
assert.ok(checkReceipt(pdf).ok);

// Tall receipts → overlapping tiles that cover the whole image in order.
assert.deepEqual(tileRanges(1000, 2000), [[0, 2000]]);
const tiles = tileRanges(800, 4400);
assert.ok(tiles.length >= 3);
assert.equal(tiles[0][0], 0);
for (let i = 1; i < tiles.length; i++) {
  const [py, ph] = tiles[i - 1];
  assert.ok(tiles[i][0] < py + ph, "tiles overlap");
  assert.ok(Math.abs(py + ph - tiles[i][0] - Math.round(1600 * 0.15)) <= 1 || i === tiles.length - 1, "≈15 % overlap");
}
assert.equal(tiles.at(-1)![0] + tiles.at(-1)![1], 4400);

console.log("OK receipt checks: supermarket, AliExpress, Amazon, PDF text, retry choice, tiles");
