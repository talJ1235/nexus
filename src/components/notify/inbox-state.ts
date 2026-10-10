"use client";
// R17 S3 K4 — the inbox on the client: rows, the unread count, open/closed. One small external store shared by the
// bell(s), the popover / phone page and the runtime (service worker messages, focus, the 60 s refresh). Mark read and
// delete are optimistic. No content travels over Ably — the count is fetched from our own server.

import { useSyncExternalStore } from "react";
import { inbox, markAllRead, markRead, removeNotification, unread, type InboxRow, type NotifyBoot } from "@/app/notify-actions";

type State = { rows: InboxRow[] | null; unread: number; now: number; boot: NotifyBoot | null; ring: number; received: Record<string, true>; /** L2: the reminder card is out of the bell (it shows a dot). */ ask: boolean };

let state: State = { rows: null, unread: 0, now: Date.now(), boot: null, ring: 0, received: {}, ask: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

export function useInbox() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

let loading: Promise<void> | null = null;
let loadedAt = 0;
// R17 P4: how many rows the inbox had last time (per person, this tab) — a cold-start skeleton has that many.
let who = "";
const COUNT_KEY = "nexus.inbox.n:";
const STALE_MS = 30_000;

export const inboxStore = {
  get: () => state,
  setAsk(ask: boolean) {
    if (state.ask !== ask) set({ ask });
  },
  setBoot(boot: NotifyBoot) {
    set({ boot, unread: boot.unread });
  },
  setUser(id: string | undefined) {
    who = id ?? "";
  },
  /** Rows the last load had (≤ 6), for the skeleton's shape; 3 when unknown. */
  lastCount() {
    try {
      const v = sessionStorage.getItem(COUNT_KEY + who);
      return v == null ? 3 : Math.max(0, Math.min(6, Number(v) || 0));
    } catch {
      return 3;
    }
  },
  /** The full list (when the popover / page opens, or a push arrives while it is open). Rows already in memory stay on
   *  screen while it refreshes. */
  load() {
    loading ??= inbox()
      .then((r) => {
        loadedAt = Date.now();
        set({ rows: r.rows, unread: r.unread, now: r.now });
        try {
          sessionStorage.setItem(COUNT_KEY + who, String(Math.min(6, r.rows.length)));
        } catch {}
      })
      .catch(() => {})
      .finally(() => (loading = null));
    return loading;
  },
  /** R17 P4: warm the list before it is opened (app idle after start, bell hover / press) — skipped while fresh. */
  prefetch() {
    if (state.rows && Date.now() - loadedAt < STALE_MS) return;
    void inboxStore.load();
  },
  async refreshUnread(ring = false) {
    try {
      const n = await unread();
      set({ unread: n, ...(ring && n > state.unread ? { ring: state.ring + 1 } : {}) });
    } catch {}
  },
  read(id: string) {
    const row = state.rows?.find((r) => r.id === id);
    if (!row || row.read) return;
    set({ rows: state.rows!.map((r) => (r.id === id ? { ...r, read: true } : r)), unread: Math.max(0, state.unread - 1) });
    void markRead([id]).then((n) => set({ unread: n }), () => {});
  },
  readAll() {
    set({ rows: state.rows?.map((r) => ({ ...r, read: true })) ?? null, unread: 0 });
    void markAllRead().catch(() => {});
  },
  remove(id: string) {
    const row = state.rows?.find((r) => r.id === id);
    set({ rows: state.rows?.filter((r) => r.id !== id) ?? null, unread: Math.max(0, state.unread - (row && !row.read ? 1 : 0)) });
    void removeNotification(id).then((n) => set({ unread: n }), () => {});
  },
  /** Delivery "Received" from the row: the same route the service worker's action uses. */
  async received(id: string) {
    set({ received: { ...state.received, [id]: true } });
    inboxStore.read(id);
    const r = await fetch("/api/notify/received", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (!r?.ok) {
      const { [id]: _, ...rest } = state.received;
      void _;
      set({ received: rest });
      return false;
    }
    return true;
  },
  /** A push arrived (service worker message) or the app came back into view. */
  poke(fromPush = false) {
    void inboxStore.refreshUnread(fromPush);
    if (state.rows) void inboxStore.load();
  },
};
