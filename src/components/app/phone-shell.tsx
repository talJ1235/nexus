"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChartColumn, Folder, House, Plus, Search, ShoppingBag, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoPill } from "@/components/logo";
import { cn } from "@/lib/utils";
import { useBackClose } from "@/components/ui/sheet-drag";
import { prewarmScanners } from "@/lib/barcode-reader";
import { AlertsBell } from "./alerts-panel";
import { useReadOnly } from "./offline-banner";
import { useStore, type View } from "./store";
import { AskButton } from "./top-bar";

/** Phone / tablet (<1024 px) top bar: logo pill, then search, Ask (icon), alerts. Search expands in place. */
export function PhoneTopBar() {
  const s = useStore();
  const { t } = useI18n();
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);
  const open = searching || !!s.query;

  return (
    <div className="flex h-[46px] items-center gap-1.5 min-[380px]:gap-2" data-phone-top>
      {open ? (
        <label className="flex h-[46px] min-w-0 flex-1 animate-pop-in items-center gap-2 rounded-full border border-line bg-surface pe-1 ps-4 text-muted">
          <Search className="size-[19px] shrink-0" />
          <input
            ref={input}
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (s.setQuery(""), setSearching(false))}
            placeholder={t.shell.searchPlaceholder}
            aria-label={t.view.search}
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => {
              s.setQuery("");
              setSearching(false);
            }}
            className="grid size-10 place-items-center rounded-full hover:bg-surface-2"
            aria-label={t.phone.closeSearch}
          >
            <X className="size-[18px]" />
          </button>
        </label>
      ) : (
        <>
          {/* Settings, look, reports, extension, Telegram, export and log out (Round 9 A1). */}
          <button
            type="button"
            onClick={() => s.setMeOpen(true)}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-[15px] font-extrabold text-bg active:scale-95"
            aria-label={t.me.open}
            data-me-open
          >
            {t.shell.owner.slice(0, 1).toUpperCase()}
          </button>
          <button type="button" onClick={() => s.setView({ type: "home" })} className="me-auto" aria-label={t.dash.title} data-topbar-logo data-carry="view:home">
            <LogoPill className="h-[46px] text-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="grid size-[46px] shrink-0 place-items-center rounded-full border border-line bg-surface text-ink active:scale-95"
            aria-label={t.phone.search}
            data-phone-search
          >
            <Search className="size-5" />
          </button>
        </>
      )}
      {s.aiEnabled && <AskButton iconOnly />}
      <AlertsBell size="sm" />
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
  v.type === "home" ? "home" : v.type === "to_buy" || v.type === "ordered" || v.type === "urgent" || v.type === "unsorted" ? "shopping" : v.type === "collection" || v.type === "projects" ? "projects" : v.type === "orders" || v.type === "history" || v.type === "spending" ? "spending" : null;

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
      className={cn(
        "relative grid size-[46px] place-items-center rounded-full transition-[background-color,opacity,transform] duration-200 active:scale-90 [&_svg]:size-[22px] [&_svg]:stroke-[1.8]",
        active === d.id ? "bg-surface-2 opacity-100" : "opacity-50",
      )}
    >
      {d.icon}
      {d.id === "shopping" && urgent > 0 && (
        <span className="tabular absolute end-1 top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-warn px-1 text-[10.5px] font-bold leading-none text-bg" data-dock-badge>
          {urgent}
        </span>
      )}
    </button>
  );
  return (
    <nav
      dir="ltr"
      className="fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-40 flex h-[68px] items-center justify-around rounded-full border border-line bg-surface px-2 text-ink shadow-[0_14px_40px_color-mix(in_srgb,var(--ink)_16%,transparent)] transition-[transform,opacity] duration-[320ms] ease-[var(--ease-out)] lg:hidden [[data-selecting]_&]:pointer-events-none [[data-selecting]_&]:translate-y-[140%] [[data-selecting]_&]:opacity-0"
      aria-label="Main"
      data-dock
    >
      {DOCK.slice(0, 2).map(item)}
      <button
        type="button"
        onClick={() => s.setPlusOpen(!s.plusOpen)}
        aria-label={s.plusOpen ? t.phone.closeMenu : t.phone.add}
        aria-expanded={s.plusOpen}
        data-plus
        data-dock-target="plus"
        className="grid size-14 place-items-center rounded-full bg-brand text-on-brand shadow-[0_8px_20px_color-mix(in_srgb,var(--brand)_40%,transparent)] active:scale-95"
      >
        <Plus className={cn("size-[26px] transition-transform duration-[450ms] ease-[var(--ease-spring)]", s.plusOpen && "rotate-[135deg]")} strokeWidth={2.4} />
      </button>
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
  const open = s.plusOpen;
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
  const actions = [
    { key: "barcode", art: <BarcodeArt />, tone: "barcode", title: t.phone.barcode, hint: t.phone.barcodeHint, run: () => s.setScanner("barcode"), disabled: false },
    { key: "receipt", art: <ReceiptArt />, tone: "receipt", title: t.phone.receipt, hint: t.phone.receiptHint, run: () => s.setScanner("receipt"), disabled: ro.ro },
    { key: "paste", art: <LinkArt />, tone: "link", title: t.phone.paste, hint: t.phone.pasteHint, run: () => s.setPasteOpen(true), disabled: ro.ro },
    { key: "plan", art: <PlanArt />, tone: "plan", title: t.phone.plan, hint: t.phone.planHint, run: () => s.setPanel("planner"), disabled: ro.ro || !s.aiEnabled },
  ];
  return (
    <div className="lg:hidden" data-plus-menu={open ? "open" : "closed"}>
      <div
        aria-hidden
        onClick={() => s.setPlusOpen(false)}
        className={cn(
          "fixed inset-0 z-[35] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[10px] transition-opacity duration-300",
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
              "relative flex min-h-[124px] flex-col items-start justify-between overflow-hidden rounded-[24px] border border-line p-3.5 text-start shadow-[0_14px_32px_color-mix(in_srgb,var(--ink)_16%,transparent)] transition-[opacity,transform] duration-[250ms,450ms] ease-[ease,var(--ease-spring)] active:scale-[0.97] disabled:opacity-50",
              open ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-[0.92] opacity-0",
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
