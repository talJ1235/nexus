"use server";

import { eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { requireCtx } from "@/lib/ctx";
import { scoped, type Scoped } from "@/lib/db-scoped";
import { aiEnabled, generateJson } from "@/lib/ai";
import { aiUse } from "@/lib/ai-gate";
import { mockAi } from "@/lib/assistant";
import { classifyBarcode, gtinKey, lookupChain, type BarcodeClass, type LookupHit } from "@/lib/barcode";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { getItem } from "@/lib/data";
import { kvGet, kvSet } from "@/lib/kv";
import { safeFetch } from "@/lib/safe-fetch";
import { searchProvider, webSearch } from "@/lib/search";
import { createItemCore } from "@/lib/service";
import type { ItemWithSources } from "@/lib/types";

const UA = { "user-agent": "Nexus/1.0 (personal shopping list; https://nexus-ashen-beta.vercel.app)" };
const HIT_TTL = 30 * 86400_000;
const MISS_TTL = 86400_000;

async function json<T>(url: string): Promise<T | null> {
  const res = await safeFetch(url, { headers: UA, timeoutMs: 6000, maxBytes: 2_000_000 });
  return res.ok ? (JSON.parse(res.text) as T) : null;
}

type OffProduct = { product_name?: string; product_name_he?: string; product_name_en?: string; brands?: string; image_front_url?: string; image_url?: string; categories?: string };
const offLike = (host: string) => async (code: string): Promise<LookupHit | null> => {
  const r = await json<{ status?: number; product?: OffProduct }>(`https://${host}/api/v2/product/${code}.json?fields=product_name,product_name_he,product_name_en,brands,image_front_url,image_url,categories`);
  const p = r?.status === 1 ? r.product : null;
  const title = p?.product_name_he || p?.product_name || p?.product_name_en;
  if (!p || !title) return null;
  return { source: host.includes("food") ? "off" : "opf", title: title.trim(), brand: p.brands?.split(",")[0]?.trim() || null, image: p.image_front_url || p.image_url || null, category: p.categories?.split(",").at(-1)?.trim() ?? null };
};

async function upcitemdb(code: string): Promise<LookupHit | null> {
  const r = await json<{ items?: { title?: string; brand?: string; images?: string[]; category?: string }[] }>(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`);
  const it = r?.items?.[0];
  return it?.title ? { source: "upcitemdb", title: it.title, brand: it.brand || null, image: it.images?.[0] ?? null, category: it.category ?? null } : null;
}

async function searchHit(code: string): Promise<LookupHit | null> {
  const r = (await webSearch(`"${code}"`, 5)).find((x) => x.title && !/barcode|upc|ean|gtin/i.test(x.title));
  return r ? { source: "search", title: r.title.split(/ [|–—-] /)[0].trim(), url: r.url } : null;
}

/** This space's items (or their store links) carrying this barcode. */
async function ownHit(s: Scoped, key: string): Promise<LookupHit | null> {
  const [items, sources] = await Promise.all([
    s.pick({ id: schema.items.id, gtin: schema.items.gtin }, schema.items, isNotNull(schema.items.gtin)),
    s.pick({ itemId: schema.sources.itemId, gtin: schema.sources.gtin }, schema.sources, isNotNull(schema.sources.gtin)),
  ]);
  const same = (g: string | null) => !!g && (g === key || gtinKey(g) === gtinKey(key));
  const id = items.find((i) => same(i.gtin))?.id ?? sources.find((x) => same(x.gtin))?.itemId;
  if (!id) return null;
  const item = await getItem(s, id);
  return item ? { source: "own", title: item.title, brand: item.brand, image: item.imageUrl, category: item.category, itemId: item.id } : null;
}

export type BarcodeResult = { code: string; cls: BarcodeClass; hit: LookupHit | null; item: ItemWithSources | null; canPhoto: boolean };

/** Scan → own items → Open Food/Products Facts → UPCitemdb → search (with a key) → null (ask for a photo). Cached. */
export async function lookupBarcode(raw: string): Promise<BarcodeResult> {
  const s = scoped(await requireCtx("view"));
  const code = z.string().trim().min(1).max(64).parse(raw);
  const cls = classifyBarcode(code);
  // The shared cache holds product data from public databases only (never a user's own items or photo guesses).
  const cacheKey = `barcode:${cls.kind === "gtin" ? cls.key : cls.code}`;
  const own = await ownHit(s, cls.kind === "gtin" ? cls.key : cls.code).catch(() => null);
  if (own) return { code, cls, hit: own, item: (await getItem(s, own.itemId!)) ?? null, canPhoto: aiEnabled() || mockAi() };

  let hit: LookupHit | null = null;
  const cached = await kvGet(cacheKey).catch(() => null);
  const c = cached ? (JSON.parse(cached) as { hit: LookupHit | null; at: number }) : null;
  if (c && Date.now() - c.at < (c.hit ? HIT_TTL : MISS_TTL)) hit = c.hit;
  else if (mockAi()) hit = cls.kind === "gtin" ? { source: "off", title: `Mock product ${cls.code.slice(-4)}`, brand: "Mock", image: null, category: "home-kitchen" } : null;
  else {
    hit = (
      await lookupChain(code, {
        own: async () => null,
        off: offLike("world.openfoodfacts.org"),
        opf: offLike("world.openproductsfacts.org"),
        upcitemdb,
        search: searchProvider() ? searchHit : null,
      })
    ).hit;
    await kvSet(cacheKey, JSON.stringify({ hit, at: Date.now() })).catch(() => {});
  }
  return { code, cls, hit, item: null, canPhoto: aiEnabled() || mockAi() };
}

type PhotoGuess = { title: string; brand: string | null; category: string };

/** No database knows the code (Israeli 729 products, weight/store codes): Gemini names the product from a photo. */
export async function identifyProductPhoto(input: { image: string; code?: string | null }): Promise<LookupHit | null> {
  const ctx = await requireCtx("edit");
  const { image, code } = z.object({ image: z.string().max(6_000_000), code: z.string().max(64).nullish() }).strict().parse(input);
  const m = image.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!m) throw new Error("invalid_image");
  let guess: PhotoGuess | null;
  if (mockAi()) guess = { title: "Mock photographed product", brand: null, category: "other" };
  else {
    guess = await generateJson<PhotoGuess>(
      `This photo shows one product someone is holding in a store${code ? ` (its barcode reads ${code})` : ""}. Name it the way a shop would list it: brand + product + size/variant, in the language printed on the package (Hebrew stays Hebrew). "category": one of ${CATEGORIES.join(", ")}.`,
      { type: "object", properties: { title: { type: "string" }, brand: { type: ["string", "null"] }, category: { type: "string", enum: [...CATEGORIES] } }, required: ["title", "brand", "category"] },
      { use: aiUse(ctx, "barcode"), file: { mimeType: m[1], data: m[2] }, budgetMs: 25_000 },
    );
  }
  if (!guess?.title) return null;
  // R15: a photo guess is this user's — it is not written to the cache every space reads.
  return { source: "photo", title: guess.title.slice(0, 200), brand: guess.brand, image: null, category: normalizeCategory(guess.category) };
}

const addSchema = z.strictObject({
  title: z.string().min(1).max(300),
  brand: z.string().max(120).nullable(),
  image: z.string().max(2000).nullable(),
  category: z.string().max(40).nullable(),
  collectionId: z.string().nullable(),
  code: z.string().max(64).nullable(),
  status: z.enum(["to_buy", "purchased"]),
});

/** Add a scanned product (to buy, or straight to History when it's already in the cart). */
export async function addScannedItem(raw: z.input<typeof addSchema>): Promise<ItemWithSources> {
  const s = scoped(await requireCtx("edit"));
  const d = addSchema.parse(raw);
  const cls = d.code ? classifyBarcode(d.code) : null;
  const item = await createItemCore(s, {
    title: d.title,
    brand: d.brand,
    imageUrl: d.image,
    category: normalizeCategory(d.category),
    tags: [],
    collectionId: d.collectionId,
    source: null,
    gtin: cls?.kind === "gtin" ? cls.code : null,
  });
  if (d.status === "purchased") {
    const t = Date.now();
    await s.update(schema.items, { status: "purchased", purchasedAt: t, updatedAt: t }, eq(schema.items.id, item.id));
    return (await getItem(s, item.id))!;
  }
  return item;
}
