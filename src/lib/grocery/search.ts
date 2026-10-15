// R18 C3 — type-ahead for the supermarket Add field (pure, client-safe). Ranked: this household's products first (times
// bought × recency), then the dictionary, then Open Food Facts results the server adds. Matching is on normalised text;
// every result carries the matched character range in its OWN title so S2 bolds only the typed letters (Tal
// 2026-10-11). Nothing matches → up to 3 "did you mean" by edit distance (≤ ⌊length / 3⌋, at least 1), household first.

import { PRODUCT_TYPES } from "./dictionary";
import { editDistance, normalize } from "./normalize";
import type { SectionOrOther } from "./sections";

export type HouseholdProduct = { productKey: string; title: string; count: number; lastAt: number; section: SectionOrOther; art: string | null };
export type Hit = {
  source: "household" | "dictionary" | "off";
  productKey: string;
  title: string;
  section: SectionOrOther;
  art: string | null;
  /** [start, end) of the typed letters in `title` (UTF-16 indices); null for "did you mean". */
  match: [number, number] | null;
  count?: number;
  /** S4 F3: this is the home's usual brand of its type. */
  usual?: boolean;
};

/**
 * R18 S4 F3: the home's usual brand of a type comes first among the hits (stable otherwise), marked `usual`.
 * `brandOf` = the brand part of a title (lib/grocery/classify), `usual` = type → brand.
 */
export function rankUsualBrand(hits: Hit[], usual: Record<string, string>, brandOf: (title: string) => { type: string; brand: string } | null): Hit[] {
  if (!hits.length || !Object.keys(usual).length) return hits;
  const marked = hits.map((h) => {
    const b = brandOf(h.title);
    return b && usual[b.type] && normalize(usual[b.type]) === normalize(b.brand) ? { ...h, usual: true } : h;
  });
  return [...marked.filter((h) => h.usual), ...marked.filter((h) => !h.usual)];
}

const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
/** normalize() one character at a time, remembering where each output character came from. */
export function normWithMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    let c = s[i].toLowerCase();
    if (c === "־") c = " ";
    else if (/[֑-ׇ׳״'"`‘’“”]/.test(c)) continue;
    c = FINALS[c] ?? c;
    if (!/[\p{L}\p{N}%.]/u.test(c)) {
      if (!space) {
        text += " ";
        map.push(i);
        space = true;
      }
      continue;
    }
    text += c;
    map.push(i);
    space = false;
  }
  return { text: text.trimEnd(), map };
}

/** Where the normalised query occurs in `title` (a word start preferred), as a range of the original title. */
export function matchRange(title: string, query: string): [number, number] | null {
  const q = normalize(query);
  if (!q) return null;
  const { text, map } = normWithMap(title);
  let at = -1;
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    if (i === 0 || text[i - 1] === " ") {
      at = i;
      break;
    }
    if (at < 0) at = i;
  }
  if (at < 0) return null;
  const end = map[at + q.length - 1];
  return [map[at], end + 1];
}

const DAY = 86_400_000;
/** Household rank: times bought, discounted by age (half-life ~ 60 days). */
export const householdScore = (p: { count: number; lastAt: number }, now: number) => p.count * Math.pow(0.5, Math.max(0, now - p.lastAt) / (60 * DAY));

export function typeAhead(query: string, household: HouseholdProduct[], o: { now?: number; locale?: string; limit?: number } = {}): { hits: Hit[]; didYouMean: Hit[] } {
  const now = o.now ?? Date.now();
  const limit = o.limit ?? 8;
  const he = o.locale === "he";
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const prefix = (r: [number, number] | null, t: string) => (r && (r[0] === 0 || /\s/.test(t[r[0] - 1] ?? " ")) ? 0 : 1);
  const own = household
    .map((p) => ({ p, r: matchRange(p.title, query) }))
    .filter((x) => x.r)
    .sort((a, b) => prefix(a.r, a.p.title) - prefix(b.r, b.p.title) || householdScore(b.p, now) - householdScore(a.p, now));
  for (const { p, r } of own) {
    if (seen.has(p.productKey)) continue;
    seen.add(p.productKey);
    hits.push({ source: "household", productKey: p.productKey, title: p.title, section: p.section, art: p.art, match: r, count: p.count });
  }
  const dict: (Hit & { pre: number })[] = [];
  for (const t of PRODUCT_TYPES) {
    if (seen.has(t.key)) continue;
    // Show the name in the reader's language; match any spelling.
    const shown = he ? t.he : t.en;
    const r = matchRange(shown, query);
    const other = r ? null : t.names.map((n) => ({ n, r: matchRange(n, query) })).find((x) => x.r);
    if (!r && !other) continue;
    const title = r ? shown : other!.n;
    const range = r ?? other!.r;
    dict.push({ source: "dictionary", productKey: t.key, title, section: t.section, art: t.art, match: range, pre: prefix(range, title) });
  }
  dict.sort((a, b) => a.pre - b.pre || a.title.length - b.title.length);
  for (const d of dict) {
    if (hits.length >= limit) break;
    const { pre: _pre, ...hit } = d;
    void _pre;
    hits.push(hit);
  }
  return { hits: hits.slice(0, limit), didYouMean: hits.length ? [] : didYouMean(query, household, { locale: o.locale }) };
}

/** Up to 3 near spellings (edit distance on the normalised words; a word's prefix counts while typing). */
export function didYouMean(query: string, household: HouseholdProduct[], o: { locale?: string } = {}): Hit[] {
  const q = normalize(query);
  if (q.length < 3) return [];
  const limit = Math.max(1, Math.floor(q.length / 3));
  const dist = (title: string) => {
    let best = 99;
    for (const w of normalize(title).split(" "))
      for (let k = Math.max(1, q.length - 1); k <= Math.min(w.length, q.length + 1); k++) best = Math.min(best, editDistance(q, w.slice(0, k)));
    return best;
  };
  const out: (Hit & { d: number; h: number })[] = [];
  for (const p of household) {
    const d = dist(p.title);
    if (d <= limit) out.push({ source: "household", productKey: p.productKey, title: p.title, section: p.section, art: p.art, match: null, count: p.count, d, h: 0 });
  }
  const he = o.locale === "he";
  for (const t of PRODUCT_TYPES) {
    if (out.some((x) => x.productKey === t.key)) continue;
    let best: { n: string; d: number } | null = null;
    for (const n of [he ? t.he : t.en, ...t.names]) {
      const d = dist(n);
      if (!best || d < best.d) best = { n, d };
    }
    if (best && best.d <= limit) out.push({ source: "dictionary", productKey: t.key, title: /[א-ת]/.test(q) ? t.he : t.en, section: t.section, art: t.art, match: null, d: best.d, h: 1 });
  }
  out.sort((a, b) => a.h - b.h || a.d - b.d || (b.count ?? 0) - (a.count ?? 0));
  return out.slice(0, 3).map(({ d: _d, h: _h, ...x }) => (void _d, void _h, x));
}
