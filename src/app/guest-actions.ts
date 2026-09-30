"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { activeSource } from "@/lib/calc";
import { getItem } from "@/lib/data";
import { extractFromUrl } from "@/lib/extract";
import { getGuestData, guestItem, requireGuest, roleFor, type GuestData } from "@/lib/guest";
import { getRates } from "@/lib/rates";
import { buildDraft, createItemCore, missingDetails, refreshSourceCore } from "@/lib/service";
import { normalizeUrl } from "@/lib/stores";
import type { ItemWithSources } from "@/lib/types";
import { isHttpUrl } from "@/lib/utils";

// Every action re-loads the guest from the DB (signature + revocation + grants) and checks the
// specific item/collection. Guests never see receipts or anything outside their granted collections.

const strip = (i: ItemWithSources): ItemWithSources => ({ ...i, attachments: [] });

export async function guestReload(): Promise<GuestData> {
  return getGuestData(await requireGuest());
}

export async function guestAddItem(url: string, collectionId: string): Promise<{ item: ItemWithSources; existed: boolean }> {
  const g = await requireGuest();
  if (roleFor(g, collectionId) !== "editor") throw new Error("forbidden");
  const clean = z.string().max(2000).parse(url).trim();
  if (!isHttpUrl(clean)) throw new Error("invalid_url");

  // Duplicate check ONLY inside the shared collection — never reveal items from elsewhere.
  const same = await db
    .select({ itemId: schema.sources.itemId })
    .from(schema.sources)
    .innerJoin(schema.items, eq(schema.items.id, schema.sources.itemId))
    .where(and(eq(schema.sources.normalizedUrl, normalizeUrl(clean)), eq(schema.items.collectionId, collectionId)))
    .limit(1);
  if (same[0]) return { item: strip((await getItem(same[0].itemId))!), existed: true };

  const draft = await buildDraft(await extractFromUrl(clean), collectionId, clean);
  const created = await createItemCore({ ...draft, collectionId });
  await db.update(schema.items).set({ addedByMemberId: g.member.id, addedByName: g.member.name }).where(eq(schema.items.id, created.id));
  return { item: strip((await getItem(created.id))!), existed: false };
}

/**
 * Self-heal for a link the guest just added: if its name/price/picture didn't come through on the first
 * read (store blocked us, AI busy), try again a moment later. Called automatically by the guest page.
 * Only for the guest's own recent additions, and at most once every 15s per link.
 */
export async function guestRepairItem(itemId: string): Promise<ItemWithSources> {
  const g = await requireGuest();
  const item = await guestItem(g, z.string().max(40).parse(itemId), "edit");
  const full = (await getItem(item.id))!;
  const src = full.sources.find((s) => s.url);
  const recent = Date.now() - full.createdAt < 3600_000;
  if (!src || item.addedByMemberId !== g.member.id || !recent || !missingDetails(src, full) || (src.fetchedAt && Date.now() - src.fetchedAt < 15_000)) return strip(full);
  return strip(await refreshSourceCore(src.id));
}

const patch = z
  .object({
    quantity: z.number().int().min(1).max(100000),
    notes: z.string().max(4000).nullable(),
    priority: z.enum(["urgent", "normal", "someday"]),
  })
  .partial()
  .strict();

export async function guestUpdateItem(itemId: string, p: z.input<typeof patch>): Promise<ItemWithSources> {
  const g = await requireGuest();
  await guestItem(g, itemId, "edit");
  await db.update(schema.items).set({ ...patch.parse(p), updatedAt: Date.now() }).where(eq(schema.items.id, itemId));
  return strip((await getItem(itemId))!);
}

export async function guestSetStatus(itemId: string, status: "to_buy" | "ordered" | "purchased"): Promise<ItemWithSources> {
  const g = await requireGuest();
  z.enum(["to_buy", "ordered", "purchased"]).parse(status);
  await guestItem(g, itemId, "edit");
  const item = (await getItem(itemId))!;
  const t = Date.now();
  if (status === "to_buy") {
    await db.update(schema.items).set({ status, orderedAt: null, purchasedAt: null, purchasedPrice: null, purchasedCurrency: null, updatedAt: t }).where(eq(schema.items.id, itemId));
  } else {
    const src = activeSource(item, await getRates());
    const paid = item.purchasedPrice == null && src?.price != null ? { purchasedPrice: src.price + (src.shipping ?? 0), purchasedCurrency: src.currency } : {};
    await db
      .update(schema.items)
      .set(status === "ordered" ? { status, orderedAt: t, purchasedAt: null, ...paid, updatedAt: t } : { status, orderedAt: item.orderedAt, purchasedAt: t, ...paid, updatedAt: t })
      .where(eq(schema.items.id, itemId));
  }
  return strip((await getItem(itemId))!);
}

/** Editors may delete only items they added themselves. */
export async function guestDeleteItem(itemId: string): Promise<void> {
  const g = await requireGuest();
  const item = await guestItem(g, itemId, "edit");
  if (item.addedByMemberId !== g.member.id) throw new Error("forbidden");
  await db.delete(schema.pricePoints).where(eq(schema.pricePoints.itemId, itemId));
  await db.delete(schema.sources).where(eq(schema.sources.itemId, itemId));
  await db.delete(schema.items).where(eq(schema.items.id, itemId));
}
