// R19 B2 + D1 — what a promotion is ("3 for ₪15", "₪11.90", "20 % off", "the 2nd at half price") and what it does to a
// list row ("3 for ₪15 · you have 3 ✓", "4 for ₪12 · worth taking 4"). Chains fill the Promo files' numbers differently
// (DiscountedPrice is a bundle total in some, per unit in others), so the description's own numbers lead when they're
// there and the fields fill in. Pure, client-safe — test:deals.
import type { PromoRow } from "./parse";

export type DealKind = "n_for" | "price" | "pct" | "second" | "other";
export type Deal = {
  kind: DealKind;
  /** How many units the deal needs (n_for: the bundle size; second: 2; else 1). */
  n: number;
  /** n_for: the bundle's total; price: the unit price; second: the 2nd unit's price (null with a rate). */
  price: number | null;
  /** pct: percent off every unit; second: percent off the 2nd unit. */
  rate: number | null;
  club: boolean;
  minBasket: number | null;
  ends: number | null;
  description: string;
};

const NUM = String.raw`(\d+(?:[.,]\d{1,2})?)`;
const toN = (s: string) => Number(s.replace(",", "."));

/** A Promo row → a deal. */
export function dealOf(p: Pick<PromoRow, "description" | "minQty" | "discountedPrice" | "discountRate" | "reward" | "club" | "minBasket" | "end">): Deal {
  const d = (p.description ?? "").replace(/\s+/g, " ").trim();
  const base = { club: p.club, minBasket: p.minBasket && p.minBasket > 0 ? p.minBasket : null, ends: p.end ? Date.parse(`${p.end}+03:00`) || null : null, description: d };
  // "1+1", "השני חינם", "השני ב-50%", "השני ב-5 ₪", "2nd at half price"
  if (/1\s*\+\s*1|השני(?:ה)?\s+(?:חינם|במתנה)|second (?:one )?free/i.test(d)) return { ...base, kind: "second", n: 2, price: 0, rate: 100 };
  let m = d.match(new RegExp(String.raw`השני(?:ה)?\s+ב\s*-?\s*${NUM}\s*%`)) ?? d.match(/(\d+)\s*% (?:off )?the second/i);
  if (m) return { ...base, kind: "second", n: 2, price: null, rate: toN(m[1]) };
  if (/השני(?:ה)?\s+בחצי|second (?:at )?half/i.test(d)) return { ...base, kind: "second", n: 2, price: null, rate: 50 };
  m = d.match(new RegExp(String.raw`השני(?:ה)?\s+ב\s*-?\s*₪?\s*${NUM}`));
  if (m) return { ...base, kind: "second", n: 2, price: toN(m[1]), rate: null };
  // "3 ב-15", "3 יח' ב 15 ₪", "2 ב-₪10", "4 for 12"
  m = d.match(new RegExp(String.raw`(?:^|[^\d.])(\d{1,2})\s*(?:יח['׳]?|יחידות|פריטים|מוצרים)?\s*(?:ב|for)\s*-?\s*₪?\s*${NUM}`, "i"));
  if (m && Number(m[1]) >= 2) return { ...base, kind: "n_for", n: Number(m[1]), price: toN(m[2]), rate: null };
  // "20% הנחה", "הנחה 15%", "15% off"
  m = d.match(new RegExp(String.raw`${NUM}\s*%`));
  if (m && /הנחה|off|discount|%\s*$/i.test(d)) return { ...base, kind: "pct", n: 1, price: null, rate: toN(m[1]) };
  // "ב-11.90", "ב 19.80 ש"ח", "רק 9.90", "only 9.90"
  m = d.match(new RegExp(String.raw`(?:ב|רק|only|at)\s*-?\s*₪?\s*${NUM}`, "i"));
  // The fields: MinQty ≥ 2 with a price = a bundle (a per-unit price when it's below the description's total / n).
  const min = p.minQty != null && p.minQty >= 2 && Number.isInteger(p.minQty) ? p.minQty : null;
  if (min && p.discountedPrice != null) {
    const each = m ? toN(m[1]) / min : null;
    const total = each != null && Math.abs(p.discountedPrice - each) < 0.02 ? p.discountedPrice * min : p.discountedPrice;
    return { ...base, kind: "n_for", n: min, price: Math.round(total * 100) / 100, rate: null };
  }
  if (m) return { ...base, kind: "price", n: 1, price: toN(m[1]), rate: null };
  if (p.discountedPrice != null && p.discountedPrice > 0) return { ...base, kind: "price", n: 1, price: p.discountedPrice, rate: null };
  if (p.discountRate != null && p.discountRate > 0 && p.discountRate < 100) return { ...base, kind: "pct", n: 1, price: null, rate: p.discountRate };
  return { ...base, kind: "other", n: 1, price: null, rate: null };
}

export type DealUse = {
  /** What the row costs at this count with the deal (null = the deal doesn't apply). */
  total: number;
  /** Without the deal. */
  regular: number;
  saved: number;
  /** have = the count already uses the deal fully; take = adding `take` units makes it worth it; none. */
  hint: "have" | "take" | "none";
  take: number;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * A deal on a row of `count` units (or kg when weighted) at `unit` each. "worth taking N" only when filling the bundle
 * costs no more than ~a unit's price over what's on the list now (it's then the cheaper way to buy N).
 */
export function applyDeal(deal: Deal, count: number, unit: number, opts: { weighted?: boolean; basket?: number; club?: boolean } = {}): DealUse {
  const regular = r2(count * unit);
  const none: DealUse = { total: regular, regular, saved: 0, hint: "none", take: 0 };
  if (deal.club && opts.club === false) return none;
  if (deal.minBasket && opts.basket != null && opts.basket < deal.minBasket) return none;
  if (!(count > 0) || !(unit > 0)) return none;
  const done = (total: number, hint: DealUse["hint"] = "have", take = 0): DealUse => ({ total: r2(Math.min(total, regular)), regular, saved: r2(Math.max(0, regular - total)), hint: total < regular - 0.004 ? hint : take ? hint : "none", take });
  switch (deal.kind) {
    case "price":
      return deal.price != null && deal.price < unit ? done(count * deal.price) : none;
    case "pct":
      return deal.rate ? done(count * unit * (1 - deal.rate / 100)) : none;
    case "n_for": {
      if (opts.weighted || deal.price == null || deal.n < 2) return none;
      const groups = Math.floor(count / deal.n);
      const rest = count - groups * deal.n;
      const total = groups * deal.price + rest * unit;
      if (rest > 0) {
        // Filling the next bundle: is N for the deal price worth it next to what's on the list?
        const need = deal.n - rest;
        const fill = (groups + 1) * deal.price;
        if (fill <= total + unit * 0.5 && deal.price < deal.n * unit) return { total: r2(total), regular, saved: r2(regular - total), hint: "take", take: need };
      }
      return groups > 0 ? done(total) : none;
    }
    case "second": {
      if (opts.weighted) return none;
      const pairs = Math.floor(count / 2);
      const second = deal.price != null ? deal.price : unit * (1 - (deal.rate ?? 0) / 100);
      const total = pairs * (unit + second) + (count - pairs * 2) * unit;
      if (count % 2 === 1 && second < unit) return { total: r2(total), regular, saved: r2(regular - total), hint: "take", take: 1 };
      return pairs > 0 ? done(total) : none;
    }
    default:
      return none;
  }
}

/** The best deal for a row among several (the lowest total; a "take" hint only when nothing applies yet). */
export function bestDeal(deals: Deal[], count: number, unit: number, opts: { weighted?: boolean; basket?: number; club?: boolean } = {}) {
  let best: { deal: Deal; use: DealUse } | null = null;
  for (const deal of deals) {
    const use = applyDeal(deal, count, unit, opts);
    if (use.hint === "none" && use.saved === 0) continue;
    if (!best || use.total < best.use.total - 0.004 || (Math.abs(use.total - best.use.total) < 0.005 && use.hint === "have" && best.use.hint !== "have")) best = { deal, use };
  }
  return best;
}
