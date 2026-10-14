// R18 S2 B1 — count + weight. A supermarket row holds a count (pieces), a weight (amount + kg / g) or both. When only one
// is known the other is estimated from the product's unit weight: learned per product per home from what was bought
// with both (trip checks, receipts), else a fallback table for common produce and meat. Pure, client-safe.

/** kg per piece, typical Israeli produce / meat (the fallback until the home's own purchases teach it). */
export const UNIT_KG: Record<string, number> = {
  tomatoes: 0.15, "cherry-tomatoes": 0.015, cucumbers: 0.12, "bell-peppers": 0.2, onions: 0.15, "red-onions": 0.15, "green-onions": 0.1,
  garlic: 0.05, potatoes: 0.2, "sweet-potatoes": 0.3, carrots: 0.1, zucchini: 0.2, eggplant: 0.35, lettuce: 0.4, cabbage: 1,
  cauliflower: 0.8, broccoli: 0.4, avocado: 0.2, lemons: 0.1, bananas: 0.15, apples: 0.18, pears: 0.18, oranges: 0.22,
  clementines: 0.08, watermelon: 5, melon: 1.5, mango: 0.35, peaches: 0.15, plums: 0.06, kiwi: 0.08, mushrooms: 0.015,
  celery: 0.5, beets: 0.2, ginger: 0.1, "corn-cobs": 0.3, radish: 0.02,
  "chicken-breast": 0.25, "chicken-thighs": 0.15, "chicken-drumsticks": 0.12, "whole-chicken": 1.6, "chicken-wings": 0.08,
  "beef-steak": 0.3, salmon: 0.2, "white-fish": 0.25,
};

/** The product type of a key ("tomatoes", "milk 3%" → "milk"). */
export const typeOf = (productKey: string) => productKey.split(" ")[0];

const toKg = (amount: number, unit: string | null | undefined) => (unit === "g" ? amount / 1000 : unit === "kg" ? amount : null);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type Weighed = { productKey: string; count?: number | null; amount?: number | null; unit?: string | null };

/** kg per piece per product, from purchases that carry both a count and a weight (median; implausible ones dropped). */
export function learnUnitWeights(rows: Weighed[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.count || r.count < 1 || r.amount == null) continue;
    const kg = toKg(r.amount, r.unit);
    if (kg == null || kg <= 0) continue;
    const per = kg / r.count;
    if (per < 0.005 || per > 10) continue;
    by.set(r.productKey, [...(by.get(r.productKey) ?? []), per]);
  }
  return new Map([...by].map(([k, v]) => [k, Math.round(median(v) * 1000) / 1000]));
}

/** The unit weight to use: the home's own, else the type's fallback (null = unknown: nothing is estimated). */
export function unitKgFor(productKey: string | null | undefined, learned?: Map<string, number> | Record<string, number>): number | null {
  if (!productKey) return null;
  const own = learned instanceof Map ? learned.get(productKey) : learned?.[productKey];
  return own ?? UNIT_KG[typeOf(productKey)] ?? null;
}

export type Measure = { quantity?: number; count?: number | null; amount?: number | null; unit?: string | null };

/**
 * Both sides of a row: the count (said or ≈ from the weight) and the weight in kg (said or ≈ from the count).
 * `approx` says which side is an estimate.
 */
export function measure(i: Measure, unitKg: number | null) {
  const kgSaid = i.amount != null && i.unit && i.unit !== "u" && i.unit !== "l" ? toKg(i.amount, i.unit) : null;
  const count = i.count ?? null;
  if (count != null && kgSaid != null) return { count, kg: kgSaid, approx: null as "count" | "kg" | null };
  if (count != null) return { count, kg: unitKg ? Math.round(count * unitKg * 10) / 10 : null, approx: unitKg ? ("kg" as const) : null };
  if (kgSaid != null) return { count: unitKg ? Math.max(1, Math.round(kgSaid / unitKg)) : null, kg: kgSaid, approx: unitKg ? ("count" as const) : null };
  return { count: null, kg: null, approx: null };
}

type Said = { quantity: number; count: number | null; amount: number | null; unit: string | null };
const r1 = (n: number) => Math.round(n * 10) / 10;
const kgOf = (amount: number | null, unit: string | null) => (amount == null ? null : unit === "g" ? amount / 1000 : unit === "kg" ? amount : null);

/**
 * R18 S3 B7: the count changed (produce) — the weight follows: with a known unit weight it goes back to the estimate
 * (≈ count × unit weight), without one a said weight scales with the count (8 · 1 kg → 12 · 1.5 kg). n ≤ 0 = no count.
 */
export function withCount(v: Said, n: number, unitKg: number | null): Said {
  const next = n <= 0 ? null : Math.min(999, Math.round(n));
  const kg = kgOf(v.amount, v.unit);
  if (next == null || kg == null) return { ...v, count: next };
  if (unitKg != null) return { ...v, count: next, amount: null, unit: null };
  const was = v.count ?? v.quantity;
  if (!was) return { ...v, count: next };
  const scaled = (v.amount! / was) * next;
  return { ...v, count: next, amount: v.unit === "g" ? Math.max(10, Math.round(scaled / 10) * 10) : Math.max(0.1, r1(scaled)) };
}

/** The weight changed — a said count follows: back to the estimate with a known unit weight, else it scales. */
export function withWeight(v: Said, amount: number | null, unit: "kg" | "g" | null, unitKg: number | null): Said {
  const kg = kgOf(amount, unit);
  if (v.count == null || kg == null) return { ...v, amount, unit };
  if (unitKg != null) return { ...v, amount, unit, count: null };
  const oldKg = kgOf(v.amount, v.unit) ?? measure(v, unitKg).kg;
  return { ...v, amount, unit, count: oldKg ? Math.max(1, Math.round((v.count * kg) / oldKg)) : v.count };
}
