// R19 — the price data (public files: global tables, no space_id) as the app reads it: the store directory (A10),
// catalog + prices + deals (C1, D1–D6). Space rows (space_store, items) go through Scoped as always.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHAINS, chainById } from "@/lib/grocery/chains";
import { normalize } from "@/lib/grocery/normalize";
import type { Scoped } from "./index";

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
