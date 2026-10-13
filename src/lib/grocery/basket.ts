// R18 S2 — the basic Israeli household basket (cold start, Tal 2026-10-13): what Nexus suggests before the home has its
// own history (~3–4 trips), and the first-time "Basic weekly basket". Adapted to the onboarding answers: household size
// scales quantities and adds family items; baby / pet items only when the home is known to have them. Client-safe.

import { TYPE_BY_KEY } from "./dictionary";

/** `n` = units for one or two people; `family` = only for a family; `amount` = kg for produce weighed. */
type Row = { key: string; n?: number; kg?: number; family?: boolean; only?: "baby" | "pets" };

/** In weekly-importance order: the first 24 are the "Basic weekly basket". */
const ROWS: Row[] = [
  { key: "milk", n: 2 },
  { key: "bread" },
  { key: "eggs" },
  { key: "tomatoes", kg: 1 },
  { key: "cucumbers", kg: 1 },
  { key: "cottage" },
  { key: "yellow-cheese" },
  { key: "white-cheese" },
  { key: "yogurt", n: 4 },
  { key: "bananas", n: 6 },
  { key: "apples", kg: 1 },
  { key: "onions", kg: 1 },
  { key: "potatoes", kg: 1 },
  { key: "chicken-breast", kg: 1 },
  { key: "pasta", n: 2 },
  { key: "rice" },
  { key: "hummus" },
  { key: "pita" },
  { key: "coffee" },
  { key: "toilet-paper" },
  { key: "dish-soap" },
  { key: "trash-bags" },
  { key: "olive-oil" },
  { key: "lemons", n: 3 },
  { key: "bell-peppers", kg: 0.5 },
  { key: "carrots", kg: 1 },
  { key: "butter" },
  { key: "tuna", n: 3 },
  { key: "crushed-tomatoes", n: 2 },
  { key: "tahini" },
  { key: "cornflakes", family: true },
  { key: "chocolate-spread", family: true },
  { key: "juice", family: true },
  { key: "cookies", family: true },
  { key: "sparkling-water" },
  { key: "paper-towels" },
  { key: "laundry-detergent" },
  { key: "toothpaste" },
  { key: "shampoo" },
  { key: "challah" },
  { key: "diapers", only: "baby" },
  { key: "wet-wipes", only: "baby" },
  { key: "cat-food", only: "pets" },
  { key: "dog-food", only: "pets" },
];

export type BasketItem = { productKey: string; title: string; qty: number; amount: number | null; unit: string | null; section: string; art: string | null };
export type BasketFor = { who?: string | null; baby?: boolean; pets?: boolean; locale?: string };

/** The basket for this home (onboarding `who`: me / partner / family). Families get ×1.5 counts and family items. */
export function basketFor(o: BasketFor = {}): BasketItem[] {
  const family = o.who === "family";
  const out: BasketItem[] = [];
  for (const r of ROWS) {
    if (r.family && !family) continue;
    if (r.only === "baby" && !o.baby) continue;
    if (r.only === "pets" && !o.pets) continue;
    const t = TYPE_BY_KEY.get(r.key);
    if (!t) continue;
    const scale = family ? 1.5 : 1;
    out.push({
      productKey: t.key,
      title: o.locale === "he" ? t.he : t.en,
      qty: r.kg ? 1 : Math.max(1, Math.round((r.n ?? 1) * scale)),
      amount: r.kg ? Math.round(r.kg * scale * 2) / 2 : null,
      unit: r.kg ? "kg" : null,
      section: t.section,
      art: t.art,
    });
  }
  return out;
}

export const WEEKLY_BASKET_SIZE = 24;
