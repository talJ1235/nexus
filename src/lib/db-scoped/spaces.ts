import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { AccessError } from "@/lib/ctx";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Scoped } from "./index";

// R15 C3/C4: the two operations that cross a space boundary on purpose. Both live in the data layer: the caller has
// already checked the role in BOTH spaces (space-actions.ts); here every statement is still bound to an explicit
// space id on both sides.

/** Tables whose rows hang off an item (moved with it). */
const ITEM_CHILDREN = [schema.sources, schema.pricePoints, schema.attachments, schema.alerts] as const;

/**
 * Move a list/project and everything under it (items, links, price history, attachments, alerts) from `from`'s space
 * into `toSpaceId`, in one transaction. Alternatives groups move when all their items move; otherwise the moved items
 * leave the group. Returns the moved item ids.
 */
export async function moveCollection(from: Scoped, toSpaceId: string, collectionId: string) {
  if (toSpaceId === from.spaceId) throw new AccessError("not_found");
  await from.mustGet(schema.collections, collectionId);
  const items = await from.pick({ id: schema.items.id, altGroupId: schema.items.altGroupId }, schema.items, eq(schema.items.collectionId, collectionId));
  const ids = items.map((i) => i.id);
  const groupIds = [...new Set(items.map((i) => i.altGroupId).filter((g): g is string => !!g))];
  // A group moves only if none of its items stay behind.
  const members = groupIds.length ? await from.pick({ g: schema.items.altGroupId, c: schema.items.collectionId }, schema.items, inArray(schema.items.altGroupId, groupIds)) : [];
  const blocked = new Set(members.filter((r) => r.c !== collectionId).map((r) => r.g as string));
  const moveGroups = groupIds.filter((g) => !blocked.has(g));
  const splitGroups = groupIds.filter((g) => blocked.has(g));
  const to = { spaceId: toSpaceId };
  const own = (t: { spaceId: SQLiteColumn }) => eq(t.spaceId, from.spaceId);
  const q = [
    db.update(schema.collections).set(to).where(and(own(schema.collections), eq(schema.collections.id, collectionId))),
    ...(splitGroups.length ? [db.update(schema.items).set({ altGroupId: null }).where(and(own(schema.items), eq(schema.items.collectionId, collectionId), inArray(schema.items.altGroupId, splitGroups)))] : []),
    ...(moveGroups.length ? [db.update(schema.altGroups).set(to).where(and(own(schema.altGroups), inArray(schema.altGroups.id, moveGroups)))] : []),
    ...(ids.length ? ITEM_CHILDREN.map((t) => db.update(t).set(to).where(and(own(t), inArray(t.itemId, ids)))) : []),
    db.update(schema.items).set(to).where(and(own(schema.items), eq(schema.items.collectionId, collectionId))),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.batch(q as any);
  return ids;
}

/** Every data row of a deleted space, and the blob URLs its rows pointed to (the cron deletes those files). */
export async function purgeSpaceData(spaceId: string) {
  const [att, rec, img] = await Promise.all([
    db.select({ url: schema.attachments.url }).from(schema.attachments).where(eq(schema.attachments.spaceId, spaceId)),
    db.select({ url: schema.receipts.url, parts: schema.receipts.parts }).from(schema.receipts).where(eq(schema.receipts.spaceId, spaceId)),
    db.select({ url: schema.items.imageUrl }).from(schema.items).where(and(eq(schema.items.spaceId, spaceId), isNotNull(schema.items.imageUrl))),
  ]);
  const urls = [...att.map((a) => a.url), ...rec.flatMap((r) => [r.url, ...(r.parts ?? [])]), ...img.map((i) => i.url)].filter((u): u is string => !!u && /\.blob\.vercel-storage\.com\//.test(u));
  const tables = [
    schema.conversationMessages,
    schema.conversations,
    schema.alerts,
    schema.attachments,
    schema.pricePoints,
    schema.sources,
    schema.items,
    schema.altGroups,
    schema.collections,
    schema.storeSettings,
    schema.receipts,
  ] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.batch(tables.map((t) => db.delete(t).where(eq(t.spaceId, spaceId))) as any);
  return [...new Set(urls)];
}
