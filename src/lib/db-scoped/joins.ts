import "server-only";
import { and, asc, eq, ne, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Scoped } from "./index";

// Joins live here (typed), with BOTH sides filtered by the space.

export async function sourceWithItemTitle(s: Scoped, normalizedUrl: string) {
  const [r] = await db
    .select({ itemId: schema.sources.itemId, title: schema.items.title })
    .from(schema.sources)
    .innerJoin(schema.items, and(eq(schema.items.id, schema.sources.itemId), s.in(schema.items)))
    .where(s.in(schema.sources, eq(schema.sources.normalizedUrl, normalizedUrl)))
    .limit(1);
  return r ?? null;
}

export async function sourcesWithItemImage(s: Scoped, cond: SQL, order: SQL, limit: number) {
  return db
    .select({ source: schema.sources, imageUrl: schema.items.imageUrl })
    .from(schema.sources)
    .innerJoin(schema.items, and(eq(schema.items.id, schema.sources.itemId), s.in(schema.items)))
    .where(s.in(schema.sources, cond))
    .orderBy(order)
    .limit(limit);
}

export async function sourcesWithItem(s: Scoped, cond?: SQL) {
  return db
    .select({ source: schema.sources, item: schema.items })
    .from(schema.sources)
    .innerJoin(schema.items, and(eq(schema.items.id, schema.sources.itemId), s.in(schema.items)))
    .where(s.in(schema.sources, cond));
}

/** Watched links of this space: to-buy items with tracking on, real URLs only (oldest check first). */
export async function watchedSources(s: Scoped, where?: SQL) {
  return db
    .select({ source: schema.sources })
    .from(schema.sources)
    .innerJoin(schema.items, and(eq(schema.items.id, schema.sources.itemId), s.in(schema.items)))
    .where(s.in(schema.sources, and(eq(schema.items.status, "to_buy"), eq(schema.items.watch, true), ne(schema.sources.url, ""), where)))
    .orderBy(asc(schema.sources.fetchedAt));
}
