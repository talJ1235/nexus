// Unit test for product pictures (Round 10 D5): receipt-line understanding (Hebrew abbreviations, sizes, barcodes,
// the model-answer parser), image-result filtering, the ranking glue and the 30-day query cache.
//   npx tsx scripts/test-pictures.ts
import assert from "node:assert/strict";
import { heuristicLineInfo, parseLineInfos } from "../src/lib/product-lines";
import { applyRanking, cacheKey, filterImageResults, makeCache, storedSource, type Candidate } from "../src/lib/picture-rank";

// ---------- D1: line normalization ----------
const milk = heuristicLineInfo('חלב תנ 3% 1ל\'');
assert.equal(milk.brand, "Tnuva");
assert.equal(milk.type, "milk");
assert.equal(milk.typeHe, "חלב");
assert.equal(milk.iconKeyword, "milk");
assert.match(milk.nameHe, /^חלב.*תנובה$/);
assert.ok(milk.size?.includes("3%"), `size ${milk.size}`);
assert.match(milk.queryHe, /תנובה/);
assert.match(milk.queryEn, /Tnuva milk/);

const milky = heuristicLineInfo("מילקי שוקו 3*100");
assert.equal(milky.type, "chocolate pudding");
assert.equal(milky.typeHe, "פודינג");
assert.equal(milky.brand, "Strauss", "Milky implies Strauss");
assert.equal(milky.size, "3*100");
assert.equal(milky.iconKeyword, "pudding");
assert.ok(!/3\*100/.test(milky.nameHe), "size is not part of the name");

const cottage = heuristicLineInfo("קוטג' תנובה 5% 250 גר");
assert.equal(cottage.type, "cottage cheese");
assert.equal(cottage.brand, "Tnuva");
assert.ok(cottage.size?.includes("5%") && cottage.size.includes("250"), `size ${cottage.size}`);

const withCode = heuristicLineInfo("7290000066318 במבה 80 גר");
assert.equal(withCode.barcode, "7290000066318");
assert.equal(withCode.brand, "Osem");
assert.ok(!withCode.nameHe.includes("7290000066318"));

const maker = heuristicLineInfo("NEMA 17 stepper motor 42-40 1.5A");
assert.equal(maker.brand, null);
assert.equal(maker.nameEn.startsWith("NEMA 17"), true);
assert.equal(maker.queryEn.includes("stepper"), true);

const unknown = heuristicLineInfo("ממרח זיתים ירוקים");
assert.equal(unknown.iconKeyword, "package");
assert.equal(unknown.type, "grocery product");

// Model answer: valid lines are taken (barcode cleaned), a missing line falls back to the heuristic.
const parsed = parseLineInfos(
  { lines: [{ i: 1, nameHe: "מילקי שוקולד 3 × 100 גרם", nameEn: "Milky chocolate pudding 3 × 100 g", brand: "Strauss", type: "Chocolate Pudding", typeHe: "פודינג", size: "3 × 100 g", queryHe: "מילקי שטראוס", queryEn: "Milky Strauss pudding", iconKeyword: "Pudding", barcode: "729-0000-123456" }] },
  ["מילקי שוקו 3*100", "חלב תנ 3%"],
);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].type, "chocolate pudding");
assert.equal(parsed[0].iconKeyword, "pudding");
assert.equal(parsed[0].barcode, "7290000123456");
assert.equal(parsed[0].raw, "מילקי שוקו 3*100");
assert.equal(parsed[1].brand, "Tnuva", "missing line → heuristic");
assert.deepEqual(parseLineInfos(null, ["x"]).map((l) => l.raw), ["x"]);
assert.equal(parseLineInfos({ lines: [{ i: 1, nameHe: "", barcode: "12" }] }, ["חלב"])[0].nameHe.length > 0, true, "empty fields fall back");

// ---------- D2: filtering image results ----------
const res = filterImageResults(
  [
    { image: "https://cdn.example.com/a.jpg", page: "https://blog.example.com/x", title: "milk", width: 800, height: 800 },
    { image: "http://insecure.example.com/b.jpg", width: 800, height: 800 },
    { image: "https://www.shufersal.co.il/img/tnuva-milk.jpg", page: "https://www.shufersal.co.il/p/1", title: "חלב תנובה", width: 600, height: 640 },
    { image: "https://site.com/logo-tnuva.png", width: 500, height: 500 },
    { image: "https://site.com/wide.jpg", width: 1600, height: 400 },
    { image: "https://site.com/tiny.jpg", width: 120, height: 120 },
    { image: "https://site.com/promo.jpg", title: "באנר מבצע", width: 800, height: 800 },
    { image: "https://site.com/vector.svg" },
    { image: "https://cdn.example.com/a.jpg", width: 800, height: 800 },
    { image: "https://tnuva.co.il/p.jpg", page: "https://www.tnuva.co.il/x", width: 900, height: 900 },
  ],
  { brand: "Tnuva" },
);
assert.deepEqual(
  res.map((r) => r.url),
  ["https://tnuva.co.il/p.jpg", "https://www.shufersal.co.il/img/tnuva-milk.jpg", "https://cdn.example.com/a.jpg"],
  "store/brand domains first; http, logo, banner, wide, tiny, svg and duplicates dropped",
);
assert.equal(filterImageResults([{ image: "https://x.com/no-size.jpg" }])[0]?.url, "https://x.com/no-size.jpg", "unknown size is kept");
assert.equal(filterImageResults(Array.from({ length: 10 }, (_, i) => ({ image: `https://x.com/${i}.jpg` }))).length, 6, "at most 6");

// ---------- D3: ranking glue ----------
const c = (url: string, source: Candidate["source"] = "search"): Candidate => ({ url, source });
const cands = [c("a"), c("b"), c("c")];
let r = applyRanking(cands, { index: 2, confidence: 0.9 });
assert.deepEqual(r.candidates.map((x) => x.url), ["c", "a", "b"]);
assert.equal(r.chosen?.url, "c");
assert.equal(r.check, false);
r = applyRanking(cands, { index: 1, confidence: 0.4 });
assert.equal(r.chosen?.url, "b");
assert.equal(r.check, true, "low confidence → check");
r = applyRanking(cands, { index: null, confidence: 0 });
assert.equal(r.chosen?.url, "a");
assert.equal(r.check, true, "no pick → best guess, check");
r = applyRanking(cands, { index: 7, confidence: 0.9 });
assert.equal(r.chosen?.url, "a", "out of range → first");
assert.equal(r.check, true);
assert.equal(applyRanking([c("g", "generic")], { index: 0, confidence: 0.95 }).check, true, "generic always asks");
assert.equal(applyRanking([c("i", "icon")], null).check, true);
assert.equal(applyRanking([c("bc", "barcode")], null).check, false, "barcode photo is exact");
assert.deepEqual(applyRanking([], null), { chosen: null, candidates: [], check: false });
assert.equal(storedSource(c("x", "off")), "search");
assert.equal(storedSource(c("x", "own")), "search");
assert.equal(storedSource(c("x", "barcode")), "barcode");

// ---------- Cache ----------
async function cacheTests() {
  const mem = new Map<string, string>();
  let clock = 1_000_000;
  const cached = makeCache({ get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v) }, () => clock);
  let calls = 0;
  const fetcher = async () => (++calls, ["r1"]);
  const k = cacheKey("serper", "  חלב  תנובה ");
  assert.equal(k, "pic:v1:serper:חלב תנובה");
  assert.deepEqual(await cached(k, fetcher), ["r1"]);
  assert.deepEqual(await cached(k, fetcher), ["r1"]);
  assert.equal(calls, 1, "second call is served from the cache");
  clock += 31 * 86400_000;
  await cached(k, fetcher);
  assert.equal(calls, 2, "expired after 30 days");
  let empties = 0;
  await cached("pic:v1:x:empty", async () => (++empties, []));
  await cached("pic:v1:x:empty", async () => (++empties, []));
  assert.equal(empties, 2, "empty answers aren't cached");

}

void cacheTests().then(() => console.log("OK test:pictures (line normalization, filtering, ranking, cache)"));
