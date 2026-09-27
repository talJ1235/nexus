"use server";

import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";
import { extractWithAi, extractWithUrlContext } from "@/lib/ai";
import { getItem, loadItems } from "@/lib/data";
import { addSourceCore, createItemCore, draftSchema, previewFromClientCore, previewUrlCore, refreshSourceCore, type ClientPayload } from "@/lib/service";
import { extractFromUrl, hintsFromUrl } from "@/lib/extract";
import { storeThumbnail } from "@/lib/images";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { storeFromUrl } from "@/lib/stores";
import type { Collection, ItemWithSources, PreviewResult, SourceDraft } from "@/lib/types";
import { isHttpUrl } from "@/lib/utils";

async function assertAuth() {
  const jar = await cookies();
  if (!(await verifySessionValue(jar.get(SESSION_COOKIE)?.value))) throw new Error("unauthorized");
}

const now = () => Date.now();

// ---------- Items ----------

// ---------- Preview & create (logic lives in lib/service) ----------

export async function previewUrl(url: string, hintCollectionId: string | null = null): Promise<PreviewResult> {
  await assertAuth();
  return previewUrlCore(url, hintCollectionId);
}

export async function previewFromClient(payload: ClientPayload, hintCollectionId: string | null = null): Promise<PreviewResult> {
  await assertAuth();
  return previewFromClientCore(payload, hintCollectionId);
}

export async function createItem(input: z.input<typeof draftSchema>): Promise<ItemWithSources> {
  await assertAuth();
  return createItemCore(input);
}

export async function addSource(itemId: string, source: SourceDraft, imageUrl?: string | null): Promise<ItemWithSources> {
  await assertAuth();
  return addSourceCore(itemId, source, imageUrl);
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
  let image = ex.image;
  if (price == null || !image) {
    const uc = await extractWithUrlContext(url.trim());
    if (price == null && uc?.price != null) {
      price = uc.price;
      currency = uc.currency ?? currency;
    }
    image ??= uc?.imageUrl ?? null;
  }
  const hints = hintsFromUrl(url.trim());
  if (price == null && hints.price != null) {
    price = hints.price;
    currency = hints.currency;
  }
  return addSourceCore(
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
    image,
  );
}

const itemPatch = z
  .object({
    title: z.string().min(1).max(300),
    brand: z.string().max(120).nullable(),
    imageUrl: z.string().max(400_000).nullable(),
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

export async function refetchSource(id: string, payload?: ClientPayload | null): Promise<ItemWithSources> {
  await assertAuth();
  return refreshSourceCore(id, payload);
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

