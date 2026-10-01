// Tal's shopping profile (Round 9 C3), computed from his own data — deterministic, no AI. Pure: unit-tested in
// scripts/test-memory.ts; cached in kv by lib/profile-server.ts (refreshed daily and on demand).
import { activeSource, lineTotal, spendDate, unitPrice } from "./calc";
import { normalizeCategory } from "./categories";
import type { Rates } from "./money";
import type { Collection, ItemWithSources } from "./types";

export type Profile = {
  computedAt: number;
  /** The display currency the numbers are in. */
  currency: string;
  /** Orders/purchases looked at (last 6 months). */
  basis: number;
  stores: { store: string; storeKey: string; count: number; spend: number }[];
  categories: { category: string; count: number; share: number }[];
  /** Unit price ranges per category (25th / 50th / 75th percentile). */
  prices: { category: string; p25: number; p50: number; p75: number }[];
  brands: { brand: string; count: number }[];
  /** Orders = items ordered from one store on one day. */
  orders: { count: number; itemsPerOrder: number; spendPerOrder: number; freeShippingShare: number };
  projects: { projects: number; lists: number; top: string[] };
  /** The currency his store links are most often in. */
  sourceCurrency: string | null;
};

const HALF_YEAR = 183 * 86_400_000;
/** Percentile with linear interpolation between the closest ranks. */
const pct = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const round = (v: number) => Math.round(v * 100) / 100;

export function computeProfile(items: ItemWithSources[], collections: Collection[], rates: Rates, currency: string, now = Date.now()): Profile {
  const bought = items.filter((i) => i.status !== "to_buy" && (spendDate(i) ?? i.updatedAt) >= now - HALF_YEAR);

  const stores = new Map<string, { store: string; storeKey: string; count: number; spend: number }>();
  const cats = new Map<string, number>();
  const brandCount = new Map<string, { brand: string; count: number }>();
  const priceByCat = new Map<string, number[]>();
  const orders = new Map<string, { items: number; spend: number; shipping: number }>();
  for (const i of bought) {
    const src = activeSource(i, rates);
    const spend = lineTotal(i, rates, currency) ?? 0;
    if (src) {
      const e = stores.get(src.storeKey) ?? { store: src.store, storeKey: src.storeKey, count: 0, spend: 0 };
      e.count++;
      e.spend += spend;
      stores.set(src.storeKey, e);
      const day = new Date(spendDate(i) ?? i.updatedAt).toISOString().slice(0, 10);
      const o = orders.get(`${src.storeKey}|${day}`) ?? { items: 0, spend: 0, shipping: 0 };
      o.items += i.quantity;
      o.spend += spend;
      o.shipping += src.shipping ?? 0;
      orders.set(`${src.storeKey}|${day}`, o);
    }
    const cat = normalizeCategory(i.category) ?? "other";
    cats.set(cat, (cats.get(cat) ?? 0) + 1);
    const unit = unitPrice(i, rates, currency);
    if (unit != null && unit > 0) priceByCat.set(cat, [...(priceByCat.get(cat) ?? []), unit]);
    const brand = i.brand?.trim();
    if (brand) {
      const k = brand.toLowerCase();
      const b = brandCount.get(k) ?? { brand, count: 0 };
      b.count++;
      brandCount.set(k, b);
    }
  }
  const o = [...orders.values()];
  const currencies = new Map<string, number>();
  for (const i of items) for (const s of i.sources) if (s.currency) currencies.set(s.currency, (currencies.get(s.currency) ?? 0) + 1);

  return {
    computedAt: now,
    currency,
    basis: bought.length,
    stores: [...stores.values()]
      .sort((a, b) => b.count - a.count || b.spend - a.spend)
      .slice(0, 5)
      .map((s) => ({ ...s, spend: round(s.spend) })),
    categories: [...cats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count, share: round(count / Math.max(1, bought.length)) })),
    prices: [...priceByCat.entries()]
      .filter(([, v]) => v.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([category, v]) => {
        const s = v.slice().sort((a, b) => a - b);
        return { category, p25: round(pct(s, 0.25)), p50: round(pct(s, 0.5)), p75: round(pct(s, 0.75)) };
      }),
    brands: [...brandCount.values()].filter((b) => b.count >= 2).sort((a, b) => b.count - a.count).slice(0, 5),
    orders: {
      count: o.length,
      itemsPerOrder: o.length ? round(o.reduce((a, x) => a + x.items, 0) / o.length) : 0,
      spendPerOrder: o.length ? round(o.reduce((a, x) => a + x.spend, 0) / o.length) : 0,
      freeShippingShare: o.length ? round(o.filter((x) => x.shipping === 0).length / o.length) : 0,
    },
    projects: {
      projects: collections.filter((c) => c.kind === "project" && !c.archived).length,
      lists: collections.filter((c) => c.kind === "list" && !c.archived).length,
      top: collections
        .filter((c) => !c.archived)
        .map((c) => ({ name: c.name, n: items.filter((i) => i.collectionId === c.id).length }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 3)
        .map((c) => c.name),
    },
    sourceCurrency: [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

/** Short lines for the model (and the settings screen): only what there's evidence for. */
export function profileLines(p: Profile, fmt: (v: number) => string): string[] {
  const out: string[] = [];
  if (p.stores.length) out.push(`Usual stores (last 6 months): ${p.stores.map((s) => `${s.store} (${s.count} items, ${fmt(s.spend)})`).join(", ")}`);
  if (p.categories.length) out.push(`Typical categories: ${p.categories.map((c) => `${c.category} ${Math.round(c.share * 100)}%`).join(", ")}`);
  if (p.prices.length) out.push(`Usual unit prices: ${p.prices.map((c) => `${c.category} ${fmt(c.p25)}–${fmt(c.p75)} (median ${fmt(c.p50)})`).join("; ")}`);
  if (p.brands.length) out.push(`Brands bought more than once: ${p.brands.map((b) => b.brand).join(", ")}`);
  if (p.orders.count)
    out.push(`Orders: ${p.orders.count} in 6 months, about ${p.orders.itemsPerOrder} items / ${fmt(p.orders.spendPerOrder)} each, ${Math.round(p.orders.freeShippingShare * 100)}% with free shipping`);
  if (p.projects.projects + p.projects.lists) out.push(`Projects: ${p.projects.projects}, lists: ${p.projects.lists}${p.projects.top.length ? ` (biggest: ${p.projects.top.join(", ")})` : ""}`);
  if (p.sourceCurrency) out.push(`Store links mostly priced in ${p.sourceCurrency}; shows prices in ${p.currency}`);
  return out;
}
