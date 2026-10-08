"use client";

import { useMemo } from "react";
import { PRIORITY_RANK, unitPrice } from "@/lib/calc";
import { tokens } from "@/lib/similarity";
import type { ItemWithSources } from "@/lib/types";
import { itemsForView } from "@/lib/views";
import { normalizeCategory } from "@/lib/categories";
import { monthKey } from "@/lib/budget";
import { PHONE, useMedia } from "@/components/ui/use-media";
import { useStore } from "./store";

export { itemsForView };

/**
 * The desktop table (R14 A4): only when `layout` is "table" AND the screen is ≥ 640 px. Phones ignore `layout`
 * entirely and use `phoneLayout` (rows / cards) — a stored "table" once trapped phones in it with no way back.
 */
export function useTable() {
  const s = useStore();
  const phone = useMedia(PHONE);
  return !phone && s.layout === "table";
}

export function matchesQuery(i: ItemWithSources, q: string) {
  if (!q.trim()) return true;
  const hay = [i.title, i.fullTitle, i.brand, i.category, i.notes, ...(i.tags ?? []), ...i.sources.map((s) => s.store)].filter(Boolean).join(" ").toLowerCase();
  return [...tokens(q)].every((t) => hay.includes(t)) || hay.includes(q.toLowerCase().trim());
}

/** Month a bought item belongs to (YYYY-MM, local time), from when it was bought (or ordered). */
export function historyMonthOf(i: ItemWithSources) {
  const at = i.purchasedAt ?? i.orderedAt;
  return at ? monthKey(new Date(at)) : null;
}

/** The store it was bought from: the chosen offer, else the first. */
export function historyStoreOf(i: ItemWithSources) {
  return (i.chosenSourceId ? i.sources.find((x) => x.id === i.chosenSourceId) : null) ?? i.sources[0] ?? null;
}

export function useViewItems() {
  const { items, view, query, tagFilter, categoryFilter, collectionFilter, sort, rates, currency, historyQuery, historyMonth, historyStore } = useStore();
  return useMemo(() => {
    let list = itemsForView(items, view).filter((i) => matchesQuery(i, query));
    // History's own search + Month / Store filters (Round 11 B2).
    if (view.type === "history")
      list = list.filter((i) => (!historyMonth || historyMonthOf(i) === historyMonth) && (!historyStore || historyStoreOf(i)?.storeKey === historyStore) && matchesQuery(i, historyQuery));
    if (tagFilter) list = list.filter((i) => i.tags?.includes(tagFilter) || i.category === tagFilter);
    if (collectionFilter) list = list.filter((i) => i.collectionId === collectionFilter);
    if (categoryFilter) list = list.filter((i) => (normalizeCategory(i.category) ?? "other") === categoryFilter);
    const sorted = list.slice();
    if (view.type === "history") {
      sorted.sort((a, b) => (b.purchasedAt ?? 0) - (a.purchasedAt ?? 0));
    } else if (sort === "price") {
      sorted.sort((a, b) => (unitPrice(b, rates, currency) ?? -1) - (unitPrice(a, rates, currency) ?? -1));
    } else if (sort === "priority") {
      sorted.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt - a.createdAt);
    } else if (sort === "name") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      sorted.sort((a, b) => b.createdAt - a.createdAt);
    }
    return sorted;
  }, [items, view, query, tagFilter, categoryFilter, collectionFilter, sort, rates, currency, historyQuery, historyMonth, historyStore]);
}

/** User-picked collection colours → a muted per-theme set (globals.css --proj-*), used only as small dots/bars. */
export const COLLECTION_COLORS: Record<string, string> = {
  amber: "var(--proj-amber)",
  blue: "var(--proj-blue)",
  green: "var(--proj-green)",
  violet: "var(--proj-violet)",
  rose: "var(--proj-rose)",
  teal: "var(--proj-teal)",
  slate: "var(--proj-slate)",
  olive: "var(--proj-olive)",
};
export const COLOR_KEYS = Object.keys(COLLECTION_COLORS);
