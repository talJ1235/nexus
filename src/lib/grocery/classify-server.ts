import "server-only";
import { generateJson } from "../ai";
import type { AiUse } from "../ai-gate";
import { mockAi } from "../assistant";
import { kvGet, kvSet } from "../kv";
import { safeFetch } from "../safe-fetch";
import { classifyLocal, gtinKey, productKeyFor, type Classified } from "./classify";
import { TYPE_BY_KEY } from "./dictionary";
import { normalize } from "./normalize";
import { isSection, SECTION_KEYS } from "./sections";

// R18 A4 — classify(text, gtin?) on the server: the dictionary first, then Open Food Facts categories for a barcode,
// then ONE batched AI call for whatever is still unknown (counts in the AI quota, cached per normalised text). Adding
// never waits for the AI: an unknown line goes to section `other` and is fixed when the answer arrives (classifyLater).

const OFF_TTL = 30 * 86_400_000;
const UA = { "User-Agent": "Nexus/1.0 (personal shopping list; https://nexus-ashen-beta.vercel.app)" };

/** Open Food Facts category tags → a section (the first tag that maps wins; tags run broad → specific, so scan all). */
const OFF_MAP: [RegExp, string][] = [
  [/frozen|surgel/, "frozen"],
  [/baby-food|infant|baby-milk|follow-on/, "baby"],
  [/pet-food|cat-food|dog-food/, "pets"],
  [/dairies|dairy|milks|cheeses|yogurts|yoghurts|eggs|butters|creams/, "dairy"],
  [/breads|bakery|pastries|cakes|viennoiseries|pitas/, "bread"],
  [/beverages|drinks|waters|juices|sodas|wines|beers/, "drink"],
  [/snacks|sweets|chocolates|candies|biscuits|cookies|chips|crisps/, "snack"],
  [/breakfast|cereals|spreads|honeys|jams|coffees|teas/, "bfast"],
  [/spices|condiments|salts|sugars|flours|baking/, "spice"],
  [/canned|sauces|oils|vinegars|pickles|tahini|preserves/, "cans"],
  [/pastas|rices|legumes|pulses|cereal-grains|seeds|dried/, "dry"],
  [/meats|poultry|fishes|seafood|chickens|beef/, "meat"],
  [/salads|spreads-salty|hummus|delicatessen|cold-cuts|sausages/, "deli"],
  [/fruits|vegetables|fresh-herbs|plant-based-foods(?!-and)/, "produce"],
  [/cleaning|detergents|dishwashing|household/, "clean"],
  [/hygiene|cosmetics|toothpastes|shampoos|soaps/, "toil"],
];

export function sectionFromOff(tags: string[]): string | null {
  for (const [re, section] of OFF_MAP) if (tags.some((t) => re.test(t))) return section;
  return null;
}

/** Open Food Facts for one barcode → section + name (cached 30 days in kv). */
export async function offClassify(gtin: string): Promise<{ section: string | null; name: string | null } | null> {
  const code = gtin.replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(code)) return null;
  const key = `grocery:off:${code}`;
  const cached = await kvGet(key).catch(() => null);
  if (cached) {
    const c = JSON.parse(cached) as { v: { section: string | null; name: string | null } | null; at: number };
    if (Date.now() - c.at < OFF_TTL) return c.v;
  }
  let v: { section: string | null; name: string | null } | null = null;
  try {
    const res = await safeFetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=categories_tags,product_name,product_name_he`, { headers: UA, timeoutMs: 5000, maxBytes: 1_000_000 });
    const r = res.ok ? (JSON.parse(res.text) as { status?: number; product?: { categories_tags?: string[]; product_name?: string; product_name_he?: string } }) : null;
    if (r?.status === 1 && r.product) v = { section: sectionFromOff(r.product.categories_tags ?? []), name: r.product.product_name_he || r.product.product_name || null };
  } catch {
    return null; // offline / slow: no cache entry, try again next time
  }
  await kvSet(key, JSON.stringify({ v, at: Date.now() })).catch(() => {});
  return v;
}

/** Dictionary, then Open Food Facts for a barcode (never the AI: that one is batched, see classifyUnknown). */
export async function classify(text: string, gtin?: string | null): Promise<Classified> {
  const local = classifyLocal(text, gtin);
  if (local.type || !gtin) return local;
  const off = await offClassify(gtin);
  if (off?.section && isSection(off.section)) return { ...local, section: off.section, confidence: 0.6, via: "barcode", productKey: gtinKey(gtin) };
  if (off?.name) {
    const byName = classifyLocal(off.name, gtin);
    if (byName.type) return { ...byName, confidence: 0.6, via: "barcode" };
  }
  return local;
}

type AiAnswer = { section: string; type: string | null };
const aiKey = (text: string) => `grocery:ai:${normalize(text).slice(0, 160)}`;

/**
 * One AI call for every line the dictionary doesn't know (cached per normalised text, so a line is asked once).
 * Returns text → { section, type } for the ones answered. Rules-only / over quota → empty (they stay in `other`).
 */
export async function classifyUnknown(texts: string[], use: AiUse): Promise<Map<string, AiAnswer>> {
  const out = new Map<string, AiAnswer>();
  const ask: string[] = [];
  for (const t of [...new Set(texts.map((x) => x.trim()).filter(Boolean))].slice(0, 40)) {
    const c = await kvGet(aiKey(t)).catch(() => null);
    if (c) out.set(t, JSON.parse(c) as AiAnswer);
    else ask.push(t);
  }
  if (!ask.length) return out;
  let answers: { i: number; section: string; type: string | null }[] | null = null;
  if (mockAi()) answers = ask.map((_, i) => ({ i, section: "other", type: null }));
  else {
    const prompt = `Sort these grocery-list lines (Hebrew or English, from Israeli households) into supermarket sections.
Sections (use the key): ${SECTION_KEYS.join(", ")}. "type": the closest of these product types if one fits, else null: ${[...TYPE_BY_KEY.keys()].join(", ")}.
Lines: ${JSON.stringify(ask.map((text, i) => ({ i, text })))}`;
    const schema = {
      type: "object",
      properties: { lines: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, section: { type: "string", enum: [...SECTION_KEYS, "other"] }, type: { type: ["string", "null"] } }, required: ["i", "section", "type"] } } },
      required: ["lines"],
    };
    answers = (await generateJson<{ lines: { i: number; section: string; type: string | null }[] }>(prompt, schema, { use, budgetMs: 12_000 }).catch(() => null))?.lines ?? null;
  }
  for (const a of answers ?? []) {
    const t = ask[a.i];
    if (!t) continue;
    const v: AiAnswer = { section: isSection(a.section) ? a.section : "other", type: a.type && TYPE_BY_KEY.has(a.type) ? a.type : null };
    out.set(t, v);
    if (v.section !== "other") await kvSet(aiKey(t), JSON.stringify(v)).catch(() => {});
  }
  return out;
}

/** The AI's answer as a classification (product key from the type it named, when it named one). */
export function fromAi(text: string, a: AiAnswer, gtin?: string | null): Classified {
  const type = a.type ? TYPE_BY_KEY.get(a.type) ?? null : null;
  return { type: type?.key ?? null, section: (isSection(a.section) ? a.section : "other") as Classified["section"], unit: type?.unit ?? "u", art: type?.art ?? null, productKey: productKeyFor(text, type, gtin), confidence: 0.6, via: "ai" };
}

/** C3: Open Food Facts Israel product names for a typed query (5 at most; cached a week per query). */
export async function offSearch(query: string): Promise<{ title: string; productKey: string; section: string }[]> {
  const q = normalize(query);
  if (q.length < 3 || mockAi()) return [];
  const key = `grocery:offq:${q.slice(0, 60)}`;
  const cached = await kvGet(key).catch(() => null);
  if (cached) {
    const c = JSON.parse(cached) as { v: { title: string; productKey: string; section: string }[]; at: number };
    if (Date.now() - c.at < 7 * 86_400_000) return c.v;
  }
  let v: { title: string; productKey: string; section: string }[] = [];
  try {
    const res = await safeFetch(`https://il.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&json=1&page_size=5&fields=code,product_name,product_name_he,categories_tags`, { headers: UA, timeoutMs: 2500, maxBytes: 500_000 });
    const r = res.ok ? (JSON.parse(res.text) as { products?: { code?: string; product_name?: string; product_name_he?: string; categories_tags?: string[] }[] }) : null;
    v = (r?.products ?? [])
      .map((p) => ({ title: (p.product_name_he || p.product_name || "").trim(), code: p.code ?? "", tags: p.categories_tags ?? [] }))
      .filter((p) => p.title)
      .map((p) => {
        const local = classifyLocal(p.title, p.code || null);
        return { title: p.title.slice(0, 120), productKey: local.productKey, section: local.type ? local.section : (sectionFromOff(p.tags) ?? "other") };
      });
  } catch {
    return [];
  }
  await kvSet(key, JSON.stringify({ v, at: Date.now() })).catch(() => {});
  return v;
}
