import "server-only";
import { and, eq, like, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Fixed-window counter in the DB (serverless-safe). Returns true when the call is allowed (and counts it).
 * One atomic upsert: a new window resets the count.
 */
export async function hitLimit(key: string, max: number, windowMs: number) {
  return (await countHit(key, windowMs)).count <= max;
}

/** Count one hit in the current window (one atomic upsert); the count so far and when the window started. */
async function countHit(key: string, windowMs: number) {
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
    .returning({ count: schema.rateLimit.count, windowStart: schema.rateLimit.windowStart });
  return { count: rows[0]?.count ?? 1, windowStart: rows[0]?.windowStart ?? now };
}

/**
 * R16 G3: Better Auth's rate limits on the same counter — one DB statement per auth request instead of its own
 * read-then-write (2–3). Same rules (per IP + path, fixed window); keys are prefixed `ba:`. Old rows go now and then.
 */
export const authRateLimitStorage = {
  async consume(key: string, rule: { window: number; max: number }) {
    const windowMs = rule.window * 1000;
    const hit = await countHit(`ba:${key}`, windowMs);
    if (Math.random() < 0.01) await db.delete(schema.rateLimit).where(and(like(schema.rateLimit.key, "ba:%"), lt(schema.rateLimit.windowStart, Date.now() - DAY)));
    if (hit.count <= rule.max) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((hit.windowStart + windowMs - Date.now()) / 1000)) };
  },
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The current count in this window (no increment). */
export async function peekLimit(key: string, windowMs: number) {
  const [r] = await db.select().from(schema.rateLimit).where(eq(schema.rateLimit.key, key)).limit(1);
  return r && r.windowStart > Date.now() - windowMs ? r.count : 0;
}
