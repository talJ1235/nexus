"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { aiEnabled, generateJson } from "@/lib/ai";
import { mockAi } from "@/lib/assistant";
import { assertOwner } from "@/lib/auth";
import { getItem } from "@/lib/data";
import { dayKeyIn, HIDE_MS } from "@/lib/home";
import { HOME_AI_KEY, HOME_DISMISSED_KEY, parseDismissed } from "@/lib/home-prefs";
import { kvGet, kvSet } from "@/lib/kv";
import { createItemCore } from "@/lib/service";
import type { ItemWithSources } from "@/lib/types";

/** Hide a Needs-you row (or snooze a suggestion, key "sug:…") for 7 days. Returns the new map. */
export async function dismissHome(key: string): Promise<Record<string, number>> {
  await assertOwner();
  const k = z.string().min(1).max(300).parse(key);
  const map = parseDismissed(await kvGet(HOME_DISMISSED_KEY));
  map[k] = Date.now() + HIDE_MS;
  await kvSet(HOME_DISMISSED_KEY, JSON.stringify(map));
  return map;
}

export async function undismissHome(key: string): Promise<Record<string, number>> {
  await assertOwner();
  const map = parseDismissed(await kvGet(HOME_DISMISSED_KEY));
  delete map[z.string().max(300).parse(key)];
  await kvSet(HOME_DISMISSED_KEY, JSON.stringify(map));
  return map;
}

/** Settings → Assistant → "AI-written suggestions". */
export async function setAiSuggestions(on: boolean): Promise<boolean> {
  await assertOwner();
  await kvSet(HOME_AI_KEY, z.boolean().parse(on) ? null : "off");
  return on;
}

/** "Add to list" for something bought before (reorder due): a new to-buy item with the same picture and links. */
export async function buyAgain(itemId: string): Promise<ItemWithSources> {
  await assertOwner();
  const old = await getItem(z.string().min(1).max(40).parse(itemId));
  if (!old) throw new Error("not_found");
  const src = (old.chosenSourceId && old.sources.find((s) => s.id === old.chosenSourceId)) || old.sources[0] || null;
  const created = await createItemCore({
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
  if (old.imageSource) await db.update(schema.items).set({ imageSource: old.imageSource }).where(eq(schema.items.id, created.id));
  return (await getItem(created.id))!;
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
  await assertOwner();
  const cands = candSchema.parse(raw);
  const lang = locale === "he" ? "he" : "en";
  if (!cands.length || (await kvGet(HOME_AI_KEY)) === "off" || !(aiEnabled() || mockAi())) return {};
  const date = dayKeyIn(Date.now(), "Asia/Jerusalem");
  const key = `home:ai:${date}:${lang}`;
  let cache: Cache | null = null;
  try {
    cache = JSON.parse((await kvGet(key)) ?? "null");
  } catch {}
  if (cache && !cache.failedAt) return cache.map;
  // A failed call is retried after 3 h, not on every page load.
  if (cache?.failedAt && Date.now() - cache.failedAt < 3 * 3_600_000) return {};

  let map: Phrased = {};
  if (mockAi()) {
    for (const c of cands) map[c.key] = { title: `✦ ${lang === "he" ? "הצעה" : "Suggestion"}: ${String(c.facts.item ?? c.facts.project ?? c.kind)}`, why: lang === "he" ? "נוסח על ידי הבינה (דמה)" : "Phrased by the AI (mock)" };
  } else {
    const prompt = [
      `You write the "Nexus suggests" card of a personal shopping app. For each suggestion below, write a short title (max 80 characters) and a "why" line (max 70 characters) in ${lang === "he" ? "Hebrew" : "English"}.`,
      "Use only the facts given; never invent prices, dates or numbers. Friendly, plain, no emoji, no exclamation marks.",
      "Kinds: deal = an item is cheaper than its usual price (pct = % under usual; partner = another item that makes the order ship free); reorder = bought regularly (everyDays) and due again; wait = price is usually lowest on weekday `day` (0 = Sunday); budget = a project has no budget while similar ones cost min–max.",
      JSON.stringify(cands.map((c) => ({ key: c.key, kind: c.kind, facts: c.facts }))),
    ].join("\n\n");
    const res = await generateJson<{ items: { key: string; title: string; why: string }[] }>(
      prompt,
      { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { key: { type: "string" }, title: { type: "string" }, why: { type: "string" } }, required: ["key", "title", "why"] } } }, required: ["items"] },
      { budgetMs: 12_000 },
    ).catch(() => null);
    const known = new Set(cands.map((c) => c.key));
    for (const x of res?.items ?? []) if (known.has(x.key) && x.title?.trim()) map[x.key] = { title: x.title.trim().slice(0, 120), why: (x.why ?? "").trim().slice(0, 110) };
    if (!Object.keys(map).length) {
      await kvSet(key, JSON.stringify({ at: Date.now(), map: {}, failedAt: Date.now() } satisfies Cache));
      return {};
    }
  }
  await kvSet(key, JSON.stringify({ at: Date.now(), map } satisfies Cache));
  map = Object.fromEntries(Object.entries(map).filter(([k]) => cands.some((c) => c.key === k)));
  return map;
}
