import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiEnabled } from "./ai";
import { getRates } from "./rates";
import type { AppData, ItemWithSources } from "./types";

export async function loadItems(): Promise<ItemWithSources[]> {
  const [items, sources] = await Promise.all([
    db.select().from(schema.items).orderBy(desc(schema.items.createdAt)),
    db.select().from(schema.sources).orderBy(asc(schema.sources.createdAt)),
  ]);
  const byItem = new Map<string, typeof sources>();
  for (const s of sources) {
    const arr = byItem.get(s.itemId) ?? [];
    arr.push(s);
    byItem.set(s.itemId, arr);
  }
  return items.map((i) => ({ ...i, sources: byItem.get(i.id) ?? [] }));
}

export async function getAppData(): Promise<AppData> {
  const [collections, items, rates] = await Promise.all([
    db.select().from(schema.collections).orderBy(asc(schema.collections.sortOrder), asc(schema.collections.createdAt)),
    loadItems(),
    getRates(),
  ]);
  return { collections, items, rates, aiEnabled: aiEnabled() };
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
  const sources = await db.select().from(schema.sources).where(eq(schema.sources.itemId, id)).orderBy(asc(schema.sources.createdAt));
  return { ...item, sources };
}
