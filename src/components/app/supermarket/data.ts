"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supermarketHome } from "@/app/supermarket-actions";
import { useI18n } from "@/components/providers";
import { useStore } from "../store";

// R18 S2 — the Supermarket's server state (store chip, order, suggestions, prices, this month's trips, rows/tiles, the
// usual day, open trips), cached per space on the page. One <SmHomeSync/> (nexus-app) refreshes it: on load, 600 ms after
// the list changes, after a live feed update, and every 20 s while a trip runs. Screens read it with useSmHome().

export type SmHome = Awaited<ReturnType<typeof supermarketHome>>;
export type OpenTrip = SmHome["open"][number];

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

export function refreshSmHome(spaceId: string, locale: "he" | "en") {
  return supermarketHome(locale)
    .then((h) => {
      if (h && Array.isArray(h.suggestions)) {
        cache.set(spaceId, h);
        emit();
      }
    })
    .catch(() => {});
}

/** The store's feed applied a change (store.applyChanges dispatches it): trips and other members' adds. */
export const FEED_EVENT = "nexus:feed";

const keyOf = (spaceId: string) => spaceId || "-";

/** The cached state (null until the first answer) + a refresh. */
export function useSmHome() {
  const s = useStore();
  const { locale } = useI18n();
  const key = keyOf(s.spaceId);
  useSyncExternalStore(subscribe, () => version, () => 0);
  const refresh = useCallback(() => refreshSmHome(key, locale), [key, locale]);
  return { home: cache.get(key) ?? null, refresh };
}

export function SmHomeSync() {
  const s = useStore();
  const { home, refresh } = useSmHome();
  const running = !!home?.open.length;
  const off = s.offlineAt != null || s.loading;
  // On load / space switch, then 600 ms after the list changes.
  useEffect(() => {
    if (off) return;
    const t = setTimeout(() => void refresh(), home ? 600 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `home` only decides the first delay
  }, [s.sm, refresh, off]);
  useEffect(() => {
    if (off) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 500);
    };
    window.addEventListener(FEED_EVENT, on);
    const poll = running ? window.setInterval(() => document.visibilityState === "visible" && void refresh(), 20_000) : undefined;
    return () => {
      clearTimeout(t);
      window.removeEventListener(FEED_EVENT, on);
      window.clearInterval(poll);
    };
  }, [refresh, running, off]);
  return null;
}
