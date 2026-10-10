// Round 14 A2: the AI's look at Home ("Nexus suggests" / "Nexus noticed") — validation of what the model returns.
// Pure (no server imports) so the unit tests and the client can use it.

import { formatMoney } from "./money";

export type HomeAiAction = { type: "open" | "add" | "budget" | "none"; itemId?: string; collectionId?: string };
export type HomeAiSuggestion = { title: string; why: string; action: HomeAiAction };
export type HomeAiInsight = { text: string; action?: HomeAiAction };
export type HomeAi = { suggestions: HomeAiSuggestion[]; insights: HomeAiInsight[] };

/** Numbers written in a text ("₪1,234.50", "30%", "3 items" → 1234.5, 30, 3). */
export function numbersIn(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

/**
 * The number guard: every number in `text` must appear in the snapshot (exactly, or as its rounding to a whole number
 * or one decimal). A model that computes or invents a figure fails it, and the line is dropped.
 */
export function numbersKnown(text: string, known: number[]): boolean {
  const ok = new Set<number>();
  for (const m of known) {
    ok.add(m);
    ok.add(Math.round(m));
    ok.add(Math.round(m * 10) / 10);
  }
  return numbersIn(text).every((n) => ok.has(n));
}

// R17 P5: money is written the way the app writes it ("₪45" / "45 ₪"), never as a word. A word form next to a number —
// before or after it, with or without a symbol already there — becomes the formatted amount in that word's currency.
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const WORDS: [string, RegExp][] = [
  ["ILS", /^(?:שקלים|שקל|ש["״]ח|nis|ils|shekels?|sheqels?)$/iu],
  ["USD", /^(?:דולרים|דולר|dollars?|usd)$/iu],
  ["EUR", /^(?:אירו|יורו|euros?|eur)$/iu],
];
const WORD = String.raw`שקלים|שקל|ש["״]ח|NIS|ILS|shekels?|sheqels?|דולרים|דולר|dollars?|USD|אירו|יורו|euros?|EUR`;
// Not in the middle of a word on either side (word boundaries in JS regexps do not know Hebrew letters).
const AFTER = new RegExp(String.raw`(?:[₪$€]\s?)?(${NUM})(?:\s?[₪$€])?\s*(${WORD})(?![\p{L}\p{N}])`, "giu");
const BEFORE = new RegExp(String.raw`(?<![\p{L}\p{N}])(${WORD})\s*(?:[₪$€]\s?)?(${NUM})`, "giu");
const currencyOf = (word: string) => WORDS.find(([, re]) => re.test(word))?.[0] ?? "ILS";

export function normalizeMoney(text: string, locale: string): string {
  const fmt = (num: string, word: string) => {
    const n = Number(num.replace(/,/g, ""));
    return Number.isFinite(n) ? formatMoney(n, currencyOf(word), locale) : num;
  };
  return text.replace(AFTER, (_, num: string, word: string) => fmt(num, word)).replace(BEFORE, (_, word: string, num: string) => fmt(num, word));
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** An action whose ids all exist (null = it names an unknown id, so the entry is dropped). */
function action(raw: unknown, ids: { items: Set<string>; collections: Set<string> }): HomeAiAction | null {
  if (!raw || typeof raw !== "object") return { type: "none" };
  const a = raw as Record<string, unknown>;
  const type = ["open", "add", "budget", "none"].includes(a.type as string) ? (a.type as HomeAiAction["type"]) : "none";
  const itemId = typeof a.itemId === "string" && a.itemId ? a.itemId : undefined;
  const collectionId = typeof a.collectionId === "string" && a.collectionId ? a.collectionId : undefined;
  if (itemId && !ids.items.has(itemId)) return null;
  if (collectionId && !ids.collections.has(collectionId)) return null;
  if ((type === "open" || type === "add") && !itemId) return null;
  if (type === "budget" && !collectionId) return null;
  return { type, ...(itemId && { itemId }), ...(collectionId && { collectionId }) };
}

/**
 * Keep the model's suggestions (≤ 3) and insights (≤ 3) that only reference known item / project ids and only use
 * numbers present in the snapshot.
 */
export function validateHomeAi(raw: unknown, ids: { items: Set<string>; collections: Set<string> }, known: number[], locale = "en"): HomeAi {
  const r = (raw && typeof raw === "object" ? raw : {}) as { suggestions?: unknown; insights?: unknown };
  const suggestions: HomeAiSuggestion[] = [];
  for (const x of Array.isArray(r.suggestions) ? r.suggestions : []) {
    const title = normalizeMoney(str(x?.title, 120), locale);
    const why = normalizeMoney(str(x?.why, 140), locale);
    const act = action(x?.action, ids);
    if (!title || !act || !numbersKnown(`${title} ${why}`, known)) continue;
    suggestions.push({ title, why, action: act });
    if (suggestions.length === 3) break;
  }
  const insights: HomeAiInsight[] = [];
  for (const x of Array.isArray(r.insights) ? r.insights : []) {
    const text = normalizeMoney(str(x?.text, 220), locale);
    const act = x?.action == null ? undefined : action(x.action, ids);
    if (!text || act === null || !numbersKnown(text, known)) continue;
    insights.push({ text, ...(act && act.type !== "none" && { action: act }) });
    if (insights.length === 3) break;
  }
  return { suggestions, insights };
}
