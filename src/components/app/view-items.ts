"use client";

import { useMemo } from "react";
import { PRIORITY_RANK, unitPrice } from "@/lib/calc";
import { tokens } from "@/lib/similarity";
import type { ItemWithSources } from "@/lib/types";
import { itemsForView } from "@/lib/views";
import { useStore } from "./store";

export { itemsForView };

export function matchesQuery(i: ItemWithSources, q: string) {
  if (!q.trim()) return true;
  const hay = [i.title, i.brand, i.category, i.notes, ...(i.tags ?? []), ...i.sources.map((s) => s.store)].filter(Boolean).join(" ").toLowerCase();
  return [...tokens(q)].every((t) => hay.includes(t)) || hay.includes(q.toLowerCase().trim());
}

export function useViewItems() {
  const { items, view, query, tagFilter, sort, rates, currency } = useStore();
  return useMemo(() => {
    let list = itemsForView(items, view).filter((i) => matchesQuery(i, query));
    if (tagFilter) list = list.filter((i) => i.tags?.includes(tagFilter) || i.category === tagFilter);
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
  }, [items, view, query, tagFilter, sort, rates, currency]);
}

export const COLLECTION_COLORS: Record<string, string> = {
  amber: "#f2a93b",
  blue: "#4c8dff",
  green: "#35b27a",
  violet: "#9b7bff",
  rose: "#f0647f",
  teal: "#2bb5b0",
  slate: "#8a94a3",
};
export const COLOR_KEYS = Object.keys(COLLECTION_COLORS);
