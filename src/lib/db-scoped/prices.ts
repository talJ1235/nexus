// R19 — the price data (public files: global tables, no space_id) as the app reads it: the store directory (A10),
// catalog + prices + deals (C1, D1–D6). Space rows (space_store, items) go through Scoped as always.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHAINS, chainById } from "@/lib/grocery/chains";
import { normalize } from "@/lib/grocery/normalize";
import type { Scoped } from "./index";
import { put } from "@vercel/blob";
import { kvGet, kvSet } from "@/lib/kv";
import { safeFetch } from "@/lib/safe-fetch";
import { picturesFor } from "@/lib/product-pictures";
import { catalogLineInfo, catalogThumb, pictureDayKey, underCap } from "@/lib/catalog-picture";
import { isStale } from "@/lib/prices/health";
import { decideMatch, nameKey, rankCandidates, type Cand } from "@/lib/prices/match";
import { classifyLocal, typeOf } from "@/lib/grocery/classify";

export type BranchHit = {
  id: string;
  chain: string;
  storeId: number;
  name: string;
  address: string;
  city: string;
  cityEn: string;
  online: boolean;
  lat: number | null;
  lng: number | null;
  /** km from `near` (null without a location or coordinates). */
  km: number | null;
  pricesAt: number | null;
};

const km = (a: { lat: number; lng: number }, b: { lat: number | null; lng: number | null }) => {
  if (b.lat == null || b.lng == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)) * 10) / 10;
};

const hit = (r: typeof schema.branch.$inferSelect, near?: { lat: number; lng: number } | null): BranchHit => ({
  id: r.id,
  chain: r.chainId,
  storeId: r.storeId,
  name: r.name,
  address: r.address,
  city: r.city,
  cityEn: r.cityEn,
  online: r.kind === 2,
  lat: r.lat,
  lng: r.lng,
  km: near ? km(near, r) : null,
  pricesAt: r.pricesAt,
});

/**
 * The picker's search: every typed word narrows (chain, city, street, branch name — in any order, he or en); a chain
 * filter; nearest first with a location, else the big chains first, then city. Gone branches never show.
 */
export async function searchBranches(o: { q?: string; chain?: string | null; near?: { lat: number; lng: number } | null; limit?: number }): Promise<BranchHit[]> {
  const words = normalize(o.q ?? "").split(" ").filter((w) => w.length > 0).slice(0, 6);
  const conds = [isNull(schema.branch.goneAt)];
  if (o.chain) conds.push(eq(schema.branch.chainId, o.chain));
  for (const w of words) conds.push(sql`${schema.branch.search} LIKE ${`%${w}%`}`);
  const rows = await db
    .select()
    .from(schema.branch)
    .where(and(...conds))
    .limit(Math.max(o.limit ?? 40, o.near ? 600 : 200));
  const big = new Map(CHAINS.map((c, i) => [c.id, c.big ? i : 100 + i]));
  const hits = rows.map((r) => hit(r, o.near));
  hits.sort((a, b) => (o.near ? (a.km ?? 9e9) - (b.km ?? 9e9) : 0) || (big.get(a.chain) ?? 999) - (big.get(b.chain) ?? 999) || a.city.localeCompare(b.city, "he") || a.storeId - b.storeId);
  return hits.slice(0, o.limit ?? 40);
}

export async function branchesById(ids: string[]): Promise<Map<string, BranchHit>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(schema.branch).where(inArray(schema.branch.id, ids));
  return new Map(rows.map((r) => [r.id, hit(r)]));
}

/** Chains that have branches in the directory (from the Stores files), with their counts. */
export async function directoryChains(): Promise<{ id: string; branches: number }[]> {
  const rows = await db.select({ id: schema.branch.chainId, n: sql<number>`count(*)` }).from(schema.branch).where(isNull(schema.branch.goneAt)).groupBy(schema.branch.chainId);
  return rows.map((r) => ({ id: r.id, branches: Number(r.n) }));
}

/** How well a typed branch ("סינמה סיטי", "herzl", "נתניה") fits a real branch: shared words (prefixes) / words typed. */
export function branchScore(typed: string, b: Pick<BranchHit, "name" | "address" | "city" | "cityEn">) {
  const want = normalize(typed).split(" ").filter((w) => w.length > 1);
  if (!want.length) return 0;
  const hay = normalize(`${b.name} ${b.address} ${b.city} ${b.cityEn}`).split(" ");
  let n = 0;
  for (const w of want) if (hay.some((h) => h.startsWith(w) || (w.length >= 4 && h.includes(w)))) n++;
  return n / want.length;
}

/**
 * A10: the space's stores typed before the directory existed → their real branch (the best match within the chain, all
 * words found; ties → none). Unmatched rows stay as they are and the picker asks once.
 */
export async function mapStores(s: Scoped): Promise<number> {
  const rows = await s.select(schema.spaceStore, isNull(schema.spaceStore.branchId));
  let mapped = 0;
  for (const r of rows) {
    if (!chainById(r.chain) || !r.branch.trim()) continue;
    const cands = await searchBranches({ chain: r.chain, limit: 2000 });
    const scored = cands.map((b) => ({ b, sc: branchScore(r.branch, b) })).filter((x) => x.sc >= 1).sort((a, b) => b.sc - a.sc);
    if (scored.length !== 1 && !(scored.length > 1 && normalize(scored[0].b.name) === normalize(r.branch))) continue;
    await s.update(schema.spaceStore, { branchId: scored[0].b.id }, and(eq(schema.spaceStore.chain, r.chain), eq(schema.spaceStore.branch, r.branch)));
    mapped++;
  }
  return mapped;
}

// ---------- B4: catalog pictures ----------

/**
 * Pictures for catalog products that have none yet (lazy: the first time they're shown / searched; nightly: the most
 * bought). Bounded by time, by the day's cap (PICTURE_CAPS) and 3 tries per product; the system's AI budget, never a
 * person's. The thumbnail goes to Blob (`catalog/<gtin>.webp`); without Blob the source URL is kept.
 */
export async function fillCatalogPictures(gtins: string[], o: { budgetMs?: number; now?: number } = {}) {
  const now = o.now ?? Date.now();
  const day = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  const used = Number((await kvGet(pictureDayKey(day))) ?? 0);
  const rows = gtins.length
    ? await db
        .select()
        .from(schema.catalog)
        .where(and(inArray(schema.catalog.gtin, gtins.slice(0, 200)), isNull(schema.catalog.imageUrl), sql`${schema.catalog.imageTries} < 3`))
        .limit(underCap(used, 8))
    : [];
  if (!rows.length) return { tried: 0, filled: 0 };
  await kvSet(pictureDayKey(day), String(used + rows.length));
  const out = await picturesFor(rows.map((r) => ({ name: r.name, info: catalogLineInfo({ gtin: r.gtin.split("#").pop()!, name: r.name, brand: r.brand, qty: r.qty, unit: r.unit, internal: r.internal }) })), o.budgetMs ?? 15_000);
  let filled = 0;
  for (const [i, r] of out.entries()) {
    const row = rows[i];
    const c = r.ranked.chosen;
    const real = !!c && c.source !== "icon" && c.source !== "generic";
    let url: string | null = null;
    if (real) url = await thumbToBlob(c.url, row.gtin).catch(() => null);
    await db
      .update(schema.catalog)
      .set(url ? { imageUrl: url, imageSrc: c!.source === "barcode" || c!.source === "off" ? "off" : c!.source === "own" ? "own" : "search", imageAt: now, imageTries: row.imageTries + 1 } : { imageTries: row.imageTries + 1, imageSrc: row.imageTries >= 2 ? "none" : null })
      .where(eq(schema.catalog.gtin, row.gtin));
    if (url) filled++;
  }
  return { tried: rows.length, filled };
}

async function thumbToBlob(src: string, gtin: string): Promise<string | null> {
  const m = src.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (m && !process.env.BLOB_READ_WRITE_TOKEN) return src.length < 6000 ? src : null;
  const buf = m ? Buffer.from(m[1], "base64") : (await safeFetch(src, { timeoutMs: 7000, maxBytes: 8_000_000, headers: { accept: "image/*" } })).body;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return src;
  const webp = await catalogThumb(buf);
  const blob = await put(`catalog/${gtin.replace(/[^\w-]/g, "_")}.webp`, webp, { access: "public", contentType: "image/webp", addRandomSuffix: true });
  return blob.url;
}

/** The products the homes buy most (mapped list rows), for the nightly picture batch. */
export async function mostBought(limit = 40): Promise<string[]> {
  const rows = await db
    .select({ gtin: schema.items.catalogGtin, n: sql<number>`count(*)` })
    .from(schema.items)
    .where(sql`${schema.items.catalogGtin} IS NOT NULL`)
    .groupBy(schema.items.catalogGtin)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
  return rows.map((r) => r.gtin!).filter(Boolean);
}

// ---------- B5: freshness, health ----------

export type ChainHealth = { id: string; branches: number; lastFileAt: number | null; lastOkAt: number | null; error: string | null; filesToday: number; rowsToday: number; changedToday: number; failedToday: number; stale: boolean };

/** Admin → System: per chain the newest file, today's rows / changes / failed files, staleness; picture coverage. */
export async function priceHealth(now = Date.now()) {
  const dayStart = now - ((now + 3 * 3600_000) % 86_400_000);
  const chains = await db.select().from(schema.chain);
  const today = await db
    .select({ chain: schema.priceFile.chainId, files: sql<number>`count(*)`, rows: sql<number>`coalesce(sum(${schema.priceFile.rows}), 0)`, changed: sql<number>`coalesce(sum(${schema.priceFile.changed}), 0)`, failed: sql<number>`sum(${schema.priceFile.error} IS NOT NULL)` })
    .from(schema.priceFile)
    .where(sql`${schema.priceFile.readAt} >= ${dayStart}`)
    .groupBy(schema.priceFile.chainId);
  const by = new Map(today.map((r) => [r.chain, r]));
  const [pics] = await db.select({ all: sql<number>`count(*)`, real: sql<number>`sum(${schema.catalog.imageUrl} IS NOT NULL)` }).from(schema.catalog);
  const rows: ChainHealth[] = chains
    .map((c) => {
      const t = by.get(c.id);
      return { id: c.id, branches: c.branches, lastFileAt: c.lastFileAt, lastOkAt: c.lastOkAt, error: c.lastError, filesToday: Number(t?.files ?? 0), rowsToday: Number(t?.rows ?? 0), changedToday: Number(t?.changed ?? 0), failedToday: Number(t?.failed ?? 0), stale: isStale(c.lastFileAt, now) };
    })
    .sort((a, b) => Number(b.stale) - Number(a.stale) || (b.lastFileAt ?? 0) - (a.lastFileAt ?? 0));
  return { chains: rows, products: Number(pics?.all ?? 0), withPicture: Number(pics?.real ?? 0) };
}

/** The app's side: which chains' prices may be old (for "prices may be old" next to their estimates). */
export async function staleChains(now = Date.now()): Promise<string[]> {
  const rows = await db.select({ id: schema.chain.id, at: schema.chain.lastFileAt }).from(schema.chain);
  return rows.filter((r) => isStale(r.at, now)).map((r) => r.id);
}

// ---------- C1 / D5: the catalog search and matching a list row ----------

export type CatalogHit = Cand & { imageUrl: string | null; section: string | null; short: string | null; weighted: boolean; unitPrice: number | null; deals: number };
export type PriceAt = { branchId: string | null; chainId: string | null };

/** The space's store for prices: the default store's real branch, else its chain (null = no store yet). */
export async function priceStoreOf(s: Scoped, pick?: { chain: string; branchId?: string | null } | null): Promise<PriceAt> {
  if (pick) return { branchId: pick.branchId ?? null, chainId: pick.chain };
  const [d] = await s.select(schema.spaceStore, eq(schema.spaceStore.isDefault, true)).limit(1);
  return d ? { branchId: d.branchId ?? null, chainId: d.chain } : { branchId: null, chainId: null };
}

/** FTS5 trigram over the catalog's normalized names (3+ letters); fewer letters → prefix on the name. */
async function catalogRows(q: string, limit: number) {
  const n = normalize(q).trim();
  if (!n) return [] as (typeof schema.catalog.$inferSelect)[];
  if (n.replace(/\s/g, "").length >= 3) {
    const terms = n.split(" ").filter((w) => w.length >= 3).map((w) => `"${w.replace(/"/g, "")}"`).join(" AND ") || `"${n.replace(/"/g, "")}"`;
    const ids = await db.all<{ gtin: string }>(sql`SELECT gtin FROM catalog_fts WHERE catalog_fts MATCH ${terms} LIMIT ${limit}`).catch(() => [] as { gtin: string }[]);
    if (!ids.length) return [];
    return db.select().from(schema.catalog).where(inArray(schema.catalog.gtin, ids.map((r) => r.gtin)));
  }
  return db.select().from(schema.catalog).where(sql`${schema.catalog.search} LIKE ${`${n}%`}`).limit(limit);
}

/** Catalog products for what's typed, with the price at the store (its branch's own price, else the chain's). */
export async function catalogSearch(q: string, at: PriceAt, o: { limit?: number; mine?: Set<string> } = {}): Promise<CatalogHit[]> {
  const rows = await catalogRows(q, 200);
  if (!rows.length) return [];
  const gtins = rows.map((r) => r.gtin);
  const prices = await pricesAt(gtins, at);
  const deals = at.chainId ? await dealCounts(gtins, at.chainId) : new Map<string, number>();
  const hits: CatalogHit[] = rows
    // Store codes belong to their chain only.
    .filter((r) => !r.internal || (at.chainId && r.gtin.startsWith(`${at.chainId}#`)))
    .map((r) => ({
      gtin: r.gtin,
      name: r.name,
      brand: r.brand,
      qty: r.qty,
      unit: r.unit,
      chains: r.chains,
      price: prices.get(r.gtin)?.price ?? null,
      unitPrice: prices.get(r.gtin)?.unit ?? null,
      mine: o.mine?.has(r.gtin),
      imageUrl: r.imageUrl,
      section: r.section,
      short: r.short,
      weighted: r.weighted,
      deals: deals.get(r.gtin) ?? 0,
    }));
  return rankCandidates(q, hits).slice(0, o.limit ?? 20) as CatalogHit[];
}

/** Prices of products at a store: the branch's own price first, then its chain's. */
export async function pricesAt(gtins: string[], at: PriceAt): Promise<Map<string, { price: number; unit: number | null; at: number | null }>> {
  const out = new Map<string, { price: number; unit: number | null; at: number | null }>();
  if (!gtins.length || !at.chainId) return out;
  for (let i = 0; i < gtins.length; i += 300) {
    const part = gtins.slice(i, i + 300);
    for (const r of await db.select().from(schema.chainPrice).where(and(eq(schema.chainPrice.chainId, at.chainId), inArray(schema.chainPrice.gtin, part)))) out.set(r.gtin, { price: r.price, unit: r.unitPrice, at: r.priceAt });
    if (at.branchId) for (const r of await db.select().from(schema.branchPrice).where(and(eq(schema.branchPrice.branchId, at.branchId), inArray(schema.branchPrice.gtin, part)))) out.set(r.gtin, { price: r.price, unit: r.unitPrice, at: r.priceAt });
  }
  return out;
}

async function dealCounts(gtins: string[], chainId: string) {
  const rows = await db
    .select({ gtin: schema.promoItem.gtin, n: sql<number>`count(*)` })
    .from(schema.promoItem)
    .innerJoin(schema.promo, eq(schema.promo.id, schema.promoItem.promoId))
    .where(and(inArray(schema.promoItem.gtin, gtins.slice(0, 300)), eq(schema.promo.chainId, chainId)))
    .groupBy(schema.promoItem.gtin);
  return new Map(rows.map((r) => [r.gtin, Number(r.n)]));
}

/** The products this home already has on its list / bought (household products lead the search). */
export async function homeGtins(s: Scoped): Promise<Set<string>> {
  const rows = await s.pick({ g: schema.items.catalogGtin }, schema.items, sql`${schema.items.catalogGtin} IS NOT NULL`);
  return new Set(rows.map((r) => r.g!).filter(Boolean));
}

export type RowMatch = { state: "auto" | "any" | "ask" | "none"; why?: string; gtin: string | null; name?: string; price?: number | null; cands?: CatalogHit[] };

/**
 * C1: give a list row its product (never changes what the user typed). Barcode → exact; the home's remembered choice;
 * the usual brand + size; one clear candidate; else "ask" (the row shows "choose a product", C2 opens).
 */
export async function matchRow(s: Scoped, item: { id: string; title: string; gtin?: string | null }, o: { usualBrand?: string | null; at?: PriceAt } = {}): Promise<RowMatch> {
  const at = o.at ?? (await priceStoreOf(s));
  const core = item.title.replace(/\d+(?:[.,]\d+)?\s*(ק"ג|קג|גרם|גר|מ"ל|מל|ליטר|יח'?|kg|g|ml|l)(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim() || item.title;
  // The catalog speaks Hebrew (the chains' files): an English name searches by its product type's Hebrew name.
  const he = /[֐-׿]/.test(core);
  const type = he ? null : typeOf(classifyLocal(core).type);
  const query = type ? type.he : core;
  const cands = await catalogSearch(query, at, { limit: 40, mine: await homeGtins(s) });
  if (item.gtin && !cands.some((c) => c.gtin === item.gtin)) {
    const [g] = await db.select().from(schema.catalog).where(eq(schema.catalog.gtin, item.gtin)).limit(1);
    if (g) cands.unshift({ gtin: g.gtin, name: g.name, brand: g.brand, qty: g.qty, unit: g.unit, chains: g.chains, price: (await pricesAt([g.gtin], at)).get(g.gtin)?.price ?? null, unitPrice: null, imageUrl: g.imageUrl, section: g.section, short: g.short, weighted: g.weighted, deals: 0 });
  }
  const [ch] = await s.select(schema.productChoice, eq(schema.productChoice.nameKey, nameKey(item.title))).limit(1);
  const d = decideMatch({ title: item.title, gtin: item.gtin ?? null, choice: ch ? { gtin: ch.gtin, anyType: ch.anyType } : null, usualBrand: o.usualBrand ?? null, cands });
  const now = Date.now();
  const gtin = d.state === "auto" || d.state === "any" ? d.gtin : null;
  await s.update(schema.items, { catalogGtin: gtin, matchState: d.state === "none" ? "none" : d.state, matchAt: now }, eq(schema.items.id, item.id));
  const hit = gtin ? cands.find((c) => c.gtin === gtin) : null;
  return { state: d.state, why: d.state === "auto" ? d.why : undefined, gtin, name: hit?.name, price: hit?.price ?? null, cands: d.state === "ask" ? (d.cands as CatalogHit[]) : undefined };
}

/** C2: the home's answer — this product (or "doesn't matter which" of its type), remembered per typed name unless off. */
export async function chooseProduct(s: Scoped, item: { id: string; title: string }, pick: { gtin: string | null; anyType: string | null }, o: { remember: boolean; by: string }) {
  await s.update(schema.items, { catalogGtin: pick.gtin, matchState: pick.anyType ? "any" : "picked", matchAt: Date.now() }, eq(schema.items.id, item.id));
  if (!o.remember) return;
  await s
    .insert(schema.productChoice, { nameKey: nameKey(item.title), gtin: pick.gtin, anyType: pick.anyType, byUser: o.by, at: Date.now() })
    .onConflictDoUpdate({ target: [schema.productChoice.spaceId, schema.productChoice.nameKey], set: { gtin: pick.gtin, anyType: pick.anyType, byUser: o.by, at: Date.now() } });
}

/** "What Nexus learned": the remembered choices, and forgetting one (or all). */
export async function productChoices(s: Scoped) {
  return s.select(schema.productChoice).orderBy(sql`${schema.productChoice.at} desc`);
}
export async function forgetChoice(s: Scoped, key: string | null) {
  await s.delete(schema.productChoice, key ? eq(schema.productChoice.nameKey, key) : undefined);
}

// ---------- C3: existing lists get mapped; D1: the list's prices + deals ----------

/** C3: rows not matched yet (typed before R19, or added offline) → C1's rules, a batch at a time. Never renames a row. */
export async function mapRows(s: Scoped, max = 40, usual?: (title: string) => Promise<string | null>) {
  const rows = await s
    .pick({ id: schema.items.id, title: schema.items.title }, schema.items, and(eq(schema.items.list, "supermarket"), isNull(schema.items.matchState), sql`${schema.items.status} = 'to_buy'`))
    .limit(max);
  const at = await priceStoreOf(s);
  const out = { tried: rows.length, auto: 0, ask: 0, none: 0 };
  for (const r of rows) {
    const m = await matchRow(s, r, { at, usualBrand: usual ? await usual(r.title).catch(() => null) : null }).catch(() => null);
    if (!m) continue;
    if (m.state === "auto" || m.state === "any") out.auto++;
    else if (m.state === "ask") out.ask++;
    else out.none++;
  }
  return out;
}

export type ListDeal = { kind: string; n: number; price: number | null; rate: number | null; club: boolean; minBasket: number | null; ends: number | null; description: string };
export type ListPrice = { gtin: string; name: string; short: string | null; brand: string | null; qty: number | null; unit: string | null; weighted: boolean; imageUrl: string | null; section: string | null; price: number | null; unitPrice: number | null; deals: ListDeal[] };

/** D1: the list's products at the store — price, unit price, deals running now there — and when the prices are from. */
export async function smPrices(s: Scoped, pick?: { chain: string; branchId?: string | null } | null) {
  const at = await priceStoreOf(s, pick);
  const rows = await s.pick({ id: schema.items.id, gtin: schema.items.catalogGtin }, schema.items, and(eq(schema.items.list, "supermarket"), sql`${schema.items.catalogGtin} IS NOT NULL`));
  const gtins = [...new Set(rows.map((r) => r.gtin!))];
  const now = Date.now();
  const [cat, prices, deals, chainRow, branchRow] = await Promise.all([
    gtins.length ? db.select().from(schema.catalog).where(inArray(schema.catalog.gtin, gtins)) : Promise.resolve([]),
    pricesAt(gtins, at),
    at.chainId && gtins.length ? dealsFor(gtins, at, now) : Promise.resolve(new Map<string, ListDeal[]>()),
    at.chainId ? db.select().from(schema.chain).where(eq(schema.chain.id, at.chainId)).limit(1) : Promise.resolve([]),
    at.branchId ? db.select().from(schema.branch).where(eq(schema.branch.id, at.branchId)).limit(1) : Promise.resolve([]),
  ]);
  const byGtin = new Map(cat.map((c) => [c.gtin, c]));
  const items: Record<string, ListPrice> = {};
  for (const r of rows) {
    const c = byGtin.get(r.gtin!);
    if (!c) continue;
    const p = prices.get(c.gtin);
    items[r.id] = { gtin: c.gtin, name: c.name, short: c.short, brand: c.brand, qty: c.qty, unit: c.unit, weighted: c.weighted, imageUrl: c.imageUrl, section: c.section, price: p?.price ?? null, unitPrice: p?.unit ?? null, deals: deals.get(c.gtin) ?? [] };
  }
  const chainAt = chainRow[0]?.lastFileAt ?? null;
  const updatedAt = branchRow[0]?.pricesAt ?? chainAt;
  return { chain: at.chainId, branchId: at.branchId, branchName: branchRow[0]?.name ?? null, updatedAt, stale: at.chainId ? isStale(chainAt, now) : false, items };
}

async function dealsFor(gtins: string[], at: PriceAt, now: number) {
  const out = new Map<string, ListDeal[]>();
  const storeId = at.branchId ? Number(at.branchId.split(":")[1]) : null;
  for (let i = 0; i < gtins.length; i += 300) {
    const rows = await db
      .select({ gtin: schema.promoItem.gtin, p: schema.promo })
      .from(schema.promoItem)
      .innerJoin(schema.promo, eq(schema.promo.id, schema.promoItem.promoId))
      .where(and(inArray(schema.promoItem.gtin, gtins.slice(i, i + 300)), eq(schema.promo.chainId, at.chainId!), sql`(${schema.promo.ends} IS NULL OR ${schema.promo.ends} >= ${now})`, sql`(${schema.promo.starts} IS NULL OR ${schema.promo.starts} <= ${now})`));
    for (const { gtin, p } of rows) {
      // A deal of some stores only: shown for those (unknown branch → the chain's deals).
      if (p.stores && storeId != null && !p.stores.includes(storeId)) continue;
      const list = out.get(gtin) ?? [];
      list.push({ kind: p.kind, n: p.minQty ?? 1, price: p.price, rate: p.rate, club: p.club, minBasket: p.minBasket, ends: p.ends, description: p.description });
      out.set(gtin, list);
    }
  }
  return out;
}
