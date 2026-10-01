import "server-only";
import { GoogleGenAI, MediaResolution, ThinkingLevel } from "@google/genai";
import { kvGet, kvSet } from "./kv";

import { CATEGORIES, normalizeCategory } from "./categories";
export { CATEGORIES };
/** Helps the model place things in the short list. */
export const CATEGORY_HINT =
  "(mechanical = motors, bearings, rails, belts, fasteners, parts; materials = filament, resin, wood, metal stock, glue, tape; camera-audio = cameras, lenses, mics, speakers, headphones; home-kitchen = furniture, appliances, kitchen, garden; clothing-personal = clothes, shoes, sports, health, beauty; other = books, software, vehicle, anything else)";

// ---------- Providers ----------
// Gemini (free tier) first; when it is overloaded or out of quota, fall back to other free,
// OpenAI-compatible providers if their keys are set in Vercel (GROQ_API_KEY, OPENROUTER_API_KEY).
// Only Gemini can open web pages (url-context), so page-reading calls never fall back.

const GEMINI_FAST = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash-lite"];
// Planning / Q&A need more reasoning than tagging: prefer full Flash, fall back to Lite.
const GEMINI_SMART = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const list = (env: string | undefined, dflt: string[]) => (env ? env.split(",").map((s) => s.trim()).filter(Boolean) : dflt);

type Route = { provider: "gemini" | "groq" | "openrouter"; model: string };

function routes(tier: "fast" | "smart", urlContext: boolean): Route[] {
  const gem = tier === "smart" ? GEMINI_SMART : GEMINI_FAST;
  const gemModels = process.env.GEMINI_MODEL && tier === "fast" ? [process.env.GEMINI_MODEL, ...gem] : gem;
  const out: Route[] = process.env.GEMINI_API_KEY ? gemModels.map((model) => ({ provider: "gemini", model })) : [];
  if (urlContext) return out;
  if (process.env.GROQ_API_KEY)
    out.push(...list(process.env.GROQ_MODELS, tier === "smart" ? ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] : ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]).map((model) => ({ provider: "groq" as const, model })));
  if (process.env.OPENROUTER_API_KEY) out.push(...list(process.env.OPENROUTER_MODELS, ["openrouter/free"]).map((model) => ({ provider: "openrouter" as const, model })));
  return out;
}

let client: GoogleGenAI | null = null;
function gemini() {
  if (!process.env.GEMINI_API_KEY) return null;
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function aiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY);
}

/** Which providers have keys, plus current routing health (owner diagnostics). */
export function aiProviders() {
  return [process.env.GEMINI_API_KEY && "gemini", process.env.GROQ_API_KEY && "groq", process.env.OPENROUTER_API_KEY && "openrouter"].filter(Boolean) as string[];
}
export const aiHealth = () => health;

// ---------- Health state (per warm instance, shared across instances through kv) ----------

type Health = { working: Partial<Record<"fast" | "smart", string>>; cooling: Record<string, number> };
let health: Health = { working: {}, cooling: {} };
let healthLoadedAt = 0;
let healthDirty = false;
/** Last failure per route (owner-only diagnostics at /api/debug/ai). */
export const lastAiErrors: Record<string, string> = {};
const key = (r: Route) => `${r.provider}:${r.model}`;

async function loadHealth() {
  if (Date.now() - healthLoadedAt < 60_000) return;
  healthLoadedAt = Date.now();
  try {
    const raw = await kvGet("ai:health");
    if (!raw) return;
    const shared = JSON.parse(raw) as Health;
    const cooling = { ...shared.cooling };
    for (const [k, v] of Object.entries(health.cooling)) cooling[k] = Math.max(v, cooling[k] ?? 0);
    health = { working: { ...shared.working, ...health.working }, cooling };
  } catch {
    /* kv unavailable — per-instance state only */
  }
}

async function saveHealth() {
  if (!healthDirty) return;
  healthDirty = false;
  const now = Date.now();
  health.cooling = Object.fromEntries(Object.entries(health.cooling).filter(([, v]) => v > now));
  await kvSet("ai:health", JSON.stringify(health)).catch(() => {});
}

function cool(r: Route, ms: number) {
  health.cooling[key(r)] = Date.now() + ms;
  healthDirty = true;
}

type Failure = { kind: "retry" | "skip" | "fatal"; coolMs: number };

/** Classify an upstream error: retry the same route once, skip to the next route (cooling it), or give up. */
export function classify(msg: string): Failure {
  const m = msg.toLowerCase();
  // Model doesn't exist for this key / was retired → don't try it again for a long time.
  if (/not[ _]found|404|not supported|deprecated|no longer available|decommissioned|does not exist/.test(m)) return { kind: "skip", coolMs: 2 * 3600_000 };
  if (/429|resource_exhausted|quota|rate.?limit|too many requests/.test(m)) {
    if (/limit: ?0\b/.test(m)) return { kind: "skip", coolMs: 6 * 3600_000 }; // not on the free tier
    if (/per ?day|perday|daily|rpd/.test(m)) return { kind: "skip", coolMs: 60 * 60_000 };
    const secs = Number(m.match(/retry (?:in|after) ([\d.]+)\s*s/)?.[1] ?? m.match(/retrydelay"?:\s*"?([\d.]+)s/)?.[1] ?? 0);
    return { kind: "skip", coolMs: Math.min(Math.max(secs * 1000, 20_000), 10 * 60_000) };
  }
  // Overload / transient server errors: usually clear within seconds.
  if (/503|unavailable|overloaded|high demand|500|502|504|internal|deadline|timeout|timed out|aborted|fetch failed|econnreset|socket/.test(m)) return { kind: "retry", coolMs: 90_000 };
  if (/413|too large|context length|maximum context|tokens? per minute|tpm/.test(m)) return { kind: "skip", coolMs: 0 };
  if (/401|403|permission|api key|unauthorized/.test(m)) return { kind: "skip", coolMs: 30 * 60_000 };
  return { kind: "fatal", coolMs: 0 };
}

function parseLooseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

/** A document for Gemini to read (image or PDF, base64). Only Gemini can read files, so these calls never fall back. */
export type AiFile = { mimeType: string; data: string };
/** `files`: several images read together, in order (tiles of one long receipt). `mediaResolution`: tokens per image. */
type GenOpts = { urlContext?: boolean; smart?: boolean; text?: boolean; system?: string; budgetMs?: number; file?: AiFile; files?: AiFile[]; mediaResolution?: "low" | "medium" | "high" };

async function callGemini(model: string, prompt: string, schema: object | null, opts: GenOpts, timeoutMs: number) {
  const c = gemini()!;
  const files = opts.files?.length ? opts.files : opts.file ? [opts.file] : [];
  const call = (withThinking: boolean) =>
    c.models.generateContent({
      model,
      contents: files.length ? [{ role: "user", parts: [...files.map((f) => ({ inlineData: f })), { text: prompt }] }] : prompt,
      config: {
        abortSignal: AbortSignal.timeout(timeoutMs),
        ...(opts.mediaResolution ? { mediaResolution: { low: MediaResolution.MEDIA_RESOLUTION_LOW, medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM, high: MediaResolution.MEDIA_RESOLUTION_HIGH }[opts.mediaResolution] } : {}),
        // These tasks need little deliberation; low thinking keeps answers fast.
        ...(withThinking ? (/gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : { thinkingConfig: { thinkingBudget: 0 } }) : {}),
        ...(opts.system ? { systemInstruction: opts.system } : {}),
        ...(opts.urlContext
          ? { tools: [{ urlContext: {} }], temperature: 0.1 }
          : opts.text
            ? { temperature: 0.3 }
            : { responseMimeType: "application/json", responseJsonSchema: schema ?? undefined, temperature: 0.2 }),
      },
    });
  try {
    return (await call(true)).text ?? null;
  } catch (e) {
    // A model that rejects the thinking setting → same model, default thinking.
    if (/thinking/i.test(String((e as Error)?.message ?? e))) return (await call(false)).text ?? null;
    throw e;
  }
}

const OPENAI_BASE = { groq: "https://api.groq.com/openai/v1", openrouter: "https://openrouter.ai/api/v1" } as const;

async function callOpenAiCompatible(r: Route, prompt: string, schema: object | null, opts: GenOpts, timeoutMs: number) {
  const provider = r.provider as keyof typeof OPENAI_BASE;
  const keyEnv = provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY;
  const jsonRule = opts.text ? "" : `\n\nRespond with ONLY a JSON object${schema ? ` that matches this JSON Schema: ${JSON.stringify(schema)}` : ""}. No prose, no code fences.`;
  const system = `${opts.system ?? ""}${jsonRule}`.trim();
  const res = await fetch(`${OPENAI_BASE[provider]}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${keyEnv}`,
      ...(provider === "openrouter" ? { "x-title": "Nexus" } : {}),
    },
    body: JSON.stringify({
      model: r.model,
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
      temperature: opts.text ? 0.3 : 0.2,
      max_tokens: 6000,
      ...(opts.text ? {} : { response_format: { type: "json_object" } }),
      ...(/gpt-oss/.test(r.model) ? { reasoning_effort: "low" } : {}),
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 300)}`);
  const json = JSON.parse(body) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "error");
  const text = json.choices?.[0]?.message?.content?.trim() ?? null;
  // Some reasoning models leak their <think> block into content.
  return text ? text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null : null;
}

async function generate(prompt: string, schema: object | null, opts: GenOpts = {}): Promise<string | null> {
  const tier = opts.smart ? "smart" : "fast";
  const all = routes(tier, !!opts.urlContext || !!opts.file || !!opts.files?.length);
  if (!all.length) return null;
  await loadHealth();
  const now = Date.now();
  const known = health.working[tier];
  const ordered = known ? [...all.filter((r) => key(r) === known), ...all.filter((r) => key(r) !== known)] : all;
  const ready = ordered.filter((r) => !(health.cooling[key(r)] > now));
  // Everything is cooling → still try, least-recently-cooled first, rather than failing outright.
  const queue = ready.length ? ready : [...ordered].sort((a, b) => (health.cooling[key(a)] ?? 0) - (health.cooling[key(b)] ?? 0));
  // Stay well inside the 60s function limit, whatever happens upstream.
  const deadline = now + (opts.budgetMs ?? 45_000);
  const hasFallback = queue.some((r) => r.provider !== "gemini");
  try {
    for (const r of queue) {
      for (let attempt = 0; attempt < 2; attempt++) {
        // Keep part of the budget (≤12 s) for a fallback provider when one is configured.
        const reserve = r.provider === "gemini" && hasFallback ? Math.min(12_000, (opts.budgetMs ?? 45_000) * 0.3) : 0;
        const left = deadline - Date.now() - reserve;
        if (left < 3000) break;
        const timeout = Math.min(left, opts.smart || opts.urlContext || opts.file || opts.files?.length ? 22_000 : 12_000);
        try {
          const text = r.provider === "gemini" ? await callGemini(r.model, prompt, schema, opts, timeout) : await callOpenAiCompatible(r, prompt, schema, opts, timeout);
          if (!text) break; // empty answer → next route
          if (health.working[tier] !== key(r)) {
            health.working[tier] = key(r);
            healthDirty = true;
          }
          if (health.cooling[key(r)]) {
            delete health.cooling[key(r)];
            healthDirty = true;
          }
          return text;
        } catch (e) {
          const msg = String((e as Error)?.message ?? e);
          lastAiErrors[key(r)] = `${new Date().toISOString()} ${msg.slice(0, 300)}`;
          const f = classify(msg);
          if (f.kind === "fatal") {
            console.warn("[ai] generate failed:", key(r), msg.slice(0, 200));
            break;
          }
          if (f.kind === "retry" && attempt === 0 && !/timeout|timed out|aborted/i.test(msg)) {
            // Brief, jittered pause: free-tier overload spikes often clear within a second or two.
            await new Promise((res) => setTimeout(res, 700 + Math.random() * 900));
            continue;
          }
          if (f.coolMs) cool(r, f.coolMs);
          if (health.working[tier] === key(r)) {
            delete health.working[tier];
            healthDirty = true;
          }
          break;
        }
      }
    }
    return null;
  } finally {
    await saveHealth();
  }
}

export async function generateJson<T>(prompt: string, schema: object | null, opts: GenOpts = {}): Promise<T | null> {
  const text = await generate(prompt, schema, opts);
  if (!text) return null;
  if (opts.urlContext) return parseLooseJson<T>(text);
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
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
}, budgetMs?: number): Promise<Categorization | null> {
  const prompt = `You organize a personal shopping/procurement list for a maker (electronics, mechatronics, 3D printing, video) who also buys for home and a startup.

Product:
- Raw title: ${input.title}
- Store: ${input.store}
- URL: ${input.url}
- Description: ${(input.description ?? "").slice(0, 500)}

Tasks:
1. "title": a short, clean, human product name (max ~70 chars), like a shop assistant would write it. Keep the product type, brand/model number and the 1-2 specs that identify it (size, color, voltage, capacity). Drop marketing fluff, shipping claims, keyword stuffing, store names and SKU codes. If the raw title is in Hebrew keep Hebrew, but keep brand names, model numbers, units and technical acronyms (PLA, PETG, USB-C, LED, NEMA 17) in their original Latin form — never transliterate them into Hebrew letters; if it is English keep English; if it is any other language (e.g. German/Chinese from a localized store) translate it to English. If the raw title is only a URL slug or generic text like "KSP item", infer the best name you can from the URL and description.
2. "brand": brand if clear, else null.
3. "category": exactly one of: ${CATEGORIES.join(", ")}. ${CATEGORY_HINT}
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
  const out = await generateJson<Categorization>(prompt, schema, { budgetMs });
  if (!out) return null;
  const validIds = new Set(input.collections.map((c) => c.id));
  return {
    title: (out.title || input.title).slice(0, 200),
    brand: out.brand || null,
    category: normalizeCategory(out.category) ?? "other",
    tags: Array.from(new Set((out.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))).slice(0, 4),
    collectionId: out.collectionId && validIds.has(out.collectionId) ? out.collectionId : null,
  };
}

export async function extractWithAi(url: string, pageText: string, budgetMs?: number) {
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
  return generateJson<{ title: string | null; price: number | null; currency: string | null; brand: string | null }>(prompt, schema, { budgetMs });
}

export type UrlContextResult = { title: string | null; price: number | null; currency: string | null; imageUrl: string | null; brand: string | null };

/** Let Gemini fetch the page itself (Google's fetcher is blocked less often than serverless IPs). */
export async function extractWithUrlContext(url: string, budgetMs = 25_000): Promise<UrlContextResult | null> {
  const prompt = `Open this product page and read it: ${url}

Return ONLY a JSON object, no prose, with these keys:
{"title": string|null, "price": number|null, "currency": "ISO 4217 code"|null, "imageUrl": "absolute URL of the main product image"|null, "brand": string|null}

Rules: "title" is the product's real name as shown on the page. "price" is the current selling price for one unit (the discounted price if on sale), as a plain number. Use null for anything you cannot see on the page — never guess.`;
  const out = await generateJson<UrlContextResult>(prompt, null, { urlContext: true, budgetMs: Math.min(budgetMs, 25_000) });
  if (!out) return null;
  const price = typeof out.price === "number" && out.price > 0 ? out.price : null;
  const imageUrl = typeof out.imageUrl === "string" && /^https?:\/\//.test(out.imageUrl) ? out.imageUrl : null;
  const title = typeof out.title === "string" && out.title.trim().length > 2 ? out.title.trim() : null;
  return { title, price, currency: out.currency?.toUpperCase?.() ?? null, imageUrl, brand: out.brand ?? null };
}
