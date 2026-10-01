// Shopping mode, offline-safe (client only): the current trip (scope, checks, edits) and an outbox of "bought" marks
// live in IndexedDB, so a trip survives reloads and dead zones in the store; the outbox is sent when back online.
// Conflicts: last write wins (a mark sent later simply overwrites the item's status/price).

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
