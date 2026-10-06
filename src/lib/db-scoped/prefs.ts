import "server-only";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Scoped } from "./index";
import { bumpRev, stamp, tombstones } from "./feed";

// R15 B1: owner-level kv keys moved here. user_pref = per person (alerts, memory switch, home, profile, calendar),
// space_pref = per space (budget per month, import limit, AI caches of the space's items).

export async function spacePrefGet(s: Scoped, key: string) {
  const [r] = await db.select({ v: schema.spacePref.value }).from(schema.spacePref).where(and(eq(schema.spacePref.spaceId, s.spaceId), eq(schema.spacePref.key, key))).limit(1);
  return r?.v ?? null;
}

export async function spacePrefLike(s: Scoped, prefix: string) {
  return db
    .select({ key: schema.spacePref.key, value: schema.spacePref.value })
    .from(schema.spacePref)
    .where(and(eq(schema.spacePref.spaceId, s.spaceId), like(schema.spacePref.key, `${prefix.replace(/[%_]/g, "")}%`)));
}

/** R16 B1: the space prefs other members see (budget per month, import limit) are in the change feed; AI caches aren't. */
const synced = (key: string) => key.startsWith("pref:");

export async function spacePrefSet(s: Scoped, key: string, value: string | null) {
  const where = and(eq(schema.spacePref.spaceId, s.spaceId), eq(schema.spacePref.key, key));
  const feed = synced(key);
  if (value == null) {
    const del = db.delete(schema.spacePref).where(where);
    if (!feed) return void (await del);
    await s.runBatch([bumpRev(s.spaceId), tombstones(s.spaceId, s.actor, schema.spacePref, { name: "space_pref", key: schema.spacePref.key }, where!), del], 2);
    return;
  }
  const t = Date.now();
  const st = feed ? stamp(s.spaceId, s.actor) : {};
  const up = db
    .insert(schema.spacePref)
    .values({ spaceId: s.spaceId, key, value, updatedAt: t, ...st })
    .onConflictDoUpdate({ target: [schema.spacePref.spaceId, schema.spacePref.key], set: { value, updatedAt: t, ...st } });
  if (!feed) return void (await up);
  await s.runBatch([bumpRev(s.spaceId), up], 1);
}

export async function userPrefGet(userId: string, key: string) {
  const [r] = await db.select({ v: schema.userPref.value }).from(schema.userPref).where(and(eq(schema.userPref.userId, userId), eq(schema.userPref.key, key))).limit(1);
  return r?.v ?? null;
}

export async function userPrefGetMany(userId: string, keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const rows = await db.select().from(schema.userPref).where(and(eq(schema.userPref.userId, userId), inArray(schema.userPref.key, keys)));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function userPrefSet(userId: string, key: string, value: string | null) {
  if (value == null) {
    await db.delete(schema.userPref).where(and(eq(schema.userPref.userId, userId), eq(schema.userPref.key, key)));
    return;
  }
  const t = Date.now();
  await db
    .insert(schema.userPref)
    .values({ userId, key, value, updatedAt: t })
    .onConflictDoUpdate({ target: [schema.userPref.userId, schema.userPref.key], set: { value, updatedAt: t } });
}

/** The user whose pref row holds this value (calendar feed token → user). */
export async function userByPref(key: string, value: string) {
  const [r] = await db.select({ userId: schema.userPref.userId }).from(schema.userPref).where(and(eq(schema.userPref.key, key), eq(schema.userPref.value, value))).limit(1);
  return r?.userId ?? null;
}

/** R16 B3: who last wrote a synced space pref (for "already changed by …"). */
export async function spacePrefBy(s: Scoped, key: string) {
  const [r] = await db.select({ by: schema.spacePref.revBy }).from(schema.spacePref).where(and(eq(schema.spacePref.spaceId, s.spaceId), eq(schema.spacePref.key, key))).limit(1);
  return r?.by ?? null;
}
