"use server";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { del } from "@vercel/blob";
import { z } from "zod";
import { noteActivity } from "@/lib/activity";
import { schema } from "@/db";
import { extractWithAi, extractWithUrlContext } from "@/lib/ai";
import { aiUseOf } from "@/lib/ai-gate";
import { requireCtx } from "@/lib/ctx";
import { getItem, loadItems, mustItem, recordPrice } from "@/lib/data";
import { scoped, type Scoped } from "@/lib/db-scoped";
import { addSourceCore, createItemCore, draftSchema, previewFromClientCore, previewUrlCore, refreshSourceCore, sourceDraftSchema, clientPayload, type ClientPayload } from "@/lib/service";
import { extractFromUrl, hintsFromUrl } from "@/lib/extract";
import { storeThumbnail } from "@/lib/images";
import { storeFromUrl } from "@/lib/stores";
import type { AltGroup, Collection, Item, ItemWithSources, PreviewResult, SourceDraft } from "@/lib/types";
import { isHttpUrl } from "@/lib/utils";
import { statusPatch, type Paid, type Status } from "@/lib/status";
import { BaseZ, guardedUpdate, type Base, type Conflict } from "@/lib/conflict";

// R15 B3: every action resolves the ctx first (requireCtx), then works only inside the current space (scoped).
const edit = async () => scoped(await requireCtx("edit"));
const view = async () => scoped(await requireCtx("view"));

const now = () => Date.now();
const Id = z.string().min(1).max(64);
const Ids = z.array(Id).max(500);
const NullableId = Id.nullable();

// ---------- Preview & create (logic lives in lib/service) ----------

export async function previewUrl(url: string, hintCollectionId: string | null = null): Promise<PreviewResult> {
  const s = await edit();
  return previewUrlCore(s, z.string().max(4000).parse(url), await s.ref(schema.collections, NullableId.parse(hintCollectionId)));
}

export async function previewFromClient(payload: ClientPayload, hintCollectionId: string | null = null): Promise<PreviewResult> {
  const s = await edit();
  return previewFromClientCore(s, clientPayload.parse(payload), await s.ref(schema.collections, NullableId.parse(hintCollectionId)));
}

export async function createItem(input: z.input<typeof draftSchema>): Promise<ItemWithSources> {
  const s = await edit();
  const item = await createItemCore(s, input);
  noteActivity({ userId: s.scope.userId, spaceId: s.scope.spaceId }, "items_added");
  if (input.source?.url) noteActivity({ userId: s.scope.userId, spaceId: s.scope.spaceId }, "link_added");
  return item;
}

export async function addSource(itemId: string, source: SourceDraft, imageUrl?: string | null): Promise<ItemWithSources> {
  const s = await edit();
  const item = await addSourceCore(s, Id.parse(itemId), sourceDraftSchema.parse(source), z.string().max(400_000).nullish().parse(imageUrl));
  noteActivity({ userId: s.scope.userId, spaceId: s.scope.spaceId }, "link_added");
  return item;
}

/** Add a store link to an existing item: extracts price from the page. */
export async function addSourceFromUrl(itemId: string, url: string): Promise<ItemWithSources> {
  const s = await edit();
  await s.mustGet(schema.items, Id.parse(itemId));
  if (typeof url !== "string" || !isHttpUrl(url)) throw new Error("invalid_url");
  noteActivity({ userId: s.scope.userId, spaceId: s.scope.spaceId }, "link_added");
  const ex = await extractFromUrl(url.trim());
  let { price, currency } = ex;
  if (price == null && ex.pageText && !ex.blocked) {
    const ai = await extractWithAi(ex.url, ex.pageText, aiUseOf(s, "extract"));
    if (ai?.price) {
      price = ai.price;
      currency = ai.currency ?? currency;
    }
  }
  let image = ex.image;
  if (price == null || !image) {
    const uc = await extractWithUrlContext(url.trim(), aiUseOf(s, "extract"));
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
    s,
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
    // R17 B1: "Use full name" moves the original back into the title and clears this.
    fullTitle: z.string().max(500).nullable(),
    brand: z.string().max(120).nullable(),
    imageUrl: z.string().max(400_000).nullable(),
    category: z.string().max(40).nullable(),
    tags: z.array(z.string().max(40)).max(12),
    collectionId: NullableId,
    priority: z.enum(["urgent", "normal", "someday"]),
    quantity: z.number().int().min(1).max(100000),
    notes: z.string().max(4000).nullable(),
    chosenSourceId: NullableId,
    trackingNumber: z.string().max(80).nullable(),
    carrier: z.string().max(40).nullable(),
    eta: z.number().int().nullable(),
    targetPrice: z.number().nonnegative().nullable(),
    targetCurrency: z.string().min(3).max(3).nullable(),
    watch: z.boolean(),
  })
  .partial()
  .strict();

export async function updateItem(id: string, patch: z.input<typeof itemPatch>): Promise<ItemWithSources>;
export async function updateItem(id: string, patch: z.input<typeof itemPatch>, base: Base): Promise<ItemWithSources | Conflict<ItemWithSources>>;
export async function updateItem(id: string, patch: z.input<typeof itemPatch>, base?: Base): Promise<ItemWithSources | Conflict<ItemWithSources>> {
  const s = await edit();
  const b = base === undefined ? undefined : BaseZ.parse(base);
  await s.mustGet(schema.items, Id.parse(id));
  const p = itemPatch.parse(patch);
  if (p.collectionId !== undefined) await s.ref(schema.collections, p.collectionId);
  if (p.chosenSourceId) {
    const src = await s.mustGet(schema.sources, p.chosenSourceId);
    if (src.itemId !== id) throw new Error("not_found");
  }
  // A picture set by hand is the user's (no "icon" badge any more).
  if (p.imageUrl !== undefined) (p as { imageSource?: string | null }).imageSource = null;
  if (p.imageUrl && /^https?:/.test(p.imageUrl) && !p.imageUrl.includes(".blob.vercel-storage.com")) {
    p.imageUrl = await storeThumbnail(p.imageUrl, id);
  }
  const c = await guardedUpdate(s, schema.items, id, { ...p, updatedAt: now() }, b);
  if (c) return { conflict: true, row: await mustItem(s, id), by: c.by };
  return mustItem(s, id);
}

const StatusZ = z.enum(["to_buy", "ordered", "purchased"]);
const PaidZ = z.object({ price: z.number().nonnegative(), currency: z.string().min(3).max(3) }).strict().nullable();

/** Move an item along to_buy → ordered → purchased (received). `paid` = unit price actually paid. */
export async function setStatus(id: string, status: Status, paid?: Paid): Promise<ItemWithSources>;
export async function setStatus(id: string, status: Status, paid: Paid | undefined, base: Base): Promise<ItemWithSources | Conflict<ItemWithSources>>;
export async function setStatus(id: string, status: Status, paid?: Paid, base?: Base): Promise<ItemWithSources | Conflict<ItemWithSources>> {
  const s = await edit();
  StatusZ.parse(status);
  const pd = PaidZ.parse(paid ?? null);
  const b = base === undefined ? undefined : BaseZ.parse(base);
  let from: Status | null = null;
  const c = await guardedUpdate(s, schema.items, Id.parse(id), (cur) => ((from = cur.status as Status), statusPatch(status, pd, cur)), b);
  if (c) return { conflict: true, row: await mustItem(s, id), by: c.by };
  // R17 G1: To buy → bought = checked off (shopping); On the way → received = a delivery.
  if (status === "purchased" && from === "to_buy") noteActivity({ userId: s.scope.userId, spaceId: s.scope.spaceId }, "checked_off");
  if (status === "purchased" && from === "ordered") noteActivity({ userId: s.scope.userId, spaceId: s.scope.spaceId }, "delivery_received");
  return mustItem(s, id);
}

// ---------- Bulk ----------

const bulkPatch = z
  .object({
    collectionId: NullableId,
    priority: z.enum(["urgent", "normal", "someday"]),
  })
  .partial()
  .strict();

export type BulkResult = { items: ItemWithSources[]; conflicts: Conflict<ItemWithSources>[] };
const Bases = z.record(Id, BaseZ);

/** Without `bases`: as before. With them (R16 B3): rows changed by someone else since are skipped and reported. */
export async function bulkUpdate(ids: string[], patch: z.input<typeof bulkPatch>): Promise<ItemWithSources[]>;
export async function bulkUpdate(ids: string[], patch: z.input<typeof bulkPatch>, bases: Record<string, Base>): Promise<BulkResult>;
export async function bulkUpdate(ids: string[], patch: z.input<typeof bulkPatch>, bases?: Record<string, Base>): Promise<ItemWithSources[] | BulkResult> {
  const s = await edit();
  Ids.parse(ids);
  const p = bulkPatch.parse(patch);
  if (!ids.length) return bases ? { items: [], conflicts: [] } : [];
  if (p.collectionId !== undefined) await s.ref(schema.collections, p.collectionId);
  if (!bases) {
    await s.update(schema.items, { ...p, updatedAt: now() }, inArray(schema.items.id, ids));
    return loadItems(s, ids);
  }
  return guardedEach(s, ids, Bases.parse(bases), () => ({ ...p, updatedAt: now() }));
}

/** Apply a patch item by item against each one's base; collect the conflicts. */
async function guardedEach(s: Scoped, ids: string[], bases: Record<string, Base>, patch: (cur: Item) => Record<string, unknown>): Promise<BulkResult> {
  const clashed = new Map<string, string | null>();
  for (const id of ids) {
    const c = await guardedUpdate(s, schema.items, id, patch, bases[id]).catch(() => null);
    if (c) clashed.set(id, c.by);
  }
  const all = await loadItems(s, ids);
  return { items: all.filter((i) => !clashed.has(i.id)), conflicts: all.filter((i) => clashed.has(i.id)).map((row) => ({ conflict: true as const, row, by: clashed.get(row.id) ?? null })) };
}

/** Bulk status change; each item's paid price comes from its active store (computed on the client). */
export async function bulkSetStatus(entries: { id: string; paid: Paid }[], status: Status): Promise<ItemWithSources[]>;
export async function bulkSetStatus(entries: { id: string; paid: Paid }[], status: Status, bases: Record<string, Base>): Promise<BulkResult>;
export async function bulkSetStatus(entries: { id: string; paid: Paid }[], status: Status, bases?: Record<string, Base>): Promise<ItemWithSources[] | BulkResult> {
  const s = await edit();
  StatusZ.parse(status);
  const list = z.array(z.object({ id: Id, paid: PaidZ }).strict()).max(500).parse(entries);
  const ids = list.map((e) => e.id);
  if (bases) {
    const paidOf = new Map(list.map((e) => [e.id, e.paid]));
    return guardedEach(s, ids, Bases.parse(bases), (cur) => statusPatch(status, paidOf.get(cur.id) ?? null, cur));
  }
  const current = await s.select(schema.items, inArray(schema.items.id, ids));
  for (const e of list) {
    const cur = current.find((c) => c.id === e.id);
    if (cur) await s.update(schema.items, statusPatch(status, e.paid, cur), eq(schema.items.id, e.id));
  }
  return loadItems(s, ids);
}

async function deleteItemsIn(s: Scoped, ids: string[]) {
  await s.delete(schema.sources, inArray(schema.sources.itemId, ids));
  await s.delete(schema.pricePoints, inArray(schema.pricePoints.itemId, ids));
  await s.delete(schema.attachments, inArray(schema.attachments.itemId, ids));
  await s.delete(schema.items, inArray(schema.items.id, ids));
}

export async function bulkDelete(ids: string[]): Promise<ItemWithSources[]> {
  const s = await edit();
  Ids.parse(ids);
  if (!ids.length) return [];
  const snaps = await loadItems(s, ids);
  const own = snaps.map((x) => x.id);
  if (own.length) await deleteItemsIn(s, own);
  for (const g of new Set(snaps.map((x) => x.altGroupId).filter(Boolean) as string[])) await cleanupGroup(s, g);
  return snaps;
}

export async function restoreItems(snapshots: ItemWithSources[]): Promise<ItemWithSources[]> {
  const s = await edit();
  const out: ItemWithSources[] = [];
  for (const snap of z.array(z.unknown()).max(500).parse(snapshots)) out.push(await restoreOne(s, snap));
  return out;
}

// ---------- Alternatives ----------

async function cleanupGroup(s: Scoped, groupId: string) {
  const members = await s.pick({ id: schema.items.id }, schema.items, eq(schema.items.altGroupId, groupId));
  if (members.length < 2) {
    await s.update(schema.items, { altGroupId: null }, eq(schema.items.altGroupId, groupId));
    await s.delete(schema.altGroups, eq(schema.altGroups.id, groupId));
    return null;
  }
  const g = await s.byId(schema.altGroups, groupId);
  if (g?.chosenItemId && !members.some((m) => m.id === g.chosenItemId)) {
    await s.update(schema.altGroups, { chosenItemId: null }, eq(schema.altGroups.id, groupId));
  }
  return s.byId(schema.altGroups, groupId);
}

type AltState = { items: ItemWithSources[]; altGroups: AltGroup[] };
async function altState(s: Scoped): Promise<AltState> {
  const [items, altGroups] = await Promise.all([loadItems(s), s.select(schema.altGroups)]);
  return { items, altGroups };
}

export async function createAltGroup(itemIds: string[], name: string): Promise<AltState & { groupId: string }> {
  const s = await edit();
  const ids = z.array(Id).min(2).max(20).parse(itemIds);
  const clean = z.string().min(1).max(80).parse(String(name).trim());
  const previous = await s.pick({ id: schema.items.id, g: schema.items.altGroupId }, schema.items, inArray(schema.items.id, ids));
  if (previous.length !== new Set(ids).size) throw new Error("not_found");
  const id = nanoid(10);
  await s.insert(schema.altGroups, { id, name: clean, createdAt: now() });
  await s.update(schema.items, { altGroupId: id, updatedAt: now() }, inArray(schema.items.id, ids));
  for (const p of previous) if (p.g) await cleanupGroup(s, p.g);
  return { ...(await altState(s)), groupId: id };
}

export async function updateAltGroup(id: string, patch: { name?: string; chosenItemId?: string | null }): Promise<AltGroup>;
export async function updateAltGroup(id: string, patch: { name?: string; chosenItemId?: string | null }, base: Base): Promise<AltGroup | Conflict<AltGroup>>;
export async function updateAltGroup(id: string, patch: { name?: string; chosenItemId?: string | null }, base?: Base): Promise<AltGroup | Conflict<AltGroup>> {
  const s = await edit();
  await s.mustGet(schema.altGroups, Id.parse(id));
  const p = z.object({ name: z.string().min(1).max(80).optional(), chosenItemId: NullableId.optional() }).strict().parse(patch);
  if (p.chosenItemId) {
    const it = await s.mustGet(schema.items, p.chosenItemId);
    if (it.altGroupId !== id) throw new Error("not_found");
  }
  const c = await guardedUpdate(s, schema.altGroups, id, p, base === undefined ? undefined : BaseZ.parse(base));
  if (c) return { conflict: true, row: (await s.byId(schema.altGroups, id))!, by: c.by };
  return (await s.byId(schema.altGroups, id))!;
}

/** Take one item out of its group (the group dissolves when fewer than two remain). */
export async function leaveAltGroup(itemId: string): Promise<AltState> {
  const s = await edit();
  const item = await s.mustGet(schema.items, Id.parse(itemId));
  if (item.altGroupId) {
    await s.update(schema.items, { altGroupId: null }, eq(schema.items.id, itemId));
    await cleanupGroup(s, item.altGroupId);
  }
  return altState(s);
}

// ---------- Receipts ----------

/** Files this space may attach: uploaded by the blob route under spaces/<spaceId>/ (or older receipts/ files it already owns). */
function blobUrlZ(s: Scoped) {
  return z
    .string()
    .url()
    .refine((u) => {
      try {
        const url = new URL(u);
        return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com") && url.pathname.startsWith(`/spaces/${s.spaceId}/`);
      } catch {
        return false;
      }
    });
}

export async function addAttachment(itemId: string, file: { url: string; name: string; contentType?: string | null; size?: number | null }): Promise<ItemWithSources> {
  const s = await edit();
  await s.mustGet(schema.items, Id.parse(itemId));
  const f = z.object({ url: blobUrlZ(s), name: z.string().min(1).max(200), contentType: z.string().max(100).nullish(), size: z.number().int().nonnegative().nullish() }).strict().parse(file);
  await s.insert(schema.attachments, { id: nanoid(12), itemId, url: f.url, name: f.name, contentType: f.contentType ?? null, size: f.size ?? null, createdAt: now() });
  return mustItem(s, itemId);
}

export async function deleteAttachment(id: string): Promise<ItemWithSources> {
  const s = await edit();
  const row = await s.mustGet(schema.attachments, Id.parse(id));
  await s.delete(schema.attachments, eq(schema.attachments.id, id));
  // A receipt read from a document is attached to every item it paid for: keep the file while anything uses it.
  const [att, rec] = await Promise.all([
    s.pick({ id: schema.attachments.id }, schema.attachments, eq(schema.attachments.url, row.url)).limit(1),
    s.pick({ id: schema.receipts.id }, schema.receipts, eq(schema.receipts.url, row.url)).limit(1),
  ]);
  if (!att.length && !rec.length) {
    try {
      await del(row.url);
    } catch {
      /* file may already be gone */
    }
  }
  return mustItem(s, row.itemId);
}

export async function deleteItem(id: string): Promise<ItemWithSources | null> {
  const s = await edit();
  const snapshot = await getItem(s, Id.parse(id));
  if (!snapshot) throw new Error("not_found");
  await deleteItemsIn(s, [id]);
  if (snapshot.altGroupId) await cleanupGroup(s, snapshot.altGroupId);
  return snapshot;
}

// Undo snapshots come back from the client: only known columns, children re-pointed at the restored item.
const snapItem = z
  .object({
    id: Id,
    collectionId: NullableId,
    title: z.string().min(1).max(300),
    fullTitle: z.string().max(500).nullable().optional(),
    brand: z.string().max(120).nullable(),
    imageUrl: z.string().max(400_000).nullable(),
    category: z.string().max(40).nullable(),
    tags: z.array(z.string().max(40)).max(12),
    status: StatusZ,
    priority: z.enum(["urgent", "normal", "someday"]),
    quantity: z.number().int().min(1).max(100000),
    notes: z.string().max(4000).nullable(),
    chosenSourceId: NullableId,
    orderedAt: z.number().nullable(),
    purchasedAt: z.number().nullable(),
    purchasedPrice: z.number().nullable(),
    purchasedCurrency: z.string().max(3).nullable(),
    trackingNumber: z.string().max(80).nullable(),
    carrier: z.string().max(40).nullable(),
    eta: z.number().nullable(),
    orderNumber: z.string().max(80).nullable(),
    gtin: z.string().max(20).nullable(),
    altGroupId: NullableId,
    imageSource: z.string().max(20).nullable(),
    productInfo: z.unknown().nullable(),
    imageCandidates: z.unknown().nullable(),
    imageCheck: z.boolean(),
    targetPrice: z.number().nullable(),
    targetCurrency: z.string().max(3).nullable(),
    watch: z.boolean(),
    searchQuery: z.string().max(300).nullable(),
    addedByUserId: z.string().max(64).nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .partial()
  .required({ id: true, title: true });
const snapSource = z.object({ id: Id, url: z.string().max(4000), normalizedUrl: z.string().max(4000), store: z.string().max(80), storeKey: z.string().max(120), price: z.number().nullable(), currency: z.string().max(3), shipping: z.number().nullable(), availability: z.string().max(80).nullable(), rawTitle: z.string().max(500).nullable(), extractMethod: z.string().max(60).nullable(), gtin: z.string().max(20).nullable().optional(), fetchedAt: z.number().nullable(), checkFails: z.number().int().optional(), createdAt: z.number() }).partial().required({ id: true, url: true, normalizedUrl: true, store: true, storeKey: true });
const snapPoint = z.object({ id: Id, sourceId: Id, price: z.number(), currency: z.string().max(3), recordedAt: z.number() });
const snapAttachment = z.object({ id: Id, url: z.string().max(2000), name: z.string().max(200), contentType: z.string().max(100).nullable(), size: z.number().nullable(), createdAt: z.number() }).partial().required({ id: true, url: true, name: true });

async function restoreOne(s: Scoped, raw: unknown): Promise<ItemWithSources> {
  const snap = raw as Record<string, unknown>;
  const item = snapItem.parse(Object.fromEntries(Object.entries(snap).filter(([k]) => k in snapItem.shape)));
  const sources = z.array(snapSource).max(50).parse((snap.sources as unknown[] | undefined)?.map((x) => pickKeys(x, snapSource.shape)) ?? []);
  const points = z.array(snapPoint).max(2000).parse((snap.points as unknown[] | undefined)?.map((x) => pickKeys(x, snapPoint.shape)) ?? []);
  const blob = blobUrlZ(s);
  const attachments = z.array(snapAttachment).max(50).parse((snap.attachments as unknown[] | undefined)?.map((x) => pickKeys(x, snapAttachment.shape)) ?? []).filter((a) => blob.safeParse(a.url).success);
  if (item.collectionId && !(await s.byId(schema.collections, item.collectionId))) item.collectionId = null;
  if (item.altGroupId && !(await s.byId(schema.altGroups, item.altGroupId))) item.altGroupId = null;
  const srcIds = new Set(sources.map((x) => x.id));
  if (item.chosenSourceId && !srcIds.has(item.chosenSourceId)) item.chosenSourceId = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await s.insert(schema.items, item as any).onConflictDoNothing();
  // A snapshot can only restore into this space: if the id is taken elsewhere nothing was written and we stop here.
  const restored = await s.byId(schema.items, item.id);
  if (!restored) throw new Error("not_found");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (sources.length) await s.insert(schema.sources, sources.map((x) => ({ ...x, itemId: item.id })) as any).onConflictDoNothing();
  const pts = points.filter((p) => srcIds.has(p.sourceId));
  if (pts.length) await s.insert(schema.pricePoints, pts.map((p) => ({ ...p, itemId: item.id }))).onConflictDoNothing();
  if (attachments.length) await s.insert(schema.attachments, attachments.map((a) => ({ ...a, itemId: item.id }))).onConflictDoNothing();
  return mustItem(s, item.id);
}

function pickKeys(x: unknown, shape: Record<string, unknown>) {
  return x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k in shape)) : x;
}

export async function restoreItem(snapshot: ItemWithSources): Promise<ItemWithSources> {
  const s = await edit();
  return restoreOne(s, snapshot);
}

// ---------- Sources ----------

const sourcePatch = z
  .object({
    price: z.number().nonnegative().nullable(),
    currency: z.string().min(3).max(3),
    shipping: z.number().nonnegative().nullable(),
    store: z.string().min(1).max(80),
  })
  .partial()
  .strict();

export async function updateSource(id: string, patch: z.input<typeof sourcePatch>): Promise<ItemWithSources>;
export async function updateSource(id: string, patch: z.input<typeof sourcePatch>, base: Base): Promise<ItemWithSources | Conflict<ItemWithSources>>;
export async function updateSource(id: string, patch: z.input<typeof sourcePatch>, base?: Base): Promise<ItemWithSources | Conflict<ItemWithSources>> {
  const s = await edit();
  const src = await s.mustGet(schema.sources, Id.parse(id));
  const p = sourcePatch.parse(patch);
  const c = await guardedUpdate(s, schema.sources, id, p, base === undefined ? undefined : BaseZ.parse(base));
  if (c) return { conflict: true, row: await mustItem(s, src.itemId), by: c.by };
  const row = (await s.byId(schema.sources, id))!;
  if (p.price !== undefined || p.currency !== undefined) await recordPrice(s, row.id, row.itemId, row.price, row.currency);
  return mustItem(s, row.itemId);
}

export async function deleteSource(id: string): Promise<ItemWithSources> {
  const s = await edit();
  const row = await s.mustGet(schema.sources, Id.parse(id));
  await s.delete(schema.sources, eq(schema.sources.id, id));
  await s.update(schema.items, { chosenSourceId: null }, and(eq(schema.items.id, row.itemId), eq(schema.items.chosenSourceId, id)));
  return mustItem(s, row.itemId);
}

export async function refetchSource(id: string, payload?: ClientPayload | null): Promise<ItemWithSources> {
  const s = await edit();
  return refreshSourceCore(s, Id.parse(id), payload ? clientPayload.parse(payload) : null);
}

// ---------- Collections ----------

const collectionInput = z
  .object({
    kind: z.enum(["project", "list"]),
    name: z.string().min(1).max(80),
    description: z.string().max(500).nullable().optional(),
    color: z.string().max(20).optional(),
    budget: z.number().nonnegative().nullable().optional(),
    budgetCurrency: z.string().min(3).max(3).optional(),
  })
  .strict();

export async function createCollection(input: z.input<typeof collectionInput>): Promise<Collection> {
  const s = await edit();
  const c = collectionInput.parse(input);
  const id = nanoid(10);
  await s.insert(schema.collections, { id, ...c, description: c.description ?? null, budget: c.budget ?? null, sortOrder: now() % 1e9 });
  return (await s.byId(schema.collections, id))!;
}

export async function updateCollection(id: string, patch: Partial<z.input<typeof collectionInput>> & { archived?: boolean }): Promise<Collection>;
export async function updateCollection(id: string, patch: Partial<z.input<typeof collectionInput>> & { archived?: boolean }, base: Base): Promise<Collection | Conflict<Collection>>;
export async function updateCollection(id: string, patch: Partial<z.input<typeof collectionInput>> & { archived?: boolean }, base?: Base): Promise<Collection | Conflict<Collection>> {
  const s = await edit();
  await s.mustGet(schema.collections, Id.parse(id));
  const p = collectionInput.partial().extend({ archived: z.boolean().optional() }).strict().parse(patch);
  const c = await guardedUpdate(s, schema.collections, id, p, base === undefined ? undefined : BaseZ.parse(base));
  if (c) return { conflict: true, row: (await s.byId(schema.collections, id))!, by: c.by };
  return (await s.byId(schema.collections, id))!;
}

export async function deleteCollection(id: string) {
  const s = await edit();
  await s.mustGet(schema.collections, Id.parse(id));
  await s.update(schema.items, { collectionId: null }, eq(schema.items.collectionId, id));
  await s.delete(schema.collections, eq(schema.collections.id, id));
}

export async function setSharing(id: string, on: boolean): Promise<Collection> {
  const s = await edit();
  await s.mustGet(schema.collections, Id.parse(id));
  await s.update(schema.collections, { shareToken: z.boolean().parse(on) ? nanoid(24) : null }, eq(schema.collections.id, id));
  return (await s.byId(schema.collections, id))!;
}

export async function moveItems(ids: string[], collectionId: string | null) {
  const s = await edit();
  Ids.parse(ids);
  if (!ids.length) return;
  await s.ref(schema.collections, NullableId.parse(collectionId));
  await s.update(schema.items, { collectionId, updatedAt: now() }, inArray(schema.items.id, ids));
}

/**
 * Move some units of an item to another project/list. Moving every unit just moves the item; moving fewer
 * splits it: a copy with `count` units (same store links and price history) goes to the target, the rest stay.
 */
export async function splitItem(id: string, count: number, collectionId: string | null): Promise<{ original: ItemWithSources; moved: ItemWithSources }> {
  const s = await edit();
  const n = z.number().int().min(1).parse(count);
  await s.ref(schema.collections, NullableId.parse(collectionId));
  const cur = await mustItem(s, Id.parse(id));
  const t = now();
  if (n >= cur.quantity) {
    await s.update(schema.items, { collectionId, updatedAt: t }, eq(schema.items.id, id));
    const it = await mustItem(s, id);
    return { original: it, moved: it };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sources, points, attachments: _receipts, spaceId: _space, ...item } = cur; // receipts stay with the original line
  const newId = nanoid();
  const srcIds = new Map(sources.map((x) => [x.id, nanoid()]));
  await s.insert(schema.items, {
    ...item,
    id: newId,
    collectionId,
    quantity: n,
    altGroupId: null,
    chosenSourceId: item.chosenSourceId ? (srcIds.get(item.chosenSourceId) ?? null) : null,
    createdAt: t,
    updatedAt: t,
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  if (sources.length) await s.insert(schema.sources, sources.map(({ spaceId: _s, ...x }) => ({ ...x, id: srcIds.get(x.id)!, itemId: newId })));
  const pts = (points ?? []).filter((p) => srcIds.has(p.sourceId));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  if (pts.length) await s.insert(schema.pricePoints, pts.map(({ spaceId: _s, ...p }) => ({ ...p, id: nanoid(), itemId: newId, sourceId: srcIds.get(p.sourceId)! })));
  await s.update(schema.items, { quantity: cur.quantity - n, updatedAt: t }, eq(schema.items.id, id));
  return { original: await mustItem(s, id), moved: await mustItem(s, newId) };
}

/** Undo a split: fold the moved units back into the original line. */
export async function unsplitItem(originalId: string, movedId: string): Promise<ItemWithSources> {
  const s = await edit();
  if (Id.parse(originalId) === Id.parse(movedId)) throw new Error("same_item");
  const [orig, moved] = await Promise.all([mustItem(s, originalId), mustItem(s, movedId)]);
  await s.delete(schema.pricePoints, eq(schema.pricePoints.itemId, movedId));
  await s.delete(schema.sources, eq(schema.sources.itemId, movedId));
  await s.delete(schema.items, eq(schema.items.id, movedId));
  await s.update(schema.items, { quantity: orig.quantity + moved.quantity, updatedAt: now() }, eq(schema.items.id, originalId));
  return mustItem(s, originalId);
}

export async function reloadAll(): Promise<ItemWithSources[]> {
  const s = await view();
  return loadItems(s);
}
