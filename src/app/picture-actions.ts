"use server";

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
import { getItem } from "@/lib/data";
import { storeThumbnail } from "@/lib/images";
import { savePictureChoice } from "@/lib/product-image";
import { findCandidates, iconsForKeyword, picturesFor, rankCandidates, searchCandidates, understandLines } from "@/lib/product-pictures";
import type { LineInfo } from "@/lib/product-lines";
import type { Candidate } from "@/lib/picture-rank";
import { searchProvider } from "@/lib/search";
import type { ItemWithSources } from "@/lib/types";

// Product pictures (Round 10 D): the receipt review asks D1 once for all lines, then D2+D3 a few lines at a time so
// pictures appear as they're found; the picker searches, offers icons, and saves the choice on an item.

const info = z.object({
  raw: z.string().max(300),
  nameHe: z.string().max(300),
  nameEn: z.string().max(300),
  brand: z.string().max(100).nullable(),
  type: z.string().max(100),
  typeHe: z.string().max(100).nullable(),
  size: z.string().max(60).nullable(),
  queryHe: z.string().max(300),
  queryEn: z.string().max(300),
  iconKeyword: z.string().max(40),
  barcode: z.string().max(20).nullable(),
});
export type LinePicture = { chosen: Candidate | null; candidates: Candidate[]; check: boolean };

/** D1 for a receipt: one call for all lines. */
export async function understandReceiptLines(input: { names: string[] }): Promise<LineInfo[]> {
  await assertOwner();
  const { names } = z.object({ names: z.array(z.string().min(1).max(300)).max(60) }).parse(input);
  return understandLines(names);
}

/** D2 + D3 for a few lines (the review calls this in chunks; nothing is saved). */
export async function findLinePictures(input: { infos: LineInfo[] }): Promise<LinePicture[]> {
  await assertOwner();
  const { infos } = z.object({ infos: z.array(info).max(8) }).parse(input);
  const cands = await Promise.all(infos.map((i) => findCandidates(i).catch((): Candidate[] => [])));
  return rankCandidates(infos.map((i, k) => ({ info: i, candidates: cands[k] })));
}

/** The picker's search box (Hebrew or English). */
export async function searchPictures(input: { query: string }): Promise<Candidate[]> {
  await assertOwner();
  const { query } = z.object({ query: z.string().trim().min(1).max(200) }).parse(input);
  return searchCandidates(query);
}

/** "Use an icon": a few Fluent Emoji for the product's keyword. */
export async function pictureIcons(input: { keyword: string }): Promise<Candidate[]> {
  await assertOwner();
  const { keyword } = z.object({ keyword: z.string().trim().min(1).max(40) }).parse(input);
  const got = await iconsForKeyword(keyword, 4);
  return got.length ? got : iconsForKeyword("package", 2);
}

/** Alternatives for an item's picker: the stored ones, else a fresh search (stored for next time). */
export async function itemPictureChoices(input: { itemId: string }): Promise<Candidate[]> {
  await assertOwner();
  const { itemId } = z.object({ itemId: z.string().min(1).max(40) }).parse(input);
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  if (!item) return [];
  if (item.imageCandidates?.length) return item.imageCandidates;
  const [r] = await picturesFor([{ name: item.title, info: item.productInfo, excludeId: item.id }], 20_000);
  if (!r) return [];
  await db.update(schema.items).set({ imageCandidates: r.ranked.candidates, productInfo: r.info }).where(eq(schema.items.id, itemId));
  return r.ranked.candidates;
}

/**
 * The owner's choice for an item: a candidate (kept as an alternative), their own photo/upload (a data URL, made a
 * 480 px WebP), or no picture (`url: null`). Always approved.
 */
export async function setItemPicture(input: { itemId: string; url: string | null; source?: Candidate["source"] | "photo" }): Promise<ItemWithSources | null> {
  await assertOwner();
  const p = z.object({ itemId: z.string().min(1).max(40), url: z.string().max(400_000).nullable(), source: z.enum(["barcode", "own", "search", "off", "generic", "icon", "photo"]).optional() }).parse(input);
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, p.itemId) });
  if (!item) return null;
  if (p.url == null) {
    await db.update(schema.items).set({ imageUrl: null, imageSource: null, imageCheck: false, updatedAt: Date.now() }).where(eq(schema.items.id, item.id));
  } else if (p.source === "photo" || !p.source) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(p.url)) throw new Error("invalid photo");
    // Blob when configured; locally (no Blob token) the client already shrank it to ~480 px, so keep it as is.
    const url = (await storeThumbnail(p.url, item.id)) ?? (p.url.length <= 160_000 ? p.url : null);
    await db.update(schema.items).set({ imageUrl: url, imageSource: null, imageCheck: false, updatedAt: Date.now() }).where(eq(schema.items.id, item.id));
  } else {
    if (!/^https:\/\//.test(p.url) && !p.url.startsWith("data:image/svg+xml;base64,")) throw new Error("invalid picture");
    const chosen: Candidate = { url: p.url, source: p.source };
    const rest = (item.imageCandidates ?? []).filter((c) => c.url !== p.url);
    await savePictureChoice(item.id, { chosen, candidates: [chosen, ...rest].slice(0, 6), check: false });
  }
  return getItem(item.id);
}

/** "Pictures look right": clear the check mark. */
export async function approvePictures(input: { itemIds: string[] }): Promise<void> {
  await assertOwner();
  const { itemIds } = z.object({ itemIds: z.array(z.string().min(1).max(40)).max(200) }).parse(input);
  if (itemIds.length) await db.update(schema.items).set({ imageCheck: false }).where(inArray(schema.items.id, itemIds));
}

/** Settings: whether Google image search is configured (better pictures). */
export async function pictureSearchStatus(): Promise<{ search: boolean }> {
  await assertOwner();
  return { search: !!searchProvider() };
}

