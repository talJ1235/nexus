import "server-only";
import { and, asc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { schema } from "@/db";
import { joins, type Scoped } from "@/lib/db-scoped";
import { categorize, extractWithAi, extractWithUrlContext } from "@/lib/ai";
import { getItem, recordPrice } from "@/lib/data";
import { extractFromUrl, hintsFromUrl, type Extracted } from "@/lib/extract";
import { storeThumbnail } from "@/lib/images";
import { parsePrice } from "@/lib/money";
import { titleSimilarity } from "@/lib/similarity";
import { normalizeUrl, storeFromUrl } from "@/lib/stores";
import type { Duplicate, ItemDraft, ItemWithSources, PreviewResult, SourceDraft } from "@/lib/types";
import { isHttpUrl } from "@/lib/utils";

const now = () => Date.now();

// ---------- Preview (extract + categorize, no writes) ----------

export const clientPayload = z.object({
  url: z.string().url(),
  title: z.string().max(500).nullish(),
  price: z.union([z.number(), z.string()]).nullish(),
  currency: z.string().max(8).nullish(),
  image: z.string().max(400_000).nullish(),
  brand: z.string().max(120).nullish(),
  siteName: z.string().max(120).nullish(),
  description: z.string().max(1000).nullish(),
  gtin: z.string().max(20).nullish(),
});
export type ClientPayload = z.infer<typeof clientPayload>;

export async function findDuplicate(s: Scoped, normalizedUrl: string, title: string | null): Promise<Duplicate | null> {
  const exact = await joins.sourceWithItemTitle(s, normalizedUrl);
  if (exact) return { itemId: exact.itemId, title: exact.title, reason: "url" };
  if (!title) return null;
  const candidates = await s.pick({ id: schema.items.id, title: schema.items.title }, schema.items);
  let best: { id: string; title: string; score: number } | null = null;
  for (const c of candidates) {
    const score = titleSimilarity(title, c.title);
    if (score >= 0.6 && (!best || score > best.score)) best = { ...c, score };
  }
  return best ? { itemId: best.id, title: best.title, reason: "title" } : null;
}

/**
 * Whole add must finish well inside Vercel's 60 s function limit: past it the platform kills the request and the
 * user loses the link ("couldn't read"). Each AI step gets only what's left of this budget and is skipped when
 * too little remains, so a slow store/AI yields a partial item (self-heal fills it later) instead of an error.
 */
const DRAFT_BUDGET_MS = 38_000;

export async function buildDraft(s: Scoped, ex: Extracted, hintCollectionId: string | null, originalUrl?: string, startedAt = Date.now()): Promise<ItemDraft> {
  const deadline = startedAt + DRAFT_BUDGET_MS;
  const left = () => deadline - Date.now();
  let { title, price, currency, brand, image } = ex;
  let method: string = ex.method;
  const hints = hintsFromUrl(originalUrl ?? ex.url);

  if (price == null && hints.price != null) {
    price = hints.price;
    currency = hints.currency;
    method = `${method}+url`;
  }

  // 1) Page was readable but thin → let the model read the page text.
  if ((!title || price == null) && ex.pageText && !ex.blocked && left() > 12_000) {
    const ai = await extractWithAi(ex.url, ex.pageText, Math.min(12_000, left() - 8_000));
    if (ai) {
      if (!title && ai.title) {
        title = ai.title;
        method = "ai";
      }
      if (price == null && ai.price && ai.price > 0) {
        price = ai.price;
        currency = ai.currency?.toUpperCase() ?? currency;
        method = `${method}+ai`;
      }
      brand ??= ai.brand;
    }
  }

  // 2) Store blocked us or data still missing → ask Gemini to open the page itself.
  if ((ex.method === "client" ? !title || price == null : !title || price == null || !image) && left() > 14_000) {
    const uc = await extractWithUrlContext(originalUrl ?? ex.url, left() - 8_000);
    if (uc) {
      if (!title && uc.title) title = uc.title;
      if (price == null && uc.price != null) {
        price = uc.price;
        currency = uc.currency ?? currency;
      }
      if (!image && uc.imageUrl) image = uc.imageUrl;
      brand ??= uc.brand;
      method = `${method}+gemini-url`;
    }
  }

  const collections = await s.pick(
    { id: schema.collections.id, name: schema.collections.name, kind: schema.collections.kind, description: schema.collections.description },
    schema.collections,
    eq(schema.collections.archived, false),
  );

  let category: string | null = null;
  let tags: string[] = [];
  let collectionId = hintCollectionId;
  const rawTitle = title ?? hints.slugTitle;
  let cleanTitle = rawTitle;

  if (rawTitle) {
    const tagRows = await s.pick({ tags: schema.items.tags }, schema.items);
    const counts = new Map<string, number>();
    for (const r of tagRows) for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    const knownTags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    // Tidy name / tags are nice-to-have: with little time left the raw title is used as is.
    const cat = left() > 4_000 ? await categorize({ title: rawTitle, description: ex.description, store: ex.store.name, url: ex.url, collections, knownTags }, Math.min(15_000, left())) : null;
    if (cat) {
      cleanTitle = cat.title;
      brand ??= cat.brand;
      category = cat.category;
      tags = cat.tags;
      collectionId ??= cat.collectionId;
    }
  }

  const quality: ItemDraft["quality"] = title && price != null && image ? "full" : title || price != null ? "partial" : "failed";

  return {
    title: cleanTitle || `${ex.store.name} item`,
    brand: brand ?? null,
    imageUrl: image,
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
      rawTitle: title,
      extractMethod: method,
      gtin: ex.gtin ?? null,
    },
  };
}

export async function previewUrlCore(s: Scoped, url: string, hintCollectionId: string | null = null): Promise<PreviewResult> {
  const clean = url.trim();
  if (!isHttpUrl(clean)) throw new Error("invalid_url");
  const early = await findDuplicate(s, normalizeUrl(clean), null);
  if (early) {
    // Exact link already saved — skip the network round-trip.
    const st = storeFromUrl(clean);
    return {
      duplicate: early,
      draft: {
        title: early.title, brand: null, imageUrl: null, category: null, tags: [], collectionId: hintCollectionId, quality: "partial",
        source: { url: clean, normalizedUrl: normalizeUrl(clean), store: st.name, storeKey: st.key, price: null, currency: st.currency ?? "USD", shipping: null, availability: null, rawTitle: null, extractMethod: "none" },
      },
    };
  }
  const started = Date.now();
  const ex = await extractFromUrl(clean);
  const draft = await buildDraft(s, ex, hintCollectionId, clean, started);
  const duplicate = await findDuplicate(s, draft.source.normalizedUrl, draft.source.rawTitle ? draft.title : null);
  return { draft, duplicate };
}

export function extractedFromPayload(payload: ClientPayload): Extracted {
  const p = clientPayload.parse(payload);
  const store = storeFromUrl(p.url, p.siteName);
  const parsed = parsePrice(p.price ?? null, p.currency ?? store.currency);
  return {
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
    gtin: p.gtin && /^\d{8,14}$/.test(p.gtin.replace(/\D/g, "")) ? p.gtin.replace(/\D/g, "") : null,
    store: { key: store.key, name: store.name },
    method: "client",
    pageText: null,
    blocked: false,
  };
}

export async function previewFromClientCore(s: Scoped, payload: ClientPayload, hintCollectionId: string | null = null): Promise<PreviewResult> {
  const draft = await buildDraft(s, extractedFromPayload(payload), hintCollectionId);
  const duplicate = await findDuplicate(s, draft.source.normalizedUrl, draft.source.rawTitle ? draft.title : null);
  return { draft, duplicate };
}

/** Re-read a store link (server-side, or with data the extension read in the browser) and repair the item. */
export async function refreshSourceCore(s: Scoped, sourceId: string, payload?: ClientPayload | null): Promise<ItemWithSources> {
  const src = await s.byId(schema.sources, sourceId);
  if (!src) throw new Error("not_found");
  const item = await getItem(s, src.itemId);
  if (!item) throw new Error("not_found");
  const ex = payload ? extractedFromPayload({ ...payload, url: payload.url || src.url }) : await extractFromUrl(src.url);
  const draft = await buildDraft(s, ex, item.collectionId, src.url);
  const t = now();

  await s.update(
    schema.sources,
    {
      fetchedAt: t,
      ...(draft.source.price != null ? { price: draft.source.price, currency: draft.source.currency } : {}),
      ...(draft.source.availability ? { availability: draft.source.availability } : {}),
      ...(draft.source.rawTitle ? { rawTitle: draft.source.rawTitle } : {}),
      extractMethod: draft.source.extractMethod,
    },
    eq(schema.sources.id, sourceId),
  );
  if (draft.source.price != null) await recordPrice(s, sourceId, item.id, draft.source.price, draft.source.currency);

  // The first read failed (no real title) → adopt the new name, tags and image.
  const firstReadFailed = !src.rawTitle;
  const patch: Record<string, unknown> = { updatedAt: t };
  if (firstReadFailed && draft.source.rawTitle) {
    if (src.extractMethod !== "import-titled") patch.title = draft.title;
    if (!item.tags?.length) patch.tags = draft.tags;
    if (!item.category) patch.category = draft.category;
    if (!item.brand) patch.brand = draft.brand;
  }
  if (!item.imageUrl && draft.imageUrl) patch.imageUrl = await storeThumbnail(draft.imageUrl, item.id);
  await s.update(schema.items, patch, eq(schema.items.id, item.id));
  return (await getItem(s, item.id))!;
}

// ---------- Self-heal: links whose first read came back incomplete ----------

/** A store link still missing its real name, price or the item's picture. */
export function missingDetails(src: { url: string | null; rawTitle: string | null; price: number | null }, item: { imageUrl: string | null }) {
  return Boolean(src.url) && (!src.rawTitle || src.price == null || !item.imageUrl);
}

const REPAIR_WINDOW_MS = 21 * 86400_000;

/** Recent incomplete links, oldest attempt first, not retried within `minGapMs`. */
export async function sourcesNeedingDetails(s: Scoped, limit = 20, minGapMs = 6 * 3600_000) {
  const t = now();
  const rows = await joins.sourcesWithItemImage(
    s,
    and(
      gt(schema.sources.createdAt, t - REPAIR_WINDOW_MS),
      eq(schema.items.status, "to_buy"),
      or(isNull(schema.sources.rawTitle), isNull(schema.sources.price), isNull(schema.items.imageUrl)),
      or(isNull(schema.sources.fetchedAt), lt(schema.sources.fetchedAt, t - minGapMs)),
      isNotNull(schema.sources.url),
    )!,
    asc(schema.sources.fetchedAt),
    limit,
  );
  return rows.filter((r) => missingDetails(r.source, { imageUrl: r.imageUrl })).map((r) => r.source);
}

/** Server-side repair pass (daily cron): re-read incomplete links until the time budget runs out. */
export async function repairIncomplete(s: Scoped, budgetMs = 20_000) {
  const started = now();
  let repaired = 0;
  let tried = 0;
  for (const src of await sourcesNeedingDetails(s, 10)) {
    if (now() - started > budgetMs) break;
    tried++;
    try {
      const item = await refreshSourceCore(s, src.id);
      const got = item.sources.find((x) => x.id === src.id);
      if (got && !missingDetails(got, item)) repaired++;
    } catch {
      /* next one */
    }
  }
  return { tried, repaired };
}

// ---------- Writes ----------

export const sourceDraftSchema = z.object({
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
  gtin: z.string().regex(/^\d{8,14}$/).nullable().optional(),
});

export const draftSchema = z.object({
  title: z.string().min(1).max(300),
  brand: z.string().max(120).nullable(),
  imageUrl: z.string().max(400_000).nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string().max(40)).max(12),
  collectionId: z.string().nullable(),
  source: sourceDraftSchema.nullable(),
  quantity: z.number().int().min(1).max(100000).optional(),
  priority: z.enum(["urgent", "normal", "someday"]).optional(),
  notes: z.string().max(4000).nullable().optional(),
  gtin: z.string().regex(/^\d{8,14}$/).nullable().optional(),
});

export async function createItemCore(s: Scoped, input: z.input<typeof draftSchema>): Promise<ItemWithSources> {
  const d = draftSchema.parse(input);
  const collectionId = await s.ref(schema.collections, d.collectionId);
  const id = nanoid(12);
  const imageUrl = d.imageUrl?.includes(".blob.vercel-storage.com") ? d.imageUrl : await storeThumbnail(d.imageUrl, id);
  const t = now();
  await s.insert(schema.items, {
    id,
    title: d.title,
    brand: d.brand,
    imageUrl,
    category: d.category,
    tags: d.tags,
    collectionId,
    addedByUserId: s.scope.userId,
    quantity: d.quantity ?? 1,
    priority: d.priority ?? "normal",
    notes: d.notes ?? null,
    gtin: d.gtin ?? null,
    createdAt: t,
    updatedAt: t,
  });
  if (d.source) {
    const sourceId = nanoid(12);
    await s.insert(schema.sources, { id: sourceId, itemId: id, ...d.source, fetchedAt: t, createdAt: t });
    await recordPrice(s, sourceId, id, d.source.price, d.source.currency);
  }
  return (await getItem(s, id))!;
}

export async function addSourceCore(s: Scoped, itemId: string, source: SourceDraft, imageUrl?: string | null): Promise<ItemWithSources> {
  const src = sourceDraftSchema.parse(source);
  const item = await s.mustGet(schema.items, itemId);
  const t = now();
  const sourceId = nanoid(12);
  await s.insert(schema.sources, { id: sourceId, itemId, ...src, fetchedAt: t, createdAt: t });
  await recordPrice(s, sourceId, itemId, src.price, src.currency);
  if (!item.imageUrl && imageUrl) {
    await s.update(schema.items, { imageUrl: await storeThumbnail(imageUrl, itemId) }, eq(schema.items.id, itemId));
  }
  await s.update(schema.items, { updatedAt: t }, eq(schema.items.id, itemId));
  return (await getItem(s, itemId))!;
}

