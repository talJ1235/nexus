import "server-only";
import { generateJson, type AiUse } from "./ai";
import { mockAi } from "./assistant";
import { extractFromUrl, type Extracted } from "./extract";
import type { Scoped } from "./db-scoped";
import { spacePrefGet, spacePrefSet } from "./db-scoped/prefs";
import { convert, parsePrice, type Rates } from "./money";
import { shoppingSearch, webSearch, searchProvider } from "./search";
import { titleSimilarity } from "./similarity";
import { normalizeUrl, storeFromUrl } from "./stores";
import type { ItemWithSources } from "./types";

// Compare one item across any store (Round 7 G1): queries → candidate pages (search key, or the owner's extension) →
// read each page → keep only the same product (Gemini on the extracted data) → prices in the display currency.

export type Candidate = { url: string; title?: string | null; price?: string | number | null; source?: string | null };
export type CompareResult = {
  url: string;
  store: string;
  storeKey: string;
  title: string;
  image: string | null;
  price: number;
  currency: string;
  /** In the display currency, shipping included when known. */
  total: number;
  shipping: number | null;
  availability: string | null;
};
export type CompareCache = { at: number; currency: string; results: CompareResult[] };

const TTL = 24 * 3600_000;
const cacheKey = (id: string) => `compare:${id}`;

// R15: the cache is the space's (space_pref), keyed by item.
export async function cachedCompare(s: Scoped, itemId: string, currency: string): Promise<CompareCache | null> {
  const raw = await spacePrefGet(s, cacheKey(itemId)).catch(() => null);
  const c = raw ? (JSON.parse(raw) as CompareCache) : null;
  return c && Date.now() - c.at < TTL && c.currency === currency ? c : null;
}
export const saveCompare = (s: Scoped, itemId: string, c: CompareCache) => spacePrefSet(s, cacheKey(itemId), JSON.stringify(c)).catch(() => {});

/** 2–3 search queries from title / brand / model / specs (and the barcode when known). */
export async function compareQueries(item: ItemWithSources, use: AiUse): Promise<string[]> {
  const gtin = item.gtin ?? item.sources.find((s) => s.gtin)?.gtin ?? null;
  const base = [item.brand && !item.title.toLowerCase().includes(item.brand.toLowerCase()) ? `${item.brand} ${item.title}` : item.title];
  if (mockAi()) return [...base, ...(gtin ? [gtin] : [])].slice(0, 3);
  const out = await generateJson<{ queries: string[] }>(
    `Write 2–3 short web-shopping search queries that find THIS exact product in other online stores (any country). Use brand + model number + the key spec; drop marketing words, store names and colours unless they define the product.${gtin ? ` Its barcode (GTIN) is ${gtin}; make one query just the barcode.` : ""}\nProduct: ${item.title}${item.brand ? `\nBrand: ${item.brand}` : ""}${item.notes ? `\nNotes: ${item.notes.slice(0, 300)}` : ""}`,
    { type: "object", properties: { queries: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["queries"] },
    { use, budgetMs: 10_000 },
  ).catch(() => null);
  const q = (out?.queries ?? []).map((x) => x.trim()).filter(Boolean);
  return (q.length ? q : base).slice(0, 3);
}

/** Candidate pages from the search provider (web + shopping results). */
export async function searchCandidates(queries: string[]): Promise<Candidate[]> {
  if (!searchProvider()) return [];
  const lists = await Promise.all(queries.flatMap((q) => [shoppingSearch(q, 10), webSearch(q, 8)]));
  return lists.flat().map((r) => ({ url: r.url, title: r.title, price: "price" in r ? r.price : null, source: "source" in r ? r.source : null }));
}

/** Distinct product pages worth reading: one per store, not a store the item already has, no search/marketplace hubs. */
export function pickCandidates(item: ItemWithSources, cands: Candidate[], max = 8): Candidate[] {
  const have = new Set(item.sources.map((s) => s.storeKey));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    if (!/^https?:\/\//.test(c.url) || /google\.|bing\.|youtube\.|facebook\.|reddit\.|wikipedia\.|pinterest\./.test(c.url)) continue;
    const store = storeFromUrl(c.url);
    if (have.has(store.key) || seen.has(store.key)) continue;
    seen.add(store.key);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

type Read = { url: string; ex: Pick<Extracted, "title" | "price" | "currency" | "image" | "availability" | "brand"> & { store: { key: string; name: string } } };

/** Read candidate pages on the server; blocked ones are returned for the owner's browser to read. */
export async function readCandidates(cands: Candidate[], budgetMs = 25_000): Promise<{ read: Read[]; blocked: string[] }> {
  const t0 = Date.now();
  const read: Read[] = [];
  const blocked: string[] = [];
  await Promise.all(
    cands.map(async (c) => {
      if (Date.now() - t0 > budgetMs) return;
      const ex = await extractFromUrl(c.url).catch(() => null);
      if (ex && !ex.blocked && ex.title && ex.price != null) read.push({ url: ex.url, ex });
      else if (ex?.blocked || !ex) blocked.push(c.url);
      else if (ex.title && c.price != null) {
        // The page didn't show a price to the server, but the shopping result had one.
        const p = parsePrice(c.price, ex.currency ?? undefined);
        if (p) read.push({ url: ex.url, ex: { ...ex, price: p.amount, currency: p.currency ?? ex.currency } });
      }
    }),
  );
  return { read, blocked };
}

/** Keep only pages that are the same product (model/specs), judged by Gemini on the extracted data. */
export async function sameProduct(item: ItemWithSources, reads: Read[], use: AiUse): Promise<Read[]> {
  if (!reads.length) return [];
  if (mockAi()) return reads.filter((r) => titleSimilarity(item.title, r.ex.title ?? "") >= 0.35);
  const list = reads.map((r, i) => `${i}. ${r.ex.title}${r.ex.brand ? ` (brand ${r.ex.brand})` : ""} — ${r.ex.store.name}`).join("\n");
  const out = await generateJson<{ same: number[] }>(
    `Target product: ${item.title}${item.brand ? ` (brand ${item.brand})` : ""}.\nWhich of these store listings are the SAME product (same brand, model and key specs such as size/capacity/voltage; a different pack size or a bundle is NOT the same)? Return their numbers.\n${list}`,
    { type: "object", properties: { same: { type: "array", items: { type: "integer" } } }, required: ["same"] },
    { use, budgetMs: 12_000 },
  ).catch(() => null);
  if (!out) return reads.filter((r) => titleSimilarity(item.title, r.ex.title ?? "") >= 0.5);
  const keep = new Set(out.same);
  return reads.filter((_, i) => keep.has(i));
}

/** Cheapest first; when totals tie (within 1 %), the user's usual stores (`preferred` storeKeys, R9 C3) come first. */
export function toResults(reads: Read[], currency: string, rates: Rates, preferred: string[] = []): CompareResult[] {
  const rank = (k: string) => {
    const i = preferred.indexOf(k);
    return i < 0 ? preferred.length : i;
  };
  return reads
    .map((r) => {
      const cur = (r.ex.currency ?? storeFromUrl(r.url).currency ?? "USD").toUpperCase();
      const price = r.ex.price!;
      return {
        url: r.url,
        store: r.ex.store.name,
        storeKey: r.ex.store.key,
        title: r.ex.title ?? "",
        image: r.ex.image,
        price,
        currency: cur,
        shipping: null,
        total: Math.round(convert(price, cur, currency, rates) * 100) / 100,
        availability: r.ex.availability,
      };
    })
    .filter((r, i, all) => all.findIndex((x) => normalizeUrl(x.url) === normalizeUrl(r.url)) === i)
    .sort((a, b) => (Math.abs(a.total - b.total) <= Math.min(a.total, b.total) * 0.01 ? rank(a.storeKey) - rank(b.storeKey) || a.total - b.total : a.total - b.total));
}
