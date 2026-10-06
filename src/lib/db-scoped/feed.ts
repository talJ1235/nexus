import "server-only";
import { and, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, schema } from "@/db";

// R16 B1 — the change feed's write side. Every write to a synced table through the scoped layer runs as ONE batch
// (a transaction): bump the space's revision, stamp rev / rev_by on the rows it writes, tombstone the rows it deletes.
// Child rows (store links, price points, attachments) also stamp their item: the client syncs items whole.

type Synced = { name: string; key: SQLiteColumn; parent?: SQLiteColumn };

/** The tables the client store holds (space_pref is stamped in prefs.ts). */
export const SYNCED = new Map<SQLiteTable, Synced>([
  [schema.items, { name: "items", key: schema.items.id }],
  [schema.sources, { name: "sources", key: schema.sources.id, parent: schema.sources.itemId }],
  [schema.pricePoints, { name: "price_points", key: schema.pricePoints.id, parent: schema.pricePoints.itemId }],
  [schema.attachments, { name: "attachments", key: schema.attachments.id, parent: schema.attachments.itemId }],
  [schema.collections, { name: "collections", key: schema.collections.id }],
  [schema.altGroups, { name: "alt_groups", key: schema.altGroups.id }],
  [schema.storeSettings, { name: "store_settings", key: schema.storeSettings.storeKey }],
  [schema.alerts, { name: "alerts", key: schema.alerts.id }],
] as [SQLiteTable, Synced][]);

/** The space's revision after this transaction's bump (a subquery, so every statement in the batch stamps the same). */
export const curRev = (spaceId: string) => sql`(SELECT rev FROM space_rev WHERE space_id = ${spaceId})`;

/** +1 on the space's revision (the row is created on the first write). */
export const bumpRev = (spaceId: string) =>
  db
    .insert(schema.spaceRev)
    .values({ spaceId, rev: 1 })
    .onConflictDoUpdate({ target: schema.spaceRev.spaceId, set: { rev: sql`${schema.spaceRev.rev} + 1` } });

/** Stamp fields for a write by `by`. */
export const stamp = (spaceId: string, by: string) => ({ rev: curRev(spaceId), revBy: by });

/** Touch the parent items of child rows (by explicit ids or by the child rows matching `where`). */
export function touchParents(spaceId: string, by: string, t: SQLiteTable, meta: Synced, where: SQL | string[]) {
  const ids = Array.isArray(where) ? where : db.select({ id: meta.parent! }).from(t).where(where);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db.update(schema.items).set(stamp(spaceId, by) as any).where(and(eq(schema.items.spaceId, spaceId), inArray(schema.items.id, ids as string[])));
}

/** Tombstones for the rows of `t` matching `where` (written before they are deleted). */
export function tombstones(spaceId: string, by: string, t: SQLiteTable, meta: Synced, where: SQL) {
  const at = Date.now();
  return db
    .insert(schema.tombstone)
    .select(
      db
        .select({ spaceId: sql<string>`${spaceId}`.as("space_id"), tbl: sql<string>`${meta.name}`.as("tbl"), rowId: sql<string>`${meta.key}`.as("row_id"), rev: sql<number>`${curRev(spaceId)}`.as("rev"), by: sql<string>`${by}`.as("by"), at: sql<number>`${at}`.as("at") })
        .from(t)
        .where(where),
    )
    .onConflictDoUpdate({ target: [schema.tombstone.spaceId, schema.tombstone.tbl, schema.tombstone.rowId], set: { rev: curRev(spaceId), by, at } });
}

/** Mark a bulk change clients can't replay row by row (a list moved between spaces): older clients reload. */
export function resetMark(spaceId: string) {
  return db
    .insert(schema.spaceRev)
    .values({ spaceId, rev: 1, resetRev: 1 })
    .onConflictDoUpdate({ target: schema.spaceRev.spaceId, set: { rev: sql`${schema.spaceRev.rev} + 1`, resetRev: sql`${schema.spaceRev.rev} + 1` } });
}

export async function readRev(spaceId: string): Promise<{ rev: number; floor: number; resetRev: number }> {
  const [r] = await db.select().from(schema.spaceRev).where(eq(schema.spaceRev.spaceId, spaceId)).limit(1);
  return r ?? { rev: 0, floor: 0, resetRev: 0 };
}

/** B5: realtime publishes per day (count only, kv `realtime:pub:<YYYY-MM-DD>`), for the Ably budget. */
export async function countPublish(day = new Date().toISOString().slice(0, 10)) {
  const key = `realtime:pub:${day}`;
  await db
    .insert(schema.kv)
    .values({ key, value: "1", updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value: sql`CAST(CAST(${schema.kv.value} AS INTEGER) + 1 AS TEXT)`, updatedAt: Date.now() } });
}

/** Cron: tombstones older than 30 days go; each space's floor moves up so older clients reload instead. */
export async function purgeTombstones(days = 30) {
  const cut = Date.now() - days * 86_400_000;
  const old = await db
    .select({ spaceId: schema.tombstone.spaceId, top: sql<number>`max(${schema.tombstone.rev})` })
    .from(schema.tombstone)
    .where(lt(schema.tombstone.at, cut))
    .groupBy(schema.tombstone.spaceId);
  for (const o of old) {
    await db.batch([
      db.update(schema.spaceRev).set({ floor: sql`max(${schema.spaceRev.floor}, ${o.top})` }).where(eq(schema.spaceRev.spaceId, o.spaceId)),
      db.delete(schema.tombstone).where(and(eq(schema.tombstone.spaceId, o.spaceId), lt(schema.tombstone.at, cut))),
    ]);
  }
  return old.length;
}
