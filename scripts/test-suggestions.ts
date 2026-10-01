// Unit test for src/lib/assistant-suggestions.ts (pure: input → expected questions).  npx tsx scripts/test-suggestions.ts
import assert from "node:assert/strict";
import { suggestQuestions } from "../src/lib/assistant-suggestions";
import { en } from "../src/lib/i18n/en";
import { FALLBACK_RATES } from "../src/lib/money";
import type { AltGroup, Collection, ItemWithSources } from "../src/lib/types";

const DAY = 86_400_000;
const now = new Date(2026, 8, 30, 12).getTime();
const fallback = [en.ai.ex1, en.ai.ex2, en.ai.ex3, en.ai.ex4];

const col = (id: string, name: string, budget: number | null = null) =>
  ({ id, name, kind: "project", budget, budgetCurrency: "ILS", archived: false }) as Collection;
let n = 0;
const item = (p: Partial<ItemWithSources> & { store?: string; price?: number }): ItemWithSources => {
  const id = `i${++n}`;
  const { store, price, ...rest } = p;
  return {
    id, title: `Item ${n}`, status: "to_buy", priority: "normal", quantity: 1, collectionId: null, altGroupId: null,
    chosenSourceId: null, watch: true, targetPrice: null, targetCurrency: null, eta: null, orderedAt: null, purchasedAt: null,
    purchasedPrice: null, purchasedCurrency: null, createdAt: now - 30 * DAY, points: [], attachments: [],
    sources: store ? [{ id: `s${n}`, itemId: id, store, storeKey: store.toLowerCase(), price: price ?? 100, currency: "ILS", shipping: null } as ItemWithSources["sources"][number]] : [],
    ...rest,
  } as ItemWithSources;
};
const run = (items: ItemWithSources[], collections: Collection[] = [], extra: Partial<Parameters<typeof suggestQuestions>[0]> = {}) =>
  suggestQuestions({ items, collections, altGroups: [] as AltGroup[], view: { type: "to_buy" }, recent: [], now, rates: FALLBACK_RATES, currency: "ILS", t: en.ai.sug, fallback, ...extra }).map((s) => s.text);

// Empty account → the static questions.
assert.deepEqual(run([]), fallback);

// Project context + over budget + plan the next stage + urgent, one per family, best first (R9 C4: on a project's page
// planning its next stage outranks the store question).
const slider = col("c1", "Camera slider", 150);
const items = [
  item({ collectionId: "c1", store: "AliExpress", price: 100, priority: "urgent" }),
  item({ collectionId: "c1", store: "AliExpress", price: 100 }),
];
assert.deepEqual(run(items, [slider], { view: { type: "collection", id: "c1" } }), [
  "How much is left to buy for Camera slider?",
  "Camera slider is over budget — what can I cut?",
  "Plan the next Camera slider stage",
  "What's urgent and still not ordered?",
]);

// Recently asked questions are skipped; the plan suggestion and then the fallback fill the gap.
assert.deepEqual(run(items, [slider], { recent: ["what's urgent and still not ordered?"] }), [
  "Camera slider is over budget — what can I cut?",
  "What should I order from AliExpress?",
  "Plan the next Camera slider stage",
  fallback[0],
]);

// Late order, alternatives without a winner, names kept as separate parts for bidi isolation.
const a = item({ title: "מנוע NEMA 17", altGroupId: "g1", createdAt: now - 5 * DAY });
const b = item({ title: "Stepper 42mm", altGroupId: "g1", createdAt: now - 4 * DAY });
const late = item({ status: "ordered", eta: now - 3 * DAY });
const r = suggestQuestions({ items: [a, b, late], collections: [], altGroups: [{ id: "g1", name: "motor", chosenItemId: null } as AltGroup], view: { type: "to_buy" }, recent: [], now, rates: FALLBACK_RATES, currency: "ILS", t: en.ai.sug, fallback, limit: 2 });
assert.deepEqual(r.map((s) => s.text), ["Which of my orders are late?", "Help me choose between מנוע NEMA 17 and Stepper 42mm"]);
assert.deepEqual(r[1].parts.filter((p) => p.name).map((p) => p.text), ["מנוע NEMA 17", "Stepper 42mm"]);

// R9 C4 — with the profile's usual store, the plan suggestion names it.
assert.ok(run(items, [slider], { view: { type: "collection", id: "c1" }, topStore: "AliExpress" }).includes("Plan the next Camera slider stage at AliExpress"));

// R9 C4 — after "how much is left…", the natural next steps (what's missing, plan the next stage) come first and the
// question just asked isn't repeated.
const next = run(items, [slider], { view: { type: "collection", id: "c1" }, last: { question: "How much is left to buy for Camera slider?", route: "data" } });
assert.deepEqual(next.slice(0, 2), ["What's still missing to finish Camera slider?", "Plan the next Camera slider stage"]);
assert.ok(!next.includes("How much is left to buy for Camera slider?"));

// R9 C4 — after a help answer the follow-ups are how-to questions: the ones after the topic just asked, never it again.
const helpQs: readonly string[] = en.ai.helpSug;
const h = run(items, [slider], { last: { question: "How do I add a receipt?", route: "help" }, helpQuestions: helpQs, limit: 3 });
assert.deepEqual(h, [helpQs[1], helpQs[2], helpQs[3]]);
assert.deepEqual(run(items, [slider], { last: { question: "where are settings?", route: "help" }, helpQuestions: helpQs, recent: [helpQs[0]], limit: 2 }), [helpQs[1], helpQs[2]]);
// A data answer keeps data follow-ups.
assert.ok(!run(items, [slider], { last: { question: "How much is left?", route: "data" }, helpQuestions: helpQs }).some((q) => helpQs.includes(q)));

console.log("OK suggestions");
