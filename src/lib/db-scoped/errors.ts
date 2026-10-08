import "server-only";
import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// R16 C2 — the error log's storage (raw DB lives in the data layer). One row per fingerprint; at most 1 000 rows —
// beyond that only the kv counter `errors:overflow` goes up. Distinct users through error_user (hashes only).

export const MAX_FINGERPRINTS = 1000;
const OVERFLOW = "errors:overflow";

export type StoredError = { fingerprint: string; kind: string; code: string; where: string; message: string; sample: string; release: string | null; userHash: string | null };

export async function storeError(e: StoredError, now = Date.now()) {
  const [hit] = await db.select({ f: schema.errorEvent.fingerprint }).from(schema.errorEvent).where(eq(schema.errorEvent.fingerprint, e.fingerprint)).limit(1);
  if (!hit) {
    const [{ n }] = await db.select({ n: count() }).from(schema.errorEvent);
    if (n >= MAX_FINGERPRINTS) {
      await db
        .insert(schema.kv)
        .values({ key: OVERFLOW, value: "1", updatedAt: now })
        .onConflictDoUpdate({ target: schema.kv.key, set: { value: sql`CAST(CAST(${schema.kv.value} AS INTEGER) + 1 AS TEXT)`, updatedAt: now } });
      return "overflow" as const;
    }
  }
  const newUser = e.userHash
    ? ((await db.insert(schema.errorUser).values({ fingerprint: e.fingerprint, userHash: e.userHash }).onConflictDoNothing().returning({ f: schema.errorUser.fingerprint })).length > 0)
    : false;
  await db
    .insert(schema.errorEvent)
    .values({ fingerprint: e.fingerprint, kind: e.kind, code: e.code, where: e.where, message: e.message, sample: e.sample, release: e.release, count: 1, users: newUser ? 1 : 0, status: "new", firstSeen: now, lastSeen: now })
    .onConflictDoUpdate({
      target: schema.errorEvent.fingerprint,
      set: {
        count: sql`${schema.errorEvent.count} + 1`,
        users: sql`${schema.errorEvent.users} + ${newUser ? 1 : 0}`,
        lastSeen: now,
        sample: e.sample,
        release: e.release,
        // A fixed error that comes back is new again.
        status: sql`CASE WHEN ${schema.errorEvent.status} = 'fixed' THEN 'new' ELSE ${schema.errorEvent.status} END`,
      },
    });
  return hit ? ("counted" as const) : ("new" as const);
}

export async function errorOverflow() {
  const [r] = await db.select({ v: schema.kv.value }).from(schema.kv).where(eq(schema.kv.key, OVERFLOW)).limit(1);
  return Number(r?.v ?? 0);
}

export async function listErrors(opts: { status?: ("new" | "known" | "fixed")[]; sort?: "last" | "count"; limit?: number } = {}) {
  const q = db.select().from(schema.errorEvent);
  const filtered = opts.status?.length ? q.where(inArray(schema.errorEvent.status, opts.status)) : q;
  return filtered.orderBy(opts.sort === "count" ? desc(schema.errorEvent.count) : desc(schema.errorEvent.lastSeen)).limit(opts.limit ?? 200);
}

export async function setErrorStatusRow(fingerprint: string, status: "new" | "known" | "fixed") {
  await db.update(schema.errorEvent).set({ status }).where(eq(schema.errorEvent.fingerprint, fingerprint));
  const [r] = await db.select().from(schema.errorEvent).where(eq(schema.errorEvent.fingerprint, fingerprint)).limit(1);
  return r ?? null;
}

/** Cron: samples of errors not seen for 30 days go (the counts stay); their user hashes too. */
export async function dropOldSamples(days = 30) {
  const cut = Date.now() - days * 86_400_000;
  const old = await db.select({ f: schema.errorEvent.fingerprint }).from(schema.errorEvent).where(and(lt(schema.errorEvent.lastSeen, cut), sql`${schema.errorEvent.sample} IS NOT NULL`));
  if (!old.length) return 0;
  const fs = old.map((o) => o.f);
  await db.batch([db.update(schema.errorEvent).set({ sample: null }).where(inArray(schema.errorEvent.fingerprint, fs)), db.delete(schema.errorUser).where(inArray(schema.errorUser.fingerprint, fs))]);
  return fs.length;
}

/** R17 C2/E5: a store host that reads again through the fetch ladder — its open "extract · blocked/fetch" entries are fixed
 *  (if it's refused again later, the entry comes back as new). `where` is `extract:<domain>`. */
export async function markExtractFixed(host: string) {
  const where = [`extract:${host}`, `extract:www.${host}`];
  await db
    .update(schema.errorEvent)
    .set({ status: "fixed" })
    .where(and(eq(schema.errorEvent.kind, "extract"), inArray(schema.errorEvent.code, ["blocked", "fetch", "no_price", "parse"]), inArray(schema.errorEvent.where, where), sql`${schema.errorEvent.status} <> 'fixed'`));
}

/** R17 E5: retention — error-log rows (and viewport diagnostics, kind `viewport`) not seen for 30 days are deleted. */
export async function purgeOldErrors(days = 30) {
  const cut = Date.now() - days * 86_400_000;
  const old = await db.select({ f: schema.errorEvent.fingerprint }).from(schema.errorEvent).where(lt(schema.errorEvent.lastSeen, cut));
  if (!old.length) return 0;
  const fs = old.map((o) => o.f);
  await db.batch([db.delete(schema.errorUser).where(inArray(schema.errorUser.fingerprint, fs)), db.delete(schema.errorEvent).where(inArray(schema.errorEvent.fingerprint, fs))]);
  return fs.length;
}
