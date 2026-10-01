"use server";

import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { del } from "@vercel/blob";
import { z } from "zod";
import { db, schema } from "@/db";
import { extractWithAi, extractWithUrlContext } from "@/lib/ai";
import { getItem, loadItems, recordPrice } from "@/lib/data";
import { addSourceCore, createItemCore, draftSchema, previewFromClientCore, previewUrlCore, refreshSourceCore, type ClientPayload } from "@/lib/service";
import { extractFromUrl, hintsFromUrl } from "@/lib/extract";
import { storeThumbnail } from "@/lib/images";
import { dropCollectionSharing } from "@/lib/sharing";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { storeFromUrl } from "@/lib/stores";
import type { AltGroup, Collection, ItemWithSources, PreviewResult, SourceDraft } from "@/lib/types";
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
      gtin: ex.gtin ?? null,
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
    trackingNumber: z.string().max(80).nullable(),
    carrier: z.string().max(40).nullable(),
    eta: z.number().int().nullable(),
    targetPrice: z.number().nonnegative().nullable(),
    targetCurrency: z.string().min(3).max(3).nullable(),
    watch: z.boolean(),
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

type Status = "to_buy" | "ordered" | "purchased";
type Paid = { price: number; currency: string } | null;

function statusPatch(status: Status, paid: Paid, current?: { orderedAt: number | null; purchasedPrice: number | null; purchasedCurrency: string | null }) {
  const t = now();
  if (status === "to_buy") return { status, orderedAt: null, purchasedAt: null, purchasedPrice: null, purchasedCurrency: null, updatedAt: t };
  const price = paid ? { purchasedPrice: paid.price, purchasedCurrency: paid.currency } : current?.purchasedPrice != null ? {} : { purchasedPrice: null, purchasedCurrency: null };
  if (status === "ordered") return { status, orderedAt: t, purchasedAt: null, ...price, updatedAt: t };
  return { status, orderedAt: current?.orderedAt ?? null, purchasedAt: t, ...price, updatedAt: t };
}

/** Move an item along to_buy → ordered → purchased (received). `paid` = unit price actually paid. */
export async function setStatus(id: string, status: Status, paid?: Paid): Promise<ItemWithSources> {
  await assertAuth();
  z.enum(["to_buy", "ordered", "purchased"]).parse(status);
  const cur = await db.query.items.findFirst({ where: eq(schema.items.id, id) });
  if (!cur) throw new Error("not_found");
  await db.update(schema.items).set(statusPatch(status, paid ?? null, cur)).where(eq(schema.items.id, id));
  return (await getItem(id))!;
}

// ---------- Bulk ----------

const bulkPatch = z
  .object({
    collectionId: z.string().nullable(),
    priority: z.enum(["urgent", "normal", "someday"]),
  })
  .partial();

export async function bulkUpdate(ids: string[], patch: z.input<typeof bulkPatch>): Promise<ItemWithSources[]> {
  await assertAuth();
  const p = bulkPatch.parse(patch);
  if (!ids.length) return [];
  await db.update(schema.items).set({ ...p, updatedAt: now() }).where(inArray(schema.items.id, ids));
  return (await loadItems()).filter((i) => ids.includes(i.id));
}

/** Bulk status change; each item's paid price comes from its active store (computed on the client). */
export async function bulkSetStatus(entries: { id: string; paid: Paid }[], status: Status): Promise<ItemWithSources[]> {
  await assertAuth();
  z.enum(["to_buy", "ordered", "purchased"]).parse(status);
  const ids = entries.map((e) => e.id);
  const current = await db.select().from(schema.items).where(inArray(schema.items.id, ids));
  for (const e of entries) {
    const cur = current.find((c) => c.id === e.id);
    if (cur) await db.update(schema.items).set(statusPatch(status, e.paid, cur)).where(eq(schema.items.id, e.id));
  }
  return (await loadItems()).filter((i) => ids.includes(i.id));
}

export async function bulkDelete(ids: string[]): Promise<ItemWithSources[]> {
  await assertAuth();
  if (!ids.length) return [];
  const snaps = (await loadItems()).filter((i) => ids.includes(i.id));
  await db.delete(schema.sources).where(inArray(schema.sources.itemId, ids));
  await db.delete(schema.pricePoints).where(inArray(schema.pricePoints.itemId, ids));
  await db.delete(schema.attachments).where(inArray(schema.attachments.itemId, ids));
  await db.delete(schema.items).where(inArray(schema.items.id, ids));
  for (const g of new Set(snaps.map((x) => x.altGroupId).filter(Boolean) as string[])) await cleanupGroup(g);
  return snaps;
}

export async function restoreItems(snapshots: ItemWithSources[]): Promise<ItemWithSources[]> {
  await assertAuth();
  const out: ItemWithSources[] = [];
  for (const snap of snapshots) out.push(await restoreItem(snap));
  return out;
}

// ---------- Alternatives ----------

async function cleanupGroup(groupId: string) {
  const members = await db.select({ id: schema.items.id }).from(schema.items).where(eq(schema.items.altGroupId, groupId));
  if (members.length < 2) {
    await db.update(schema.items).set({ altGroupId: null }).where(eq(schema.items.altGroupId, groupId));
    await db.delete(schema.altGroups).where(eq(schema.altGroups.id, groupId));
    return null;
  }
  const g = await db.query.altGroups.findFirst({ where: eq(schema.altGroups.id, groupId) });
  if (g?.chosenItemId && !members.some((m) => m.id === g.chosenItemId)) {
    await db.update(schema.altGroups).set({ chosenItemId: null }).where(eq(schema.altGroups.id, groupId));
  }
  return (await db.query.altGroups.findFirst({ where: eq(schema.altGroups.id, groupId) })) ?? null;
}

type AltState = { items: ItemWithSources[]; altGroups: AltGroup[] };
async function altState(): Promise<AltState> {
  const [items, altGroups] = await Promise.all([loadItems(), db.select().from(schema.altGroups)]);
  return { items, altGroups };
}

export async function createAltGroup(itemIds: string[], name: string): Promise<AltState & { groupId: string }> {
  await assertAuth();
  const ids = z.array(z.string()).min(2).max(20).parse(itemIds);
  const clean = z.string().min(1).max(80).parse(name.trim());
  const id = nanoid(10);
  const previous = await db.select({ g: schema.items.altGroupId }).from(schema.items).where(inArray(schema.items.id, ids));
  const [group] = await db.insert(schema.altGroups).values({ id, name: clean, createdAt: now() }).returning();
  await db.update(schema.items).set({ altGroupId: id, updatedAt: now() }).where(inArray(schema.items.id, ids));
  for (const p of previous) if (p.g) await cleanupGroup(p.g);
  return { ...(await altState()), groupId: group.id };
}

export async function updateAltGroup(id: string, patch: { name?: string; chosenItemId?: string | null }): Promise<AltGroup> {
  await assertAuth();
  const p = z.object({ name: z.string().min(1).max(80).optional(), chosenItemId: z.string().nullable().optional() }).parse(patch);
  const [row] = await db.update(schema.altGroups).set(p).where(eq(schema.altGroups.id, id)).returning();
  return row;
}

/** Take one item out of its group (the group dissolves when fewer than two remain). */
export async function leaveAltGroup(itemId: string): Promise<AltState> {
  await assertAuth();
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  if (item?.altGroupId) {
    await db.update(schema.items).set({ altGroupId: null }).where(eq(schema.items.id, itemId));
    await cleanupGroup(item.altGroupId);
  }
  return altState();
}

// ---------- Receipts ----------

export async function addAttachment(itemId: string, file: { url: string; name: string; contentType?: string | null; size?: number | null }): Promise<ItemWithSources> {
  await assertAuth();
  const f = z
    .object({ url: z.string().url().refine((u) => u.includes(".blob.vercel-storage.com/")), name: z.string().min(1).max(200), contentType: z.string().max(100).nullish(), size: z.number().int().nonnegative().nullish() })
    .parse(file);
  await db.insert(schema.attachments).values({ id: nanoid(12), itemId, url: f.url, name: f.name, contentType: f.contentType ?? null, size: f.size ?? null, createdAt: now() });
  return (await getItem(itemId))!;
}

export async function deleteAttachment(id: string): Promise<ItemWithSources> {
  await assertAuth();
  const [row] = await db.delete(schema.attachments).where(eq(schema.attachments.id, id)).returning();
  if (!row) throw new Error("not_found");
  // A receipt read from a document is attached to every item it paid for: keep the file while anything uses it.
  const [att, rec] = await Promise.all([
    db.select({ id: schema.attachments.id }).from(schema.attachments).where(eq(schema.attachments.url, row.url)).limit(1),
    db.select({ id: schema.receipts.id }).from(schema.receipts).where(eq(schema.receipts.url, row.url)).limit(1),
  ]);
  if (!att.length && !rec.length) {
    try {
      await del(row.url);
    } catch {
      /* file may already be gone */
    }
  }
  return (await getItem(row.itemId))!;
}

export async function deleteItem(id: string): Promise<ItemWithSources | null> {
  await assertAuth();
  const snapshot = await getItem(id);
  await db.delete(schema.sources).where(eq(schema.sources.itemId, id));
  await db.delete(schema.pricePoints).where(eq(schema.pricePoints.itemId, id));
  await db.delete(schema.attachments).where(eq(schema.attachments.itemId, id));
  await db.delete(schema.items).where(eq(schema.items.id, id));
  if (snapshot?.altGroupId) await cleanupGroup(snapshot.altGroupId);
  return snapshot;
}

export async function restoreItem(snapshot: ItemWithSources): Promise<ItemWithSources> {
  await assertAuth();
  const { sources, points, attachments, ...item } = snapshot;
  if (item.altGroupId && !(await db.query.altGroups.findFirst({ where: eq(schema.altGroups.id, item.altGroupId) }))) item.altGroupId = null;
  await db.insert(schema.items).values(item).onConflictDoNothing();
  if (sources.length) await db.insert(schema.sources).values(sources).onConflictDoNothing();
  if (points?.length) await db.insert(schema.pricePoints).values(points).onConflictDoNothing();
  if (attachments?.length) await db.insert(schema.attachments).values(attachments).onConflictDoNothing();
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
  const [row] = await db.update(schema.sources).set(p).where(eq(schema.sources.id, id)).returning();
  if (!row) throw new Error("not_found");
  if (p.price !== undefined || p.currency !== undefined) await recordPrice(row.id, row.itemId, row.price, row.currency);
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
  await dropCollectionSharing(id);
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

/**
 * Move some units of an item to another project/list. Moving every unit just moves the item; moving fewer
 * splits it: a copy with `count` units (same store links and price history) goes to the target, the rest stay.
 */
export async function splitItem(id: string, count: number, collectionId: string | null): Promise<{ original: ItemWithSources; moved: ItemWithSources }> {
  await assertAuth();
  const n = z.number().int().min(1).parse(count);
  z.string().nullable().parse(collectionId);
  const cur = await getItem(id);
  if (!cur) throw new Error("not_found");
  const t = now();
  if (n >= cur.quantity) {
    await db.update(schema.items).set({ collectionId, updatedAt: t }).where(eq(schema.items.id, id));
    const it = (await getItem(id))!;
    return { original: it, moved: it };
  }
  const { sources, points, attachments: _receipts, ...item } = cur; // receipts stay with the original line
  const newId = nanoid();
  const srcIds = new Map(sources.map((x) => [x.id, nanoid()]));
  await db.insert(schema.items).values({
    ...item,
    id: newId,
    collectionId,
    quantity: n,
    altGroupId: null,
    chosenSourceId: item.chosenSourceId ? (srcIds.get(item.chosenSourceId) ?? null) : null,
    createdAt: t,
    updatedAt: t,
  });
  if (sources.length) await db.insert(schema.sources).values(sources.map((x) => ({ ...x, id: srcIds.get(x.id)!, itemId: newId })));
  const pts = (points ?? []).filter((p) => srcIds.has(p.sourceId));
  if (pts.length) await db.insert(schema.pricePoints).values(pts.map((p) => ({ ...p, id: nanoid(), itemId: newId, sourceId: srcIds.get(p.sourceId)! })));
  await db.update(schema.items).set({ quantity: cur.quantity - n, updatedAt: t }).where(eq(schema.items.id, id));
  return { original: (await getItem(id))!, moved: (await getItem(newId))! };
}

/** Undo a split: fold the moved units back into the original line. */
export async function unsplitItem(originalId: string, movedId: string): Promise<ItemWithSources> {
  await assertAuth();
  if (originalId === movedId) throw new Error("same_item");
  const [orig, moved] = await Promise.all([getItem(originalId), getItem(movedId)]);
  if (!orig || !moved) throw new Error("not_found");
  await db.delete(schema.pricePoints).where(eq(schema.pricePoints.itemId, movedId));
  await db.delete(schema.sources).where(eq(schema.sources.itemId, movedId));
  await db.delete(schema.items).where(eq(schema.items.id, movedId));
  await db.update(schema.items).set({ quantity: orig.quantity + moved.quantity, updatedAt: now() }).where(eq(schema.items.id, originalId));
  return (await getItem(originalId))!;
}

export async function reloadAll(): Promise<ItemWithSources[]> {
  await assertAuth();
  return loadItems();
}

