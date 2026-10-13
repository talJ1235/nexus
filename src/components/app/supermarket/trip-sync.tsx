"use client";

import { useEffect } from "react";
import * as sm from "@/app/supermarket-actions";
import { flushTrip, loadTripOps, onTripAnswer, queueTripOp, tripApi } from "@/lib/trip-client";
import type { ItemWithSources } from "@/lib/types";
import { useStore } from "../store";
import { asItem } from "./numbers";

// R18 S2 D1 — keeps the trip outbox flowing (queued actions go out whenever the app is online, also after a reload) and
// puts the server's answers into the store. Replaces S1's sm-bridge. Tests: with localStorage `nexus.smBridge` = "1" the
// actions + the trip API are on `window.__nexusSm` (test:shop-offline, test:capture).
export function TripSync() {
  const s = useStore();
  const { upsertSm, removeSm } = s;
  useEffect(() => {
    const off = onTripAnswer((r) => {
      const rows = (r.items ?? []) as Omit<ItemWithSources, "sources" | "points" | "attachments">[];
      upsertSm(rows.filter((i) => i.list === "supermarket").map(asItem));
      // Offline adds showed under their client id until the server named them.
      for (const cid of Object.keys(r.idMap ?? {})) removeSm(cid);
      window.dispatchEvent(new Event("nexus:feed"));
    });
    const run = () => void flushTrip();
    run();
    window.addEventListener("online", run);
    let flag = false;
    try {
      flag = localStorage.getItem("nexus.smBridge") === "1";
    } catch {}
    if (flag) (window as unknown as { __nexusSm: unknown }).__nexusSm = { ...sm, tripApi, queueTripOp, loadTripOps, flush: flushTrip };
    return () => {
      off();
      window.removeEventListener("online", run);
    };
  }, [upsertSm, removeSm]);
  return null;
}
