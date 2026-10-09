// Read-only offline v1 (client only): the owner's latest app data lives in IndexedDB, the app shell in the service
// worker's cache (public/sw.js). Both are cleared on the login page, where every logout lands.
import type { AppData } from "./types";

export type Snapshot = { data: AppData; at: number; currency: string };

const DB = "nexus-offline";
const STORE = "snapshot";
const KEY = "app";

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

export async function saveSnapshot(s: Snapshot) {
  try {
    await tx("readwrite", (st) => st.put(s, KEY));
  } catch {
    /* private mode / quota — offline just won't have data */
  }
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    return ((await tx("readonly", (st) => st.get(KEY))) as Snapshot | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Forget everything kept for offline use (snapshot + cached shell), and the Account page's last answer (R17 A5). */
export async function clearOffline() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("nexus.sec:")) localStorage.removeItem(k);
  } catch {
    /* no storage */
  }
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {
    /* nothing stored */
  }
  try {
    for (const k of await caches.keys()) if (k.startsWith("nexus-shell")) await caches.delete(k);
  } catch {
    /* no Cache Storage */
  }
  // R17 S3 J2: signed out → this browser stops getting the account's pushes (the server row dies on its next 410).
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
    localStorage.removeItem("nexus.push");
  } catch {
    /* no push here */
  }
}

/** Ask the service worker to (re)cache the offline shell. Owner app only, after an online load. */
export function cacheShell() {
  navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage({ type: "cache-shell" })).catch(() => {});
}
