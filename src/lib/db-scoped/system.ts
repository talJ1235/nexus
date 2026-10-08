import "server-only";
import { and, asc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// System-level reads that legitimately span spaces — only for the cron fan-out and public share/calendar tokens.
// Each returns the space id with every row so callers continue through that space's Scoped handle.

/** Every watched link of every live space (to-buy, watch on, not blocked 3+ times), oldest check first. */
export async function systemWatchedSources() {
  return systemWatchedSourcesQuery();
}

/** The query itself (test:query-plans checks it uses sources_item_idx). */
export function systemWatchedSourcesQuery() {
  return db
    .select({ source: schema.sources, spaceId: schema.sources.spaceId, ownerId: schema.space.createdBy })
    .from(schema.sources)
    // `+space_id` keeps SQLite on sources_item_idx: matching by the space index instead walks a whole space per item
    // (R15 E1 bench: 422 ms → 10 ms for 670 links next to a 2 000-item space).
    .innerJoin(schema.items, and(eq(schema.items.id, schema.sources.itemId), sql`${schema.items.spaceId} = +${schema.sources.spaceId}`))
    .innerJoin(schema.space, eq(schema.space.id, schema.sources.spaceId))
    .where(
      and(
        isNull(schema.space.deletedAt),
        eq(schema.items.status, "to_buy"),
        eq(schema.items.watch, true),
        ne(schema.sources.url, ""),
        or(lt(schema.sources.checkFails, 3), isNull(schema.sources.checkFails)),
      ),
    )
    .orderBy(asc(schema.sources.fetchedAt));
}

/** Live spaces with their creator (cron: per-space maintenance passes). */
export async function systemSpaces() {
  return db.select({ id: schema.space.id, ownerId: schema.space.createdBy, currency: schema.space.currency }).from(schema.space).where(isNull(schema.space.deletedAt));
}

/** Public read-only list link → its collection and space (the token is the only key). */
export async function collectionByShareToken(token: string) {
  const [c] = await db.select().from(schema.collections).where(eq(schema.collections.shareToken, token)).limit(1);
  return c ?? null;
}

/** Spaces a user belongs to (calendar feed: all of them). */
export async function spaceIdsOfUser(userId: string) {
  const rows = await db
    .select({ id: schema.space.id })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), isNull(schema.space.deletedAt)));
  return rows.map((r) => r.id);
}

/** R15 D1: who shared an old guest link (/i/<token>) — the admin (the only owner before accounts). R17 E1: the old guest
 *  tables (members, grants, invites) aren't read or written any more; a name only, for the "ask <name>" notice. */
export async function legacyShareOwnerName(adminEmail: string | null) {
  if (!adminEmail) return null;
  const [a] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.email, adminEmail.toLowerCase())).limit(1);
  return a?.name ? a.name.split(/\s+/)[0] : null;
}
