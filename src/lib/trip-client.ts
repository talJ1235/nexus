"use client";

// R18 S2 D1 — the trip API on the device: `tripApi.check(row)` etc. queue a typed op (lib/grocery/trip-api.ts) in the
// IndexedDB outbox and send the queue (one `syncTripOps` call, oldest first) whenever the app is online; what the server
// answers (changed rows, the ids offline adds got, my open trip) goes to the listeners (the store, store mode). Nothing
// else writes trip data. A failed send keeps everything queued and tries again every 3 s while online.

import { syncTripOps } from "@/app/supermarket-actions";
import { tripOps, type NewOp } from "@/lib/grocery/trip-api";
import type { TripOp } from "@/lib/grocery/trip";
import { flushTripOps, loadTripOps, queueTripOp } from "@/lib/shop-outbox";

export type SyncAnswer = Awaited<ReturnType<typeof syncTripOps>>;
type Listener = (r: SyncAnswer) => void;
const listeners = new Set<Listener>();
export function onTripAnswer(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** An action call cut off on the way (reconnect, navigation) can resolve without an answer: that is not "sent". */
async function send(ops: TripOp[]) {
  const r = await syncTripOps(ops);
  if (!r || typeof r.applied !== "number") throw new Error("no answer");
  return r;
}

let chain: Promise<unknown> = Promise.resolve();
let retry: ReturnType<typeof setTimeout> | undefined;

async function flushOnce(): Promise<SyncAnswer | null> {
  const r = await flushTripOps(send);
  if (r) for (const l of listeners) l(r);
  window.dispatchEvent(new Event("nexus:sm-outbox"));
  clearTimeout(retry);
  if (navigator.onLine && (await loadTripOps().catch(() => [])).length) retry = setTimeout(() => void flushTrip(), 3000);
  return r;
}

/** Send what's queued. Calls run one after another, so the answer covers everything queued before the call; while
 *  actions are left (offline, a failed send), it tries again every 3 s. */
export function flushTrip(): Promise<SyncAnswer | null> {
  const next = chain.then(flushOnce, flushOnce);
  chain = next.catch(() => {});
  return next;
}

async function queue(op: NewOp) {
  const full = await queueTripOp(op);
  window.dispatchEvent(new Event("nexus:sm-outbox"));
  void flushTrip();
  return full;
}

/** The trip API. Each call is queued at once (offline-safe) and sent when online; an add returns its client id. */
export const tripApi = {
  start: (...a: Parameters<typeof tripOps.start>) => queue(tripOps.start(...a)),
  check: (...a: Parameters<typeof tripOps.check>) => queue(tripOps.check(...a)),
  uncheck: (...a: Parameters<typeof tripOps.uncheck>) => queue(tripOps.uncheck(...a)),
  notFound: (...a: Parameters<typeof tripOps.notFound>) => queue(tripOps.notFound(...a)),
  substitute: (...a: Parameters<typeof tripOps.substitute>) => queue(tripOps.substitute(...a)),
  quantity: (...a: Parameters<typeof tripOps.quantity>) => queue(tripOps.quantity(...a)),
  price: (...a: Parameters<typeof tripOps.price>) => queue(tripOps.price(...a)),
  add: (...a: Parameters<typeof tripOps.add>) => queue(tripOps.add(...a)),
  note: (...a: Parameters<typeof tripOps.note>) => queue(tripOps.note(...a)),
  finish: (...a: Parameters<typeof tripOps.finish>) => queue(tripOps.finish(...a)),
};

export { loadTripOps, queueTripOp };
