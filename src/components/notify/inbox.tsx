"use client";

import "../auth/nx.css";
import "../app/settings/nx16.css";
import "../admin/nx17.css";
import "./nx18.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { notifyAsk, notifyBoot, type InboxRow } from "@/app/notify-actions";
import { setNotificationsOn } from "@/app/home-actions";
import { askPermission, ensureSubscribed, permState, pushEnv, type PermState } from "@/lib/notify/client";
import { isToday } from "@/lib/notify/text";
import { useMedia } from "@/components/ui/use-media";
import { useBackClose } from "@/components/ui/sheet-drag";
import { cn } from "@/lib/utils";
import { useStore } from "../app/store";
import { AllowSteps } from "./allow";
import { inboxStore, useInbox } from "./inbox-state";
import { ICONS, NotifyRow, Svg } from "./row";

// R17 S3 K — the inbox. Desktop: a popover out of the header bell (420 wide, 200 ms ease-out from the bell). Phone: a
// full page pushed in from the inline-end over Home (Home shifts back and dims; Back / edge swipe / browser Back reverse
// it). Opened by `panel === "alerts"` so every old entry point (Me sheet, palette, assistant, "Needs you") lands here.

export const DESK = "(min-width: 1024px)";
const REFRESH_MS = 60_000;

/** This device's permission, re-read on focus (the person may have changed it in the browser's settings). */
export function usePerm() {
  // Only rendered on the client (inside an open inbox / card), so the first read can happen in the initializer.
  const [p, setP] = useState<PermState>(() => (typeof window === "undefined" ? "default" : permState()));
  const refresh = useCallback(() => setP(permState()), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);
  return [p, refresh] as const;
}

/** "Turn on" (a tap): the browser's own question, then this device's push address. */
export async function turnOnHere(publicKey: string | null, nt: ReturnType<typeof useI18n>["t"]["nt"]) {
  const r = await askPermission();
  if (r === "granted") {
    void notifyAsk("yes").catch(() => {});
    const res = await ensureSubscribed(publicKey, true);
    if (res === "no-key") toast(nt.ask.noServer);
  }
  return r;
}

/** Open what a row is about: in this space directly, otherwise through /api/notify/open (switches space first). */
function useOpenRow(close: () => void) {
  const s = useStore();
  return useCallback(
    (r: InboxRow) => {
      inboxStore.read(r.id);
      const d = r.data as { itemId?: string };
      if (r.spaceId && s.space && r.spaceId !== s.space.id) {
        // A route handler (marks read, switches the space cookie, redirects) — a full navigation on purpose.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/api/notify/open?id=${encodeURIComponent(r.id)}`;
        return;
      }
      close();
      if ((r.kind === "price" || r.kind === "delivery") && d.itemId) s.openItem(d.itemId);
      else if (r.kind === "shop" || r.kind === "activity") s.setView({ type: "to_buy" });
      else s.setView({ type: "spending" });
    },
    [s, close],
  );
}

function Banners({ phone }: { phone: boolean }) {
  const { t } = useI18n();
  const nt = t.nt;
  const { boot } = useInbox();
  const [perm, refresh] = usePerm();
  const [how, setHow] = useState(false);
  if (!boot) return null;
  if (!boot.on) {
    return (
      <div className="banner off" data-nt-banner="switch-off">
        <Svg d={`${ICONS.BELL} M3 3l18 18`} />
        <span className="grow">{phone ? nt.offPhone : nt.offComputer}</span>
        <button type="button" className="btn sm pri" style={{ height: 36 }} onClick={async () => (await setNotificationsOn(true), inboxStore.setBoot({ ...boot, on: true }))}>
          {nt.turnOn}
        </button>
      </div>
    );
  }
  if (perm === "denied")
    return (
      <>
        <div className="banner blocked" data-nt-banner="blocked">
          <Svg d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 8v4 M12 16h.01" />
          <span className="grow">{nt.blocked}</span>
          <button type="button" className="btn sm" style={{ height: 36 }} onClick={() => setHow((v) => !v)} aria-expanded={how}>
            {nt.how}
          </button>
        </div>
        {how && (
          <div style={{ margin: "0 12px 8px" }}>
            <AllowSteps phone={phone} />
          </div>
        )}
      </>
    );
  if (perm === "default" || perm === "iphone-browser")
    return (
      <div className="banner off" data-nt-banner="off-here">
        <Svg d={`${ICONS.BELL} M3 3l18 18`} />
        <span className="grow">{phone ? nt.offPhone : nt.offComputer}</span>
        {perm === "default" ? (
          <button type="button" className="btn sm pri" style={{ height: 36 }} onClick={async () => (await turnOnHere(boot.publicKey, nt), refresh())}>
            {nt.turnOn}
          </button>
        ) : (
          <button type="button" className="btn sm" style={{ height: 36 }} onClick={() => setHow((v) => !v)}>
            {nt.how}
          </button>
        )}
      </div>
    );
  return null;
}

/** Today / Earlier groups. On the phone page each row can be swiped away. */
function Groups({ rows, now, onOpen, swipe }: { rows: InboxRow[]; now: number; onOpen: (r: InboxRow) => void; swipe?: boolean }) {
  const { t } = useI18n();
  const groups = [
    { key: "today", label: t.nt.today, rows: rows.filter((r) => isToday(r.at, now)) },
    { key: "earlier", label: t.nt.earlier, rows: rows.filter((r) => !isToday(r.at, now)) },
  ].filter((g) => g.rows.length);
  return (
    <>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-label={g.label}>
          <div className="igrp">{g.label}</div>
          {g.rows.map((r) => (swipe ? <SwipeRow key={r.id} row={r} now={now} onOpen={onOpen} /> : <NotifyRow key={r.id} row={r} now={now} onOpen={onOpen} />))}
        </div>
      ))}
    </>
  );
}

/** Swipe to delete: 1:1 follow, rubber-band, velocity flick; release snaps on the drawer curve. */
function SwipeRow({ row, now, onOpen }: { row: InboxRow; now: number; onOpen: (r: InboxRow) => void }) {
  const { t } = useI18n();
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const sgn = rtl ? -1 : 1;
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const [dying, setDying] = useState(false);
  const d = useRef<{ x0: number; y0: number; base: number; t0: number; moved: boolean; axis: "x" | "y" | null } | null>(null);
  const justDragged = useRef(false);
  const kill = () => {
    setDying(true);
    setTimeout(() => inboxStore.remove(row.id), 220);
  };
  return (
    <div className={cn("sw-wrap", dying && "collapse")} data-sw>
      <div className="sw-under" aria-hidden={x === 0}>
        <button type="button" onClick={kill} tabIndex={x === 0 ? -1 : 0} data-sw-delete>
          <Svg d={ICONS.TRASH} />
          {t.nt.del}
        </button>
      </div>
      <div
        className={cn("sw-row", !drag && "settle")}
        style={{ transform: `translateX(${(dying ? -420 : x) * sgn}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          d.current = { x0: e.clientX, y0: e.clientY, base: x, t0: performance.now(), moved: false, axis: null };
        }}
        onPointerMove={(e) => {
          const c = d.current;
          if (!c) return;
          const dx = (e.clientX - c.x0) * sgn;
          const dy = e.clientY - c.y0;
          if (!c.axis && Math.hypot(dx, dy) > 8) {
            c.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (c.axis === "x") (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }
          if (c.axis !== "x") return;
          c.moved = true;
          let v = c.base + dx;
          if (v > 0) v *= 0.25;
          if (v < -240) v = -240 + (v + 240) * 0.3;
          setDrag(true);
          setX(v);
        }}
        onPointerUp={(e) => {
          const c = d.current;
          d.current = null;
          setDrag(false);
          if (!c || !c.moved) return;
          justDragged.current = true;
          const vel = ((e.clientX - c.x0) * sgn) / Math.max(1, performance.now() - c.t0);
          if (x < -200 || (vel < -0.6 && x < -40)) return kill();
          setX(x < -48 || vel < -0.3 ? -96 : 0);
        }}
        onPointerCancel={() => ((d.current = null), setDrag(false), setX(0))}
        onClickCapture={(e) => {
          // A drag that ended on the row is not a tap; a tap on an open row closes it first.
          if (justDragged.current || x !== 0) {
            e.stopPropagation();
            e.preventDefault();
            justDragged.current = false;
            if (x !== 0 && !(e.target as HTMLElement).closest("[data-sw-delete]")) setX(0);
          }
        }}
      >
        <NotifyRow row={row} now={now} onOpen={onOpen} />
      </div>
    </div>
  );
}

function Empty() {
  const { t } = useI18n();
  return (
    <div className="ibx-empty" data-nt-empty>
      <span className="ic">
        <Svg d={ICONS.BELL} />
      </span>
      <b style={{ fontSize: 16 }}>{t.nt.emptyT}</b>
      <span className="sub" style={{ maxWidth: 260 }}>
        {t.nt.emptyS}
      </span>
    </div>
  );
}

const Skeleton = () => (
  <div style={{ padding: "8px 20px", display: "flex", flexDirection: "column", gap: 14 }} aria-hidden>
    {[0, 1, 2].map((i) => (
      <div key={i} className="skeleton" style={{ height: 52, borderRadius: 12 }} />
    ))}
  </div>
);

/** Desktop: out of the bell. Esc / outside click close; focus returns to the bell. */
function Popover({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const nt = t.nt;
  const s = useStore();
  const { rows, now, unread } = useInbox();
  const ref = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ top: number; end: number; h: number } | null>(null);
  const [out, setOut] = useState(false);
  const close = useCallback(() => {
    setOut(true);
    setTimeout(() => {
      onClose();
      document.querySelector<HTMLElement>('[data-nt-bell="desk"]')?.focus();
    }, 140);
  }, [onClose]);
  const open = useOpenRow(onClose);
  useLayoutEffect(() => {
    const place = () => {
      const b = document.querySelector<HTMLElement>('[data-nt-bell="desk"]')?.getBoundingClientRect();
      const rtl = document.documentElement.dir === "rtl";
      const top = b ? b.bottom + 8 : 64;
      const end = b ? Math.max(12, rtl ? b.left - 8 : window.innerWidth - b.right - 8) : 24;
      setPos({ top, end, h: Math.min(640, window.innerHeight - top - 16) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  useEffect(() => {
    void inboxStore.load();
    ref.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), close());
    const down = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (ref.current?.contains(el) || el.closest('[data-nt-bell="desk"]')) return;
      close();
    };
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", down, true);
    };
  }, [close]);
  if (!pos) return null;
  return createPortal(
    <div className="nx nt-root" dir={document.documentElement.dir}>
      <section
        ref={ref}
        tabIndex={-1}
        className={cn("ibx", out && "out")}
        style={{ top: pos.top, insetInlineEnd: pos.end, height: rows && rows.length === 0 ? Math.min(420, pos.h) : pos.h, outline: "none" }}
        role="dialog"
        aria-modal="false"
        aria-label={nt.title}
        data-nt-popover
      >
        <div className="ihd">
          <h2>{nt.title}</h2>
          {unread > 0 && (
            <button type="button" className="btn sm ghost" onClick={() => inboxStore.readAll()} data-nt-markall>
              {nt.markAll}
            </button>
          )}
          <button type="button" className="btn sm ghost" style={{ width: 32, padding: 0 }} onClick={close} aria-label={nt.close}>
            <Svg d="M18 6 6 18 M6 6l12 12" className="i sm" />
          </button>
        </div>
        <Banners phone={false} />
        {!rows ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <div className="ilist">
            <Groups rows={rows} now={now} onOpen={open} />
          </div>
        )}
        <div className="ifoot">
          <span style={{ flex: 1 }}>{nt.kept}</span>
          <button type="button" onClick={() => (onClose(), s.openSettings("notifications"))} data-nt-settings>
            {nt.settings}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Phone: a full page from the inline-end. Back, the edge swipe and the browser's Back all close it the same way. */
function Page({ onClose }: { onClose: () => void }) {
  const { t, f } = useI18n();
  const nt = t.nt;
  const s = useStore();
  const { rows, now, unread } = useInbox();
  const [out, setOut] = useState(false);
  const [dx, setDx] = useState<number | null>(null);
  const edge = useRef<{ x0: number; t0: number } | null>(null);
  const finish = useCallback(() => {
    setOut(true);
    document.documentElement.removeAttribute("data-inbox");
    setTimeout(onClose, 280);
  }, [onClose]);
  useBackClose(true, finish, "(max-width: 1023px)");
  const open = useOpenRow(onClose);
  useEffect(() => {
    void inboxStore.load();
    // Two frames: the page's own entry runs, Home moves under it on the same curve.
    const id = requestAnimationFrame(() => document.documentElement.setAttribute("data-inbox", "open"));
    return () => {
      cancelAnimationFrame(id);
      document.documentElement.removeAttribute("data-inbox");
    };
  }, []);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const w = typeof window !== "undefined" ? window.innerWidth : 390;
  return (
    <section
      className={cn("nx ibx-page", out && "out", dx != null && "dragging")}
      style={dx != null ? { transform: `translateX(${(rtl ? -1 : 1) * dx}px)` } : undefined}
      aria-label={nt.title}
      role="dialog"
      aria-modal="true"
      data-nt-page
      onPointerDown={(e) => {
        const fromEdge = rtl ? w - e.clientX : e.clientX;
        if (e.pointerType !== "mouse" && fromEdge < 24) edge.current = { x0: e.clientX, t0: performance.now() };
      }}
      onPointerMove={(e) => {
        if (!edge.current) return;
        const v = (e.clientX - edge.current.x0) * (rtl ? -1 : 1);
        if (v > 4) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDx(Math.max(0, v));
      }}
      onPointerUp={(e) => {
        const c = edge.current;
        edge.current = null;
        if (!c || dx == null) return setDx(null);
        const vel = dx / Math.max(1, performance.now() - c.t0);
        void e;
        if (dx > w * 0.35 || vel > 0.5) {
          setDx(null);
          history.back();
        } else setDx(null);
      }}
      onPointerCancel={() => ((edge.current = null), setDx(null))}
    >
      <div className="pg-top">
        <button type="button" className="btn icon ghost" onClick={() => history.back()} aria-label={nt.back} data-nt-back>
          <Svg d="m15 18-6-6 6-6" className="flip" />
        </button>
        <span className="sp" />
        {unread > 0 && (
          <button type="button" className="btn ghost" style={{ height: 44, fontSize: 14 }} onClick={() => inboxStore.readAll()} data-nt-markall>
            {nt.markAll}
          </button>
        )}
      </div>
      <div className="pg-title">
        <h1>{nt.title}</h1>
        {unread > 0 && <span className="newc">{f(nt.newN, { n: unread })}</span>}
      </div>
      <Banners phone />
      {!rows ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ilist">
          <Groups rows={rows} now={now} onOpen={open} swipe />
          <div className="pg-foot">
            <span>{nt.kept}</span>
            <button type="button" onClick={() => (onClose(), s.openSettings("notifications"))} data-nt-settings>
              {nt.settings}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The inbox for whichever layout is showing. */
export function InboxLayer() {
  const s = useStore();
  const desk = useMedia(DESK);
  const open = s.panel === "alerts";
  const close = useCallback(() => {
    s.setPanel(null);
    // Opened at /inbox (a grouped push): closing leaves Home's own address.
    if (window.location.pathname === "/inbox") window.history.replaceState(window.history.state, "", `/${window.location.search}`);
  }, [s]);
  if (!open || s.loading) return null;
  return desk ? <Popover onClose={close} /> : <Page onClose={close} />;
}

/** The header bell: count badge, a ring when something new arrives while the app is open. */
export function NotifyBell({ variant, className }: { variant: "desk" | "phone"; className?: string }) {
  const s = useStore();
  const { t } = useI18n();
  const { unread, ring, ask } = useInbox();
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    if (!ring) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- replay the one-shot ring
    setRinging(true);
    const id = setTimeout(() => setRinging(false), 750);
    return () => clearTimeout(id);
  }, [ring]);
  const open = s.panel === "alerts";
  const label = unread ? `${t.nt.title} (${unread})` : t.nt.title;
  return (
    <button
      type="button"
      className={cn(className, ringing && "nt-ring")}
      onClick={() => s.setPanel(open ? null : "alerts")}
      aria-label={label}
      aria-expanded={variant === "desk" ? open : undefined}
      aria-haspopup={variant === "desk" ? "dialog" : undefined}
      title={variant === "desk" ? t.nt.title : undefined}
      data-nt-bell={variant}
      data-carry="panel:alerts"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={ICONS.BELL} />
      </svg>
      {ask && !unread && <span className="nt-bell-dot" aria-hidden data-nt-ask-dot />}
      {unread > 0 && (
        <span className="nt-bd" data-unread={unread}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

/** App start + while open: the push key, the badge, this device's subscription, messages from the service worker. */
export function NotifyRuntime() {
  const s = useStore();
  const { boot } = useInbox();
  useEffect(() => {
    if (s.loading || s.offlineAt != null) return;
    let alive = true;
    notifyBoot()
      .then((b) => {
        if (!alive) return;
        inboxStore.setBoot(b);
        // iPhone: only a Home Screen app can subscribe.
        const env = pushEnv();
        if (!env.iphone || env.standalone) void ensureSubscribed(b.publicKey);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.loading]);
  useEffect(() => {
    if (!boot) return;
    const sw = navigator.serviceWorker;
    const msg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type === "nexus-notify") inboxStore.poke(true);
      else if (d?.type === "nexus-resubscribe") void ensureSubscribed(inboxStore.get().boot?.publicKey ?? null, true);
      else if (d?.type === "nexus-open" && typeof d.url === "string" && d.url.startsWith("/")) window.location.href = d.url;
    };
    const vis = () => document.visibilityState === "visible" && inboxStore.poke();
    sw?.addEventListener("message", msg);
    window.addEventListener("focus", vis);
    document.addEventListener("visibilitychange", vis);
    const id = setInterval(() => document.visibilityState === "visible" && void inboxStore.refreshUnread(true), REFRESH_MS);
    return () => {
      sw?.removeEventListener("message", msg);
      window.removeEventListener("focus", vis);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(id);
    };
  }, [boot]);
  return null;
}

/** Unread for other surfaces (Me sheet row, the avatar dot). */
export function useNotifyUnread() {
  return useInbox().unread;
}

