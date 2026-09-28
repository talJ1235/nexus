import "server-only";
import { GoogleGenAI } from "@google/genai";

export const CATEGORIES = [
  "electronics",
  "components",
  "tools",
  "3d-printing",
  "computers",
  "camera-video",
  "audio",
  "home",
  "furniture",
  "kitchen",
  "office",
  "clothing",
  "sports",
  "health-beauty",
  "books",
  "software",
  "vehicle",
  "garden",
  "other",
] as const;

const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash-lite"];
// Planning / Q&A need more reasoning than tagging: prefer full Flash, fall back to Lite.
const SMART_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

let client: GoogleGenAI | null = null;
function ai() {
  if (!process.env.GEMINI_API_KEY) return null;
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function aiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

const workingModel: Record<"fast" | "smart", string | null> = { fast: null, smart: null };

function parseLooseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

type GenOpts = { urlContext?: boolean; smart?: boolean; text?: boolean; system?: string };

async function generate(prompt: string, schema: object | null, opts: GenOpts = {}): Promise<string | null> {
  const c = ai();
  if (!c) return null;
  const tier = opts.smart ? "smart" : "fast";
  const base = opts.smart ? SMART_MODELS : DEFAULT_MODELS;
  const models = process.env.GEMINI_MODEL && !opts.smart ? [process.env.GEMINI_MODEL, ...base] : base;
  const known = workingModel[tier];
  const ordered = known ? [known, ...models.filter((m) => m !== known)] : models;
  for (const model of ordered) {
    try {
      const res = await c.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...(opts.system ? { systemInstruction: opts.system } : {}),
          ...(opts.urlContext
            ? { tools: [{ urlContext: {} }], temperature: 0.1 }
            : opts.text
              ? { temperature: 0.3 }
              : { responseMimeType: "application/json", responseJsonSchema: schema ?? undefined, temperature: 0.2 }),
        },
      });
      const text = res.text;
      if (!text) continue;
      workingModel[tier] = model;
      return text;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // Unknown / retired model or per-model quota → try the next one.
      if (/not found|404|not supported|NOT_FOUND|deprecated|no longer available|RESOURCE_EXHAUSTED|429|quota/i.test(msg)) continue;
      console.warn("[ai] generate failed:", model, msg.slice(0, 200));
      return null;
    }
  }
  return null;
}

export async function generateJson<T>(prompt: string, schema: object | null, opts: GenOpts = {}): Promise<T | null> {
  const text = await generate(prompt, schema, opts);
  if (!text) return null;
  if (opts.urlContext) return parseLooseJson<T>(text);
  try {
    return JSON.parse(text) as T;
  } catch {
    return parseLooseJson<T>(text);
  }
}

export async function generateText(prompt: string, opts: Omit<GenOpts, "text" | "urlContext"> = {}) {
  return generate(prompt, null, { ...opts, text: true });
}

export type Categorization = {
  title: string;
  brand: string | null;
  category: (typeof CATEGORIES)[number];
  tags: string[];
  collectionId: string | null;
};

export async function categorize(input: {
  title: string;
  description?: string | null;
  store: string;
  url: string;
  collections: { id: string; name: string; kind: string; description: string | null }[];
  knownTags: string[];
}): Promise<Categorization | null> {
  const prompt = `You organize a personal shopping/procurement list for a maker (electronics, mechatronics, 3D printing, video) who also buys for home and a startup.

Product:
- Raw title: ${input.title}
- Store: ${input.store}
- URL: ${input.url}
- Description: ${(input.description ?? "").slice(0, 500)}

Tasks:
1. "title": a short, clean, human product name (max ~70 chars), like a shop assistant would write it. Keep the product type, brand/model number and the 1-2 specs that identify it (size, color, voltage, capacity). Drop marketing fluff, shipping claims, keyword stuffing, store names and SKU codes. If the raw title is in Hebrew keep Hebrew, but keep brand names, model numbers, units and technical acronyms (PLA, PETG, USB-C, LED, NEMA 17) in their original Latin form — never transliterate them into Hebrew letters; if it is English keep English; if it is any other language (e.g. German/Chinese from a localized store) translate it to English. If the raw title is only a URL slug or generic text like "KSP item", infer the best name you can from the URL and description.
2. "brand": brand if clear, else null.
3. "category": exactly one of: ${CATEGORIES.join(", ")}.
4. "tags": 1-4 short lowercase English tags describing the product type (e.g. "stepper motor", "cable", "lighting"). Prefer reusing these existing tags when they fit: ${input.knownTags.slice(0, 60).join(", ") || "(none yet)"}.
5. "collectionId": the id of the user's project/list this most likely belongs to, or null if none clearly fits. Only choose one when the match is obvious from the names/descriptions.
User's collections: ${JSON.stringify(input.collections.map((c) => ({ id: c.id, name: c.name, kind: c.kind, description: c.description ?? "" })))}`;

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      brand: { type: ["string", "null"] },
      category: { type: "string", enum: [...CATEGORIES] },
      tags: { type: "array", items: { type: "string" }, maxItems: 4 },
      collectionId: { type: ["string", "null"] },
    },
    required: ["title", "brand", "category", "tags", "collectionId"],
  };
  const out = await generateJson<Categorization>(prompt, schema);
  if (!out) return null;
  const validIds = new Set(input.collections.map((c) => c.id));
  return {
    title: (out.title || input.title).slice(0, 200),
    brand: out.brand || null,
    category: (CATEGORIES as readonly string[]).includes(out.category) ? out.category : "other",
    tags: Array.from(new Set((out.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))).slice(0, 4),
    collectionId: out.collectionId && validIds.has(out.collectionId) ? out.collectionId : null,
  };
}

export async function extractWithAi(url: string, pageText: string) {
  const prompt = `Extract the main product on this web page. Return null fields when unsure — never guess a price.
URL: ${url}
Page text:
${pageText.slice(0, 10000)}`;
  const schema = {
    type: "object",
    properties: {
      title: { type: ["string", "null"] },
      price: { type: ["number", "null"] },
      currency: { type: ["string", "null"], description: "ISO 4217 code, e.g. ILS, USD" },
      brand: { type: ["string", "null"] },
    },
    required: ["title", "price", "currency", "brand"],
  };
  return generateJson<{ title: string | null; price: number | null; currency: string | null; brand: string | null }>(prompt, schema);
}

export type UrlContextResult = { title: string | null; price: number | null; currency: string | null; imageUrl: string | null; brand: string | null };

/** Let Gemini fetch the page itself (Google's fetcher is blocked less often than serverless IPs). */
export async function extractWithUrlContext(url: string): Promise<UrlContextResult | null> {
  const prompt = `Open this product page and read it: ${url}

Return ONLY a JSON object, no prose, with these keys:
{"title": string|null, "price": number|null, "currency": "ISO 4217 code"|null, "imageUrl": "absolute URL of the main product image"|null, "brand": string|null}

Rules: "title" is the product's real name as shown on the page. "price" is the current selling price for one unit (the discounted price if on sale), as a plain number. Use null for anything you cannot see on the page — never guess.`;
  const out = await generateJson<UrlContextResult>(prompt, null, { urlContext: true });
  if (!out) return null;
  const price = typeof out.price === "number" && out.price > 0 ? out.price : null;
  const imageUrl = typeof out.imageUrl === "string" && /^https?:\/\//.test(out.imageUrl) ? out.imageUrl : null;
  const title = typeof out.title === "string" && out.title.trim().length > 2 ? out.title.trim() : null;
  return { title, price, currency: out.currency?.toUpperCase?.() ?? null, imageUrl, brand: out.brand ?? null };
}
