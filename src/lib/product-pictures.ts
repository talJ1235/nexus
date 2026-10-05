import "server-only";
import sharp from "sharp";
import { generateJson, type AiFile } from "./ai";
import { mockAi } from "./assistant";
import { kvGet, kvSet } from "./kv";
import { applyRanking, cacheKey, filterImageResults, makeCache, type Candidate, type Pick, type Ranked, type RawImage } from "./picture-rank";
import { heuristicLineInfo, linePrompt, LINE_SCHEMA, parseLineInfos, type LineInfo } from "./product-lines";
import { imageSearch, searchProvider } from "./search";
import { titleSimilarity } from "./similarity";
import { schema } from "@/db";
import type { Scoped } from "./db-scoped";
import { isNotNull } from "drizzle-orm";
import { safeFetch } from "./safe-fetch";

// Real pictures for products, like searching Google (Round 10 D): understand the line (D1), gather candidates from the
// first source that has good ones (D2), let one batched vision call pick for several items at once (D3). Works on phone
// and desktop with no extension; without SERPER_API_KEY the barcode / Open Food Facts / own items / icons still work.

const cached = makeCache({ get: (k) => kvGet(k), set: (k, v) => kvSet(k, v) });
const UA = { "user-agent": "Nexus/1.0 (personal shopping app)" };

// ---------- D1 ----------

/** One batched model call for all lines (heuristic in mock mode or when the model is unavailable). */
export async function understandLines(names: string[]): Promise<LineInfo[]> {
  if (!names.length) return [];
  if (mockAi()) return names.map(heuristicLineInfo);
  const raw = await generateJson<unknown>(linePrompt(names), LINE_SCHEMA, { budgetMs: 20_000 }).catch(() => null);
  return parseLineInfos(raw, names);
}

// ---------- D2 sources ----------

type OffProduct = { image_front_url?: string; image_url?: string; product_name?: string; brands?: string; code?: string };

async function offByBarcode(code: string): Promise<Candidate[]> {
  return cached(cacheKey("off-code", code), async () => {
    for (const host of ["world.openfoodfacts.org", "world.openproductsfacts.org"]) {
      try {
        const r = await fetch(`https://${host}/api/v2/product/${code}.json?fields=image_front_url,image_url,product_name,brands`, { headers: UA, signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const p = ((await r.json()) as { product?: OffProduct }).product;
        const url = p?.image_front_url ?? p?.image_url;
        if (url) return [{ url, source: "barcode" as const, title: [p?.brands, p?.product_name].filter(Boolean).join(" ") || null, domain: host }];
      } catch {}
    }
    return [];
  });
}

async function offByName(q: string, source: "off" | "generic"): Promise<Candidate[]> {
  return cached(cacheKey(`off-${source}`, q), async () => {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=8&fields=image_front_url,product_name,brands,code`, { headers: UA, signal: AbortSignal.timeout(7000) });
      if (!r.ok) return [];
      const ps = ((await r.json()) as { products?: OffProduct[] }).products ?? [];
      return ps.filter((p) => p.image_front_url).slice(0, 6).map((p) => ({ url: p.image_front_url!, source, title: [p.brands, p.product_name].filter(Boolean).join(" ") || null, domain: "openfoodfacts.org" }));
    } catch {
      return [];
    }
  });
}

/** Pictures of this space's own items with a similar title (R15: never another space's). */
async function ownItems(s: Scoped | undefined, title: string, excludeId?: string): Promise<Candidate[]> {
  if (!s) return [];
  const rows = await s.pick({ id: schema.items.id, title: schema.items.title, imageUrl: schema.items.imageUrl, imageSource: schema.items.imageSource, imageCheck: schema.items.imageCheck }, schema.items, isNotNull(schema.items.imageUrl));
  return rows
    .filter((r) => r.id !== excludeId && r.imageUrl && r.imageSource !== "icon" && r.imageSource !== "generic" && !r.imageCheck)
    .map((r) => ({ r, score: titleSimilarity(title, r.title) }))
    .filter((x) => x.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ r, score }) => ({ url: r.imageUrl!, source: "own" as const, title: r.title, score }));
}

async function google(q: string, brand: string | null, he: boolean, source: "search" | "generic" = "search"): Promise<Candidate[]> {
  if (!searchProvider() || !q.trim()) return [];
  const raw = await cached<RawImage>(cacheKey(`img-${he ? "he" : "en"}`, q), () => imageSearch(q, 10, he ? { gl: "il", hl: "iw" } : {}));
  return filterImageResults(raw, { brand, source });
}

/** Mock mode: deterministic local pictures (SVG packshots labelled with the product type), no network. */
function mockCandidates(info: LineInfo): Candidate[] {
  const hue = [...info.type].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return [0, 1, 2].map((k) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" rx="28" fill="hsl(${(hue + k * 40) % 360} 55% 70%)"/><rect x="70" y="40" width="100" height="160" rx="18" fill="#fff" opacity=".85"/><text x="120" y="128" font-size="22" text-anchor="middle" font-family="sans-serif" fill="#333">${(info.iconKeyword || "item").slice(0, 10)} ${k + 1}</text></svg>`;
    return { url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, source: k === 2 ? ("generic" as const) : ("search" as const), title: `${info.nameEn} ${k + 1}` };
  });
}

/** Up to 6 candidates from the first source that has good ones (barcode → own → Google he/en → OFF → generic → icon). */
export async function findCandidates(info: LineInfo, opts: { excludeId?: string; s?: Scoped } = {}): Promise<Candidate[]> {
  if (mockAi()) return mockCandidates(info);
  // Own items with a similar title lead, but don't end the search on their own: one old picture is a weak set to
  // choose from (and may no longer load), so Google's results fill the rest and the vision pick decides.
  const own = await ownItems(opts.s, info.nameHe || info.raw, opts.excludeId)
    .then((a) => (a.length ? a : ownItems(opts.s, info.raw, opts.excludeId)))
    .catch(() => []);
  const steps: (() => Promise<Candidate[]>)[] = [
    () => (info.barcode ? offByBarcode(info.barcode) : Promise.resolve([])),
    async () => {
      const he = await google(info.queryHe, info.brand, true);
      const g = he.length >= 2 ? he : [...he, ...(await google(info.queryEn, info.brand, false))];
      return [...own, ...g];
    },
    () => Promise.resolve(own),
    () => offByName(info.queryEn || info.nameEn, "off"),
    async () => {
      const g = [...(info.typeHe ? await google(info.typeHe, null, true, "generic") : []), ...(await google(info.type, null, false, "generic"))];
      return g.length ? g.slice(0, 6) : offByName(info.type, "generic");
    },
  ];
  for (const step of steps) {
    const got = await step().catch(() => []);
    if (got.length) return dedupe(got);
  }
  const icon = await iconForKeyword(info.iconKeyword).catch(() => null);
  return icon ? [icon] : [];
}

const dedupe = (cs: Candidate[]) => cs.filter((c, i) => cs.findIndex((x) => x.url === c.url) === i).slice(0, 6);

/** Fluent Emoji (Iconify, MIT) for a keyword: up to `n` icons as SVG data URLs (cached). */
export async function iconsForKeyword(word: string, n = 4): Promise<Candidate[]> {
  const kw = (word || "package").toLowerCase().trim().slice(0, 30);
  return cached(cacheKey("icon", `${kw}:${n}`), async () => {
    const out: Candidate[] = [];
    try {
      const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(kw)}&prefixes=fluent-emoji&limit=${n + 2}`, { signal: AbortSignal.timeout(5000) });
      const names = ((await r.json()) as { icons?: string[] }).icons ?? [];
      for (const name of names.slice(0, n)) {
        const svg = await (await fetch(`https://api.iconify.design/${name.replace(":", "/")}.svg?height=256`, { signal: AbortSignal.timeout(5000) })).text();
        if (svg.startsWith("<svg") && svg.length < 200_000) out.push({ url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, source: "icon", title: name });
      }
    } catch {}
    return out;
  });
}

async function iconForKeyword(word: string): Promise<Candidate | null> {
  return (await iconsForKeyword(word, 1))[0] ?? (word !== "package" ? (await iconsForKeyword("package", 1))[0] ?? null : null);
}

/** Free-text search from the picker (Hebrew or English): Google first, then Open Food Facts. */
export async function searchCandidates(q: string): Promise<Candidate[]> {
  const info = heuristicLineInfo(q);
  if (mockAi()) return mockCandidates({ ...info, iconKeyword: q.slice(0, 10) });
  const he = /[֐-׿]/.test(q);
  const g = await google(q, info.brand, he);
  if (g.length) return g;
  return offByName(q, "off");
}

// ---------- D3 ----------

async function thumb(url: string): Promise<AiFile | null> {
  try {
    const buf = url.startsWith("data:")
      ? Buffer.from(url.split(",")[1] ?? "", "base64")
      : (await safeFetch(url, { headers: { ...UA, accept: "image/*" }, timeoutMs: 5000 })).body;
    const jpg = await sharp(buf, { failOn: "none" }).flatten({ background: "#ffffff" }).resize(192, 192, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    return { mimeType: "image/jpeg", data: jpg.toString("base64") };
  } catch {
    return null;
  }
}

const RANK_SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object", properties: { item: { type: "number" }, image: { type: ["number", "null"] }, confidence: { type: "number" } }, required: ["item", "image", "confidence"] } } },
  required: ["items"],
};

/**
 * One vision call ranks the candidate thumbnails of several items at once ("which picture shows <name, brand,
 * size>?"). Items with nothing to choose (no candidates, one exact barcode photo, only icons) skip the model.
 */
export async function rankCandidates(batch: { info: LineInfo; candidates: Candidate[] }[]): Promise<Ranked[]> {
  const picks: (Pick | null)[] = batch.map(() => null);
  const need = batch.map((b, i) => ({ ...b, i })).filter((b) => b.candidates.length > 0 && !(b.candidates[0].source === "barcode") && b.candidates.some((c) => c.source !== "icon"));
  if (mockAi()) {
    // Mock: the first candidate, sure unless it's generic.
    for (const b of need) picks[b.i] = { index: 0, confidence: 0.9 };
  } else if (need.length) {
    for (let start = 0; start < need.length; start += 4) {
      const chunk = need.slice(start, start + 4);
      const files: AiFile[] = [];
      const lines: string[] = [];
      const maps: number[][] = [];
      for (const [k, b] of chunk.entries()) {
        const thumbs = await Promise.all(b.candidates.map((c) => thumb(c.url)));
        // A picture we can't download can't be shown either: drop it before choosing.
        const ok = b.candidates.filter((_, ci) => thumbs[ci]);
        if (ok.length && ok.length < b.candidates.length) {
          batch[b.i] = { ...batch[b.i], candidates: ok };
          b.candidates = ok;
          thumbs.splice(0, thumbs.length, ...thumbs.filter(Boolean));
        }
        const idx: number[] = [];
        const nums: number[] = [];
        thumbs.forEach((t, ci) => {
          if (!t) return;
          files.push(t);
          idx.push(ci);
          nums.push(files.length);
        });
        maps.push(idx);
        const what = [b.info.nameEn, b.info.brand && `brand ${b.info.brand}`, b.info.size && `size ${b.info.size}`, b.info.nameHe !== b.info.nameEn && `(Hebrew: ${b.info.nameHe})`].filter(Boolean).join(", ");
        lines.push(`Item ${k + 1}: ${what} — images ${nums.length ? nums.join(", ") : "none"}`);
      }
      if (!files.length) continue;
      const prompt = `You see ${files.length} product photos, numbered 1..${files.length} in the order given. For each item below, pick the image that best shows that exact product (same product, brand and size when visible; a packshot rather than a logo, banner or collage). If none shows it, answer null. "confidence" 0–1 = how sure you are it is the right product.\n${lines.join("\n")}\nAnswer JSON {"items":[{"item":1,"image":<image number or null>,"confidence":0.0}]}.`;
      const out = await generateJson<{ items?: { item: number; image: number | null; confidence: number }[] }>(prompt, RANK_SCHEMA, { files, mediaResolution: "low", budgetMs: 25_000 }).catch(() => null);
      for (const a of out?.items ?? []) {
        const k = Math.round(a.item) - 1;
        const b = chunk[k];
        if (!b) continue;
        // Image numbers are global across the call: map back to this item's candidate index.
        const offset = maps.slice(0, k).reduce((n, m) => n + m.length, 0);
        const local = a.image != null ? a.image - 1 - offset : null;
        picks[b.i] = { index: local != null && local >= 0 && local < maps[k].length ? maps[k][local] : null, confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0)) };
      }
    }
  }
  return batch.map((b, i) => applyRanking(b.candidates, picks[i]));
}

/** D1 → D2 → D3 for a set of names (receipt review, backfill, re-search). Several at a time, bounded by time. */
export async function picturesFor(entries: { name: string; info?: LineInfo | null; excludeId?: string }[], budgetMs = 40_000, s?: Scoped): Promise<{ info: LineInfo; ranked: Ranked }[]> {
  const t0 = Date.now();
  const missing = entries.filter((e) => !e.info).map((e) => e.name);
  const understood = await understandLines(missing);
  const infos = entries.map((e) => e.info ?? understood[missing.indexOf(e.name)] ?? heuristicLineInfo(e.name));
  const cands: Candidate[][] = infos.map(() => []);
  for (let i = 0; i < infos.length && Date.now() - t0 < budgetMs; i += 4) {
    const got = await Promise.all(infos.slice(i, i + 4).map((info, k) => findCandidates(info, { excludeId: entries[i + k].excludeId, s }).catch(() => [])));
    got.forEach((g, k) => (cands[i + k] = g));
  }
  const ranked = await rankCandidates(infos.map((info, i) => ({ info, candidates: cands[i] })));
  return infos.map((info, i) => ({ info, ranked: ranked[i] }));
}
