"use server";

import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";
import { categorize, extractWithAi } from "@/lib/ai";
import { getItem, loadItems } from "@/lib/data";
import { extractFromUrl, type Extracted } from "@/lib/extract";
import { storeThumbnail } from "@/lib/images";
import { parsePrice } from "@/lib/money";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { titleSimilarity } from "@/lib/similarity";
import { normalizeUrl, storeFromUrl } from "@/lib/stores";
import type { Collection, Duplicate, ItemDraft, ItemWithSources, PreviewResult, Source, SourceDraft } from "@/lib/types";
import { isHttpUrl } from "@/lib/utils";

async function assertAuth() {
  const jar = await cookies();
  if (!(await verifySessionValue(jar.get(SESSION_COOKIE)?.value))) throw new Error("unauthorized");
}

const now = () => Date.now();

// ---------- Preview (extract + categorize, no writes) ----------

const clientPayload = z.object({
  url: z.string().url(),
  title: z.string().max(500).nullish(),
  price: z.union([z.number(), z.string()]).nullish(),
  currency: z.string().max(8).nullish(),
  image: z.string().max(2000).nullish(),
  brand: z.string().max(120).nullish(),
  siteName: z.string().max(120).nullish(),
  description: z.string().max(1000).nullish(),
});
export type ClientPayload = z.infer<typeof clientPayload>;

async function findDuplicate(normalizedUrl: string, title: string | null): Promise<Duplicate | null> {
  const exact = await db
    .select({ itemId: schema.sources.itemId, title: schema.items.title })
    .from(schema.sources)
    .innerJoin(schema.items, eq(schema.items.id, schema.sources.itemId))
    .where(eq(schema.sources.normalizedUrl, normalizedUrl))
    .limit(1);
  if (exact[0]) return { itemId: exact[0].itemId, title: exact[0].title, reason: "url" };
  if (!title) return null;
  const candidates = await db.select({ id: schema.items.id, title: schema.items.title }).from(schema.items);
  let best: { id: string; title: string; score: number } | null = null;
  for (const c of candidates) {
    const score = titleSimilarity(title, c.title);
    if (score >= 0.6 && (!best || score > best.score)) best = { ...c, score };
  }
  return best ? { itemId: best.id, title: best.title, reason: "title" } : null;
}

async function buildDraft(ex: Extracted, hintCollectionId: string | null): Promise<ItemDraft> {
  let { title, price, currency, brand } = ex;
  let method: string = ex.method;

  if ((!title || price == null) && ex.pageText && !ex.blocked) {
    const ai = await extractWithAi(ex.url, ex.pageText);
    if (ai) {
      if (!title && ai.title) {
        title = ai.title;
        method = "ai";
      }
      if (price == null && ai.price && ai.price > 0) {
        price = ai.price;
        currency = ai.currency?.toUpperCase() ?? currency;
        if (method !== "ai") method = `${method}+ai`;
      }
      brand ??= ai.brand;
    }
  }

  const collections = await db
    .select({ id: schema.collections.id, name: schema.collections.name, kind: schema.collections.kind, description: schema.collections.description })
    .from(schema.collections)
    .where(eq(schema.collections.archived, false));

  let category: string | null = null;
  let tags: string[] = [];
  let collectionId = hintCollectionId;
  let cleanTitle = title;

  if (title) {
    const tagRows = await db.select({ tags: schema.items.tags }).from(schema.items);
    const counts = new Map<string, number>();
    for (const r of tagRows) for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    const knownTags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const cat = await categorize({ title, description: ex.description, store: ex.store.name, url: ex.url, collections, knownTags });
    if (cat) {
      cleanTitle = cat.title;
      brand ??= cat.brand;
      category = cat.category;
      tags = cat.tags;
      collectionId ??= cat.collectionId;
    }
  }

  const quality: ItemDraft["quality"] = title && price != null ? "full" : title || price != null ? "partial" : "failed";
  const fallbackTitle = (() => {
    try {
      const u = new URL(ex.url);
      const slug = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")
        .replace(/\.(html?|aspx?|php)$/i, "")
        .replace(/[-_+]+/g, " ")
        .trim();
      return slug && !/^\d+$/.test(slug) ? slug.slice(0, 120) : `${ex.store.name} item`;
    } catch {
      return "New item";
    }
  })();

  return {
    title: cleanTitle || fallbackTitle,
    brand: brand ?? null,
    imageUrl: ex.image,
    category,
    tags,
    collectionId,
    quality,
    source: {
      url: ex.url,
      normalizedUrl: ex.normalizedUrl,
      store: ex.store.name,
      storeKey: ex.store.key,
      price: price ?? null,
      currency: (currency ?? storeFromUrl(ex.url).currency ?? "USD").toUpperCase(),
      shipping: null,
      availability: ex.availability,
      rawTitle: ex.title,
      extractMethod: method,
    },
  };
}

export async function previewUrl(url: string, hintCollectionId: string | null = null): Promise<PreviewResult> {
  await assertAuth();
  const clean = url.trim();
  if (!isHttpUrl(clean)) throw new Error("invalid_url");
  const early = await findDuplicate(normalizeUrl(clean), null);
  if (early) {
    // Exact link already saved — skip the network round-trip.
    const s = storeFromUrl(clean);
    return {
      duplicate: early,
      draft: {
        title: early.title, brand: null, imageUrl: null, category: null, tags: [], collectionId: hintCollectionId, quality: "partial",
        source: { url: clean, normalizedUrl: normalizeUrl(clean), store: s.name, storeKey: s.key, price: null, currency: s.currency ?? "USD", shipping: null, availability: null, rawTitle: null, extractMethod: "none" },
      },
    };
  }
  const ex = await extractFromUrl(clean);
  const draft = await buildDraft(ex, hintCollectionId);
  const duplicate = await findDuplicate(draft.source.normalizedUrl, draft.title);
  return { draft, duplicate };
}

export async function previewFromClient(payload: ClientPayload, hintCollectionId: string | null = null): Promise<PreviewResult> {
  await assertAuth();
  const p = clientPayload.parse(payload);
  const store = storeFromUrl(p.url, p.siteName);
  const parsed = parsePrice(p.price ?? null, p.currency ?? store.currency);
  const ex: Extracted = {
    url: p.url,
    normalizedUrl: normalizeUrl(p.url),
    title: p.title ?? null,
    description: p.description ?? null,
    brand: p.brand ?? null,
    image: p.image ?? null,
    price: parsed?.amount ?? null,
    currency: parsed?.currency ?? p.currency ?? store.currency ?? null,
    availability: null,
    siteName: p.siteName ?? null,
    store: { key: store.key, name: store.name },
    method: "client",
    pageText: null,
    blocked: false,
  };
  const draft = await buildDraft(ex, hintCollectionId);
  const duplicate = await findDuplicate(draft.source.normalizedUrl, draft.title);
  return { draft, duplicate };
}

// ---------- Items ----------

const sourceDraftSchema = z.object({
  url: z.string().url(),
  normalizedUrl: z.string(),
  store: z.string().max(80),
  storeKey: z.string().max(120),
  price: z.number().nonnegative().nullable(),
  currency: z.string().min(3).max(3),
  shipping: z.number().nonnegative().nullable(),
  availability: z.string().nullable(),
  rawTitle: z.string().nullable(),
  extractMethod: z.string(),
});

const draftSchema = z.object({
  title: z.string().min(1).max(300),
  brand: z.string().max(120).nullable(),
  imageUrl: z.string().max(2000).nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string().max(40)).max(12),
  collectionId: z.string().nullable(),
  source: sourceDraftSchema.nullable(),
  quantity: z.number().int().min(1).max(100000).optional(),
  priority: z.enum(["urgent", "normal", "someday"]).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function createItem(input: z.input<typeof draftSchema>): Promise<ItemWithSources> {
  await assertAuth();
  const d = draftSchema.parse(input);
  const id = nanoid(12);
  const imageUrl = await storeThumbnail(d.imageUrl, id);
  const t = now();
  await db.insert(schema.items).values({
    id,
    title: d.title,
    brand: d.brand,
    imageUrl,
    category: d.category,
    tags: d.tags,
    collectionId: d.collectionId,
    quantity: d.quantity ?? 1,
    priority: d.priority ?? "normal",
    notes: d.notes ?? null,
    createdAt: t,
    updatedAt: t,
  });
  if (d.source) {
    await db.insert(schema.sources).values({ id: nanoid(12), itemId: id, ...d.source, fetchedAt: t, createdAt: t });
  }
  return (await getItem(id))!;
}

export async function addSource(itemId: string, source: SourceDraft, imageUrl?: string | null): Promise<ItemWithSources> {
  await assertAuth();
  const s = sourceDraftSchema.parse(source);
  const t = now();
  await db.insert(schema.sources).values({ id: nanoid(12), itemId, ...s, fetchedAt: t, createdAt: t });
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  if (item && !item.imageUrl && imageUrl) {
    await db.update(schema.items).set({ imageUrl: await storeThumbnail(imageUrl, itemId) }).where(eq(schema.items.id, itemId));
  }
  await db.update(schema.items).set({ updatedAt: t }).where(eq(schema.items.id, itemId));
  return (await getItem(itemId))!;
}

/** Add a store link to an existing item: extracts price from the page. */
export async function addSourceFromUrl(itemId: string, url: string): Promise<ItemWithSources> {
  await assertAuth();
  if (!isHttpUrl(url)) throw new Error("invalid_url");
  const ex = await extractFromUrl(url.trim());
  let { price, currency } = ex;
  if (price == null && ex.pageText && !ex.blocked) {
    const ai = await extractWithAi(ex.url, ex.pageText);
    if (ai?.price) {
      price = ai.price;
      currency = ai.currency ?? currency;
    }
  }
  return addSource(
    itemId,
    {
      url: ex.url,
      normalizedUrl: ex.normalizedUrl,
      store: ex.store.name,
      storeKey: ex.store.key,
      price,
      currency: (currency ?? storeFromUrl(ex.url).currency ?? "USD").toUpperCase(),
      shipping: null,
      availability: ex.availability,
      rawTitle: ex.title,
      extractMethod: ex.method,
    },
    ex.image,
  );
}

const itemPatch = z
  .object({
    title: z.string().min(1).max(300),
    brand: z.string().max(120).nullable(),
    imageUrl: z.string().max(2000).nullable(),
    category: z.string().max(40).nullable(),
    tags: z.array(z.string().max(40)).max(12),
    collectionId: z.string().nullable(),
    priority: z.enum(["urgent", "normal", "someday"]),
    quantity: z.number().int().min(1).max(100000),
    notes: z.string().max(4000).nullable(),
    chosenSourceId: z.string().nullable(),
  })
  .partial();

export async function updateItem(id: string, patch: z.input<typeof itemPatch>): Promise<ItemWithSources> {
  await assertAuth();
  const p = itemPatch.parse(patch);
  if (p.imageUrl && /^https?:/.test(p.imageUrl) && !p.imageUrl.includes(".blob.vercel-storage.com")) {
    p.imageUrl = await storeThumbnail(p.imageUrl, id);
  }
  await db.update(schema.items).set({ ...p, updatedAt: now() }).where(eq(schema.items.id, id));
  return (await getItem(id))!;
}

export async function setPurchased(id: string, purchased: boolean, paid?: { price: number; currency: string } | null): Promise<ItemWithSources> {
  await assertAuth();
  await db
    .update(schema.items)
    .set(
      purchased
        ? { status: "purchased", purchasedAt: now(), purchasedPrice: paid?.price ?? null, purchasedCurrency: paid?.currency ?? null, updatedAt: now() }
        : { status: "to_buy", purchasedAt: null, purchasedPrice: null, purchasedCurrency: null, updatedAt: now() },
    )
    .where(eq(schema.items.id, id));
  return (await getItem(id))!;
}

export async function deleteItem(id: string): Promise<ItemWithSources | null> {
  await assertAuth();
  const snapshot = await getItem(id);
  await db.delete(schema.sources).where(eq(schema.sources.itemId, id));
  await db.delete(schema.items).where(eq(schema.items.id, id));
  return snapshot;
}

export async function restoreItem(snapshot: ItemWithSources): Promise<ItemWithSources> {
  await assertAuth();
  const { sources, ...item } = snapshot;
  await db.insert(schema.items).values(item).onConflictDoNothing();
  if (sources.length) await db.insert(schema.sources).values(sources).onConflictDoNothing();
  return (await getItem(item.id))!;
}

// ---------- Sources ----------

const sourcePatch = z
  .object({
    price: z.number().nonnegative().nullable(),
    currency: z.string().min(3).max(3),
    shipping: z.number().nonnegative().nullable(),
    store: z.string().min(1).max(80),
  })
  .partial();

export async function updateSource(id: string, patch: z.input<typeof sourcePatch>): Promise<ItemWithSources> {
  await assertAuth();
  const p = sourcePatch.parse(patch);
  const [row] = await db.update(schema.sources).set(p).where(eq(schema.sources.id, id)).returning({ itemId: schema.sources.itemId });
  if (!row) throw new Error("not_found");
  return (await getItem(row.itemId))!;
}

export async function deleteSource(id: string): Promise<ItemWithSources> {
  await assertAuth();
  const [row] = await db.delete(schema.sources).where(eq(schema.sources.id, id)).returning({ itemId: schema.sources.itemId });
  if (!row) throw new Error("not_found");
  await db
    .update(schema.items)
    .set({ chosenSourceId: null })
    .where(and(eq(schema.items.id, row.itemId), eq(schema.items.chosenSourceId, id)));
  return (await getItem(row.itemId))!;
}

export async function refetchSource(id: string): Promise<ItemWithSources> {
  await assertAuth();
  const src = await db.query.sources.findFirst({ where: eq(schema.sources.id, id) });
  if (!src) throw new Error("not_found");
  const ex = await extractFromUrl(src.url);
  const patch: Partial<Source> = { fetchedAt: now() };
  if (ex.price != null) {
    patch.price = ex.price;
    patch.currency = (ex.currency ?? src.currency).toUpperCase();
  }
  if (ex.availability) patch.availability = ex.availability;
  await db.update(schema.sources).set(patch).where(eq(schema.sources.id, id));
  const item = await getItem(src.itemId);
  if (item && !item.imageUrl && ex.image) {
    await db.update(schema.items).set({ imageUrl: await storeThumbnail(ex.image, item.id) }).where(eq(schema.items.id, item.id));
  }
  return (await getItem(src.itemId))!;
}

// ---------- Collections ----------

const collectionInput = z.object({
  kind: z.enum(["project", "list"]),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(20).optional(),
  budget: z.number().nonnegative().nullable().optional(),
  budgetCurrency: z.string().min(3).max(3).optional(),
});

export async function createCollection(input: z.input<typeof collectionInput>): Promise<Collection> {
  await assertAuth();
  const c = collectionInput.parse(input);
  const id = nanoid(10);
  const [row] = await db
    .insert(schema.collections)
    .values({ id, ...c, description: c.description ?? null, budget: c.budget ?? null, sortOrder: now() % 1e9 })
    .returning();
  return row;
}

export async function updateCollection(id: string, patch: Partial<z.input<typeof collectionInput>> & { archived?: boolean }): Promise<Collection> {
  await assertAuth();
  const p = collectionInput.partial().extend({ archived: z.boolean().optional() }).parse(patch);
  const [row] = await db.update(schema.collections).set(p).where(eq(schema.collections.id, id)).returning();
  return row;
}

export async function deleteCollection(id: string) {
  await assertAuth();
  await db.update(schema.items).set({ collectionId: null }).where(eq(schema.items.collectionId, id));
  await db.delete(schema.collections).where(eq(schema.collections.id, id));
}

export async function setSharing(id: string, on: boolean): Promise<Collection> {
  await assertAuth();
  const [row] = await db
    .update(schema.collections)
    .set({ shareToken: on ? nanoid(24) : null })
    .where(eq(schema.collections.id, id))
    .returning();
  return row;
}

export async function moveItems(ids: string[], collectionId: string | null) {
  await assertAuth();
  if (!ids.length) return;
  await db.update(schema.items).set({ collectionId, updatedAt: now() }).where(inArray(schema.items.id, ids));
}

export async function reloadAll(): Promise<ItemWithSources[]> {
  await assertAuth();
  return loadItems();
}

