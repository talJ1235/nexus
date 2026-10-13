"use client";

import { useSyncExternalStore } from "react";
import { tripOrder, type SectionKey } from "@/lib/grocery/sections";
import type { SmHome } from "./data";

// R18 S2 D2 — "This trip only": the store picked for this trip, kept on this device for the session (per space) while the
// default stays. The list and store mode follow its branch's section order; the trip API's `start` carries it.

export type StoreRef = { chain: string; branch: string };
const KEY = (space: string) => `nexus.tripStore:${space}`;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The stored pick as a string (a stable snapshot for useSyncExternalStore). */
function raw(space: string) {
  try {
    return sessionStorage.getItem(KEY(space));
  } catch {
    return null;
  }
}
function parse(v: string | null): StoreRef | null {
  try {
    const x = JSON.parse(v ?? "null") as StoreRef | null;
    return x && typeof x.chain === "string" ? { chain: x.chain, branch: String(x.branch ?? "") } : null;
  } catch {
    return null;
  }
}

export function setTripStore(space: string, s: StoreRef | null) {
  try {
    if (s) sessionStorage.setItem(KEY(space), JSON.stringify(s));
    else sessionStorage.removeItem(KEY(space));
  } catch {}
  emit();
}

/** This trip's store (the trip-only pick, else the default) and its branch's section order. */
export function useTripStore(space: string, home: SmHome | null): { store: StoreRef | null; order: SectionKey[]; tripOnly: boolean } {
  // Server render + hydration: no pick (the default store), then this device's pick — never a mismatch.
  const pick = parse(useSyncExternalStore(subscribe, () => raw(space || "-"), () => null));
  const store = pick ?? home?.store ?? null;
  const row = store ? home?.stores.find((x) => x.chain === store.chain && x.branch === store.branch) ?? null : null;
  return { store, order: row ? tripOrder(row) : pick ? tripOrder(null) : ((home?.order as SectionKey[] | undefined) ?? tripOrder(null)), tripOnly: !!pick && !(home?.store && home.store.chain === pick.chain && home.store.branch === pick.branch) };
}
