// R19 C1 + D5 — which catalog product a list row is, and how the catalog ranks for what's typed. Pure, client-safe
// (test:match). Barcode adds map exactly; a typed name maps by the home's remembered choice, then its usual brand
// (brand_buy, S3 C6) + the size, then a single clear candidate — silently ("as always · ₪6.80 · Change"); anything
// else asks once (C2). "Doesn't matter which" = the cheapest product of the type at the chosen store.
import { classifyLocal } from "../grocery/classify";
import { normalize } from "../grocery/normalize";

export type Cand = {
  gtin: string;
  name: string;
  brand: string | null;
  qty: number | null;
  unit: string | null;
  chains: number;
  /** At the chosen store (branch, else its chain); null = not sold there. */
  price: number | null;
  /** Bought by this home before (household products lead). */
  mine?: boolean;
};

/** The typed name's key for the remembered choice ("חלב 3%" ≡ "  חלב  3% "). */
export const nameKey = (title: string) => normalize(title).slice(0, 120);

/** "1 ליטר", "500 גרם", "1.5L", "250g" in a title → number + unit (g / ml / u … as the catalog keeps them). */
export function sizeIn(title: string): { qty: number; unit: "g" | "kg" | "ml" | "l" } | null {
  const m = normalize(title).match(/(\d+(?:\.\d+)?)\s*(קג|קילו|kg|גרמ|גרם|גר|g|מל|ml|ליטר|ל|l)(?=\s|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2];
  if (/^(קג|קילו|kg)$/.test(u)) return { qty: n, unit: "kg" };
  if (/^(גרמ|גרם|גר|g)$/.test(u)) return n >= 1000 ? { qty: n / 1000, unit: "kg" } : { qty: n, unit: "g" };
  if (/^(מל|ml)$/.test(u)) return n >= 1000 ? { qty: n / 1000, unit: "l" } : { qty: n, unit: "ml" };
  return { qty: n, unit: "l" };
}
const sameSize = (a: { qty: number; unit: string } | null, c: Cand) => !!a && c.qty != null && c.unit === a.unit && Math.abs(c.qty - a.qty) < 0.001;

/** Score a candidate for what was typed: word starts > anywhere, the same product type, the home's own, popularity. */
export function scoreCand(q: string, c: Cand, typeOfQ = classifyLocal(q).type) {
  const words = normalize(q).split(" ").filter(Boolean);
  const name = normalize(`${c.name} ${c.brand ?? ""}`);
  const toks = name.split(" ");
  let s = 0;
  for (const w of words) {
    if (toks[0]?.startsWith(w)) s += 6;
    else if (toks.some((t) => t.startsWith(w))) s += 4;
    else if (name.includes(w)) s += 1;
    else s -= 5;
  }
  if (typeOfQ && classifyLocal(c.name).type === typeOfQ) s += 5;
  if (c.mine) s += 6;
  if (c.price != null) s += 1;
  return s + Math.min(3, c.chains / 4);
}

/** The catalog's order for a search (D5) — best first. */
export function rankCandidates(q: string, cands: Cand[]) {
  const type = classifyLocal(q).type;
  return cands
    .map((c) => ({ c, s: scoreCand(q, c, type) }))
    .sort((a, b) => b.s - a.s || (a.c.price ?? 9e9) - (b.c.price ?? 9e9))
    .map((x) => x.c);
}

export type Choice = { gtin: string | null; anyType: string | null } | null;
export type Decision =
  | { state: "auto"; gtin: string; why: "barcode" | "choice" | "brand" | "only" }
  | { state: "any"; gtin: string | null; type: string }
  | { state: "ask"; cands: Cand[] }
  | { state: "none" };

/** C1: decide a row's product. `usualBrand` = the home's usual brand for the row's type (null when not learned). */
export function decideMatch(o: { title: string; gtin?: string | null; choice?: Choice; usualBrand?: string | null; cands: Cand[] }): Decision {
  const { title, cands } = o;
  if (o.gtin) {
    const hit = cands.find((c) => c.gtin === o.gtin);
    if (hit) return { state: "auto", gtin: hit.gtin, why: "barcode" };
  }
  const type = classifyLocal(title).type;
  if (o.choice?.anyType) return { state: "any", gtin: cheapest(cands, o.choice.anyType), type: o.choice.anyType };
  if (o.choice?.gtin && cands.some((c) => c.gtin === o.choice!.gtin)) return { state: "auto", gtin: o.choice.gtin, why: "choice" };
  // Only the candidates that are the typed thing (the same type, or all the typed words when the type isn't known).
  const words = normalize(title).split(" ").filter((w) => w.length > 1 && !/^\d/.test(w));
  const fits = cands.filter((c) => (type ? classifyLocal(c.name).type === type : words.every((w) => normalize(`${c.name} ${c.brand ?? ""}`).includes(w))));
  if (!fits.length) return cands.length ? { state: "ask", cands: rankCandidates(title, cands).slice(0, 6) } : { state: "none" };
  const size = sizeIn(title);
  const pool = size && fits.some((c) => sameSize(size, c)) ? fits.filter((c) => sameSize(size, c)) : fits;
  if (o.usualBrand) {
    const b = normalize(o.usualBrand);
    const mine = pool.filter((c) => normalize(`${c.brand ?? ""} ${c.name}`).includes(b));
    if (mine.length === 1) return { state: "auto", gtin: mine[0].gtin, why: "brand" };
    if (mine.length > 1) {
      // Several of the brand: the one the home already bought, else the most common size — still one clear pick.
      const own = mine.filter((c) => c.mine);
      if (own.length === 1) return { state: "auto", gtin: own[0].gtin, why: "brand" };
    }
  }
  if (pool.length === 1) return { state: "auto", gtin: pool[0].gtin, why: "only" };
  return { state: "ask", cands: rankCandidates(title, pool).slice(0, 6) };
}

/** "Doesn't matter which": the cheapest of the type at the store (by unit price when sizes differ). */
export function cheapest(cands: Cand[], type: string): string | null {
  const of = cands.filter((c) => c.price != null && classifyLocal(c.name).type === type);
  const per = (c: Cand) => (c.qty && (c.unit === "kg" || c.unit === "l") ? c.price! / c.qty : c.qty && (c.unit === "g" || c.unit === "ml") ? (c.price! / c.qty) * 1000 : c.price!);
  of.sort((a, b) => per(a) - per(b));
  return of[0]?.gtin ?? null;
}
