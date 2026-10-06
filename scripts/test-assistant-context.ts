// R16 A13 — the assistant sees a recent price drop (in-app report r_rWtP3XmuRl).  npx tsx scripts/test-assistant-context.ts
// The item snapshot carries the first/lowest price, the LAST change (a drop above the lowest is still a drop) and the
// latest price alert of the last 30 days.
import assert from "node:assert/strict";
import { snapshot } from "../src/lib/assistant";
import { FALLBACK_RATES } from "../src/lib/money";
import type { AppData } from "../src/lib/types";

const day = 86_400_000;
const now = Date.now();
const pt = (price: number, ago: number) => ({ id: `p${ago}`, itemId: "i1", sourceId: "s1", price, currency: "ILS", recordedAt: now - ago * day });
const item = {
  id: "i1", title: "Drill", status: "to_buy", priority: "normal", quantity: 1, collectionId: null, chosenSourceId: null, altGroupId: null, tags: [],
  orderedAt: null, purchasedAt: null, purchasedPrice: null, purchasedCurrency: null, lastPaidPrice: null, lastPaidCurrency: null, targetPrice: null,
  sources: [{ id: "s1", itemId: "i1", url: "https://s.test/drill", store: "S", price: 105, currency: "ILS", shipping: null }],
  // 100 → 90 (lowest) → 120 → 105 (today's drop is above the lowest)
  points: [pt(100, 40), pt(90, 30), pt(120, 10), pt(105, 1)],
  attachments: [],
};
const data = {
  items: [item], collections: [], altGroups: [],
  alerts: [{ id: "a1", itemId: "i1", sourceId: "s1", kind: "drop", oldPrice: 120, newPrice: 105, currency: "ILS", createdAt: now - day }],
} as unknown as AppData;
const { lines } = snapshot(data, "ILS", FALLBACK_RATES);
const line = lines[0];
assert.match(line, /price_first=100@/);
assert.match(line, /price_low=90@/);
assert.match(line, /price_prev=120→105@/, line);
assert.match(line, /alert=drop 120→105@/, line);
// Alerts older than 30 days and other items' alerts stay out.
const old = { ...data, alerts: [{ ...data.alerts[0], createdAt: now - 40 * day }, { ...data.alerts[0], itemId: "other" }] } as AppData;
assert.doesNotMatch(snapshot(old, "ILS", FALLBACK_RATES).lines[0], /alert=/);
console.log("test-assistant-context: OK");
