import "server-only";
import { and, asc, eq, isNull, lt, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";

// System-level reads that legitimately span spaces — only for the cron fan-out and public share/calendar tokens.
// Each returns the space id with every row so callers continue through that space's Scoped handle.

/** Every watched link of every live space (to-buy, watch on, not blocked 3+ times), oldest check first. */
export async function systemWatchedSources() {
  return db
    .select({ source: schema.sources, spaceId: schema.sources.spaceId, ownerId: schema.space.createdBy })
    .from(schema.sources)
    .innerJoin(schema.items, and(eq(schema.items.id, schema.sources.itemId), eq(schema.items.spaceId, schema.sources.spaceId)))
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

/** R15 D1: who shared an old guest link (/i/<token>) — the owner of that list's space; else the admin (the only owner
 *  before accounts). A name only, for the "ask <name> for a new invite" notice. */
export async function legacyShareOwnerName(tokenHash: string | null, adminEmail: string | null) {
  if (tokenHash) {
    const [r] = await db
      .select({ name: schema.user.name })
      .from(schema.invites)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.invites.collectionId))
      .innerJoin(schema.space, eq(schema.space.id, schema.collections.spaceId))
      .innerJoin(schema.user, eq(schema.user.id, schema.space.createdBy))
      .where(eq(schema.invites.tokenHash, tokenHash))
      .limit(1);
    if (r?.name) return r.name.split(/\s+/)[0];
  }
  if (!adminEmail) return null;
  const [a] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.email, adminEmail.toLowerCase())).limit(1);
  return a?.name ? a.name.split(/\s+/)[0] : null;
}
