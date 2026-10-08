"use client";

import { useEffect, useRef } from "react";
import { changesSince, loadAppData, spaceRev } from "@/app/data-actions";
import { useI18n } from "@/components/providers";
import { toast } from "@/lib/toast";
import { useStore, type ChangeSummary, type PersonTally } from "./store";

// R16 B2 — live shared spaces, client side. One transport per tab for the CURRENT space (re-made on a switch):
//   ably  — subscribe + presence on `space:<id>` with a 15-min token from /api/realtime/token
//   fake  — the dev/test server-sent stream (/api/realtime/fake), same messages, no key needed
//   poll  — no key / Ably unreachable: the cheap revision check every 10 s while visible, on focus and when back online
// Messages carry { rev, by } only; the data comes from changesSince (at most one in flight, re-run once if more arrived).
// Connected only while the tab is visible; disconnected after 2 min hidden.

type Msg = { rev: number; by: string };
type Transport = { close: () => void; mode: (m: "app" | "shopping") => void };
type TokenRes = { mode: "ably" | "fake" | "poll"; channel?: string; me: string; tokenRequest?: unknown };

const POLL_MS = 10_000;
const HIDDEN_MS = 2 * 60_000;
const TOAST_GAP_MS = 10_000;

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

export function LiveSync() {
  const s = useStore();
  const { t, f } = useI18n();
  const spaceId = s.spaceId;
  const me = s.me?.id ?? "";
  const ready = !s.loading && s.offlineAt == null && !!spaceId;
  // Latest store/i18n for the long-lived callbacks below (they're set up once per space).
  const live = useRef({ s, t, f });
  useEffect(() => {
    live.current = { s, t, f };
  });
  const shopping = s.shop != null && s.shop !== "pick";
  const modeRef = useRef<Transport["mode"] | null>(null);
  useEffect(() => {
    modeRef.current?.(shopping ? "shopping" : "app");
  }, [shopping]);

  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let transport: Transport | null = null;
    let pollTimer: number | undefined;
    let hiddenTimer: number | undefined;
    let ownTimer: number | undefined;
    let inflight = false;
    let again = false;

    // ---- activity toasts (B4): batched per person, ≤ 1 per 10 s each, never while typing ----
    const pending = new Map<string, PersonTally>();
    const lastToast = new Map<string, number>();
    let flushTimer: number | undefined;
    const nameOf = (id: string | null) => {
      const p = id ? live.current.s.people.find((x) => x.id === id) : null;
      return (p?.name || live.current.t.live.someone).split(/\s+/)[0];
    };
    const flush = () => {
      flushTimer = undefined;
      // R17 D3: off with the one Notifications switch (Account); the per-device "live activity" switch is gone.
      if (live.current.s.homePrefs.notify?.on === false) return pending.clear();
      if (typing() || document.visibilityState !== "visible") {
        flushTimer = window.setTimeout(flush, 2000);
        return;
      }
      const { t: tt, f: ff } = live.current;
      for (const [by, n] of pending) {
        const wait = (lastToast.get(by) ?? 0) + TOAST_GAP_MS - Date.now();
        if (wait > 0) {
          flushTimer ??= window.setTimeout(flush, wait);
          continue;
        }
        const parts = [
          n.added && (n.added === 1 ? tt.live.addedOne : ff(tt.live.added, { n: n.added })),
          n.checked && ff(tt.live.checked, { n: n.checked }),
          n.removed && (n.removed === 1 ? tt.live.removedOne : ff(tt.live.removed, { n: n.removed })),
          n.changed && (n.changed === 1 ? tt.live.changedOne : ff(tt.live.changed, { n: n.changed })),
        ].filter(Boolean);
        pending.delete(by);
        if (!parts.length) continue;
        lastToast.set(by, Date.now());
        toast(`${nameOf(by)} ${parts.join(" · ")}`, { duration: 3200 });
      }
    };
    const note = (sum: ChangeSummary) => {
      for (const [by, n] of sum.by) {
        if (by === me || by === "system") continue;
        const p = pending.get(by) ?? { added: 0, changed: 0, checked: 0, removed: 0 };
        p.added += n.added;
        p.changed += n.changed;
        p.checked += n.checked;
        p.removed += n.removed;
        pending.set(by, p);
      }
      if (sum.closed) toast(live.current.f(live.current.t.live.removedBy, { name: nameOf(sum.closed.by) }), { duration: 3200 });
      if (pending.size) flushTimer ??= window.setTimeout(flush, 600);
    };

    // ---- pulling the change feed ----
    const pull = async () => {
      if (stopped) return;
      if (inflight) {
        again = true;
        return;
      }
      inflight = true;
      try {
        const ch = await changesSince(live.current.s.getRev());
        if (stopped) return;
        if (ch.reset) {
          const data = await loadAppData();
          if (!stopped && data.space?.id === spaceId) live.current.s.replaceData(data, { keepView: true });
        } else note(live.current.s.applyChanges(ch));
      } catch {
        // Offline / signed out / removed from the space: the next visible / online event tries again.
      } finally {
        inflight = false;
        if (again && !stopped) {
          again = false;
          void pull();
        }
      }
    };
    const onMsg = (m: Msg) => {
      if (!m || typeof m.rev !== "number" || m.rev <= live.current.s.getRev()) return;
      // My own write: its result is already on screen — catch up a little later (keeps an in-flight edit from flickering).
      if (m.by === me) {
        window.clearTimeout(ownTimer);
        ownTimer = window.setTimeout(() => void pull(), 2000);
        return;
      }
      void pull();
    };

    // ---- transports ----
    const startPolling = () => {
      window.clearInterval(pollTimer);
      pollTimer = window.setInterval(async () => {
        if (document.visibilityState !== "visible") return;
        try {
          if ((await spaceRev()) > live.current.s.getRev()) void pull();
        } catch {
          /* offline */
        }
      }, POLL_MS);
    };
    const token = async (): Promise<TokenRes> => {
      const r = await fetch("/api/realtime/token", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };
    const presenceOf = (list: { clientId: string; mode?: string }[]) => {
      const m = new Map<string, "app" | "shopping">();
      for (const p of list) m.set(p.clientId, p.mode === "shopping" ? "shopping" : "app");
      live.current.s.setPresent(m);
    };
    const connect = async () => {
      if (transport || stopped) return;
      let res: TokenRes;
      try {
        res = await token();
      } catch {
        startPolling();
        return;
      }
      if (stopped) return;
      const mode = () => (live.current.s.shop != null && live.current.s.shop !== "pick" ? "shopping" : "app");
      if (res.mode === "fake") {
        const open = (m: string) => {
          const es = new EventSource(`/api/realtime/fake?mode=${m}`);
          es.onmessage = (e) => {
            try {
              const d = JSON.parse(e.data);
              if (d.type === "change") onMsg(d.data);
              else if (d.type === "presence") presenceOf(d.data);
            } catch {
              /* ignore */
            }
          };
          return es;
        };
        let es = open(mode());
        transport = {
          close: () => es.close(),
          mode: (m) => {
            es.close();
            es = open(m);
          },
        };
        window.clearInterval(pollTimer);
      } else if (res.mode === "ably" && res.channel) {
        try {
          const Ably = await import("ably");
          let first: unknown = res.tokenRequest;
          const client = new Ably.Realtime({
            authCallback: (_params, cb) => {
              if (first) {
                const tr = first;
                first = null;
                return cb(null, tr as Parameters<typeof cb>[1]);
              }
              token().then((r) => cb(null, r.tokenRequest as Parameters<typeof cb>[1]), (e) => cb(String(e), null));
            },
            clientId: res.me,
            echoMessages: false,
          });
          const ch = client.channels.get(res.channel);
          await ch.subscribe("change", (m) => onMsg(m.data as Msg));
          const refresh = async () => {
            try {
              presenceOf((await ch.presence.get()).map((p) => ({ clientId: p.clientId, mode: (p.data as { mode?: string } | undefined)?.mode })));
            } catch {
              /* ignore */
            }
          };
          await ch.presence.subscribe(() => void refresh());
          await ch.presence.enter({ mode: mode() });
          void refresh();
          // Ably unreachable for a while → poll until it's back.
          client.connection.on((st) => {
            if (st.current === "suspended" || st.current === "failed") startPolling();
            if (st.current === "connected") {
              window.clearInterval(pollTimer);
              void pull();
            }
          });
          transport = {
            close: () => {
              live.current.s.setPresent(new Map());
              client.close();
            },
            mode: (m) => void ch.presence.update({ mode: m }).catch(() => {}),
          };
          window.clearInterval(pollTimer);
        } catch {
          startPolling();
          return;
        }
      } else startPolling();
      modeRef.current = (m) => transport?.mode(m);
      void pull();
    };
    const disconnect = () => {
      transport?.close();
      transport = null;
      modeRef.current = null;
    };

    // ---- visibility / online ----
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(hiddenTimer);
        void connect();
        void pull();
      } else {
        window.clearTimeout(hiddenTimer);
        hiddenTimer = window.setTimeout(disconnect, HIDDEN_MS);
      }
    };
    const onOnline = () => void pull();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onOnline);
    window.addEventListener("online", onOnline);
    if (document.visibilityState === "visible") void connect();
    // Polling keeps going as a safety net when the transport is "poll"; harmless with a live transport (it's cleared).
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onOnline);
      window.removeEventListener("online", onOnline);
      window.clearInterval(pollTimer);
      window.clearTimeout(hiddenTimer);
      window.clearTimeout(ownTimer);
      window.clearTimeout(flushTimer);
      disconnect();
    };
  }, [ready, spaceId, me]);

  return null;
}
