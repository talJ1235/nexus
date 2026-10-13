"use client";

import { useSyncExternalStore } from "react";
import type { ItemWithSources } from "@/lib/types";

// R18 S2 D3 — my trip as the store-mode screen sees it, kept on this device (localStorage, per space) so a reload, a
// dead zone or closing the app mid-trip loses nothing: the rows as they were when the trip started (checked rows leave
// the list on the server, store mode keeps showing them), what I checked / didn't find / paid. Every change also goes to
// the server through the trip API (lib/trip-client.ts) — this is only the screen's memory.

export type LocalTrip = {
  chain: string | null;
  branch: string | null;
  startedAt: number;
  /** The list when the trip started (+ rows added during it). */
  rows: ItemWithSources[];
  checked: Record<string, number>;
  notFound: Record<string, true>;
  prices: Record<string, number>;
  /** Rows added during the trip by someone else (shown "added now"). */
  live: Record<string, true>;
};

const KEY = (space: string) => `nexus.smTrip:${space}`;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const raw = (space: string) => {
  try {
    return localStorage.getItem(KEY(space));
  } catch {
    return null;
  }
};

export function readTrip(space: string): LocalTrip | null {
  try {
    const v = JSON.parse(raw(space) ?? "null") as LocalTrip | null;
    return v && Array.isArray(v.rows) ? v : null;
  } catch {
    return null;
  }
}

export function writeTrip(space: string, t: LocalTrip | null) {
  try {
    if (t) localStorage.setItem(KEY(space), JSON.stringify(t));
    else localStorage.removeItem(KEY(space));
  } catch {}
  emit();
}

export function patchTrip(space: string, fn: (t: LocalTrip) => LocalTrip) {
  const cur = readTrip(space);
  if (cur) writeTrip(space, fn(cur));
}

/** My local trip (null on the server and while hydrating; then this device's). */
export function useLocalTrip(space: string): LocalTrip | null {
  const v = useSyncExternalStore(subscribe, () => raw(space), () => null);
  if (!v) return null;
  try {
    return JSON.parse(v) as LocalTrip;
  } catch {
    return null;
  }
}
