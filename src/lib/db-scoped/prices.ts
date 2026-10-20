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
    .limit(o.near ? 600 : 200);
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
    const cands = await searchBranches({ chain: r.chain, limit: 600 });
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
