"use server";

import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { schema } from "@/db";
import { requireCtx } from "@/lib/ctx";
import { loadItems, recordPrice } from "@/lib/data";
import { scoped } from "@/lib/db-scoped";
import { hintsFromUrl } from "@/lib/extract";
import { parsePrice } from "@/lib/money";
import { normalizeUrl, storeFromUrl } from "@/lib/stores";
import type { Collection, ItemWithSources } from "@/lib/types";
import { isHttpUrl } from "@/lib/utils";

const row = z.strictObject({
  title: z.string().max(300).optional(),
  url: z.string().max(2000).optional(),
  quantity: z.string().max(20).optional(),
  price: z.string().max(40).optional(),
  currency: z.string().max(8).optional(),
  notes: z.string().max(4000).optional(),
  collection: z.string().max(80).optional(),
  priority: z.string().max(20).optional(),
});
export type ImportRow = z.infer<typeof row>;

const input = z.strictObject({
  rows: z.array(row).max(1000),
  collectionId: z.string().max(64).nullable(),
  defaultCurrency: z.string().min(3).max(3),
});

const PRIORITY: Record<string, "urgent" | "normal" | "someday"> = {
  urgent: "urgent", high: "urgent", "דחוף": "urgent", "גבוהה": "urgent",
  low: "someday", someday: "someday", "מתישהו": "someday", "נמוכה": "someday",
};

export async function importRows(raw: z.input<typeof input>): Promise<{ items: ItemWithSources[]; collections: Collection[]; skipped: number }> {
  const s = scoped(await requireCtx("edit"));
  const parsed = input.parse(raw);
  const { rows, defaultCurrency } = parsed;
  const collectionId = await s.ref(schema.collections, parsed.collectionId);

  // Resolve per-row project/list names; create missing ones as lists.
  const existing = await s.select(schema.collections);
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));
  const createdCollections: Collection[] = [];
  const collectionFor = async (name?: string) => {
    const key = name?.trim().toLowerCase();
    if (!key) return collectionId;
    let c = byName.get(key);
    if (!c) {
      const cid = nanoid(10);
      await s.insert(schema.collections, { id: cid, kind: "list", name: name!.trim().slice(0, 80), sortOrder: Date.now() % 1e9 });
      c = (await s.byId(schema.collections, cid))!;
      byName.set(key, c);
      createdCollections.push(c);
    }
    return c.id;
  };

  const seen = new Set((await s.pick({ n: schema.sources.normalizedUrl }, schema.sources)).map((r) => r.n));
  const ids: string[] = [];
  let skipped = 0;
  const t0 = Date.now();

  for (const [i, r] of rows.entries()) {
    // A link pasted into the name column is still a link.
    const nameIsLink = !!r.title && isHttpUrl(r.title.trim());
    const url = r.url?.trim() && isHttpUrl(r.url.trim()) ? r.url.trim() : nameIsLink ? r.title!.trim() : null;
    const title = (nameIsLink ? null : r.title?.trim()) || (url ? hintsFromUrl(url).slugTitle : null);
    if (!title && !url) {
      skipped++;
      continue;
    }
    const normalized = url ? normalizeUrl(url) : null;
    if (normalized && seen.has(normalized)) {
      skipped++;
      continue;
    }
    if (normalized) seen.add(normalized);

    const store = url ? storeFromUrl(url) : null;
    const price = parsePrice(r.price ?? null, r.currency?.trim().toUpperCase() || store?.currency || defaultCurrency);
    const qty = Math.max(1, Math.min(100000, parseInt((r.quantity ?? "").replace(/[^\d]/g, "")) || 1));
    const id = nanoid(12);
    const ts = t0 + (rows.length - i); // keep file order when sorted by newest
    await s.insert(schema.items, {
      id,
      addedByUserId: s.scope.userId,
      title: (title ?? `${store?.name ?? "New"} item`).slice(0, 300),
      tags: [],
      collectionId: await collectionFor(r.collection),
      quantity: qty,
      priority: PRIORITY[(r.priority ?? "").trim().toLowerCase()] ?? "normal",
      notes: r.notes?.trim() || null,
      createdAt: ts,
      updatedAt: ts,
    });
    if (url && store && normalized) {
      const sourceId = nanoid(12);
      const currency = (price?.currency ?? store.currency ?? defaultCurrency).toUpperCase();
      await s.insert(schema.sources, {
        id: sourceId,
        itemId: id,
        url,
        normalizedUrl: normalized,
        store: store.name,
        storeKey: store.key,
        price: price?.amount ?? null,
        currency,
        // Keep a name the user typed; let the store page name items that came in as bare links.
        extractMethod: r.title?.trim() && !nameIsLink ? "import-titled" : "import",
        createdAt: ts,
      });
      if (price) await recordPrice(s, sourceId, id, price.amount, currency);
    } else if (price) {
      // Known price without a link (bought locally, quote, etc.) → a manual price entry.
      const sourceId = nanoid(12);
      const currency = (price.currency ?? defaultCurrency).toUpperCase();
      await s.insert(schema.sources, {
        id: sourceId,
        itemId: id,
        url: "",
        normalizedUrl: `manual:${sourceId}`,
        store: "—",
        storeKey: "manual",
        price: price.amount,
        currency,
        extractMethod: "manual",
        createdAt: ts,
      });
      await recordPrice(s, sourceId, id, price.amount, currency);
    }
    ids.push(id);
  }

  const items = await loadItems(s, ids);
  return { items, collections: createdCollections, skipped };
}

/** Items created by an import that still need their details read from the store. */
export async function needsDetails(ids: string[]): Promise<{ itemId: string; sourceId: string; url: string }[]> {
  const s = scoped(await requireCtx("edit"));
  const list = z.array(z.string().min(1).max(64)).max(1000).parse(ids);
  if (!list.length) return [];
  const srcs = await s.select(schema.sources, inArray(schema.sources.itemId, list));
  const out: { itemId: string; sourceId: string; url: string }[] = [];
  for (const id of list) {
    const src = srcs.find((x) => x.itemId === id);
    if (src?.url && !src.rawTitle) out.push({ itemId: id, sourceId: src.id, url: src.url });
  }
  void eq;
  return out;
}
