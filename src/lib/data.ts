import "server-only";
import { asc, desc, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiEnabled } from "./ai";
import { BUDGET_KV_PREFIX, type BudgetHistory } from "./budget";
import { DEFAULT_IMPORT_LIMIT_USD, IMPORT_LIMIT_KEY } from "./import-vat";
import { loadHomePrefs } from "./home-prefs";
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
  const [collections, items, altGroups, storeSettings, budget, rates, importLimitUsd, alerts, home] = await Promise.all([
    db.select().from(schema.collections).orderBy(asc(schema.collections.sortOrder), asc(schema.collections.createdAt)),
    loadItems(),
    db.select().from(schema.altGroups),
    db.select().from(schema.storeSettings),
    loadBudgetHistory(),
    getRates(),
    loadImportLimit(),
    db.select().from(schema.alerts).orderBy(desc(schema.alerts.createdAt)).limit(60),
    loadHomePrefs(),
  ]);
  return { collections, items, altGroups, storeSettings, budget, rates, aiEnabled: aiEnabled(), importLimitUsd, alerts, home };
}

export async function loadImportLimit(): Promise<number> {
  const row = await db.query.kv.findFirst({ where: eq(schema.kv.key, IMPORT_LIMIT_KEY) });
  const v = Number(row?.value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_IMPORT_LIMIT_USD;
}

export async function loadBudgetHistory(): Promise<BudgetHistory> {
  const rows = await db.select().from(schema.kv).where(like(schema.kv.key, `${BUDGET_KV_PREFIX}%`));
  const out: BudgetHistory = {};
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value);
      out[r.key.slice(BUDGET_KV_PREFIX.length)] = { cap: typeof v.cap === "number" ? v.cap : null, currency: typeof v.currency === "string" ? v.currency : "ILS" };
    } catch {
      // ignore a malformed row
    }
  }
  return out;
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
