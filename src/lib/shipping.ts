// Free-shipping thresholds per store: how far an order is from free shipping and what closes the gap.
// Pure (shared by the orders view and scripts/test-shipping.ts).
import { activeSource, lineTotal, sourceTotal } from "./calc";
import { convert, type Rates } from "./money";
import type { ItemWithSources, StoreSetting } from "./types";

export type ShippingRule = { freeShippingMin: number | null; shippingFee: number | null; currency: string };

/** Pre-filled rules for a few stores (always editable; a saved row wins). */
export const KNOWN_SHIPPING: Record<string, ShippingRule> = {
  amazon: { freeShippingMin: 49, shippingFee: null, currency: "USD" },
  aliexpress: { freeShippingMin: 10, shippingFee: null, currency: "USD" },
  iherb: { freeShippingMin: 45, shippingFee: null, currency: "USD" },
};

export function shippingRule(storeKey: string, settings: StoreSetting[]): (ShippingRule & { saved: boolean }) | null {
  const row = settings.find((s) => s.storeKey === storeKey);
  if (row) return { freeShippingMin: row.freeShippingMin, shippingFee: row.shippingFee, currency: row.currency, saved: true };
  const known = KNOWN_SHIPPING[storeKey];
  return known ? { ...known, saved: false } : null;
}

export type ShippingGap = {
  /** Item line totals in the display currency. */
  items: number;
  /** Threshold in the display currency (null = no free-shipping rule). */
  threshold: number | null;
  /** Store fee charged on this order (0 once free shipping is reached). */
  fee: number;
  /** items + fee */
  subtotal: number;
  /** Amount still missing for free shipping (0 when reached or no threshold). */
  remaining: number;
  free: boolean;
  /** 0..1 progress toward the threshold. */
  progress: number;
};

export function shippingGap(itemsTotal: number, rule: ShippingRule | null, rates: Rates, currency: string): ShippingGap {
  const threshold = rule?.freeShippingMin != null && rule.freeShippingMin > 0 ? convert(rule.freeShippingMin, rule.currency, currency, rates) : null;
  const rawFee = rule?.shippingFee != null && rule.shippingFee > 0 ? convert(rule.shippingFee, rule.currency, currency, rates) : 0;
  // Cent tolerance: FX conversion shouldn't leave "₪0.00 more".
  const free = threshold != null && itemsTotal >= threshold - 0.005;
  const fee = free || itemsTotal <= 0 ? 0 : rawFee;
  return {
    items: itemsTotal,
    threshold,
    fee,
    subtotal: itemsTotal + fee,
    remaining: threshold != null && !free ? threshold - itemsTotal : 0,
    free,
    progress: threshold ? Math.min(1, itemsTotal / threshold) : 0,
  };
}

export type GapSuggestion =
  /** Item currently ordered from another store that also has a source here: switch its chosen source. */
  | { kind: "switch"; item: ItemWithSources; sourceId: string; fromStore: string; adds: number; diff: number; closes: boolean }
  /** Someday item from this store, left out of the order: include it (priority → normal). */
  | { kind: "include"; item: ItemWithSources; adds: number; closes: boolean };

/**
 * Ways to close the gap for one store, in order: (a) switch items bought elsewhere to this store (cheapest price
 * difference first), then (b) include someday items from this store (the cheapest one that alone closes the gap
 * first, then the rest by size). `order` = items in the order (all stores), `leftOut` = someday to-buy items.
 */
export function gapSuggestions(
  storeKey: string,
  gap: ShippingGap,
  order: ItemWithSources[],
  leftOut: ItemWithSources[],
  rates: Rates,
  currency: string,
  limit = 4,
): GapSuggestion[] {
  if (gap.threshold == null || gap.free) return [];
  const switches: GapSuggestion[] = [];
  for (const item of order) {
    const cur = activeSource(item, rates);
    if (!cur || cur.storeKey === storeKey) continue;
    // Cheapest priced source at this store.
    let best: { id: string; unit: number } | null = null;
    for (const s of item.sources) {
      if (s.storeKey !== storeKey) continue;
      const t = sourceTotal(s);
      if (t == null) continue;
      const unit = convert(t, s.currency, currency, rates);
      if (!best || unit < best.unit) best = { id: s.id, unit };
    }
    if (!best) continue;
    const adds = best.unit * item.quantity;
    const now = lineTotal(item, rates, currency);
    switches.push({ kind: "switch", item, sourceId: best.id, fromStore: cur.store, adds, diff: now == null ? 0 : adds - now, closes: adds >= gap.remaining - 0.005 });
  }
  switches.sort((a, b) => (a.kind === "switch" && b.kind === "switch" ? a.diff - b.diff : 0));

  const includes: GapSuggestion[] = [];
  for (const item of leftOut) {
    if (activeSource(item, rates)?.storeKey !== storeKey) continue;
    const adds = lineTotal(item, rates, currency);
    if (adds == null || adds <= 0) continue;
    includes.push({ kind: "include", item, adds, closes: adds >= gap.remaining - 0.005 });
  }
  includes.sort((a, b) => (a.closes !== b.closes ? (a.closes ? -1 : 1) : a.closes ? a.adds - b.adds : b.adds - a.adds));

  return [...switches, ...includes].slice(0, limit);
}
