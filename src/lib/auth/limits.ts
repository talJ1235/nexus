import "server-only";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Fixed-window counter in the DB (serverless-safe). Returns true when the call is allowed (and counts it).
 * One atomic upsert: a new window resets the count.
 */
export async function hitLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const rows = await db
    .insert(schema.rateLimit)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: schema.rateLimit.key,
      set: {
        count: sql`CASE WHEN ${schema.rateLimit.windowStart} <= ${now - windowMs} THEN 1 ELSE ${schema.rateLimit.count} + 1 END`,
        windowStart: sql`CASE WHEN ${schema.rateLimit.windowStart} <= ${now - windowMs} THEN ${now} ELSE ${schema.rateLimit.windowStart} END`,
      },
    })
    .returning({ count: schema.rateLimit.count });
  return (rows[0]?.count ?? 1) <= max;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
