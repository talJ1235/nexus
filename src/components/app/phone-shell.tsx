"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Camera, ChartColumn, ChevronDown, House, Plus, ScanBarcode, Search, ShoppingBasket, ShoppingCart, Tag, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { useBackClose } from "@/components/ui/sheet-drag";
import { isPhone } from "@/components/ui/use-device";
import { prewarmScanners } from "@/lib/barcode-reader";
import { NotifyBell } from "../notify/inbox";
import { useReadOnly } from "./offline-banner";
import { usePlusOpen, useStore } from "./store";
import { useAddActions } from "./add-actions";
import { PhoneSearchResults, rememberSearch } from "./phone-search";
import { SpaceLook, useMeName } from "./spaces/space-ui";
import { initialOf } from "@/lib/initial";
import { DOCK_ORDER, dockOf, type DockTarget } from "@/lib/dock";
import { requestSm, type SmIntent } from "./supermarket/intent";
import { LONG_MS, press as pressStep, type PressEvent, type PressState } from "@/lib/press";

/** Phone / tablet (<1024 px) top bar = home-v4 (R14 B2): Box + "Nexus", then the search circle, the Ask circle and the
 *  bell (the inbox, R17 S3), avatar (Me), 36 px controls with ≥ 40 px tap areas. Search expands in place. */
export function PhoneTopBar() {
  const s = useStore();
  const { t } = useI18n();
  const [searching, setSearching] = useState(false);
  // Round 13 C1: the phone search has its own text and shows grouped results (it no longer filters the list).
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);
  const open = searching;
  const close = () => {
    setQ("");
    setSearching(false);
  };
  useBackClose(open, close, isPhone);
  const meName = useMeName();
  // 36 px circles; the ::after grows each tap area to 40 px without moving anything.
  const circle = "relative grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-[120ms] ease-[var(--ease-out)] active:scale-95 after:absolute after:-inset-0.5 after:content-['']";

  return (
    <div className="flex h-10 items-center gap-2" data-phone-top>
      {open ? (
        <label className="flex h-10 min-w-0 flex-1 animate-pop-in items-center gap-2 rounded-full border border-line bg-surface pe-0.5 ps-3.5 text-muted">
          <Search className="size-[19px] shrink-0" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Enter") rememberSearch(q);
            }}
            placeholder={t.shell.searchPlaceholder}
            aria-label={t.view.search}
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
            data-phone-search-input
          />
          <button
            type="button"
            onClick={close}
            className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
            aria-label={t.phone.closeSearch}
          >
            <X className="size-[18px]" />
          </button>
        </label>
      ) : (
        <>
          <button type="button" onClick={() => s.setView({ type: "home" })} className="flex h-10 shrink-0 items-center gap-2 rounded-lg" aria-label={t.dash.title} data-topbar-logo data-carry="view:home">
            <LogoMark className="size-5" />
            {/* R16 A10: the wordmark is always there at its R14 size — it's the "go Home" button. */}
            <span className="text-[16px] font-extrabold tracking-[-0.01em]">Nexus</span>
          </button>
          {/* R15 C1 (Switcher-phone): the current space next to the logo; tap → the spaces sheet (Me). R16 A10: a compact
              chip (tile + chevron; the name only when there's room) that never squeezes the logo. */}
          {s.space ? (
            <button type="button" onClick={() => s.setMeOpen(true)} className="me-auto ms-1 flex h-10 min-w-10 items-center gap-1 overflow-hidden rounded-full border border-line bg-surface pe-1.5 ps-[5px]" aria-label={`${t.spaces.switch}: ${s.space.name}`} data-phone-space>
              <SpaceLook space={s.space} size={26} />
              <b className="bidi min-w-0 max-w-[96px] truncate text-[13px] font-bold max-[379px]:hidden" data-phone-space-name>{s.space.name}</b>
              <ChevronDown className="size-3.5 shrink-0 text-muted" />
            </button>
          ) : (
            <span className="me-auto" />
          )}
          <button type="button" onClick={() => setSearching(true)} className={cn(circle, "border border-line bg-surface text-ink")} aria-label={t.phone.search} data-phone-search>
            <Search className="size-4" strokeWidth={1.9} />
          </button>
        </>
      )}
      {/* R17 S3 K2: the bell is back in the phone header — it opens the inbox page. */}
      {!open && <NotifyBell variant="phone" className={cn(circle, "border border-line bg-surface text-ink [&_svg]:!size-[18px]")} />}
      {!open && (
        // Settings, look, alerts, reports, extension, Telegram, export and log out (Round 9 A1).
        <button
          type="button"
          onClick={() => s.setMeOpen(true)}
          className={cn(circle, "ms-0.5 size-8 bg-ink text-xs font-bold text-bg after:-inset-1")}
          aria-label={t.me.open}
          data-me-open
        >
          {initialOf(meName, "")}
        </button>
      )}
      {open && <PhoneSearchResults q={q} onClose={close} onPick={setQ} />}
    </div>
  );
}

type Dict = ReturnType<typeof useI18n>["t"];
const DOCK: Record<DockTarget, { icon: React.ReactNode; label: (t: Dict) => string }> = {
  home: { icon: <House />, label: (t) => t.dash.title },
  // R18 S2 A1: "Products" (was Shopping) — To buy · On the way · Projects; opens the segment used last.
  shopping: { icon: <Tag />, label: (t) => t.sm.products },
  supermarket: { icon: <ShoppingBasket />, label: (t) => t.sm.title },
  // "Insights": Spending · History (Round 11 B2).
  spending: { icon: <ChartColumn />, label: (t) => t.insights.title },
};

const SHOP_TAB_KEY = "nexus.shopTab";
/** The Products tab's last segment (per device; default To buy). */
export function lastShopTab(): "to_buy" | "ordered" | "projects" {
  try {
    const v = localStorage.getItem(SHOP_TAB_KEY);
    return v === "ordered" || v === "projects" ? v : "to_buy";
  } catch {
    return "to_buy";
  }
}
export function rememberShopTab(v: "to_buy" | "ordered" | "projects") {
  try {
    localStorage.setItem(SHOP_TAB_KEY, v);
  } catch {}
}
/**
 * Floating dock: Home · Products · + · Supermarket · Insights for everyone (R18 S3 A1, `lib/dock.ts`) — physically left to right in every language
 * (Tal's decision: not mirrored in Hebrew; labels keep their own direction). Rendered into document.body so no animated
 * or transformed ancestor can move it; safe-area aware; hidden while items are selected.
 */
export function Dock() {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(<DockBar />, document.body);
}

function DockBar() {
  const s = useStore();
  const { t } = useI18n();
  const plusOpen = usePlusOpen();
  const active = dockOf(s.view.type);
  const urgent = s.items.filter((i) => i.status === "to_buy" && i.priority === "urgent").length;
  const [quick, setQuick] = useState(false);
  const go = (id: DockTarget) => s.setView(id === "shopping" ? { type: lastShopTab() } : { type: id });
  const item = (id: DockTarget) => {
    const d = DOCK[id];
    return (
      <button
        key={id}
        type="button"
        onClick={() => go(id)}
        data-dock-target={id}
        aria-label={id === "shopping" && urgent ? `${d.label(t)} (${urgent})` : d.label(t)}
        aria-current={active === id ? "page" : undefined}
        data-carry={`view:${id === "shopping" ? "to_buy" : id}`}
        // R14 B2: icons with labels under them (Tal), active = ink, others muted. R19 A2: the active tab also gets the
        // pill behind its icon (DockPill), a 2.2 stroke and a 750 label.
        className={cn(
          "relative flex h-full min-w-0 flex-col items-center justify-center gap-[3px] text-[10.5px] leading-none transition-[color,transform] duration-200 active:scale-95 [&_svg]:size-[21px]",
          active === id ? "font-[750] text-ink [&_svg]:stroke-[2.2]" : "font-semibold text-muted [&_svg]:stroke-[1.8]",
        )}
      >
        <span className="relative" data-dock-icon>
          {d.icon}
          {id === "shopping" && urgent > 0 && (
            <span className="tabular absolute -end-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold leading-none text-bg" data-dock-badge>
              {urgent}
            </span>
          )}
        </span>
        <span className="max-w-full truncate px-0.5" dir="auto" data-dock-label>
          {d.label(t)}
        </span>
      </button>
    );
  };
  // Long-press "+" (R18 S2 A1, Nav-phone): the quick supermarket menu; a plain tap keeps the "+" menu.
  const tap = () => {
    if (quick) return setQuick(false);
    // R18 S3 C1 / S4 B1: on the Supermarket tab every tap on "+" is the camera, barcode first (a hold opens its menu).
    if (s.view.type === "supermarket" && !plusOpen) return requestSm("scan");
    s.setPlusOpen(!plusOpen);
  };
  const press = useLongPress(() => {
    s.setPlusOpen(false);
    setQuick(true);
    try {
      navigator.vibrate?.(8);
    } catch {}
  }, tap);
  return (
    <>
      <nav
        dir="ltr"
        className="fixed inset-x-3 bottom-[calc(18px+env(safe-area-inset-bottom))] z-40 grid h-[62px] grid-cols-5 items-center rounded-full border border-line bg-surface px-1 text-ink shadow-[0_8px_28px_color-mix(in_srgb,var(--ink)_12%,transparent)] transition-[transform,opacity] duration-[320ms] ease-[var(--ease-out)] desk:hidden [[data-selecting]_&]:pointer-events-none [[data-selecting]_&]:translate-y-[140%] [[data-selecting]_&]:opacity-0"
        aria-label="Main"
        data-dock
      >
        <DockPill active={active} />
        {DOCK_ORDER.slice(0, 2).map(item)}
        {/* R15 C1: viewers get no "+" (nothing they could add). */}
        {s.space?.role === "viewer" ? (
          <span aria-hidden />
        ) : (
          <button
            type="button"
            onClick={press.onClick}
            {...press.handlers}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={plusOpen || quick ? t.phone.closeMenu : t.phone.add}
            aria-expanded={plusOpen || quick}
            aria-haspopup="menu"
            data-plus
            data-dock-target="plus"
            // R18 S3 A6 (Nav-phone `.plus.held`): while the finger is down, and while either menu is open, the whole button
            // eases to 0.9 and turns 45° — the "+" becomes "×", and the hold shows it's about to open the quick menu.
            className={cn(
              "grid size-[52px] touch-manipulation select-none place-items-center justify-self-center rounded-full bg-brand text-on-brand shadow-[0_8px_20px_color-mix(in_srgb,var(--brand)_40%,transparent)] transition-transform duration-[220ms] ease-[var(--ease-out)] [-webkit-touch-callout:none]",
              (press.pressing || plusOpen || quick) && "rotate-45 scale-90",
            )}
            data-plus-held={press.pressing || plusOpen || quick ? "" : undefined}
          >
            <Plus className="size-6" strokeWidth={2.4} />
          </button>
        )}
        {DOCK_ORDER.slice(2).map(item)}
      </nav>
      <QuickMenu open={quick} onClose={() => setQuick(false)} />
    </>
  );
}

/**
 * R19 A2 (board Fixes-phone): a 56×30 pill behind the active tab's icon (ink 11 %, Plum: brand 16 %, `.dock-pill` in
 * globals.css). One element that slides between tabs (`--ease-drawer`, 260 ms; reduced motion: it just moves); measured
 * from the icon, so it follows the tab whatever the label's length. No dock tab active (Settings…) → it fades out.
 */
function DockPill({ active }: { active: DockTarget | null }) {
  const me = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // No slide into the first place (the pill appears there); slides only between tabs after that.
  const [live, setLive] = useState(false);
  useLayoutEffect(() => {
    // The pill's own parent (the dock): a parent's ref isn't attached yet when a child's layout effect runs.
    const el = me.current?.parentElement;
    if (!el) return;
    const read = () => {
      const ic = active ? el.querySelector(`[data-dock-target="${active}"] [data-dock-icon]`) : null;
      if (!ic) return setAt(null);
      const n = el.getBoundingClientRect();
      const r = ic.getBoundingClientRect();
      setAt({ x: Math.round(r.left + r.width / 2 - n.left - 28), y: Math.round(r.top + r.height / 2 - n.top - 15) });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  const placed = !!at;
  useEffect(() => {
    if (!placed) return;
    const f = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(f);
  }, [placed]);
  return (
    <span
      ref={me}
      aria-hidden
      className={cn("dock-pill", !at && "dock-pill-off", !live && "dock-pill-still")}
      style={at ? { transform: `translate(${at.x}px, ${at.y}px)` } : undefined}
      data-dock-pill={active ?? ""}
    />
  );
}

/**
 * R18 S4 B1: tap / press-and-hold on pointer events only (`lib/press.ts`) — a tap is `onTap`, a hold ≥ 450 ms without
 * moving > 10 px is `onLong`, and the release of a hold is never also a tap. The click that follows a pointer press is
 * ignored; a click without one (keyboard Enter / Space) is a tap.
 */
function useLongPress(onLong: () => void, onTap: () => void) {
  const st = useRef<PressState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // When the last pointer press ended: the click the browser sends after it is not a second tap.
  const lastUp = useRef(0);
  // The finger is down (the "held" look); ends on release, a move, or when the hold fires.
  const [pressing, setPressing] = useState(false);
  const feed = (e: PressEvent) => {
    const [next, out] = pressStep(st.current, e);
    st.current = next;
    setPressing(!!next && !next.dead && !next.long);
    if (!next) clearTimeout(timer.current);
    if (out === "long") onLong();
    if (out === "tap") onTap();
  };
  return {
    pressing,
    onClick: () => {
      if (performance.now() - lastUp.current < 1000) return;
      onTap();
    },
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        lastUp.current = performance.now();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
        feed({ type: "down", id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => feed({ type: "timer", at: performance.now() }), LONG_MS);
      },
      onPointerMove: (e: React.PointerEvent) => feed({ type: "move", id: e.pointerId, x: e.clientX, y: e.clientY }),
      onPointerUp: (e: React.PointerEvent) => {
        lastUp.current = performance.now();
        feed({ type: "up", id: e.pointerId, at: lastUp.current });
      },
      onPointerCancel: () => {
        lastUp.current = performance.now();
        feed({ type: "cancel" });
      },
    },
  };
}

/** The long-press menu: Add to list · Scan · Photo · Start shopping — each opens the Supermarket doing it. */
function QuickMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  useBackClose(open, onClose, isPhone);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, onClose]);
  const rows: { k: SmIntent; icon: React.ReactNode; label: string }[] = [
    { k: "add", icon: <Plus />, label: t.sm.quick.add },
    { k: "scan", icon: <ScanBarcode />, label: t.sm.quick.scan },
    { k: "photo", icon: <Camera />, label: t.sm.quick.photo },
    { k: "shop", icon: <ShoppingCart />, label: t.sm.quick.shop },
  ];
  const pick = (k: SmIntent) => {
    onClose();
    if (s.view.type !== "supermarket") s.setView({ type: "supermarket" });
    // The screen mounts first (a view switch), then takes the intent.
    setTimeout(() => requestSm(k), 30);
  };
  return (
    <div className="desk:hidden" data-quick-menu={open ? "open" : "closed"}>
      <div
        aria-hidden
        onClick={onClose}
        className={cn("fixed inset-0 z-[35] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[6px] transition-opacity duration-200 ease-[var(--ease-out)]", open ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      {/* Mounted while closed for its exit animation — a menu role only while open (Esc → the command menu checks for
          any open menu). */}
      <div
        role={open ? "menu" : undefined}
        aria-label={t.sm.quick.label}
        aria-hidden={!open}
        className={cn(
          "fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[36] mx-auto w-[min(300px,calc(100%-40px))] origin-bottom rounded-[22px] border border-line bg-surface p-2 shadow-[0_18px_40px_color-mix(in_srgb,var(--ink)_18%,transparent)] transition-[opacity,transform] duration-200 ease-[var(--ease-out)]",
          open ? "scale-100 opacity-100" : "pointer-events-none translate-y-3 scale-[0.96] opacity-0",
        )}
      >
        {rows.map((r) => (
          <button
            key={r.k}
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={() => pick(r.k)}
            data-quick={r.k}
            className="flex min-h-[52px] w-full items-center gap-3.5 rounded-[14px] px-2.5 text-start text-[15px] font-semibold text-ink transition-[background-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.98] active:bg-surface-2"
          >
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-[11px] [&_svg]:size-[18px] [&_svg]:stroke-[1.9]", r.k === "shop" ? "bg-ink text-bg" : "bg-surface-2 text-ink")}>{r.icon}</span>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const noop = () => () => {};
/** True after hydration (portals need document.body). */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/** "+" menu: scrim + four action cards that rise (220 ms ease-out), staggered bottom-up (portal, like the dock). */
export function PlusMenu() {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(<PlusMenuSheet />, document.body);
}

function PlusMenuSheet() {
  const s = useStore();
  const { t } = useI18n();
  const ro = useReadOnly();
  const open = usePlusOpen();
  // Back gesture (the shared surface stack, like every sheet) / Esc closes.
  useBackClose(open, () => s.setPlusOpen(false), isPhone);
  useEffect(() => {
    if (!open) return;
    prewarmScanners(); // two of its four actions are camera screens (Round 10 B1)
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        s.setPlusOpen(false);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, s]);

  const choose = (fn: () => void) => {
    s.setPlusOpen(false);
    setTimeout(fn, 60);
  };
  // Each action has its own colour (tokens --act-*) and illustration, so they're told apart without reading.
  // The list is shared with the desktop Add menu and the empty Home (R16 A3); the rest sit in a compact row.
  const all = useAddActions();
  const actions = all.filter((a) => a.primary);
  const more = all.filter((a) => !a.primary);
  return (
    <div className="desk:hidden" data-plus-menu={open ? "open" : "closed"}>
      <div
        aria-hidden
        onClick={() => s.setPlusOpen(false)}
        className={cn(
          "fixed inset-0 z-[35] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[10px] transition-opacity",
          open ? "duration-300" : "duration-[240ms] ease-[var(--ease-out)]",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        role={open ? "menu" : undefined}
        aria-hidden={!open}
        className={cn("fixed inset-x-5 bottom-[calc(108px+env(safe-area-inset-bottom))] z-[36] mx-auto grid max-w-[400px] grid-cols-2 gap-2.5", !open && "pointer-events-none")}
      >
        {actions.map((a, i) => (
          <button
            key={a.key}
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            disabled={a.disabled}
            onClick={() => choose(a.run)}
            data-plus-action={a.key}
            // Bottom row rises first, then the top row (polish #12: 20 ms steps, settled by ~280 ms — it opens all day).
            style={{ transitionDelay: open ? `${((i < 2 ? 2 : 0) + (i % 2)) * 20}ms` : "0ms", backgroundColor: "var(--surface)", backgroundImage: `var(--act-${a.tone})` }}
            className={cn(
              // Disabled dims only while open: `disabled:opacity-50` would beat the closed `opacity-0` (a ghost card).
              "relative flex min-h-[124px] flex-col items-start justify-between overflow-hidden rounded-[24px] border border-line p-3.5 text-start shadow-[0_14px_32px_color-mix(in_srgb,var(--ink)_16%,transparent)] transition-[opacity,transform] active:scale-[0.97]",
              open && "disabled:opacity-50",
              // Open: 220 ms ease-out, no overshoot (polish #12); close: the same pair on --ease-out, ≤ 280 ms (R16 A11).
              open ? "translate-y-0 scale-100 opacity-100 duration-[220ms] ease-[var(--ease-out)]" : "translate-y-6 scale-[0.92] opacity-0 duration-[180ms,260ms] ease-[var(--ease-out)]",
            )}
          >
            <span className="block h-11 w-14" style={{ color: `var(--act-${a.tone}-ink)` }} aria-hidden>
              {a.art}
            </span>
            <span className="min-w-0">
              <b className="block text-[15px] font-extrabold leading-tight" style={{ color: `var(--act-${a.tone}-ink)` }}>
                {a.title}
              </b>
              <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted">{a.hint}</span>
            </span>
          </button>
        ))}
        {/* R16 A3: the rest of the shared add list (import, new list / project) — one compact row under the cards. */}
        <div
          className={cn(
            "col-span-2 flex gap-2 transition-[opacity,transform]",
            open ? "translate-y-0 opacity-100 duration-[220ms] ease-[var(--ease-out)]" : "translate-y-4 opacity-0 duration-[180ms,260ms] ease-[var(--ease-out)]",
          )}
        >
          {more.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              disabled={a.disabled}
              onClick={() => choose(a.run)}
              data-plus-action={a.key}
              className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[12.5px] font-bold text-ink shadow-card active:scale-[0.97] disabled:opacity-50"
            >
              <a.icon className="size-4 shrink-0 text-muted" />
              <span className="truncate">{a.short ?? a.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- "+" menu illustrations (Round 9 A3): drawn in currentColor (the action's ink) ----------

export function BarcodeArt() {
  return (
    <svg viewBox="0 0 56 44" className="size-full" fill="currentColor">
      <rect x="4" y="6" width="48" height="32" rx="8" fill="currentColor" opacity=".12" />
      {[10, 14, 16, 21, 24, 26, 31, 35, 37, 41, 44].map((x, i) => (
        <rect key={x} x={x} y="12" width={i % 3 === 0 ? 2.4 : 1.4} height="20" rx=".6" />
      ))}
      {/* the scan line sweeps once when the menu opens */}
      <rect className="plus-scan" x="6" y="21" width="44" height="2.2" rx="1.1" fill="currentColor" opacity=".9" />
    </svg>
  );
}

export function ReceiptArt() {
  return (
    <svg viewBox="0 0 56 44" className="size-full" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 4h22v34l-3.7-2.6-3.6 2.6-3.7-2.6-3.7 2.6-3.6-2.6L17 38z" fill="currentColor" fillOpacity=".14" />
      <path d="M22 12h12M22 18h12M22 24h7" />
      <path d="M31 30h4" strokeWidth="2.6" />
    </svg>
  );
}

export function LinkArt() {
  return (
    <svg viewBox="0 0 56 44" className="size-full" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <g transform="rotate(-35 28 22)">
        <rect x="9" y="15" width="21" height="14" rx="7" fill="currentColor" fillOpacity=".14" />
        <rect x="26" y="15" width="21" height="14" rx="7" fill="currentColor" fillOpacity=".14" />
        <path d="M21 22h14" />
      </g>
    </svg>
  );
}

export function PlanArt() {
  return (
    <svg viewBox="0 0 56 44" className="size-full" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M15 6l2.4 6.1L23.5 14.5l-6.1 2.4L15 23l-2.4-6.1L6.5 14.5l6.1-2.4z" fill="currentColor" stroke="none" />
      <path d="M31 13h18M31 21h14M31 29h18M15 32h10" />
      <circle cx="44" cy="8" r="2.4" fill="currentColor" stroke="none" opacity=".6" />
    </svg>
  );
}
