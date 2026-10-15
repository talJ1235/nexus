// R18 S3 C6 — the usual brand of a product type (pure, client-safe; the rows come from lib/db-scoped/brands.ts).

export type BrandRow = { type: string; brand: string; brandKey: string; at: number };
export type UsualBrand = { brand: string; n: number; of: number };

export const BRAND_MIN_BUYS = 3;
export const BRAND_MIN_SHARE = 0.6;

/** Pure: the usual brand of one type's buys after the cut-off, or null (the latest spelling of the winning brand). */
export function usualOf(rows: BrandRow[], cut = 0): UsualBrand | null {
  const kept = rows.filter((r) => r.at >= cut).sort((a, b) => b.at - a.at);
  if (kept.length < BRAND_MIN_BUYS) return null;
  const by = new Map<string, { brand: string; n: number }>();
  for (const r of kept) {
    const x = by.get(r.brandKey);
    if (x) x.n++;
    else by.set(r.brandKey, { brand: r.brand, n: 1 });
  }
  const top = [...by.values()].sort((a, b) => b.n - a.n)[0];
  return top && top.n / kept.length >= BRAND_MIN_SHARE ? { brand: top.brand, n: top.n, of: kept.length } : null;
}
