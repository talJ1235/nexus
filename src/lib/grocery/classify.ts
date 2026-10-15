// R18 A4 — classify a grocery line with the dictionary (pure, client-safe). The server adds Open Food Facts for a
// barcode and one batched AI call for what the dictionary doesn't know (lib/grocery/classify-server.ts).
//
// Matching: every synonym of every type is tried as a run of whole tokens (a Hebrew prefix letter or an English plural
// still matches); the longest synonym wins, ties go to the one that starts first. Qualifiers after "with" / "ללא" /
// "בתוספת"… are ignored first ("milk with added vitamin D" is milk), and only used when the head finds nothing.

import { PRODUCT_TYPES, TYPE_BY_KEY, type ProductType, type Unit } from "./dictionary";
import { normalize, tokenIs } from "./normalize";
import { OTHER, type SectionOrOther } from "./sections";

export type Classified = {
  /** Dictionary product type key, or null (unknown). */
  type: string | null;
  section: SectionOrOther;
  unit: Unit;
  art: string | null;
  /** Links the same product across trips: gtin when known, else the type + the words that tell it apart. */
  productKey: string;
  /** 0 = unknown, 0.6 = AI / Open Food Facts, 0.7–0.95 = dictionary. */
  confidence: number;
  via: "dictionary" | "barcode" | "ai" | "none";
};

const CONNECTORS = new Set(["with", "without", "w", "in", "for", "flavor", "flavour", "flavored", "flavoured", "עמ", "בלי", "ללא", "בתוספת", "בשביל", "בטעמ", "של"]);
/** "with" / "בתוספת" / "ללא"…: what follows qualifies the product before it (a normalised token). */
export const isConnector = (tok: string) => CONNECTORS.has(tok);
const STOP = new Set(["the", "a", "an", "of", "and", "or", "pack", "x", "ו", "את", "only", "רק", "size", "מידה", "new", "חדש"]);
const UNIT_WORDS: Record<string, string> = { גרמ: "g", גר: "g", gr: "g", gram: "g", grams: "g", g: "g", קג: "kg", קילו: "kg", kg: "kg", ליטר: "l", ל: "l", l: "l", liter: "l", litre: "l", מל: "ml", ml: "ml" };

type Indexed = { type: ProductType; toks: string[]; len: number };
let INDEX: Indexed[] | null = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = [];
  for (const t of PRODUCT_TYPES) {
    for (const n of t.names) {
      const toks = normalize(n).split(" ").filter(Boolean);
      if (toks.length) INDEX.push({ type: t, toks, len: toks.join(" ").length });
    }
  }
  return INDEX;
}

/** Where `syn` occurs in `toks` as a run of whole tokens (−1 = not found). */
function findRun(toks: string[], syn: string[]) {
  outer: for (let i = 0; i + syn.length <= toks.length; i++) {
    for (let j = 0; j < syn.length; j++) if (!tokenIs(toks[i + j], syn[j])) continue outer;
    return i;
  }
  return -1;
}

export type DictMatch = { type: ProductType; at: number; len: number; used: number };

/** Best dictionary match in already-normalised tokens, or null. */
export function matchTokens(toks: string[]): DictMatch | null {
  let best: DictMatch | null = null;
  for (const e of index()) {
    const at = findRun(toks, e.toks);
    if (at < 0) continue;
    if (!best || e.len > best.len || (e.len === best.len && at < best.at)) best = { type: e.type, at, len: e.len, used: e.toks.length };
  }
  return best;
}

/** R18 S3 B5: the longest dictionary name that starts exactly at token `i` (voice segmentation), or null. */
export function matchAt(toks: string[], i: number): DictMatch | null {
  let best: DictMatch | null = null;
  for (const e of index()) {
    if (i + e.toks.length > toks.length) continue;
    let hit = true;
    for (let j = 0; j < e.toks.length && hit; j++) hit = tokenIs(toks[i + j], e.toks[j]);
    if (hit && (!best || e.toks.length > best.used || (e.toks.length === best.used && e.len > best.len))) best = { type: e.type, at: i, len: e.len, used: e.toks.length };
  }
  return best;
}

/** The head of a line: the tokens before the first qualifier ("with", "ללא", "בתוספת"…). */
export function headTokens(toks: string[]) {
  const i = toks.findIndex((t, k) => k > 0 && CONNECTORS.has(t));
  return i > 0 ? toks.slice(0, i) : toks;
}

export function matchText(text: string): DictMatch | null {
  const toks = normalize(text).split(" ").filter(Boolean);
  if (!toks.length) return null;
  const head = headTokens(toks);
  return matchTokens(head) ?? (head.length < toks.length ? matchTokens(toks) : null);
}

/** The words that tell this product apart from others of its type ("3%", "1%", "500 g"), normalised and sorted. */
export function distinguishing(text: string, type: ProductType | null) {
  const toks = headTokens(normalize(text).split(" ").filter(Boolean));
  const own = new Set<string>();
  // A synonym's numbers ("קוטג׳ 5%") still tell products apart.
  if (type) for (const n of type.names) for (const w of normalize(n).split(" ")) if (!/^\d/.test(w)) own.add(w);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (STOP.has(t) || (type && [...own].some((w) => tokenIs(t, w)))) continue;
    if (UNIT_WORDS[t] && i > 0 && /^\d/.test(toks[i - 1])) {
      out[out.length - 1] = `${out[out.length - 1]}${UNIT_WORDS[t]}`;
      continue;
    }
    const m = /^(\d+(?:\.\d+)?)(kg|g|l|ml|גרמ|קג|ליטר|מל)$/.exec(t);
    out.push(m ? `${m[1]}${UNIT_WORDS[m[2]] ?? m[2]}` : t);
  }
  return [...new Set(out)].sort();
}

export const gtinKey = (gtin: string) => `gtin:${gtin.replace(/\D/g, "")}`;

export function productKeyFor(text: string, type: ProductType | null, gtin?: string | null) {
  if (gtin && /^\d{8,14}$/.test(gtin.replace(/\D/g, ""))) return gtinKey(gtin);
  const extra = distinguishing(text, type);
  if (!type) return `~${normalize(text)}`.slice(0, 120);
  return [type.key, ...extra].join(" ").slice(0, 120);
}

/** Dictionary only (sync). Unknown → section `other`, confidence 0. */
export function classifyLocal(text: string, gtin?: string | null): Classified {
  const m = matchText(text);
  if (!m) return { type: null, section: OTHER, unit: "u", art: null, productKey: productKeyFor(text, null, gtin), confidence: 0, via: "none" };
  const toks = normalize(text).split(" ").filter((t) => t && !/^\d/.test(t) && !UNIT_WORDS[t]);
  const share = toks.length ? m.used / toks.length : 1;
  return { type: m.type.key, section: m.type.section, unit: m.type.unit, art: m.type.art, productKey: productKeyFor(text, m.type, gtin), confidence: share >= 0.5 ? 0.95 : 0.7, via: "dictionary" };
}

export const typeOf = (key: string | null | undefined) => (key ? (TYPE_BY_KEY.get(key) ?? null) : null);

/** Dictionary synonyms that are brands (they find the type, but in a name they are the brand: "Tnuva milk"). */
const BRAND_WORDS = new Set(["tnuva", "תנובה", "nescafe", "נסקפה", "prigat", "פריגת", "pepsi", "פפסי", "coca", "קוקה", "activia", "אקטיביה", "yoplait", "יופלה", "danone", "דנונה", "ספרינג"].map((w) => normalize(w)));

/**
 * R18 S3 C6: the brand part of a product's name — what's left once its type ("milk", "חלב") and its pack size ("1 L",
 * "500 g", "x6") are taken out, in the name's own order and spelling ("Tnuva milk 3% 1L" → type milk, "Tnuva 3%").
 * Null when the type is unknown (nothing to compare with) or nothing is left (a plain "Milk").
 */
export function brandOf(title: string): { type: string; brand: string; key: string } | null {
  const m = matchText(title);
  if (!m) return null;
  const own = new Set<string>();
  for (const n of m.type.names) for (const w of normalize(n).split(" ")) if (w && !/^\d/.test(w) && !BRAND_WORDS.has(w)) own.add(w);
  const words = String(title).trim().split(/\s+/);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const n = normalize(words[i]);
    if (!n) continue;
    const next = normalize(words[i + 1] ?? "");
    // A brand's own second word stays with it even when it names the type ("Coca Cola").
    const prev = i > 0 ? normalize(words[i - 1]) : "";
    const afterBrand = BRAND_WORDS.has(prev) && m.type.names.some((x) => normalize(x) === `${prev} ${n}`);
    if (STOP.has(n) || (!afterBrand && [...own].some((w) => tokenIs(n, w)))) continue;
    // A pack size: "1L", "500g", "1.5 ליטר", "x6", "6x", "×6" — a number with its unit word goes as one.
    if (/^(\d+(\.\d+)?)(kg|g|l|ml|גרמ|גר|קג|ליטר|מל)$/.test(n) || /^(x|×)?\d+(x|×)?$/.test(n.replace(/×/g, "x")) && !/%/.test(words[i])) {
      if (/^\d+(\.\d+)?$/.test(n) && UNIT_WORDS[next]) i++;
      continue;
    }
    if (UNIT_WORDS[n] && kept.length && /^\d/.test(kept[kept.length - 1])) {
      kept.pop();
      continue;
    }
    kept.push(words[i].replace(/^[,;:()"'׳״-]+|[,;:()"'׳״-]+$/g, ""));
  }
  // A lone letter is a size ("Eggs L"), not a brand.
  const brand = kept.filter((w) => w && !/^\p{L}$/u.test(w)).join(" ").trim();
  if (!brand || !/\p{L}/u.test(brand)) return null;
  return { type: m.type.key, brand, key: normalize(brand) };
}
