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

let client: GoogleGenAI | null = null;
function ai() {
  if (!process.env.GEMINI_API_KEY) return null;
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function aiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

let workingModel: string | null = null;

async function generateJson<T>(prompt: string, schema: object): Promise<T | null> {
  const c = ai();
  if (!c) return null;
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL, ...DEFAULT_MODELS] : DEFAULT_MODELS;
  const ordered = workingModel ? [workingModel, ...models.filter((m) => m !== workingModel)] : models;
  for (const model of ordered) {
    try {
      const res = await c.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0.2 },
      });
      const text = res.text;
      if (!text) continue;
      workingModel = model;
      return JSON.parse(text) as T;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // Unknown / retired model → try the next one. Rate limits or other errors → give up quietly.
      if (/not found|404|not supported|NOT_FOUND|deprecated|no longer available/i.test(msg)) continue;
      console.warn("[ai] generate failed:", model, msg.slice(0, 200));
      return null;
    }
  }
  return null;
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
1. "title": a short clean product name (max ~70 chars). Keep model numbers and key specs (size, voltage, capacity). Drop marketing fluff, shipping claims and store names. Keep the language of the original title.
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
