// Shopping mode, offline-safe (client only): the current trip (scope, checks, edits) and an outbox of "bought" marks
// live in IndexedDB, so a trip survives reloads and dead zones in the store; the outbox is sent when back online.
// Conflicts: last write wins (a mark sent later simply overwrites the item's status/price).
// R18 D1: trip actions have their own queue below (merged per field on the server).

import type { TripOp } from "./grocery/trip";

export type ShopScope = { kind: "all" } | { kind: "store"; key: string; name: string } | { kind: "collection"; id: string };
export type ShopEdit = { qty?: number; price?: number };
export type ShopTrip = { scope: ShopScope; checked: string[]; edits: Record<string, ShopEdit>; added: string[]; startedAt: number };
export type OutboxOp = { id: string; itemId: string; paid: { price: number; currency: string } | null; at: number };

const DB = "nexus-shop";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const get = async <T>(k: string): Promise<T | null> => {
  try {
    return ((await tx("readonly", (s) => s.get(k))) as T | undefined) ?? null;
  } catch {
    return null;
  }
};
const put = async (k: string, v: unknown) => {
  try {
    await tx<unknown>("readwrite", (s) => (v == null ? s.delete(k) : s.put(v, k)) as IDBRequest<unknown>);
  } catch {}
};

export const loadTrip = () => get<ShopTrip>("trip");
export const saveTrip = (t: ShopTrip | null) => put("trip", t);
export const loadOutbox = async () => (await get<OutboxOp[]>("outbox")) ?? [];
export const saveOutbox = (ops: OutboxOp[]) => put("outbox", ops.length ? ops : null);

/** Send queued marks; keeps whatever fails for the next try. Returns the number sent. */
export async function flushOutbox(send: (op: OutboxOp) => Promise<unknown>): Promise<number> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  const ops = await loadOutbox();
  if (!ops.length) return 0;
  const left: OutboxOp[] = [];
  let sent = 0;
  for (const op of ops) {
    try {
      await send(op);
      sent++;
    } catch {
      left.push(op);
    }
  }
  await saveOutbox(left);
  return sent;
}

// ---------- R18 D1: every trip action queued (check, uncheck, not found, substitute, qty / amount, price, add, note) ----------
// Each op carries the item's `rev` at the time and when it happened; the server merges per field (lib/db-scoped/
// trip-sync.ts). An add made offline gets a client id: it is applied once and merges by product key.


const rid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, "").slice(0, 16);

// Unlike the marks above, a failed read is an error here, never "nothing queued" (a save after it would lose actions).
export const loadTripOps = async () => ((await tx("readonly", (st) => st.get("tripops"))) as TripOp[] | undefined) ?? [];
const saveTripOps = (ops: TripOp[]) => tx<unknown>("readwrite", (st) => (ops.length ? st.put(ops, "tripops") : st.delete("tripops")) as IDBRequest<unknown>);
/** Read-modify-write of the queue, one at a time (two quick taps never overwrite each other). */
let chain: Promise<unknown> = Promise.resolve();
const edit = <T,>(f: (ops: TripOp[]) => Promise<T> | T): Promise<T> => {
  const next = chain.then(async () => f(await loadTripOps()));
  chain = next.catch(() => {});
  return next;
};

/** Queue one action (offline-safe). Returns it (an add's `clientId` is the row's id until the server answers). */
export async function queueTripOp(op: Omit<TripOp, "id" | "at"> & { at?: number }): Promise<TripOp> {
  const full: TripOp = { ...op, id: `op_${rid()}`, at: op.at ?? Date.now(), ...(op.kind === "add" && !op.clientId ? { clientId: `c_${rid()}` } : {}) };
  await edit((ops) => saveTripOps([...ops, full]));
  return full;
}

/**
 * Send the queued actions in one call, oldest first; on any failure everything stays queued (sent again later — the
 * server's merge makes a repeat harmless). Returns what the server answered, or null when offline / it failed.
 */
export async function flushTripOps<R>(send: (ops: TripOp[]) => Promise<R>): Promise<R | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  try {
    const ops = await loadTripOps();
    if (!ops.length) return null;
    const r = await send(ops);
    const sent = new Set(ops.map((o) => o.id));
    await edit((now) => saveTripOps(now.filter((o) => !sent.has(o.id))));
    return r;
  } catch {
    return null;
  }
}
