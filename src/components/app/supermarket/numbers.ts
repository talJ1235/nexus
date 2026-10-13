"use client";

import { useMemo } from "react";
import { acceptSuggestions } from "@/app/supermarket-actions";
import { capFor, monthForecast, monthKeyIn, monthStartIn, nextMonthKey } from "@/lib/budget";
import type { BasketItem } from "@/lib/grocery/basket";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { STORES } from "@/lib/onboarding";
import { useStore } from "../store";
import type { OpenTrip, SmHome } from "./data";
import { requestSm, type SmIntent } from "./intent";

// R18 S2 — numbers and actions the Supermarket tab, the Home card and the trip bar share.

/** A server row → the store's item shape (supermarket rows carry no links / prices / files). */
export const asItem = (r: Omit<ItemWithSources, "sources" | "points" | "attachments">): ItemWithSources => ({ ...r, sources: [], points: [], attachments: [] }) as ItemWithSources;

/** The list's estimate from the last prices paid (null = nothing priced yet). */
export function useEstimate(home: SmHome | null) {
  const s = useStore();
  return useMemo(() => {
    if (!home) return null;
    let sum = 0;
    let priced = 0;
    for (const i of s.sm) {
      const p = i.productKey ? home.prices[i.productKey] : undefined;
      if (p == null) continue;
      priced++;
      sum += p * (i.unit && i.unit !== "u" && i.amount ? i.amount : i.quantity);
    }
    return priced ? sum : null;
  }, [home, s.sm]);
}

/** What's left of this month's budget after Products' spend + this month's supermarket trips (null = no budget). */
export function useMonthLeft(home: SmHome | null) {
  const s = useStore();
  return useMemo(() => {
    const key = monthKeyIn(s.clock.now, s.clock.tz);
    const cap = capFor(key, s.budget);
    if (!cap?.cap) return null;
    const fc = monthForecast({ items: s.items, altGroups: s.altGroups, rates: s.rates, currency: s.currency, from: monthStartIn(key, s.clock.tz), to: monthStartIn(nextMonthKey(key), s.clock.tz), cap, includeNormal: false });
    return (fc.cap ?? 0) - fc.spent - fc.committed - (home?.monthSpent ?? 0);
  }, [s.items, s.altGroups, s.rates, s.currency, s.clock, s.budget, home?.monthSpent]);
}

/** Open the Supermarket tab doing something (the screen takes the intent once it's mounted). */
export function useOpenSm() {
  const s = useStore();
  return (k?: SmIntent) => {
    if (s.view.type !== "supermarket") s.setView({ type: "supermarket" });
    if (k) setTimeout(() => requestSm(k), 30);
  };
}

/** Add products as the person's own rows (the basic basket, Add all), merged with what's there. */
export function useAddMany() {
  const s = useStore();
  return async (items: BasketItem[], msg: { done: (n: number) => string; failed: string }) => {
    try {
      const rows = await acceptSuggestions(items.map((b) => ({ productKey: b.productKey, title: b.title, qty: b.qty, amount: b.amount, unit: b.unit, section: b.section, art: b.art })));
      s.upsertSm(rows.map(asItem));
      toast.success(msg.done(rows.length));
      return rows.length;
    } catch {
      toast.error(msg.failed);
      return 0;
    }
  };
}

/** Trips running in this space: mine (this person's) and the others'. Items left = planned + added − bought − not found. */
export function useTrips(home: SmHome | null) {
  const s = useStore();
  return useMemo(() => {
    const open = home?.open ?? [];
    const me = s.me?.id;
    return { mine: open.find((t) => t.userId === me) ?? null, others: open.filter((t) => t.userId !== me) };
  }, [home, s.me?.id]);
}

export const tripLeft = (t: OpenTrip) => Math.max(0, t.planned + t.added - t.bought - t.notFound);
export const tripTotal = (t: OpenTrip) => Math.max(t.planned + t.added, t.bought + t.notFound);

/** Store monogram colours (the onboarding tiles, nx17 `.m1`–`.m9`). */
const MONO: Record<string, string> = { m1: "#c0392b", m2: "#1f7a4d", m3: "#1d5fa8", m4: "#b8860b", m5: "#6c3fb5", m6: "#d1495b", m7: "#2a7f8f", m8: "#5b5a56", m9: "#e07a24" };
export const monoColor = (c: string | null | undefined) => MONO[c ?? ""] ?? MONO.m8;

export const chainDef = (chain: string | null | undefined) => (chain ? STORES.find((x) => x.id === chain || x.en === chain || x.he === chain) ?? null : null);

/** "Shufersal · Herzl St." in the reader's language (null = no store chosen). */
export function storeLabel(chain: string | null | undefined, branch: string | null | undefined, locale: string) {
  if (!chain) return null;
  const d = chainDef(chain);
  const name = d ? (locale === "he" ? d.he : d.en) : chain;
  // First-strong isolates: an English branch inside a Hebrew sentence keeps its own order ("Herzl St." stays whole).
  return `⁨${branch ? `${name} · ${branch}` : name}⁩`;
}
