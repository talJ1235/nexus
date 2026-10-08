"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChartColumn, ChevronDown, Folder, House, Plus, Search, ShoppingBag, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { useBackClose } from "@/components/ui/sheet-drag";
import { prewarmScanners } from "@/lib/barcode-reader";
import { useUnreadAlerts } from "./alerts-panel";
import { useReadOnly } from "./offline-banner";
import { usePlusOpen, useStore, type View } from "./store";
import { useAddActions } from "./add-actions";
import { AskButton } from "./top-bar";
import { PhoneSearchResults, rememberSearch } from "./phone-search";
import { SpaceLook, useMeName } from "./spaces/space-ui";
import { initialOf } from "@/lib/initial";

/** Phone / tablet (<1024 px) top bar = home-v4 (R14 B2): Box + "Nexus", then the search circle, the Ask circle and the
 *  avatar (Me; a dot when price alerts are unread), 36 px controls with ≥ 40 px tap areas. Search expands in place. */
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
  useBackClose(open, close, "(max-width: 1023px)");
  const unread = useUnreadAlerts();
  const meName = useMeName();
  // 36 px circles; the ::after grows each tap area to 40 px without moving anything.
  const circle = "relative grid size-9 shrink-0 place-items-center rounded-full active:scale-95 after:absolute after:-inset-0.5 after:content-['']";

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
              <b className="min-w-0 max-w-[96px] truncate text-[13px] font-bold max-[379px]:hidden" data-phone-space-name>{s.space.name}</b>
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
      {s.aiEnabled && !open && <AskButton iconOnly className="size-9 [&_svg]:size-4 [&_svg]:text-spark" />}
      {!open && (
        // Settings, look, alerts, reports, extension, Telegram, export and log out (Round 9 A1).
        <button
          type="button"
          onClick={() => s.setMeOpen(true)}
          className={cn(circle, "ms-0.5 size-8 bg-ink text-xs font-bold text-bg")}
          aria-label={unread ? `${t.me.open} · ${t.alerts.title} (${unread})` : t.me.open}
          data-me-open
        >
          {initialOf(meName, "")}
          {unread > 0 && <span className="absolute -end-px -top-px size-2.5 rounded-full bg-spark ring-2 ring-bg" data-unread={unread} />}
        </button>
      )}
      {open && <PhoneSearchResults q={q} onClose={close} onPick={setQ} />}
    </div>
  );
}

type DockTarget = "home" | "shopping" | "projects" | "spending";
const DOCK: { id: DockTarget; icon: React.ReactNode; label: (t: ReturnType<typeof useI18n>["t"]) => string }[] = [
  { id: "home", icon: <House />, label: (t) => t.dash.title },
  // Shopping (Round 13 B1): To buy ⇄ On the way in one tab; opens the sub-tab used last.
  { id: "shopping", icon: <ShoppingBag />, label: (t) => t.shopTab.title },
  { id: "projects", icon: <Folder />, label: (t) => t.projects.title },
  // "Insights": Spending · History (Round 11 B2).
  { id: "spending", icon: <ChartColumn />, label: (t) => t.insights.title },
];

const SHOP_TAB_KEY = "nexus.shopTab";
/** The Shopping tab's last sub-tab (per device; default To buy). */
export function lastShopTab(): "to_buy" | "ordered" {
  try {
    return localStorage.getItem(SHOP_TAB_KEY) === "ordered" ? "ordered" : "to_buy";
  } catch {
    return "to_buy";
  }
}
const dockOf = (v: View): DockTarget | null =>
  v.type === "home" ? "home" : v.type === "to_buy" || v.type === "ordered" ? "shopping" : v.type === "collection" || v.type === "projects" ? "projects" : v.type === "orders" || v.type === "history" || v.type === "spending" ? "spending" : null;

/**
 * Floating dock: Home · Shopping · + · Projects · Insights (Round 13 B1) — physically left to right in every language
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
  const active = dockOf(s.view);
  const urgent = s.items.filter((i) => i.status === "to_buy" && i.priority === "urgent").length;
  const go = (id: DockTarget) => s.setView(id === "shopping" ? { type: lastShopTab() } : { type: id });
  const item = (d: (typeof DOCK)[number]) => (
    <button
      key={d.id}
      type="button"
      onClick={() => go(d.id)}
      data-dock-target={d.id}
      aria-label={d.id === "shopping" && urgent ? `${d.label(t)} (${urgent})` : d.label(t)}
      aria-current={active === d.id ? "page" : undefined}
      data-carry={`view:${d.id === "shopping" ? "to_buy" : d.id}`}
      // R14 B2: icons with labels under them (Tal), active = ink, others muted.
      className={cn(
        "flex h-full min-w-0 flex-col items-center justify-center gap-[3px] text-[10.5px] font-semibold leading-none transition-[color,transform] duration-200 active:scale-95 [&_svg]:size-[21px] [&_svg]:stroke-[1.8]",
        active === d.id ? "text-ink" : "text-muted",
      )}
    >
      <span className="relative">
        {d.icon}
        {d.id === "shopping" && urgent > 0 && (
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
  return (
    <nav
      dir="ltr"
      className="fixed inset-x-3 bottom-[calc(18px+env(safe-area-inset-bottom))] z-40 grid h-[62px] grid-cols-5 items-center rounded-full border border-line bg-surface px-1 text-ink shadow-[0_8px_28px_color-mix(in_srgb,var(--ink)_12%,transparent)] transition-[transform,opacity] duration-[320ms] ease-[var(--ease-out)] lg:hidden [[data-selecting]_&]:pointer-events-none [[data-selecting]_&]:translate-y-[140%] [[data-selecting]_&]:opacity-0"
      aria-label="Main"
      data-dock
    >
      {DOCK.slice(0, 2).map(item)}
      {/* R15 C1: viewers get no "+" (nothing they could add). */}
      {s.space?.role === "viewer" ? (
        <span aria-hidden />
      ) : (
      <button
        type="button"
        onClick={() => s.setPlusOpen(!plusOpen)}
        aria-label={plusOpen ? t.phone.closeMenu : t.phone.add}
        aria-expanded={plusOpen}
        data-plus
        data-dock-target="plus"
        className="grid size-[52px] place-items-center justify-self-center rounded-full bg-brand text-on-brand shadow-[0_8px_20px_color-mix(in_srgb,var(--brand)_40%,transparent)] active:scale-95"
      >
        <Plus className={cn("size-6 transition-transform duration-[450ms] ease-[var(--ease-spring)]", plusOpen && "rotate-[135deg]")} strokeWidth={2.4} />
      </button>
      )}
      {DOCK.slice(2).map(item)}
    </nav>
  );
}

const noop = () => () => {};
/** True after hydration (portals need document.body). */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/** "+" menu: scrim + four action cards that rise with a spring, staggered bottom-up (portal, like the dock). */
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
  useBackClose(open, () => s.setPlusOpen(false), "(max-width: 1023px)");
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
    <div className="lg:hidden" data-plus-menu={open ? "open" : "closed"}>
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
            // Bottom row rises first, then the top row (a spring, staggered toward the +).
            style={{ transitionDelay: open ? `${(i < 2 ? 2 : 0) * 45 + (i % 2) * 35}ms` : "0ms", backgroundColor: "var(--surface)", backgroundImage: `var(--act-${a.tone})` }}
            className={cn(
              "relative flex min-h-[124px] flex-col items-start justify-between overflow-hidden rounded-[24px] border border-line p-3.5 text-start shadow-[0_14px_32px_color-mix(in_srgb,var(--ink)_16%,transparent)] transition-[opacity,transform] active:scale-[0.97] disabled:opacity-50",
              // Open: a spring; close: the same transform/opacity pair on --ease-out, ≤ 280 ms (R16 A11).
              open ? "translate-y-0 scale-100 opacity-100 duration-[250ms,450ms] ease-[ease,var(--ease-spring)]" : "translate-y-6 scale-[0.92] opacity-0 duration-[180ms,260ms] ease-[var(--ease-out)]",
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
            open ? "translate-y-0 opacity-100 duration-[250ms,450ms] ease-[ease,var(--ease-spring)]" : "translate-y-4 opacity-0 duration-[180ms,260ms] ease-[var(--ease-out)]",
          )}
          style={{ transitionDelay: open ? "150ms" : "0ms" }}
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
