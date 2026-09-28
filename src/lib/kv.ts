import "server-only";
import { eq, inArray } from "drizzle-orm";
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
