// R18 S2 D1 — the one trip API (pure, client-safe): every store-mode action is a typed op built here, queued in the
// trip outbox (lib/shop-outbox.ts) and merged by the server per field (`syncTripOps` → lib/db-scoped/trip-sync.ts).
// No screen writes trip data another way; a later Wear OS client sends the same ops (SPEC.md "Trip API").
//   start → check / uncheck / notFound / substitute / quantity / price / add / note → finish

import type { TripOp } from "./trip";

export type TripRowRef = { id: string; rev?: number | null };
export type NewOp = Omit<TripOp, "id" | "at"> & { at?: number };
const ref = (r: TripRowRef) => ({ itemId: r.id, ...(r.rev != null ? { rev: r.rev } : {}) });

export const tripOps = {
  /** Start shopping (in a store, with the list's size); an open trip of mine in this space is reused. */
  start: (o: { chain?: string | null; branch?: string | null; planned?: number } = {}): NewOp => ({ kind: "start", chain: o.chain ?? null, branch: o.branch ?? null, planned: Math.max(0, Math.round(o.planned ?? 0)) }),
  check: (r: TripRowRef): NewOp => ({ kind: "check", ...ref(r) }),
  uncheck: (r: TripRowRef): NewOp => ({ kind: "uncheck", ...ref(r) }),
  notFound: (r: TripRowRef): NewOp => ({ kind: "not_found", ...ref(r) }),
  /** Took something else instead (bought, the log says "substitute"). */
  substitute: (r: TripRowRef, title?: string): NewOp => ({ kind: "substitute", ...ref(r), ...(title ? { notes: title } : {}) }),
  /** Packs, pieces and / or weight. */
  quantity: (r: TripRowRef, q: { qty?: number; count?: number | null; amount?: number | null; unit?: TripOp["unit"] }): NewOp => ({ kind: "qty", ...ref(r), ...q }),
  price: (r: TripRowRef, price: number): NewOp => ({ kind: "price", ...ref(r), price }),
  /** Add during the trip: gets a client id, applied once, merged by product key. */
  add: (a: { title: string; qty?: number; count?: number | null; amount?: number | null; unit?: TripOp["unit"]; productKey?: string }): NewOp => ({ kind: "add", ...a }),
  note: (r: TripRowRef, notes: string | null): NewOp => ({ kind: "note", ...ref(r), notes }),
  finish: (o: { total?: number | null } = {}): NewOp => ({ kind: "finish", total: o.total ?? null }),
};

export type TripOpBuilder = typeof tripOps;
