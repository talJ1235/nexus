import { convert, type Rates } from "./money";
import type { Collection, ItemWithSources, Source } from "./types";

export function sourceTotal(s: Source) {
  if (s.price == null) return null;
  return s.price + (s.shipping ?? 0);
}

/** Cheapest priced source (price + shipping), compared in a common currency. */
export function cheapestSource(item: ItemWithSources, rates: Rates): Source | null {
  let best: Source | null = null;
  let bestVal = Infinity;
  for (const s of item.sources) {
    const t = sourceTotal(s);
    if (t == null) continue;
    const v = convert(t, s.currency, "USD", rates);
    if (v < bestVal) {
      bestVal = v;
      best = s;
    }
  }
  return best;
}

/** Chosen source if set and still present, otherwise cheapest. */
export function activeSource(item: ItemWithSources, rates: Rates): Source | null {
  const chosen = item.chosenSourceId ? item.sources.find((s) => s.id === item.chosenSourceId) : null;
  return chosen ?? cheapestSource(item, rates) ?? item.sources[0] ?? null;
}

export function unitPrice(item: ItemWithSources, rates: Rates, currency: string): number | null {
  if (item.status === "purchased" && item.purchasedPrice != null) {
    return convert(item.purchasedPrice, item.purchasedCurrency ?? currency, currency, rates);
  }
  const s = activeSource(item, rates);
  const t = s ? sourceTotal(s) : null;
  return t == null || !s ? null : convert(t, s.currency, currency, rates);
}

export function lineTotal(item: ItemWithSources, rates: Rates, currency: string) {
  const u = unitPrice(item, rates, currency);
  return u == null ? null : u * item.quantity;
}

export function sumTotals(items: ItemWithSources[], rates: Rates, currency: string) {
  let total = 0;
  let missing = 0;
  for (const i of items) {
    const l = lineTotal(i, rates, currency);
    if (l == null) missing++;
    else total += l;
  }
  return { total, missing };
}

export function budgetStats(c: Collection, items: ItemWithSources[], rates: Rates, currency: string) {
  const mine = items.filter((i) => i.collectionId === c.id);
  const planned = sumTotals(mine.filter((i) => i.status === "to_buy"), rates, currency).total;
  const spent = sumTotals(mine.filter((i) => i.status === "purchased"), rates, currency).total;
  const budget = c.budget != null ? convert(c.budget, c.budgetCurrency, currency, rates) : null;
  const used = planned + spent;
  const pct = budget ? (used / budget) * 100 : null;
  const state: "none" | "ok" | "near" | "over" = budget == null ? "none" : used > budget ? "over" : pct! >= 90 ? "near" : "ok";
  return { planned, spent, budget, used, pct, state, count: mine.length };
}

export const PRIORITY_RANK = { urgent: 0, normal: 1, someday: 2 } as const;
