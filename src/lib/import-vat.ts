// Import VAT (Round 7 G2). Pure: shared by Order by store, "mark as ordered", the weekly summary and
// scripts/test-import-vat.ts. Israel lets personal imports in VAT-free up to a USD limit (it changed several times in
// 2025–26 — the user sets the current figure); above it the whole order pays 18 % VAT.
import { activeSource, lineTotal } from "./calc";
import { convert, type Rates } from "./money";
import type { ItemWithSources } from "./types";

export const DEFAULT_IMPORT_LIMIT_USD = 130;
export const IMPORT_LIMIT_KEY = "pref:import-limit";
export const VAT_RATE = 0.18;

/** Stores that ship from abroad even when they show prices in shekels. */
const FOREIGN = new Set(["aliexpress", "amazon", "ebay", "temu", "shein", "iherb", "banggood", "asos", "next", "etsy", "walmart", "bestbuy", "newegg", "adafruit", "sparkfun", "digikey", "mouser", "lcsc", "alibaba", "wish", "gearbest", "dhgate", "zara", "hm"]);

export function isForeignStore(storeKey: string, currency: string | null | undefined) {
  return FOREIGN.has(storeKey) || (!!currency && currency.toUpperCase() !== "ILS");
}

export type ImportCheck = {
  over: boolean;
  /** Items + shipping, in USD. */
  totalUsd: number;
  limitUsd: number;
  /** Estimated VAT on the whole order, in the display currency. */
  vat: number;
  /** How much (USD) has to come out of this order to get under the limit. */
  removeUsd: number;
  /** Fewest items (cheapest such set first) to move to another order so the rest is under the limit. */
  split: ItemWithSources[];
};

/**
 * One order from one store: is it over the VAT-free limit? `shipping` (display currency) is added to the items.
 * Split suggestion: the cheapest single item that's enough; otherwise the largest items until it's enough.
 */
export function importCheck(order: ItemWithSources[], opts: { rates: Rates; currency: string; limitUsd: number; shipping?: number }): ImportCheck {
  const { rates, currency, limitUsd } = opts;
  const lines = order.map((i) => ({ item: i, usd: convert(lineTotal(i, rates, currency) ?? 0, currency, "USD", rates) }));
  const shipUsd = convert(opts.shipping ?? 0, currency, "USD", rates);
  const totalUsd = Math.round((lines.reduce((a, l) => a + l.usd, 0) + shipUsd) * 100) / 100;
  const over = totalUsd > limitUsd + 0.005;
  const removeUsd = over ? Math.round((totalUsd - limitUsd) * 100) / 100 : 0;
  let split: ItemWithSources[] = [];
  if (over) {
    const single = lines.filter((l) => l.usd >= removeUsd).sort((a, b) => a.usd - b.usd)[0];
    if (single && lines.length > 1) split = [single.item];
    else if (lines.length > 1) {
      let sum = 0;
      for (const l of [...lines].sort((a, b) => b.usd - a.usd)) {
        if (sum >= removeUsd || split.length >= lines.length - 1) break;
        split.push(l.item);
        sum += l.usd;
      }
    }
  }
  return { over, totalUsd, limitUsd, vat: over ? Math.round(convert(totalUsd, "USD", currency, rates) * VAT_RATE * 100) / 100 : 0, removeUsd, split };
}

/** To-buy orders per foreign store (Order by store grouping: someday left out) that are over the limit. */
export function overLimitStores(items: ItemWithSources[], opts: { rates: Rates; currency: string; limitUsd: number }) {
  const groups = new Map<string, { store: string; items: ItemWithSources[] }>();
  for (const i of items) {
    if (i.status !== "to_buy" || i.priority === "someday") continue;
    const src = activeSource(i, opts.rates);
    if (!src?.url || !isForeignStore(src.storeKey, src.currency)) continue;
    const g = groups.get(src.storeKey) ?? { store: src.store, items: [] };
    g.items.push(i);
    groups.set(src.storeKey, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, store: g.store, check: importCheck(g.items, opts) })).filter((g) => g.check.over);
}
