// Unit test for src/lib/barcode.ts (classification, check digits, lookup chain).  npx tsx scripts/test-barcode.ts
import assert from "node:assert/strict";
import { checkDigitOk, classifyBarcode, gtinKey, lookupChain, upcEtoA, type LookupDeps } from "../src/lib/barcode";

// Check digits: real codes.
assert.ok(checkDigitOk("7290000066318")); // Israeli EAN-13 (Tnuva-style 729 prefix)
assert.ok(checkDigitOk("4006381333931")); // EAN-13
assert.ok(checkDigitOk("036000291452")); // UPC-A
assert.ok(checkDigitOk("96385074")); // EAN-8
assert.ok(!checkDigitOk("4006381333932"));

// UPC-E → UPC-A.
assert.equal(upcEtoA("04252614"), "042100005264");
assert.ok(checkDigitOk("042100005264"));

// Classification.
const il = classifyBarcode("7290000066318");
assert.equal(il.kind, "gtin");
assert.ok(il.kind === "gtin" && il.israeli && il.key === "07290000066318");
assert.equal(classifyBarcode("4006381333931").kind, "gtin");
assert.equal(classifyBarcode(" 4006-381333931 ").kind, "gtin");
assert.equal(classifyBarcode("036000291452").kind, "gtin");
assert.equal(classifyBarcode("04252614").kind, "gtin"); // UPC-E expanded
assert.equal(classifyBarcode("2100012003507").kind, "store"); // variable-weight (prefix 2)
assert.equal(classifyBarcode("4006381333932").kind, "other"); // bad check digit
assert.equal(classifyBarcode("ABC-123").kind, "other"); // Code 128 text
assert.equal(gtinKey("036000291452"), "00036000291452");

// Lookup chain: own items first, then the free databases in order, search last (only with a key).
const calls: string[] = [];
const miss = (name: string) => async () => (calls.push(name), null);
const deps = (over: Partial<LookupDeps> = {}): LookupDeps => ({ own: miss("own"), off: miss("off"), opf: miss("opf"), upcitemdb: miss("upc"), search: null, ...over });

(async () => {
  let r = await lookupChain("4006381333931", deps({ own: async (k) => (calls.push(`own:${k}`), { source: "own", title: "Pencil", itemId: "i1" }) }));
  assert.equal(r.hit?.itemId, "i1");
  assert.deepEqual(calls, ["own:04006381333931"]);

  calls.length = 0;
  r = await lookupChain("4006381333931", deps({ opf: async () => (calls.push("opf"), { source: "opf", title: "Faber pencil" }) }));
  assert.equal(r.hit?.source, "opf");
  assert.deepEqual(calls, ["own", "off", "opf"]);

  // A thrown fetcher is a miss, not a failure.
  calls.length = 0;
  r = await lookupChain("4006381333931", deps({ off: async () => { calls.push("off!"); throw new Error("503"); }, upcitemdb: async () => ({ source: "upcitemdb", title: "X" }) }));
  assert.equal(r.hit?.source, "upcitemdb");
  assert.deepEqual(r.tried, ["own", "off", "opf", "upcitemdb"]);

  // No key → no search step; nothing found → null (the UI asks for a photo).
  calls.length = 0;
  r = await lookupChain("7290000066318", deps());
  assert.equal(r.hit, null);
  assert.deepEqual(r.tried, ["own", "off", "opf", "upcitemdb"]);
  r = await lookupChain("7290000066318", deps({ search: async () => ({ source: "search", title: "Milk 3%" }) }));
  assert.equal(r.hit?.source, "search");

  // Weight / store codes: only own items, then straight to the photo.
  r = await lookupChain("2100012003507", deps());
  assert.equal(r.cls.kind, "store");
  assert.deepEqual(r.tried, ["own"]);

  console.log("OK barcode: check digits, UPC-E, classification, lookup chain");
})();
