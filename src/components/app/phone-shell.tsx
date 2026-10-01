"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChartColumn, Folder, Link2, Plus, ReceiptText, ScanBarcode, Search, ShoppingCart, Sparkles, Truck, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoPill } from "@/components/logo";
import { cn } from "@/lib/utils";
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
          <button type="button" onClick={() => s.setView({ type: "to_buy" })} className="me-auto" aria-label={t.nav.toBuy}>
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

const DOCK: { view: View; icon: React.ReactNode; label: (t: ReturnType<typeof useI18n>["t"]) => string }[] = [
  { view: { type: "to_buy" }, icon: <ShoppingCart />, label: (t) => t.nav.toBuy },
  { view: { type: "ordered" }, icon: <Truck />, label: (t) => t.nav.onTheWay },
  { view: { type: "projects" }, icon: <Folder />, label: (t) => t.projects.title },
  { view: { type: "spending" }, icon: <ChartColumn />, label: (t) => t.phone.stats },
];

/**
 * Floating dock: To buy · On the way · + · Projects · Stats — physically left to right in every language (Tal's
 * decision: not mirrored in Hebrew; labels keep their own direction). Rendered into document.body so no animated or
 * transformed ancestor can move it; safe-area aware; hidden while items are selected.
 */
export function Dock() {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(<DockBar />, document.body);
}

function DockBar() {
  const s = useStore();
  const { t } = useI18n();
  const activeType = s.view.type === "collection" ? "projects" : s.view.type === "orders" ? "spending" : s.view.type;
  const item = (d: (typeof DOCK)[number]) => (
    <button
      key={d.view.type}
      type="button"
      onClick={() => s.setView(d.view)}
      data-dock-target={d.view.type}
      aria-label={d.label(t)}
      aria-current={activeType === d.view.type ? "page" : undefined}
      data-carry={`view:${d.view.type}`}
      className={cn(
        "grid size-[46px] place-items-center rounded-full transition-[background-color,opacity,transform] duration-200 active:scale-90 [&_svg]:size-[22px] [&_svg]:stroke-[1.8]",
        activeType === d.view.type ? "bg-surface-2 opacity-100" : "opacity-50",
      )}
    >
      {d.icon}
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
  // Back gesture / Esc closes: one history entry while open.
  useEffect(() => {
    if (!open) return;
    history.pushState({ nxPlus: 1 }, "");
    const pop = () => s.setPlusOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        s.setPlusOpen(false);
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", key, true);
      if (history.state?.nxPlus) history.back();
    };
  }, [open, s]);

  const choose = (fn: () => void) => {
    s.setPlusOpen(false);
    setTimeout(fn, 60);
  };
  const actions = [
    { key: "barcode", icon: <ScanBarcode />, title: t.phone.barcode, hint: t.phone.barcodeHint, run: () => s.setScanner("barcode"), disabled: false },
    { key: "receipt", icon: <ReceiptText />, title: t.phone.receipt, hint: t.phone.receiptHint, run: () => s.setScanner("receipt"), disabled: ro.ro },
    { key: "paste", icon: <Link2 />, title: t.phone.paste, hint: t.phone.pasteHint, run: () => s.setPasteOpen(true), disabled: ro.ro },
    { key: "plan", icon: <Sparkles />, title: t.phone.plan, hint: t.phone.planHint, run: () => s.setPanel("planner"), disabled: ro.ro || !s.aiEnabled },
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
      <div role={open ? "menu" : undefined} aria-hidden={!open} className={cn("fixed inset-x-6 bottom-[calc(110px+env(safe-area-inset-bottom))] z-[36] flex flex-col gap-2.5", !open && "pointer-events-none")}>
        {actions.map((a, i) => (
          <button
            key={a.key}
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            disabled={a.disabled}
            onClick={() => choose(a.run)}
            data-plus-action={a.key}
            style={{ transitionDelay: open ? `${(actions.length - 1 - i) * 50}ms` : "0ms" }}
            className={cn(
              "flex min-h-[68px] items-center gap-3.5 rounded-[22px] border border-line bg-surface py-3 pe-4 ps-3 text-start shadow-[0_12px_30px_color-mix(in_srgb,var(--ink)_14%,transparent)] transition-[opacity,transform] duration-[250ms,450ms] ease-[ease,var(--ease-spring)] disabled:opacity-50",
              open ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-[0.94] opacity-0",
            )}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-tint text-tint-ink [&_svg]:size-[22px]">{a.icon}</span>
            <span className="min-w-0">
              <b className="block text-[15px] font-bold">{a.title}</b>
              <span className="block truncate text-xs text-muted">{a.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
