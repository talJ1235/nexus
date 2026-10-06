import { convert, type Rates } from "./money";
import type { AltGroup, Collection, ItemWithSources, Source } from "./types";

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
  if (item.status !== "to_buy" && item.purchasedPrice != null) {
    return convert(item.purchasedPrice, item.purchasedCurrency ?? currency, currency, rates);
  }
  const s = activeSource(item, rates);
  const t = s ? sourceTotal(s) : null;
  if (t != null && s) return convert(t, s.currency, currency, rates);
  if (item.status === "to_buy" && item.lastPaidPrice != null) return convert(item.lastPaidPrice, item.lastPaidCurrency ?? currency, currency, rates);
  return null;
}

/** R16 A1: a To-buy item with no live store price but a price paid before → that price is its estimate ("Last paid"). */
export function lastPaidEstimate(item: ItemWithSources, rates: Rates): boolean {
  if (item.status !== "to_buy" || item.lastPaidPrice == null) return false;
  const s = activeSource(item, rates);
  return !s || sourceTotal(s) == null;
}

export function lineTotal(item: ItemWithSources, rates: Rates, currency: string) {
  const u = unitPrice(item, rates, currency);
  return u == null ? null : u * item.quantity;
}

/** `estimated` = lines priced from "last paid" (totals show "~" then). */
export function sumTotals(items: ItemWithSources[], rates: Rates, currency: string) {
  let total = 0;
  let missing = 0;
  let estimated = 0;
  for (const i of items) {
    const l = lineTotal(i, rates, currency);
    if (l == null) missing++;
    else {
      total += l;
      if (lastPaidEstimate(i, rates)) estimated++;
    }
  }
  return { total, missing, estimated };
}

/**
 * Items that count toward "to buy" totals. Within a group of alternatives only one counts:
 * the picked winner, or — until one is picked — the cheapest option.
 */
export function countable(items: ItemWithSources[], groups: AltGroup[], rates: Rates) {
  const byGroup = new Map<string, ItemWithSources[]>();
  const out: ItemWithSources[] = [];
  const known = new Set(groups.map((g) => g.id));
  for (const i of items) {
    if (i.status === "to_buy" && i.altGroupId && known.has(i.altGroupId)) {
      const arr = byGroup.get(i.altGroupId) ?? [];
      arr.push(i);
      byGroup.set(i.altGroupId, arr);
    } else out.push(i);
  }
  for (const [gid, members] of byGroup) {
    const g = groups.find((x) => x.id === gid);
    const chosen = g?.chosenItemId ? members.find((m) => m.id === g.chosenItemId) : null;
    if (chosen) {
      out.push(chosen);
      continue;
    }
    let best: ItemWithSources | null = null;
    let bestVal = Infinity;
    for (const m of members) {
      const v = lineTotal(m, rates, "USD");
      if (v != null && v < bestVal) {
        bestVal = v;
        best = m;
      }
    }
    out.push(best ?? members[0]);
  }
  return out;
}

export function spendDate(i: ItemWithSources) {
  return i.orderedAt ?? i.purchasedAt ?? null;
}

export function budgetStats(c: Collection, items: ItemWithSources[], groups: AltGroup[], rates: Rates, currency: string) {
  const mine = items.filter((i) => i.collectionId === c.id);
  const planned = sumTotals(countable(mine.filter((i) => i.status === "to_buy"), groups, rates), rates, currency).total;
  const spent = sumTotals(mine.filter((i) => i.status !== "to_buy"), rates, currency).total;
  const budget = c.budget != null ? convert(c.budget, c.budgetCurrency, currency, rates) : null;
  const used = planned + spent;
  const pct = budget ? (used / budget) * 100 : null;
  const state: "none" | "ok" | "near" | "over" = budget == null ? "none" : used > budget ? "over" : pct! >= 90 ? "near" : "ok";
  return { planned, spent, budget, used, pct, state, count: mine.length };
}

/** Lowest price ever seen for an item, in the given currency (across all its stores). */
export function lowestSeen(item: ItemWithSources, rates: Rates, currency: string) {
  let low: number | null = null;
  for (const p of item.points) {
    const src = item.sources.find((s) => s.id === p.sourceId);
    const v = convert(p.price + (src?.shipping ?? 0), p.currency, currency, rates);
    if (low == null || v < low) low = v;
  }
  return low;
}

export const PRIORITY_RANK = { urgent: 0, normal: 1, someday: 2 } as const;
