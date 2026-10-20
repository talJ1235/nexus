// R19 B3 — every barcode in the price files becomes one catalog product: the cleanest name across chains (chains cut
// names at 20–30 letters and spell sizes their own way), the manufacturer as the brand, the pack size as a number + unit,
// weighted or not, a section from the dictionary, a short display name. Pure — test:catalog.
import { classifyLocal } from "../grocery/classify";
import { normalize } from "../grocery/normalize";
import type { PriceRow } from "./parse";

export type Unit = "g" | "kg" | "ml" | "l" | "u";

/** "גרם", "100 גרם", "ק\"ג", "קילוגרם", "מ\"ל", "ליטר", "יחידות", "יח'" … → a unit. */
export function unitOf(raw: string): Unit | null {
  const s = raw.replace(/["'׳״]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s) return null;
  if (/(^|\d|\s)(קג|קילו|קילוגרם|kg|kilo)/.test(s)) return "kg";
  if (/(^|\d|\s)(גרם|גר|gr|g)\b/.test(s) || /גרם/.test(s)) return "g";
  if (/(מל|מיליליטר|ml|מיליליטרים)/.test(s)) return "ml";
  if (/(ליטר|liter|litre|^l$|\dl\b)/.test(s)) return "l";
  if (/(יח|יחידה|יחידות|unit|pcs|מארז|זוג)/.test(s)) return "u";
  return null;
}

/** A row's pack size: Quantity in the row's unit ("215" + "100 גרם" = 215 g; "1" + "ליטר" = 1 l). */
export function sizeOf(r: Pick<PriceRow, "quantity" | "unit" | "weighted">): { qty: number | null; unit: Unit | null } {
  const unit = unitOf(r.unit);
  const q = r.quantity;
  if (r.weighted) return { qty: 1, unit: unit === "g" || unit === "kg" ? "kg" : (unit ?? "kg") };
  if (q == null || q <= 0 || q > 100000) return { qty: null, unit };
  // 1000 g → 1 kg, 1500 ml → 1.5 l (how the app shows sizes).
  if (unit === "g" && q >= 1000 && q % 100 === 0) return { qty: q / 1000, unit: "kg" };
  if (unit === "ml" && q >= 1000 && q % 50 === 0) return { qty: q / 1000, unit: "l" };
  return { qty: q, unit };
}

/** A chain's spelling of a name, cleaned: spaces, quotes, stray punctuation, the "*" / "#" marks some chains add. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/[*#_~^]+/g, " ")
    .replace(/["”“]/g, '"')
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "תנובה בע\"מ", "שטראוס גרופ בע\"מ", "Unilever Israel Ltd" → "תנובה", "שטראוס גרופ", "Unilever Israel". */
export function cleanBrand(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(בע"?מ|בעמ|ltd\.?|limited|inc\.?|co\.?|ישראל בע"מ)\b/gi, " ")
    .replace(/בע"מ|בע״מ/g, " ")
    .replace(/[,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /^(לא ידוע|unknown|כללי|general|שונות|ספק כללי|\d+)$/i.test(s)) return null;
  return s;
}

/**
 * The best name among the chains' spellings: the most common one, but a longer spelling that continues it wins (a chain
 * cut it: "בייבי כיף קרם גוף לפ" → "בייבי כיף קרם גוף לפנים ולגוף"); ties → the longer.
 */
export function bestName(names: string[]): string {
  const counts = new Map<string, { n: number; raw: string }>();
  for (const raw of names) {
    const c = cleanName(raw);
    if (!c) continue;
    const k = normalize(c);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { n: 1, raw: c });
  }
  const list = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[0].length - a[0].length);
  if (!list.length) return "";
  let [key, top] = list[0];
  for (const [k, e] of list.slice(1)) if (k.length > key.length && k.startsWith(key)) (key = k), (top = e);
  return top.raw;
}

/**
 * A real barcode (8–14 digits, not all zeros) vs a store's own code: weighed produce / deli codes are 1–7 digits, and
 * EAN-13 codes starting with "2" are in-store (variable weight / price) — neither names the same product in another chain.
 */
export function isRealGtin(code: string) {
  return /^\d{8,14}$/.test(code) && !/^0+$/.test(code) && !/^2\d{12}$/.test(code);
}

export type CatalogEntry = {
  gtin: string;
  name: string;
  brand: string | null;
  manufacturer: string | null;
  qty: number | null;
  unit: Unit | null;
  weighted: boolean;
  internal: boolean;
  section: string | null;
  search: string;
  chains: number;
  branches: number;
};

/** Merge every chain's rows of one barcode into its catalog entry. `rows` = [chainId, row] pairs. */
export function mergeProduct(gtin: string, rows: [string, PriceRow][]): CatalogEntry {
  const names = rows.map(([, r]) => r.name).filter(Boolean);
  const name = bestName(names) || gtin;
  const brands = rows.map(([, r]) => cleanBrand(r.manufacturer)).filter(Boolean) as string[];
  const brand = mode(brands);
  const sizes = rows.map(([, r]) => sizeOf(r)).filter((s) => s.qty != null && s.unit);
  const size = modeBy(sizes, (s) => `${s.qty}${s.unit}`) ?? { qty: null, unit: rows.map(([, r]) => unitOf(r.unit)).find(Boolean) ?? null };
  const weighted = rows.filter(([, r]) => r.weighted).length * 2 > rows.length;
  const c = classifyLocal(name, isRealGtin(gtin) ? gtin : null);
  return {
    gtin,
    name,
    brand,
    manufacturer: brand,
    qty: size.qty,
    unit: size.unit,
    weighted,
    internal: !isRealGtin(gtin),
    section: c.section === "other" ? null : c.section,
    search: normalize(`${name} ${brand ?? ""}`),
    chains: new Set(rows.map(([ch]) => ch)).size,
    branches: rows.length,
  };
}

function mode(xs: string[]): string | null {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, n] of m) if (best == null || n > m.get(best)! || (n === m.get(best) && k.length > best.length)) best = k;
  return best;
}
function modeBy<T>(xs: T[], key: (x: T) => string): T | null {
  const m = new Map<string, { n: number; x: T }>();
  for (const x of xs) {
    const k = key(x);
    const e = m.get(k);
    if (e) e.n++;
    else m.set(k, { n: 1, x });
  }
  let best: { n: number; x: T } | null = null;
  for (const e of m.values()) if (!best || e.n > best.n) best = e;
  return best?.x ?? null;
}

/** The most common price among a chain's branches (ties → the lower), with the range. */
export function chainPriceOf(prices: number[]): { price: number; low: number; high: number } {
  const m = new Map<number, number>();
  for (const p of prices) m.set(p, (m.get(p) ?? 0) + 1);
  let best = prices[0];
  for (const [p, n] of m) if (n > m.get(best)! || (n === m.get(best) && p < best)) best = p;
  return { price: best, low: Math.min(...prices), high: Math.max(...prices) };
}
