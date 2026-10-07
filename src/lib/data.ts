import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import { aiEnabled } from "./ai";
import { BUDGET_KV_PREFIX, type BudgetHistory } from "./budget";
import { Scoped } from "./db-scoped";
import { collectionByShareToken } from "./db-scoped/system";
import { spacePrefGet, spacePrefLike } from "./db-scoped/prefs";
import { readRev } from "./db-scoped/feed";
import { DEFAULT_IMPORT_LIMIT_USD, IMPORT_LIMIT_KEY } from "./import-vat";
import { loadHomePrefs } from "./home-prefs";
import { getRates } from "./rates";
import type { AppData, ItemWithSources, SpaceInfo } from "./types";

// R15: everything here loads the current space only (the Scoped handle carries it).

function groupBy<T extends { itemId: string }>(rows: T[]) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const arr = m.get(r.itemId) ?? [];
    arr.push(r);
    m.set(r.itemId, arr);
  }
  return m;
}

export async function loadItems(s: Scoped, ids?: string[]): Promise<ItemWithSources[]> {
  if (ids && !ids.length) return [];
  const [items, sources, points, attachments] = await Promise.all([
    s.select(schema.items, ids ? inArray(schema.items.id, ids) : undefined).orderBy(desc(schema.items.createdAt)),
    s.select(schema.sources, ids ? inArray(schema.sources.itemId, ids) : undefined).orderBy(asc(schema.sources.createdAt)),
    s.select(schema.pricePoints, ids ? inArray(schema.pricePoints.itemId, ids) : undefined).orderBy(asc(schema.pricePoints.recordedAt)),
    s.select(schema.attachments, ids ? inArray(schema.attachments.itemId, ids) : undefined).orderBy(asc(schema.attachments.createdAt)),
  ]);
  const sm = groupBy(sources);
  const p = groupBy(points);
  const a = groupBy(attachments);
  return items.map((i) => ({ ...i, sources: sm.get(i.id) ?? [], points: p.get(i.id) ?? [], attachments: a.get(i.id) ?? [] }));
}

export async function getAppData(s: Scoped, userId: string, space?: SpaceInfo, me?: AppData["me"]): Promise<AppData> {
  // R16 B1: the revision first — a write landing while the data loads is then re-sent by changesSince (idempotent).
  const rev = (await readRev(s.spaceId)).rev;
  const [collections, items, altGroups, storeSettings, budget, rates, importLimitUsd, alerts, home, budgetWarn] = await Promise.all([
    s.select(schema.collections).orderBy(asc(schema.collections.sortOrder), asc(schema.collections.createdAt)),
    loadItems(s),
    s.select(schema.altGroups),
    s.select(schema.storeSettings),
    loadBudgetHistory(s),
    getRates(),
    loadImportLimit(s),
    s.select(schema.alerts).orderBy(desc(schema.alerts.createdAt)).limit(60),
    loadHomePrefs(userId),
    loadBudgetWarn(s),
  ]);
  return { collections, items, altGroups, storeSettings, budget, rates, aiEnabled: aiEnabled(), importLimitUsd, budgetWarn, alerts, home, rev, ...(space ? { space } : {}), ...(me ? { me } : {}) };
}

/** R16 D2: Space settings → Budget → "Warn everyone at 80%" (space pref; on unless turned off). */
export const BUDGET_WARN_KEY = "pref:budget-warn";
export async function loadBudgetWarn(s: Scoped): Promise<boolean> {
  return (await spacePrefGet(s, BUDGET_WARN_KEY)) !== "off";
}

export async function loadImportLimit(s: Scoped): Promise<number> {
  const v = Number(await spacePrefGet(s, IMPORT_LIMIT_KEY));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_IMPORT_LIMIT_USD;
}

export async function loadBudgetHistory(s: Scoped): Promise<BudgetHistory> {
  const rows = await spacePrefLike(s, BUDGET_KV_PREFIX);
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

export async function getItem(s: Scoped, id: string): Promise<ItemWithSources | null> {
  const item = await s.byId(schema.items, id);
  if (!item) return null;
  const [sources, points, attachments] = await Promise.all([
    s.select(schema.sources, eq(schema.sources.itemId, id)).orderBy(asc(schema.sources.createdAt)),
    s.select(schema.pricePoints, eq(schema.pricePoints.itemId, id)).orderBy(asc(schema.pricePoints.recordedAt)),
    s.select(schema.attachments, eq(schema.attachments.itemId, id)).orderBy(asc(schema.attachments.createdAt)),
  ]);
  return { ...item, sources, points, attachments };
}

/** getItem or not_found (→ 404). */
export async function mustItem(s: Scoped, id: string): Promise<ItemWithSources> {
  const it = await getItem(s, id);
  if (!it) throw new Error("not_found");
  return it;
}

/** Log a price observation — only when it differs from the last one we saw for that link. */
export async function recordPrice(s: Scoped, sourceId: string, itemId: string, price: number | null, currency: string) {
  if (price == null || !(price > 0)) return;
  const [last] = await s.select(schema.pricePoints, eq(schema.pricePoints.sourceId, sourceId)).orderBy(desc(schema.pricePoints.recordedAt)).limit(1);
  if (last && last.price === price && last.currency === currency) return;
  await s.insert(schema.pricePoints, { id: `pp_${crypto.randomUUID().slice(0, 12)}`, sourceId, itemId, price, currency, recordedAt: Date.now() });
}

/** Public read-only list link `/s/<token>` → that list and its items, read through the list's own space. */
export async function getSharedCollection(token: string) {
  if (!token || token.length < 16 || token.length > 64) return null;
  const collection = await collectionByShareToken(token);
  if (!collection) return null;
  const s = new Scoped({ spaceId: collection.spaceId, userId: null });
  const items = (await loadItems(s)).filter((i) => i.collectionId === collection.id);
  return { collection, items, rates: await getRates() };
}
