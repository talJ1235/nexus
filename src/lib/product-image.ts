import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { extractFromUrl } from "./extract";
import { storeThumbnail } from "./images";
import { kvGet, kvSet } from "./kv";
import { storedSource, type Candidate } from "./picture-rank";
import { picturesFor } from "./product-pictures";
import type { LineInfo } from "./product-lines";

// Product pictures for items that have none (Round 7 E4, Round 10 D), used by receipts, barcode adds, manual items and
// a daily backfill. A store link's own picture first, else product-pictures.ts (understand → barcode / own items /
// Google / Open Food Facts / generic / icon → one vision pick); the owner's extension may still find a real photo in
// the background, but nothing waits for it. Never blocks the user: callers show a shimmer and fill it in later.

export type ImageSource = "store" | "search" | "extension" | "icon" | "barcode" | "generic";
export type FoundImage = { url: string; source: ImageSource };
type Query = { title: string; urls?: string[] };

const JOBS = "image-jobs";
export type ImageJob = { itemId: string; title: string; store: string | null; storeUrl: string | null; at: number };

async function fromStorePages(q: Query): Promise<FoundImage | null> {
  for (const url of (q.urls ?? []).filter((u) => /^https?:/.test(u)).slice(0, 2)) {
    const ex = await extractFromUrl(url).catch(() => null);
    if (ex?.image) return { url: ex.image, source: "store" };
  }
  return null;
}




async function saveImage(itemId: string, found: FoundImage) {
  // Icons stay SVG data URLs (tiny, sharp at any size); photos become a 480 px WebP in Blob.
  const url = found.source === "icon" || found.url.includes(".blob.vercel-storage.com") ? found.url : ((await storeThumbnail(found.url, itemId)) ?? found.url);
  await db.update(schema.items).set({ imageUrl: url, imageSource: found.source, imageCheck: false, updatedAt: Date.now() }).where(eq(schema.items.id, itemId));
}

export async function enqueueImageJob(job: Omit<ImageJob, "at">) {
  const jobs = await listImageJobs();
  if (jobs.some((j) => j.itemId === job.itemId)) return;
  await kvSet(JOBS, JSON.stringify([...jobs, { ...job, at: Date.now() }].slice(-40)));
}

export async function listImageJobs(): Promise<ImageJob[]> {
  const raw = await kvGet(JOBS).catch(() => null);
  const jobs = raw ? (JSON.parse(raw) as ImageJob[]) : [];
  return jobs.filter((j) => Date.now() - j.at < 7 * 86400_000);
}

export async function dropImageJob(itemId: string) {
  const jobs = await listImageJobs();
  await kvSet(JOBS, JSON.stringify(jobs.filter((j) => j.itemId !== itemId)));
}

/**
 * Save Nexus's choice on an item: the picture (photos become a 480 px WebP in Blob, icons stay SVG data URLs), where
 * it came from, the ranked alternatives for the picker, what the product is, and whether it still wants a look.
 */
export async function savePictureChoice(itemId: string, r: { chosen: Candidate | null; candidates: Candidate[]; check: boolean }, info?: LineInfo | null) {
  const set: Partial<typeof schema.items.$inferInsert> = { imageCandidates: r.candidates, updatedAt: Date.now() };
  if (info) set.productInfo = info;
  if (r.chosen) {
    const url = r.chosen.url.startsWith("data:image/svg") || r.chosen.url.includes(".blob.vercel-storage.com") ? r.chosen.url : ((await storeThumbnail(r.chosen.url, itemId)) ?? r.chosen.url);
    Object.assign(set, { imageUrl: url, imageSource: storedSource(r.chosen), imageCheck: r.check });
  }
  await db.update(schema.items).set(set).where(eq(schema.items.id, itemId));
}

/** Give an image-less item a picture now (barcode adds, manual items, receipt items added before their picture). */
export async function ensureItemImage(itemId: string, opts: { check?: boolean } = {}): Promise<boolean> {
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  if (!item || (item.imageUrl && item.imageSource !== "icon")) return false;
  const sources = await db.select({ url: schema.sources.url, store: schema.sources.store }).from(schema.sources).where(eq(schema.sources.itemId, itemId));
  const urls = sources.map((s) => s.url).filter((u) => !u.startsWith("manual:"));
  // A store link's own picture is the product itself.
  const page = await fromStorePages({ title: item.title, urls }).catch(() => null);
  if (page) {
    await saveImage(item.id, page);
    await dropImageJob(item.id).catch(() => {});
    return true;
  }
  const [r] = await picturesFor([{ name: item.title, info: item.productInfo, excludeId: item.id }], 20_000);
  const chosen = r?.ranked.chosen;
  if (!chosen || (item.imageSource === "icon" && chosen.source === "icon")) {
    await enqueueImageJob({ itemId: item.id, title: item.title, store: sources[0]?.store ?? null, storeUrl: urls[0] ?? null }).catch(() => {});
    return false;
  }
  await savePictureChoice(item.id, { ...r.ranked, check: opts.check ?? r.ranked.check }, r.info);
  // Only an icon or a generic picture: the owner's extension may still find the real one in the background.
  if (chosen.source === "icon" || chosen.source === "generic") await enqueueImageJob({ itemId: item.id, title: item.title, store: sources[0]?.store ?? null, storeUrl: urls[0] ?? null }).catch(() => {});
  else await dropImageJob(item.id).catch(() => {});
  return true;
}

/** The extension found a photo: replace nothing but an icon or an empty picture. */
export async function acceptExtensionImage(itemId: string, imageUrl: string) {
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  await dropImageJob(itemId);
  if (!item || (item.imageUrl && item.imageSource !== "icon")) return false;
  await saveImage(itemId, { url: imageUrl, source: "extension" });
  return true;
}

/**
 * Daily cron step (Round 10 D4): items without a picture (or with only an icon) go through D1–D3 together — one
 * understanding call, one vision call — bounded by count and time. Their best guess is marked "check" until the
 * owner approves or changes it.
 */
export async function backfillImages(budgetMs = 12_000, max = 4) {
  const rows = await db
    .select({ id: schema.items.id, title: schema.items.title, info: schema.items.productInfo })
    .from(schema.items)
    .where(and(or(isNull(schema.items.imageUrl), eq(schema.items.imageSource, "icon")), or(eq(schema.items.status, "to_buy"), eq(schema.items.status, "ordered"))))
    .limit(max);
  if (!rows.length) return { tried: 0, filled: 0 };
  const out = await picturesFor(rows.map((r) => ({ name: r.title, info: r.info, excludeId: r.id })), budgetMs);
  let filled = 0;
  for (const [i, r] of out.entries()) {
    if (!r.ranked.chosen || r.ranked.chosen.source === "icon") continue;
    await savePictureChoice(rows[i].id, { ...r.ranked, check: true }, r.info).catch(() => {});
    filled++;
  }
  return { tried: rows.length, filled };
}
