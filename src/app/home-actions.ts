"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { aiEnabled, generateJson } from "@/lib/ai";
import { aiUse } from "@/lib/ai-gate";
import { mockAi, snapshot } from "@/lib/assistant";
import { requireCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { spacePrefGet, spacePrefSet, userPrefGet, userPrefSet } from "@/lib/db-scoped/prefs";
import { getAppData, getItem } from "@/lib/data";
import { dayKeyIn, HIDE_MS } from "@/lib/home";
import { HOME_AI_CACHE_V, normalizeHomeAi, normalizeMoney, normalizePhrased, numbersIn, validateHomeAi, type HomeAi } from "@/lib/home-ai";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { HOME_AI_KEY, HOME_DISMISSED_KEY, HOME_LAYOUT_KEY, homeLayoutKey, NOTIFY_KEY, parseDismissed } from "@/lib/home-prefs";
import { parseLayout, serialize, type HomeLayout } from "@/lib/home-layout";
import { setAlertPrefs } from "@/lib/tracker";
import type { NotifyPrefs } from "@/lib/home";
import { kvGet, kvSet } from "@/lib/kv";
import { createItemCore } from "@/lib/service";
import type { ItemWithSources } from "@/lib/types";

/** Hide a Needs-you row (or snooze a suggestion, key "sug:…") for 7 days. Returns the new map. */
export async function dismissHome(key: string): Promise<Record<string, number>> {
  const ctx = await requireCtx("view");
  const k = z.string().min(1).max(300).parse(key);
  const map = parseDismissed(await userPrefGet(ctx.user.id, HOME_DISMISSED_KEY));
  map[k] = Date.now() + HIDE_MS;
  await userPrefSet(ctx.user.id, HOME_DISMISSED_KEY, JSON.stringify(map));
  return map;
}

export async function undismissHome(key: string): Promise<Record<string, number>> {
  const ctx = await requireCtx("view");
  const map = parseDismissed(await userPrefGet(ctx.user.id, HOME_DISMISSED_KEY));
  delete map[z.string().max(300).parse(key)];
  await userPrefSet(ctx.user.id, HOME_DISMISSED_KEY, JSON.stringify(map));
  return map;
}

/** Settings → Assistant → "AI-written suggestions". */
export async function setAiSuggestions(on: boolean): Promise<boolean> {
  const ctx = await requireCtx("view");
  await userPrefSet(ctx.user.id, HOME_AI_KEY, z.boolean().parse(on) ? null : "off");
  return on;
}

/** R16 D1: Settings → Notifications (in the app). The drop threshold goes to the tracker's alert prefs. */
/** R17 D3: Notifications on / off (Settings → Account). Off = nothing is sent; the bell still collects. */
export async function setNotificationsOn(on: boolean): Promise<boolean> {
  const ctx = await requireCtx("view");
  const v = z.boolean().parse(on);
  await userPrefSet(ctx.user.id, NOTIFY_KEY, JSON.stringify({ on: v }));
  return v;
}

/** R16 E1: Home's layout for this space (also remembered as the person's last layout). Personal — viewers too. */
export async function saveHomeLayout(layout: HomeLayout): Promise<HomeLayout> {
  const ctx = await requireCtx("view");
  const raw = JSON.stringify(layout);
  if (raw.length > 4000) throw new Error("too_large");
  const v = parseLayout(raw);
  if (!v) throw new Error("invalid");
  const out = serialize(v);
  await Promise.all([userPrefSet(ctx.user.id, homeLayoutKey(ctx.space.id), out), userPrefSet(ctx.user.id, HOME_LAYOUT_KEY, out)]);
  return v;
}

/** "Add to list" for something bought before (reorder due): a new to-buy item with the same picture and links. */
export async function buyAgain(itemId: string): Promise<ItemWithSources> {
  const s = scoped(await requireCtx("edit"));
  const old = await getItem(s, z.string().min(1).max(40).parse(itemId));
  if (!old) throw new Error("not_found");
  const src = (old.chosenSourceId && old.sources.find((s) => s.id === old.chosenSourceId)) || old.sources[0] || null;
  const created = await createItemCore(s, {
    title: old.title,
    brand: old.brand,
    imageUrl: old.imageUrl,
    category: old.category,
    tags: old.tags,
    collectionId: old.collectionId,
    quantity: old.quantity,
    gtin: old.gtin,
    source: src
      ? { url: src.url, normalizedUrl: src.normalizedUrl, store: src.store, storeKey: src.storeKey, price: src.price, currency: src.currency, shipping: src.shipping, availability: src.availability, rawTitle: src.rawTitle, extractMethod: src.extractMethod ?? "copy", gtin: src.gtin }
      : null,
  });
  if (old.imageSource) await s.update(schema.items, { imageSource: old.imageSource }, eq(schema.items.id, created.id));
  return (await getItem(s, created.id))!;
}

const candSchema = z.array(z.object({ key: z.string().max(200), kind: z.string().max(20), facts: z.record(z.string(), z.union([z.string().max(200), z.number(), z.null()])) })).max(4);
export type Phrased = Record<string, { title: string; why: string }>;
type Cache = { at: number; map: Phrased; failedAt?: number };

/**
 * "Nexus suggests" phrasing (A3): once a day, only the facts go to the AI chain (Gemini → Groq/OpenRouter); one short
 * title + why per key comes back and is cached in kv by date + language. Off, no key, or any failure → {} (the UI keeps
 * its templates). Keys first seen after today's call stay on templates until tomorrow (the once-a-day cost cap).
 */
export async function phraseSuggestions(raw: unknown, locale: string): Promise<Phrased> {
  const ctx = await requireCtx("view");
  const s = scoped(ctx);
  const cands = candSchema.parse(raw);
  const lang = locale === "he" ? "he" : "en";
  if (!cands.length || (await userPrefGet(ctx.user.id, HOME_AI_KEY)) === "off" || !(aiEnabled() || mockAi())) return {};
  const date = dayKeyIn(Date.now(), "Asia/Jerusalem");
  const key = `home:ai:${HOME_AI_CACHE_V}:${date}:${lang}`;
  let cache: Cache | null = null;
  try {
    cache = JSON.parse((await spacePrefGet(s, key)) ?? "null");
  } catch {}
  if (cache && !cache.failedAt) return normalizePhrased(cache.map, lang);
  // A failed call is retried after 3 h, not on every page load.
  if (cache?.failedAt && Date.now() - cache.failedAt < 3 * 3_600_000) return {};

  let map: Phrased = {};
  if (mockAi()) {
    for (const c of cands) map[c.key] = { title: `✦ ${lang === "he" ? "הצעה" : "Suggestion"}: ${String(c.facts.item ?? c.facts.project ?? c.kind)}`, why: lang === "he" ? "נוסח על ידי הבינה (דמה)" : "Phrased by the AI (mock)" };
  } else {
    // R17 P5: money facts go in formatted (the sign, never a word), and the answer is normalised the same way.
    const MONEY_FACTS = new Set(["saving", "min", "max", "price", "usual", "now", "was"]);
    const facts = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, MONEY_FACTS.has(k) && typeof v === "number" ? formatMoney(v, ctx.space.currency, lang) : v]));
    const prompt = [
      `You write the "Nexus suggests" card of a personal shopping app. For each suggestion below, write a short title (max 80 characters) and a "why" line (max 70 characters) in ${lang === "he" ? "Hebrew" : "English"}.`,
      "Use only the facts given; never invent prices, dates or numbers. Friendly, plain, no emoji, no exclamation marks.",
      "Write money exactly as the facts write it, with its currency sign — never as a word (not \"שקל\", \"ש״ח\", \"NIS\", \"shekels\").",
      "Kinds: deal = an item is cheaper than its usual price (pct = % under usual; partner = another item that makes the order ship free); reorder = bought regularly (everyDays) and due again; wait = price is usually lowest on weekday `day` (0 = Sunday); budget = a project has no budget while similar ones cost min–max.",
      JSON.stringify(cands.map((c) => ({ key: c.key, kind: c.kind, facts: facts(c.facts) }))),
    ].join("\n\n");
    const res = await generateJson<{ items: { key: string; title: string; why: string }[] }>(
      prompt,
      { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { key: { type: "string" }, title: { type: "string" }, why: { type: "string" } }, required: ["key", "title", "why"] } } }, required: ["items"] },
      { use: aiUse(ctx, "suggestions"), budgetMs: 12_000 },
    ).catch(() => null);
    const known = new Set(cands.map((c) => c.key));
    for (const x of res?.items ?? []) if (known.has(x.key) && x.title?.trim()) map[x.key] = { title: normalizeMoney(x.title.trim().slice(0, 120), lang), why: normalizeMoney((x.why ?? "").trim().slice(0, 110), lang) };
    if (!Object.keys(map).length) {
      await spacePrefSet(s, key, JSON.stringify({ at: Date.now(), map: {}, failedAt: Date.now() } satisfies Cache));
      return {};
    }
  }
  await spacePrefSet(s, key, JSON.stringify({ at: Date.now(), map } satisfies Cache));
  map = Object.fromEntries(Object.entries(map).filter(([k]) => cands.some((c) => c.key === k)));
  return map;
}

// ---------- Round 14 A2: the AI's look at Home + diagnostics ----------

const DIAG_KEY = "home:ai:diag";
export type HomeDiag = { at: number; source: "rules" | "ai"; n: number; error: string | null };
type LookCache = { at: number; ai: HomeAi | null; failedAt?: number; error?: string };
const n20 = z.number().int().min(0).max(20);
const lookInput = z.object({ ruleSugs: n20, ruleIns: n20, fbSugs: n20, fbIns: n20, currency: z.enum(CURRENCIES), locale: z.enum(["en", "he"]) });

async function writeDiag(d: Omit<HomeDiag, "at">) {
  let old: HomeDiag | null = null;
  try {
    old = JSON.parse((await kvGet(DIAG_KEY)) ?? "null");
  } catch {}
  const today = dayKeyIn(Date.now(), "Asia/Jerusalem");
  // One write per change (not on every Home load).
  if (old && dayKeyIn(old.at, "Asia/Jerusalem") === today && old.source === d.source && old.n === d.n && old.error === d.error) return;
  await kvSet(DIAG_KEY, JSON.stringify({ ...d, at: Date.now() } satisfies HomeDiag));
}

/** Settings → Assistant: when Home suggestions last ran, from what, and the last error. */
export async function homeDiag(): Promise<HomeDiag | null> {
  await requireCtx("view");
  try {
    return JSON.parse((await kvGet(DIAG_KEY)) ?? "null");
  } catch {
    return null;
  }
}

/** Canned look for mock mode: real ids, plus one unknown id and one invented number that validation must drop. */
function mockLook(data: Awaited<ReturnType<typeof getAppData>>, he: boolean) {
  const toBuy = data.items.find((i) => i.status === "to_buy");
  const bought = data.items.find((i) => i.status === "purchased");
  const coll = data.collections[0];
  const unit = toBuy?.sources[0]?.price;
  return {
    suggestions: [
      toBuy && { title: `${he ? "שווה לבדוק את" : "Take another look at"} ${toBuy.title.slice(0, 40)}`, why: he ? "נכתב על ידי הבינה (דמה)" : "Written by the AI (mock)", action: { type: "open", itemId: toBuy.id } },
      bought && { title: `${he ? "לקנות שוב" : "Buy again"}: ${bought.title.slice(0, 40)}`, why: he ? "נקנה בעבר" : "You bought it before", action: { type: "add", itemId: bought.id } },
      coll && { title: `${he ? "תקציב ל" : "A budget for "}${coll.name}`, why: he ? "עוזר לעקוב" : "Helps you keep track", action: { type: "budget", collectionId: coll.id } },
      { title: "Unknown item", why: "", action: { type: "open", itemId: "no-such-item" } },
    ].filter(Boolean),
    insights: [
      toBuy && { text: unit != null ? `${toBuy.title.slice(0, 40)}: ${unit}` : toBuy.title.slice(0, 40), action: { type: "open", itemId: toBuy.id } },
      { text: he ? "חסכת 999,999 השנה" : "You saved 999,999 this year" },
    ].filter(Boolean),
  };
}

/**
 * Once a day, when the rules give < 2 suggestions or < 2 insights: the chat's compact snapshot goes to the AI chain,
 * which returns ≤ 3 suggestions + ≤ 3 insights (unknown ids and invented numbers dropped). Cached in kv by day +
 * language; a failure retries after 3 h. Off / no key → no AI call. Always returns the receipt count (a fallback fact).
 */
export async function homeLook(raw: unknown): Promise<{ ai: HomeAi | null; receipts: number }> {
  const ctx = await requireCtx("view");
  const s = scoped(ctx);
  const input = lookInput.parse(raw);
  const receipts = await s.count(schema.receipts);
  // What Home shows: rules, then the AI, then the fallbacks (≤ 4 suggestions + ≤ 3 insights). The receipt fallback is
  // only known here.
  const fbSugs = input.fbSugs + (receipts === 0 ? 1 : 0);
  const shown = (ai: HomeAi | null) => Math.min(4, input.ruleSugs + (ai?.suggestions.length ?? 0) + fbSugs) + Math.min(3, input.ruleIns + (ai?.insights.length ?? 0) + input.fbIns);
  const rules = shown(null);
  if ((await userPrefGet(ctx.user.id, HOME_AI_KEY)) === "off" || !(aiEnabled() || mockAi())) {
    await writeDiag({ source: "rules", n: rules, error: null });
    return { ai: null, receipts };
  }
  const key = `home:look:${HOME_AI_CACHE_V}:${dayKeyIn(Date.now(), "Asia/Jerusalem")}:${input.locale}`;
  let cache: LookCache | null = null;
  try {
    cache = JSON.parse((await spacePrefGet(s, key)) ?? "null");
  } catch {}
  if (cache && !cache.failedAt) {
    await writeDiag(cache.ai ? { source: "ai", n: shown(cache.ai), error: null } : { source: "rules", n: rules, error: null });
    return { ai: normalizeHomeAi(cache.ai, input.locale), receipts };
  }
  if (input.ruleSugs >= 2 && input.ruleIns >= 2) {
    await writeDiag({ source: "rules", n: rules, error: null });
    return { ai: null, receipts };
  }
  if (cache?.failedAt && Date.now() - cache.failedAt < 3 * 3_600_000) return { ai: null, receipts };

  const data = await getAppData(s, ctx.user.id);
  // R17 P5: amounts as the app shows them (the sign, never a word); always "₪45" order so the model sees one form.
  const { lines, projects } = snapshot(data, input.currency, data.rates, (n) => formatMoney(n, input.currency, "en"));
  const known = numbersIn([...lines, ...projects].join("\n"));
  const ids = { items: new Set(data.items.map((i) => i.id)), collections: new Set(data.collections.map((c) => c.id)) };
  let rawAi: unknown = null;
  let error: string | null = null;
  if (mockAi()) rawAi = mockLook(data, input.locale === "he");
  else {
    const lang = input.locale === "he" ? "Hebrew" : "English";
    const act = { type: "object", properties: { type: { type: "string", enum: ["open", "add", "budget", "none"] }, itemId: { type: "string" }, collectionId: { type: "string" } }, required: ["type"] };
    const prompt = [
      `You are Nexus, the assistant of a personal shopping app. Look at the user's data below and write, in ${lang}:`,
      `- up to 3 suggestions for the "Nexus suggests" card: a short title (max 80 characters), a "why" line (max 70 characters) and an action — open an item (itemId), add a bought item to the list again (add + itemId), set a project's budget (budget + collectionId), or none;`,
      `- up to 3 short insights (one sentence each) for "Nexus noticed", each optionally with an action.`,
      "Use ONLY ids from the data ([[itemId]] for items, [id] for projects). Use only numbers that appear in the data — never compute or invent figures. Plain, friendly, no emoji, no exclamation marks. Skip anything you're not sure of.",
      `Write every amount of money exactly as it is written in the data, with its currency sign (e.g. ${formatMoney(45, input.currency, input.locale)}) — never as a word (not "שקל", "שקלים", "ש״ח", "NIS", "shekels", "dollars" or "euros").`,
      `Today is ${new Date().toISOString().slice(0, 10)}. Money is in ${input.currency}.`,
      `PROJECTS & LISTS\n${projects.join("\n") || "(none)"}`,
      `ITEMS\n${lines.join("\n") || "(none)"}`,
    ].join("\n\n");
    rawAi = await generateJson(
      prompt,
      {
        type: "object",
        properties: {
          suggestions: { type: "array", items: { type: "object", properties: { title: { type: "string" }, why: { type: "string" }, action: act }, required: ["title", "why", "action"] } },
          insights: { type: "array", items: { type: "object", properties: { text: { type: "string" }, action: act }, required: ["text"] } },
        },
        required: ["suggestions", "insights"],
      },
      { use: aiUse(ctx, "suggestions"), budgetMs: 15_000 },
    ).catch((e: unknown) => ((error = e instanceof Error ? e.message.slice(0, 160) : "failed"), null));
    if (rawAi == null && !error) error = "no answer";
  }
  const ai = rawAi == null ? null : validateHomeAi(rawAi, ids, known, input.locale);
  if (!ai) {
    await spacePrefSet(s, key, JSON.stringify({ at: Date.now(), ai: null, failedAt: Date.now(), error: error ?? "failed" } satisfies LookCache));
    await writeDiag({ source: "rules", n: rules, error: error ?? "failed" });
    return { ai: null, receipts };
  }
  await spacePrefSet(s, key, JSON.stringify({ at: Date.now(), ai } satisfies LookCache));
  await writeDiag({ source: "ai", n: shown(ai), error: null });
  return { ai, receipts };
}
