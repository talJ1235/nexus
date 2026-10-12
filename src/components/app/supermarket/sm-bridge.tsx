"use client";

import { useEffect } from "react";
import * as sm from "@/app/supermarket-actions";
import { flushTripOps, loadTripOps, queueTripOp } from "@/lib/shop-outbox";
import type { TripOp } from "@/lib/grocery/trip";

// R18 S1 — no supermarket screens yet (S2). This keeps the trip outbox flowing (queued actions go out whenever the app is
// online, also after a reload) and gives tests a handle on the engines: with localStorage `nexus.smBridge` = "1" the
// actions + the outbox are on `window.__nexusSm` (test:shop-offline). It renders nothing. S2 replaces it with the screens.

/** An action call cut off on the way (reconnect, navigation) can resolve without an answer: that is not "sent". */
async function send(ops: TripOp[]) {
  const r = await sm.syncTripOps(ops);
  if (!r || typeof r.applied !== "number") throw new Error("no answer");
  return r;
}

let busy = false;
let retry: ReturnType<typeof setTimeout> | undefined;
/** One flush at a time; while actions are left and the app is online, try again in 3 s. */
async function flush() {
  if (busy) return null;
  busy = true;
  let r = null;
  try {
    r = await flushTripOps(send);
  } finally {
    busy = false;
  }
  clearTimeout(retry);
  if (navigator.onLine && (await loadTripOps()).length) retry = setTimeout(() => void flush(), 3000);
  return r;
}

export function SupermarketBridge() {
  useEffect(() => {
    const run = () => void flush();
    run();
    window.addEventListener("online", run);
    let flag = false;
    try {
      flag = localStorage.getItem("nexus.smBridge") === "1";
    } catch {}
    if (flag) (window as unknown as { __nexusSm: unknown }).__nexusSm = { ...sm, queueTripOp, loadTripOps, flush };
    return () => {
      window.removeEventListener("online", run);
      clearTimeout(retry);
    };
  }, []);
  return null;
}
