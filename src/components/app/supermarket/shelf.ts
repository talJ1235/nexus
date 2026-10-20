// R19 D1 — a list row's price at the store (client): the count (or kg when weighed) × the shelf price, the best deal
// that fits (lib/prices/deals.ts), the unit price, and the deal line's words. Shared by the row, the section band's
// subtotal and the basket card, so they always agree.
import { bestDeal, type Deal } from "@/lib/prices/deals";
import type { ItemWithSources } from "@/lib/types";
import { unitsFor } from "@/lib/prices/units";

export type ShelfItem = {
  gtin: string;
  name: string;
  short: string | null;
  brand: string | null;
  qty: number | null;
  unit: string | null;
  weighted: boolean;
  imageUrl: string | null;
  section: string | null;
  price: number | null;
  unitPrice: number | null;
  deals: { kind: string; n: number; price: number | null; rate: number | null; club: boolean; minBasket: number | null; ends: number | null; description: string }[];
};
export type Shelf = { chain: string | null; branchId: string | null; branchName: string | null; updatedAt: number | null; stale: boolean; items: Record<string, ShelfItem> };

export type RowPrice = {
  units: number;
  total: number;
  regular: number;
  /** ₪ per kg / litre / 100 g for comparing sizes (null when it doesn't help). */
  per: { v: number; unit: "kg" | "l" | "100g" | "100ml" } | null;
  deal: { kind: string; n: number; price: number | null; rate: number | null; club: boolean; hint: "have" | "take" | "none"; take: number; description: string } | null;
};

/** How many units the row buys: the count (packs), or kg for a weighed product. */
export function unitsOf(item: Pick<ItemWithSources, "quantity" | "count" | "amount" | "unit">, s: ShelfItem, unitKg: number | null) {
  return unitsFor(item, s.weighted, unitKg);
}

export function rowPrice(item: Pick<ItemWithSources, "quantity" | "count" | "amount" | "unit">, s: ShelfItem | undefined, unitKg: number | null): RowPrice | null {
  if (!s || s.price == null) return null;
  const units = Math.max(0, unitsOf(item, s, unitKg));
  const regular = Math.round(units * s.price * 100) / 100;
  const deals: Deal[] = s.deals.map((d) => ({ kind: d.kind as Deal["kind"], n: d.n, price: d.price, rate: d.rate, club: d.club, minBasket: d.minBasket, ends: d.ends, description: d.description }));
  const best = bestDeal(deals, units, s.price, { weighted: s.weighted });
  // Unit price: per kg / litre for big packs, per 100 g / ml for small ones (how shelf labels compare).
  let per: RowPrice["per"] = null;
  if (s.weighted) per = { v: s.price, unit: "kg" };
  else if (s.qty && s.unit === "kg") per = { v: s.price / s.qty, unit: "kg" };
  else if (s.qty && s.unit === "l") per = { v: s.price / s.qty, unit: "l" };
  else if (s.qty && s.unit === "g") per = { v: (s.price / s.qty) * 100, unit: "100g" };
  else if (s.qty && s.unit === "ml") per = { v: (s.price / s.qty) * 100, unit: "100ml" };
  // Nothing applies at this count yet: still say the deal ("3 for ₪15") — the row's line, no nudge.
  const info = !best && deals.length ? deals[0] : null;
  return {
    units,
    total: best ? best.use.total : regular,
    regular,
    per,
    deal: best
      ? { kind: best.deal.kind, n: best.deal.n, price: best.deal.price, rate: best.deal.rate, club: best.deal.club, hint: best.use.hint, take: best.use.take, description: best.deal.description }
      : info
        ? { kind: info.kind, n: info.n, price: info.price, rate: info.rate, club: info.club, hint: "none", take: 0, description: info.description }
        : null,
  };
}
