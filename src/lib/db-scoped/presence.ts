import "server-only";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiDay } from "../ai-gate";
import { ACTIVITY_KEEP_MS, MERGE_MS, ONLINE_MS, PRESENCE_KEEP_MS, type ActivityKind, type Device, type ScreenKey } from "../presence-keys";

// R17 G1 — presence (who is online, on what kind of device, on which screen) and activity (kinds + counts). Written by
// the signed-in person's own beat / their own server actions; read only by the admin panel (lib/db-scoped/admin.ts).
// Never an item title, a note, a link or chat text: `screen` is a fixed key and activity rows are a kind + a number.

export type Beat = { device: Device; app: "installed" | "browser"; platform: string; screen: ScreenKey; shoppingLeft: number | null };

/** A session's beat. A session that was away (no beat within ONLINE_MS) starts a new "online since" and logs `opened`. */
export async function recordBeat(who: { userId: string; sessionId: string; spaceId: string | null }, b: Beat, now = Date.now()) {
  const [prev] = await db.select({ since: schema.presence.since, updatedAt: schema.presence.updatedAt, screen: schema.presence.screen }).from(schema.presence).where(eq(schema.presence.sessionId, who.sessionId));
  const fresh = !prev || now - prev.updatedAt > ONLINE_MS;
  const row = { userId: who.userId, device: b.device, app: b.app, platform: b.platform.slice(0, 40), screen: b.screen, shoppingLeft: b.screen === "shopping-mode" ? b.shoppingLeft : null, spaceId: who.spaceId, since: fresh ? now : prev.since, updatedAt: now };
  await db
    .insert(schema.presence)
    .values({ sessionId: who.sessionId, ...row })
    .onConflictDoUpdate({ target: schema.presence.sessionId, set: row });
  // "Opened Nexus" once per return (away ≥ 30 min), and one `hour` mark per person per hour for the by-hour chart.
  if (!prev || now - prev.updatedAt > 30 * 60_000) await logActivity(who.userId, who.spaceId, "opened", 1, now);
  // Shopping mode entered / left (the beat goes out at once on a screen change).
  const was = prev && now - prev.updatedAt <= 30 * 60_000 && prev.screen === "shopping-mode";
  if (b.screen === "shopping-mode" && !was) await logActivity(who.userId, who.spaceId, "shopping_started", 1, now);
  if (b.screen !== "shopping-mode" && was) await logActivity(who.userId, who.spaceId, "shopping_finished", 1, now);
  await markHour(who.userId, now);
}

/** pagehide / hidden: the session is away now (its row stays for "Earlier today"). */
export async function recordAway(sessionId: string, now = Date.now()) {
  await db
    .update(schema.presence)
    .set({ updatedAt: sql`min(${schema.presence.updatedAt}, ${now - ONLINE_MS - 1})` })
    .where(eq(schema.presence.sessionId, sessionId));
}

/** One activity row (a kind + a count). Bursts of the same kind by the same person within 10 s merge into one row. */
export async function logActivity(userId: string, spaceId: string | null, kind: ActivityKind, n = 1, now = Date.now()) {
  try {
    const [last] = await db
      .select({ id: schema.activity.id })
      .from(schema.activity)
      .where(and(eq(schema.activity.userId, userId), eq(schema.activity.kind, kind), gte(schema.activity.at, now - MERGE_MS)))
      .orderBy(desc(schema.activity.at))
      .limit(1);
    if (last) await db.update(schema.activity).set({ n: sql`${schema.activity.n} + ${n}`, at: now }).where(eq(schema.activity.id, last.id));
    else await db.insert(schema.activity).values({ userId, spaceId, kind, n, at: now });
  } catch {
    /* bookkeeping only — never fails the action that logs it */
  }
}

/** The by-hour chart: one hidden `hour` row per person per clock hour. */
async function markHour(userId: string, now: number) {
  const start = now - (now % 3_600_000);
  const [had] = await db
    .select({ id: schema.activity.id })
    .from(schema.activity)
    .where(and(eq(schema.activity.userId, userId), eq(schema.activity.kind, "hour"), gte(schema.activity.at, start)))
    .limit(1);
  if (!had) await db.insert(schema.activity).values({ userId, spaceId: null, kind: "hour", n: 1, at: now });
}

/** Daily cron: presence older than 7 days, activity older than 30 days. */
export async function purgePresence(now = Date.now()) {
  const [a, b] = await db.batch([
    db.delete(schema.presence).where(lt(schema.presence.updatedAt, now - PRESENCE_KEEP_MS)),
    db.delete(schema.activity).where(lt(schema.activity.at, now - ACTIVITY_KEEP_MS)),
  ]);
  return { presence: a.rowsAffected, activity: b.rowsAffected };
}

/** Midnight in Israel (the app's day, same as the AI quota day) as ms. */
export function dayStart(now = Date.now()) {
  const day = aiDay(now);
  // Find the instant whose Israel date first equals `day` — within ±3 h of UTC midnight.
  let t = Date.parse(`${day}T00:00:00Z`) - 3 * 3_600_000;
  while (aiDay(t) !== day) t += 15 * 60_000;
  return t;
}

export async function presenceRows(since: number) {
  return db.select().from(schema.presence).where(gte(schema.presence.updatedAt, since)).orderBy(desc(schema.presence.updatedAt));
}

export async function activityRows(opts: { since: number; userIds?: string[]; limit?: number; hours?: boolean }) {
  const where = [gte(schema.activity.at, opts.since), opts.hours ? eq(schema.activity.kind, "hour") : sql`${schema.activity.kind} <> 'hour'`];
  if (opts.userIds) where.push(inArray(schema.activity.userId, opts.userIds));
  return db
    .select()
    .from(schema.activity)
    .where(and(...where))
    .orderBy(desc(schema.activity.at))
    .limit(opts.limit ?? 500);
}
