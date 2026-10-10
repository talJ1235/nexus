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
