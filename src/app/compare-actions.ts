"use server";

import { z } from "zod";
import { assertOwner } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";
import { mockAi } from "@/lib/assistant";
import { cachedCompare, compareQueries, pickCandidates, readCandidates, sameProduct, saveCompare, searchCandidates, toResults, type CompareResult } from "@/lib/compare";
import { getItem } from "@/lib/data";
import { CURRENCIES } from "@/lib/money";
import { getRates } from "@/lib/rates";
import { searchProvider } from "@/lib/search";
import { clientPayload, extractedFromPayload } from "@/lib/service";

export type CompareResponse =
  | { status: "ok"; results: CompareResult[]; at: number; blocked: string[] }
  /** No search key: the page asks the owner's extension to search with these queries, then calls compareVerify. */
  | { status: "browser"; queries: string[] }
  | { status: "no_ai" | "not_found" };

const currency = z.enum(CURRENCIES);

/** Start (or reuse, 24 h) a comparison for one item. Never adds anything by itself. */
export async function compareStart(raw: { itemId: string; currency: string; refresh?: boolean }): Promise<CompareResponse> {
  await assertOwner();
  const input = z.object({ itemId: z.string().max(40), currency, refresh: z.boolean().optional() }).parse(raw);
  const item = await getItem(input.itemId);
  if (!item) return { status: "not_found" };
  if (!input.refresh) {
    const c = await cachedCompare(item.id, input.currency);
    if (c) return { status: "ok", results: c.results, at: c.at, blocked: [] };
  }
  if (!aiEnabled() && !mockAi()) return { status: "no_ai" };
  const queries = await compareQueries(item);
  if (mockAi() && !searchProvider()) {
    // Local UI tests: two fake offers, no network.
    const base = item.sources[0]?.price ?? 100;
    const results: CompareResult[] = [
      { url: "https://mock-store-a.test/p/1", store: "Mock Store A", storeKey: "mock-store-a", title: item.title, image: null, price: base * 0.9, currency: item.sources[0]?.currency ?? "ILS", shipping: null, total: base * 0.9, availability: "InStock" },
      { url: "https://mock-store-b.test/p/2", store: "Mock Store B", storeKey: "mock-store-b", title: item.title, image: null, price: base * 1.1, currency: item.sources[0]?.currency ?? "ILS", shipping: null, total: base * 1.1, availability: null },
    ];
    return { status: "ok", results, at: Date.now(), blocked: [] };
  }
  if (!searchProvider()) return { status: "browser", queries };
  const cands = pickCandidates(item, await searchCandidates(queries));
  const { read, blocked } = await readCandidates(cands);
  const results = toResults(await sameProduct(item, read), input.currency, await getRates());
  const at = Date.now();
  await saveCompare(item.id, { at, currency: input.currency, results });
  return { status: "ok", results, at, blocked };
}

/**
 * Candidates found by the owner's extension (Google Shopping / web in their browser), and pages the extension read
 * for stores that block servers. Verified the same way, merged into the cached comparison.
 */
export async function compareVerify(raw: { itemId: string; currency: string; candidates?: { url: string; title?: string | null; price?: string | number | null }[]; payloads?: unknown[] }): Promise<CompareResponse> {
  await assertOwner();
  const input = z
    .object({
      itemId: z.string().max(40),
      currency,
      candidates: z.array(z.object({ url: z.string().url().max(2000), title: z.string().max(400).nullish(), price: z.union([z.string().max(60), z.number()]).nullish() })).max(60).optional(),
      payloads: z.array(clientPayload).max(6).optional(),
    })
    .parse(raw);
  const item = await getItem(input.itemId);
  if (!item) return { status: "not_found" };
  const { read, blocked } = await readCandidates(pickCandidates(item, input.candidates ?? []));
  for (const p of input.payloads ?? []) {
    const ex = extractedFromPayload(p);
    if (ex.title && ex.price != null) read.push({ url: ex.url, ex });
  }
  const rates = await getRates();
  const fresh = toResults(await sameProduct(item, read), input.currency, rates);
  const prev = input.candidates?.length ? [] : ((await cachedCompare(item.id, input.currency))?.results ?? []);
  const results = [...prev, ...fresh].filter((r, i, all) => all.findIndex((x) => x.url === r.url) === i).sort((a, b) => a.total - b.total);
  const at = Date.now();
  await saveCompare(item.id, { at, currency: input.currency, results });
  return { status: "ok", results, at, blocked };
}
