import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export async function kvGet(key: string): Promise<string | null> {
  const row = await db.query.kv.findFirst({ where: eq(schema.kv.key, key) });
  return row?.value ?? null;
}

export async function kvGetMany(keys: string[]): Promise<Record<string, string>> {
  const rows = await db.select().from(schema.kv).where(inArray(schema.kv.key, keys));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function kvSet(key: string, value: string | null) {
  if (value == null) {
    await db.delete(schema.kv).where(eq(schema.kv.key, key));
    return;
  }
  await db
    .insert(schema.kv)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: Date.now() } });
}

/**
 * R17 S6 U3 — a lease: true for exactly one caller per `ms` (one statement: insert, or take over an expired lease —
 * two requests at once never both win). The value is the expiry time.
 */
export async function kvLease(key: string, ms: number, now = Date.now()) {
  const r = await db
    .insert(schema.kv)
    .values({ key, value: String(now + ms), updatedAt: now })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value: String(now + ms), updatedAt: now }, setWhere: sql`CAST(${schema.kv.value} AS INTEGER) <= ${now}` });
  return r.rowsAffected > 0;
}

/** Rows under `prefix` last written before `before` are deleted (a LIKE on the primary key: an index range). */
export async function kvPurge(prefix: string, before: number) {
  const like = `${prefix.replace(/[!%_]/g, (c) => `!${c}`)}%`;
  const r = await db.delete(schema.kv).where(sql`${schema.kv.key} LIKE ${like} ESCAPE '!' AND ${schema.kv.updatedAt} < ${before}`);
  return r.rowsAffected;
}

const DAY = 86_400_000;
/**
 * R18 S2 G1 — the supermarket's caches and one-time marks, kept only as long as they help (daily cron): AI section answers
 * 60 days, Open Food Facts lookups by barcode 30 days and by name 7 days, the evening drafts 3 days, trip op ids (a resend
 * applies once) and offline-add client ids 30 days, a deleted row's Undo copy 1 day.
 */
export const GROCERY_KV_KEEP: [prefix: string, days: number][] = [
  ["grocery:ai:", 60],
  ["grocery:off:", 30],
  ["grocery:offq:", 7],
  ["sm:draft:", 3],
  ["sm:op:", 30],
  // R18 S3 C5: a deleted row kept for its Undo (5 s on screen; a day here)
  ["sm:del:", 1],
];

export async function purgeGroceryKv(now = Date.now()) {
  let n = 0;
  for (const [prefix, days] of GROCERY_KV_KEEP) n += await kvPurge(prefix, now - days * DAY);
  return n;
}
