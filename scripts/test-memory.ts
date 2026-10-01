// Unit test for the assistant's memory (Round 9 C3): the computed shopping profile, the sensitive-data guard for
// notes, the ```nexus-memory block, and compare's tie-break toward usual stores.  npx tsx scripts/test-memory.ts
import assert from "node:assert/strict";
import { toResults } from "../src/lib/compare";
import { cleanNote, isSensitive, parseMemoryBlock } from "../src/lib/memory";
import { FALLBACK_RATES } from "../src/lib/money";
import { computeProfile, profileLines } from "../src/lib/profile";
import type { Collection, ItemWithSources, Source } from "../src/lib/types";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 1);
let n = 0;
const item = (p: { store: string; price: number; cat: string; brand?: string; ago: number; qty?: number; shipping?: number; status?: string; currency?: string; col?: string }) =>
  ({
    id: `i${++n}`,
    title: `Item ${n}`,
    status: p.status ?? "purchased",
    priority: "normal",
    quantity: p.qty ?? 1,
    category: p.cat,
    brand: p.brand ?? null,
    collectionId: p.col ?? null,
    chosenSourceId: null,
    altGroupId: null,
    points: [],
    attachments: [],
    orderedAt: now - p.ago * DAY,
    purchasedAt: now - p.ago * DAY,
    purchasedPrice: p.price,
    purchasedCurrency: p.currency ?? "ILS",
    updatedAt: now - p.ago * DAY,
    sources: [{ id: `s${n}`, itemId: `i${n}`, store: p.store, storeKey: p.store.toLowerCase(), url: `https://${p.store}.test/${n}`, price: p.price, currency: p.currency ?? "ILS", shipping: p.shipping ?? 0 } as Source],
  }) as unknown as ItemWithSources;

const items = [
  item({ store: "AliExpress", price: 20, cat: "electronics", ago: 3 }),
  item({ store: "AliExpress", price: 30, cat: "electronics", ago: 3 }), // same store + day → one order of 2
  item({ store: "AliExpress", price: 50, cat: "electronics", ago: 40 }),
  item({ store: "AliExpress", price: 10, cat: "mechanical", ago: 60, shipping: 5 }),
  item({ store: "KSP", price: 400, cat: "tools", brand: "Makita", ago: 10 }),
  item({ store: "KSP", price: 300, cat: "tools", brand: "makita", ago: 90 }),
  item({ store: "IKEA", price: 129, cat: "home-kitchen", ago: 20 }),
  item({ store: "Amazon", price: 999, cat: "computers", ago: 400 }), // older than 6 months: ignored
  item({ store: "Amazon", price: 50, cat: "computers", ago: 1, status: "to_buy" }), // not bought: ignored
];
const cols = [
  { id: "c1", kind: "project", name: "Railcam", archived: false },
  { id: "c2", kind: "list", name: "בית", archived: false },
] as unknown as Collection[];
const p = computeProfile(items, cols, FALLBACK_RATES, "ILS", now);
assert.equal(p.basis, 7);
assert.deepEqual(p.stores.map((s) => [s.store, s.count]), [["AliExpress", 4], ["KSP", 2], ["IKEA", 1]]);
assert.equal(p.stores[1].spend, 700);
assert.equal(p.categories[0].category, "electronics");
assert.equal(p.categories[0].share, 0.43);
const el = p.prices.find((x) => x.category === "electronics")!;
assert.deepEqual([el.p25, el.p50, el.p75], [25, 30, 40]); // interpolated
assert.deepEqual(p.brands, [{ brand: "Makita", count: 2 }]); // case-insensitive, ≥ 2 to count
assert.equal(p.orders.count, 6); // AliExpress day 3 is one order of 2 items
assert.equal(p.orders.freeShippingShare, 0.83);
assert.deepEqual([p.projects.projects, p.projects.lists], [1, 1]);
const lines = profileLines(p, (v) => `₪${Math.round(v)}`);
assert.ok(lines[0].startsWith("Usual stores (last 6 months): AliExpress (4 items, ₪110)"));
assert.ok(lines.some((l) => l.startsWith("Brands bought more than once: Makita")));
// Empty account → nothing to say.
assert.deepEqual(profileLines(computeProfile([], [], FALLBACK_RATES, "ILS", now), (v) => String(v)), []);

// Notes: shopping habits only.
for (const ok of ["Prefers Wera tools", "Orders electronics from AliExpress", "אני מעדיף כלים של Makita", "Buys PLA in 1 kg spools"]) assert.equal(isSensitive(ok), false, ok);
for (const bad of ["My email is tal@example.com", "call me 054-1234567", "card 4580 1234 5678 9012", "my password is hunter2", "I live on Herzl street 12", "תעודת זהות 123456789", "הכתובת שלי ברחוב הרצל", "I take medication daily"])
  assert.equal(isSensitive(bad), true, bad);
assert.equal(cleanNote("  Prefers   Wera\n tools "), "Prefers Wera tools");
assert.equal(cleanNote("ok"), null);
assert.equal(cleanNote(42), null);

// The proposed note block.
const a = parseMemoryBlock('Got it.\n\n```nexus-memory\n{"note":"Prefers Wera tools"}\n```');
assert.deepEqual(a, { text: "Got it.", note: "Prefers Wera tools" });
assert.equal(parseMemoryBlock('x\n```nexus-memory\n{"note":"email me at a@b.co"}\n```').note, null);
assert.equal(parseMemoryBlock("```nexus-memory\nnope\n```").note, null);
assert.equal(parseMemoryBlock("no block").note, null);

// Compare: a tie (within 1 %) goes to the usual store; a real price difference still wins.
const read = (store: string, price: number) => ({ url: `https://${store}.test/p`, ex: { title: "X", price, currency: "ILS", image: null, availability: null, brand: null, store: { key: store, name: store } } });
const r = (reads: ReturnType<typeof read>[], pref: string[]) => toResults(reads as never, "ILS", FALLBACK_RATES, pref).map((x) => x.storeKey);
assert.deepEqual(r([read("zap", 100), read("ksp", 100.5)], ["ksp"]), ["ksp", "zap"]);
assert.deepEqual(r([read("zap", 100), read("ksp", 110)], ["ksp"]), ["zap", "ksp"]);
assert.deepEqual(r([read("zap", 100), read("ksp", 100.5)], []), ["zap", "ksp"]);

console.log("OK memory (profile, notes guard, memory block, compare tie-break)");
