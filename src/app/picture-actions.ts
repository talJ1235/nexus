"use server";

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { allows, requireCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
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
  await requireCtx("view");
  const { names } = z.object({ names: z.array(z.string().min(1).max(300)).max(60) }).parse(input);
  return understandLines(names);
}

/** D2 + D3 for a few lines (the review calls this in chunks; nothing is saved). */
export async function findLinePictures(input: { infos: LineInfo[] }): Promise<LinePicture[]> {
  const s = scoped(await requireCtx("view"));
  const { infos } = z.object({ infos: z.array(info).max(8) }).parse(input);
  const cands = await Promise.all(infos.map((i) => findCandidates(i, { s }).catch((): Candidate[] => [])));
  return rankCandidates(infos.map((i, k) => ({ info: i, candidates: cands[k] })));
}

/** The picker's search box (Hebrew or English). */
export async function searchPictures(input: { query: string }): Promise<Candidate[]> {
  await requireCtx("view");
  const { query } = z.object({ query: z.string().trim().min(1).max(200) }).parse(input);
  return searchCandidates(query);
}

/** "Use an icon": a few Fluent Emoji for the product's keyword. */
export async function pictureIcons(input: { keyword: string }): Promise<Candidate[]> {
  await requireCtx("view");
  const { keyword } = z.object({ keyword: z.string().trim().min(1).max(40) }).parse(input);
  const got = await iconsForKeyword(keyword, 4);
  return got.length ? got : iconsForKeyword("package", 2);
}

/** Alternatives for an item's picker: the stored ones, else a fresh search (stored for next time). */
export async function itemPictureChoices(input: { itemId: string }): Promise<Candidate[]> {
  const ctx = await requireCtx("view");
  const s = scoped(ctx);
  const { itemId } = z.object({ itemId: z.string().min(1).max(40) }).parse(input);
  const item = await s.byId(schema.items, itemId);
  if (!item) return [];
  if (item.imageCandidates?.length) return item.imageCandidates;
  const [r] = await picturesFor([{ name: item.title, info: item.productInfo, excludeId: item.id }], 20_000, s);
  if (!r) return [];
  // Kept on the item for next time — only by someone who may edit this space (a viewer just gets the list).
  if (allows(ctx.role, "edit")) await s.update(schema.items, { imageCandidates: r.ranked.candidates, productInfo: r.info }, eq(schema.items.id, itemId));
  return r.ranked.candidates;
}

/**
 * The owner's choice for an item: a candidate (kept as an alternative), their own photo/upload (a data URL, made a
 * 480 px WebP), or no picture (`url: null`). Always approved.
 */
export async function setItemPicture(input: { itemId: string; url: string | null; source?: Candidate["source"] | "photo" }): Promise<ItemWithSources | null> {
  const s = scoped(await requireCtx("edit"));
  const p = z.object({ itemId: z.string().min(1).max(40), url: z.string().max(400_000).nullable(), source: z.enum(["barcode", "own", "search", "off", "generic", "icon", "photo"]).optional() }).strict().parse(input);
  const item = await s.byId(schema.items, p.itemId);
  if (!item) return null;
  if (p.url == null) {
    await s.update(schema.items, { imageUrl: null, imageSource: null, imageCheck: false, updatedAt: Date.now() }, eq(schema.items.id, item.id));
  } else if (p.source === "photo" || !p.source) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(p.url)) throw new Error("invalid photo");
    // Blob when configured; locally (no Blob token) the client already shrank it to ~480 px, so keep it as is.
    const url = (await storeThumbnail(p.url, item.id)) ?? (p.url.length <= 160_000 ? p.url : null);
    await s.update(schema.items, { imageUrl: url, imageSource: null, imageCheck: false, updatedAt: Date.now() }, eq(schema.items.id, item.id));
  } else {
    if (!/^https:\/\//.test(p.url) && !p.url.startsWith("data:image/svg+xml;base64,")) throw new Error("invalid picture");
    const chosen: Candidate = { url: p.url, source: p.source };
    const rest = (item.imageCandidates ?? []).filter((c) => c.url !== p.url);
    await savePictureChoice(s, item.id, { chosen, candidates: [chosen, ...rest].slice(0, 6), check: false });
  }
  return getItem(s, item.id);
}

/** "Pictures look right": clear the check mark. */
export async function approvePictures(input: { itemIds: string[] }): Promise<void> {
  const s = scoped(await requireCtx("edit"));
  const { itemIds } = z.object({ itemIds: z.array(z.string().min(1).max(40)).max(200) }).parse(input);
  if (itemIds.length) await s.update(schema.items, { imageCheck: false }, inArray(schema.items.id, itemIds));
}

/** Settings: whether Google image search is configured (better pictures). */
export async function pictureSearchStatus(): Promise<{ search: boolean }> {
  await requireCtx("view");
  return { search: !!searchProvider() };
}

