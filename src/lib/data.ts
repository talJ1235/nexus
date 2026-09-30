import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiEnabled } from "./ai";
import { getRates } from "./rates";
import type { AppData, ItemWithSources } from "./types";

function groupBy<T extends { itemId: string }>(rows: T[]) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const arr = m.get(r.itemId) ?? [];
    arr.push(r);
    m.set(r.itemId, arr);
  }
  return m;
}

export async function loadItems(): Promise<ItemWithSources[]> {
  const [items, sources, points, attachments] = await Promise.all([
    db.select().from(schema.items).orderBy(desc(schema.items.createdAt)),
    db.select().from(schema.sources).orderBy(asc(schema.sources.createdAt)),
    db.select().from(schema.pricePoints).orderBy(asc(schema.pricePoints.recordedAt)),
    db.select().from(schema.attachments).orderBy(asc(schema.attachments.createdAt)),
  ]);
  const s = groupBy(sources);
  const p = groupBy(points);
  const a = groupBy(attachments);
  return items.map((i) => ({ ...i, sources: s.get(i.id) ?? [], points: p.get(i.id) ?? [], attachments: a.get(i.id) ?? [] }));
}

export async function getAppData(): Promise<AppData> {
  const [collections, items, altGroups, storeSettings, rates] = await Promise.all([
    db.select().from(schema.collections).orderBy(asc(schema.collections.sortOrder), asc(schema.collections.createdAt)),
    loadItems(),
    db.select().from(schema.altGroups),
    db.select().from(schema.storeSettings),
    getRates(),
  ]);
  return { collections, items, altGroups, storeSettings, rates, aiEnabled: aiEnabled() };
}

export async function getSharedCollection(token: string) {
  if (!token || token.length < 16) return null;
  const collection = await db.query.collections.findFirst({ where: eq(schema.collections.shareToken, token) });
  if (!collection) return null;
  const all = await loadItems();
  const items = all.filter((i) => i.collectionId === collection.id);
  const rates = await getRates();
  return { collection, items, rates };
}

export async function getItem(id: string): Promise<ItemWithSources | null> {
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, id) });
  if (!item) return null;
  const [sources, points, attachments] = await Promise.all([
    db.select().from(schema.sources).where(eq(schema.sources.itemId, id)).orderBy(asc(schema.sources.createdAt)),
    db.select().from(schema.pricePoints).where(eq(schema.pricePoints.itemId, id)).orderBy(asc(schema.pricePoints.recordedAt)),
    db.select().from(schema.attachments).where(eq(schema.attachments.itemId, id)).orderBy(asc(schema.attachments.createdAt)),
  ]);
  return { ...item, sources, points, attachments };
}

/** Log a price observation — only when it differs from the last one we saw for that link. */
export async function recordPrice(sourceId: string, itemId: string, price: number | null, currency: string) {
  if (price == null || !(price > 0)) return;
  const last = await db.query.pricePoints.findFirst({
    where: eq(schema.pricePoints.sourceId, sourceId),
    orderBy: desc(schema.pricePoints.recordedAt),
  });
  if (last && last.price === price && last.currency === currency) return;
  await db.insert(schema.pricePoints).values({ id: `pp_${crypto.randomUUID().slice(0, 12)}`, sourceId, itemId, price, currency, recordedAt: Date.now() });
}
