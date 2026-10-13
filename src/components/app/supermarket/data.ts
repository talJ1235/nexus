"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { supermarketHome } from "@/app/supermarket-actions";
import { useI18n } from "@/components/providers";
import { useStore } from "../store";

// R18 S2 A2 — the Supermarket tab's server state (store chip, order, suggestions, prices, this month's trips, rows/tiles),
// cached per space on the page (switching tabs shows the last answer at once) and refreshed when the list changes.

export type SmHome = Awaited<ReturnType<typeof supermarketHome>>;

const cache = new Map<string, SmHome>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Patch the cached state (an optimistic change before the next refresh). */
export function patchSmHome(spaceId: string, fn: (h: SmHome) => SmHome) {
  const cur = cache.get(spaceId);
  if (!cur) return;
  cache.set(spaceId, fn(cur));
  emit();
}

const inflight = new Map<string, Promise<void>>();
export function refreshSmHome(spaceId: string, locale: "he" | "en") {
  const run = supermarketHome(locale)
    .then((h) => {
      if (h && Array.isArray(h.suggestions)) {
        cache.set(spaceId, h);
        emit();
      }
    })
    .catch(() => {})
    .finally(() => inflight.delete(spaceId));
  inflight.set(spaceId, run);
  return run;
}

/** The cached state (null until the first answer) + a refresh. Refreshes on mount and 600 ms after the list changes. */
export function useSmHome() {
  const s = useStore();
  const { locale } = useI18n();
  const key = s.spaceId || "-";
  useSyncExternalStore(subscribe, () => version, () => 0);
  const home = cache.get(key) ?? null;
  const refresh = useCallback(() => refreshSmHome(key, locale), [key, locale]);
  const first = useRef(true);
  useEffect(() => {
    if (s.offlineAt != null) return;
    if (first.current) {
      first.current = false;
      void refresh();
      return;
    }
    const t = setTimeout(() => void refresh(), 600);
    return () => clearTimeout(t);
  }, [s.sm, refresh, s.offlineAt]);
  return { home, refresh };
}
