import "server-only";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateJson } from "./ai";
import { mockAi } from "./assistant";
import { extractFromUrl } from "./extract";
import { storeThumbnail } from "./images";
import { kvGet, kvSet } from "./kv";
import { imageSearch, searchProvider } from "./search";
import { titleSimilarity } from "./similarity";

// Product pictures for items that have none (Round 7 E4), used by receipts, barcode adds, manual items and a daily
// backfill. Order: an existing item's picture → the store page (og:image / JSON-LD) → the owner's extension (async job)
// → an image-search key → a Fluent Emoji icon. Never blocks the user: callers show a shimmer and fill it in later.

export type ImageSource = "store" | "search" | "extension" | "icon";
export type FoundImage = { url: string; source: ImageSource };
type Query = { title: string; brand?: string | null; urls?: string[]; excludeId?: string };

const JOBS = "image-jobs";
export type ImageJob = { itemId: string; title: string; store: string | null; storeUrl: string | null; at: number };

async function fromOwnItems(q: Query): Promise<FoundImage | null> {
  const rows = await db.select({ id: schema.items.id, title: schema.items.title, imageUrl: schema.items.imageUrl, imageSource: schema.items.imageSource }).from(schema.items).where(isNotNull(schema.items.imageUrl));
  let best: { url: string; score: number } | null = null;
  for (const r of rows) {
    if (r.id === q.excludeId || !r.imageUrl || r.imageSource === "icon") continue;
    const score = titleSimilarity(q.title, r.title);
    if (score >= 0.75 && (!best || score > best.score)) best = { url: r.imageUrl, score };
  }
  return best ? { url: best.url, source: "store" } : null;
}

async function fromStorePages(q: Query): Promise<FoundImage | null> {
  for (const url of (q.urls ?? []).filter((u) => /^https?:/.test(u)).slice(0, 2)) {
    const ex = await extractFromUrl(url).catch(() => null);
    if (ex?.image) return { url: ex.image, source: "store" };
  }
  return null;
}

async function fromSearch(q: Query): Promise<FoundImage | null> {
  if (!searchProvider()) return null;
  const r = (await imageSearch(`${q.brand ? `${q.brand} ` : ""}${q.title}`, 6)).find((x) => /^https:/.test(x.image) && !/\.svg(\?|$)/.test(x.image));
  return r ? { url: r.image, source: "search" } : null;
}

/** Gemini picks 1–2 English keywords → Iconify search in fluent-emoji (3D-style, MIT) → the SVG as a data URL. */
export async function iconFor(title: string): Promise<FoundImage | null> {
  const cacheKey = `icon:${title.toLowerCase().slice(0, 80)}`;
  const cached = await kvGet(cacheKey).catch(() => null);
  if (cached) return { url: cached, source: "icon" };
  const kw = mockAi()
    ? { keywords: ["package"] }
    : await generateJson<{ keywords: string[] }>(
        `Give 1–2 simple English nouns for an emoji icon that best shows this product (e.g. "battery", "screwdriver", "milk"). Product: ${title}`,
        { type: "object", properties: { keywords: { type: "array", items: { type: "string" }, maxItems: 2 } }, required: ["keywords"] },
        { budgetMs: 8000 },
      ).catch(() => null);
  for (const word of [...(kw?.keywords ?? []), "package"].map((w) => w.toLowerCase().trim()).filter(Boolean)) {
    try {
      const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(word)}&prefixes=fluent-emoji&limit=4`, { signal: AbortSignal.timeout(5000) });
      const name = ((await r.json()) as { icons?: string[] }).icons?.[0];
      if (!name) continue;
      const svg = await (await fetch(`https://api.iconify.design/${name.replace(":", "/")}.svg?height=256`, { signal: AbortSignal.timeout(5000) })).text();
      if (!svg.startsWith("<svg") || svg.length > 200_000) continue;
      const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
      await kvSet(cacheKey, url).catch(() => {});
      return { url, source: "icon" };
    } catch {}
  }
  return null;
}

/** The first picture the chain finds (no writes). `icon: false` skips the emoji fallback. */
export async function findImage(q: Query, opts: { icon?: boolean } = {}): Promise<FoundImage | null> {
  for (const step of [fromOwnItems, fromStorePages, fromSearch]) {
    const hit = await step(q).catch(() => null);
    if (hit) return hit;
  }
  return opts.icon === false ? null : iconFor(q.title).catch(() => null);
}

async function saveImage(itemId: string, found: FoundImage) {
  // Icons stay SVG data URLs (tiny, sharp at any size); photos become a 480 px WebP in Blob.
  const url = found.source === "icon" || found.url.includes(".blob.vercel-storage.com") ? found.url : ((await storeThumbnail(found.url, itemId)) ?? found.url);
  await db.update(schema.items).set({ imageUrl: url, imageSource: found.source, updatedAt: Date.now() }).where(eq(schema.items.id, itemId));
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

/** Give an image-less item a picture now; an icon stands in while the owner's extension looks for a real photo. */
export async function ensureItemImage(itemId: string): Promise<boolean> {
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  if (!item || (item.imageUrl && item.imageSource !== "icon")) return false;
  const sources = await db.select({ url: schema.sources.url, store: schema.sources.store }).from(schema.sources).where(eq(schema.sources.itemId, itemId));
  const q: Query = { title: item.title, brand: item.brand, urls: sources.map((s) => s.url).filter((u) => !u.startsWith("manual:")), excludeId: item.id };
  const real = await findImage(q, { icon: false });
  if (real) {
    await saveImage(item.id, real);
    await dropImageJob(item.id).catch(() => {});
    return true;
  }
  await enqueueImageJob({ itemId: item.id, title: item.title, store: sources[0]?.store ?? null, storeUrl: q.urls?.[0] ?? null }).catch(() => {});
  if (item.imageSource === "icon") return false;
  const icon = await iconFor(item.title).catch(() => null);
  if (icon) await saveImage(item.id, icon);
  return !!icon;
}

/** The extension found a photo: replace nothing but an icon or an empty picture. */
export async function acceptExtensionImage(itemId: string, imageUrl: string) {
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  await dropImageJob(itemId);
  if (!item || (item.imageUrl && item.imageSource !== "icon")) return false;
  await saveImage(itemId, { url: imageUrl, source: "extension" });
  return true;
}

/** Daily cron step: a few image-less to-buy / ordered items per run (bounded by count and time). */
export async function backfillImages(budgetMs = 10_000, max = 6) {
  const t0 = Date.now();
  const rows = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(and(or(isNull(schema.items.imageUrl), eq(schema.items.imageSource, "icon")), or(eq(schema.items.status, "to_buy"), eq(schema.items.status, "ordered"))))
    .limit(max * 3);
  let filled = 0;
  for (const r of rows) {
    if (Date.now() - t0 > budgetMs || filled >= max) break;
    if (await ensureItemImage(r.id).catch(() => false)) filled++;
  }
  return { tried: rows.length, filled };
}
