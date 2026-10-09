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

export const inboxStore = {
  get: () => state,
  setAsk(ask: boolean) {
    if (state.ask !== ask) set({ ask });
  },
  setBoot(boot: NotifyBoot) {
    set({ boot, unread: boot.unread });
  },
  /** The full list (when the popover / page opens, or a push arrives while it is open). */
  load() {
    loading ??= inbox()
      .then((r) => set({ rows: r.rows, unread: r.unread, now: r.now }))
      .catch(() => {})
      .finally(() => (loading = null));
    return loading;
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
