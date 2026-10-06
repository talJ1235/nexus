"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownWideNarrow, ChevronDown, ChevronRight, LayoutGrid, List, Rows3, Store, Truck } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { Ring } from "@/components/ui/ring";
import { Ticker, useTicker } from "@/components/ui/ticker";
import { PHONE, useMedia } from "@/components/ui/use-media";
import { activeSource, budgetStats, countable, lineTotal, spendDate, sumTotals } from "@/lib/calc";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { convert, formatMoney, formatMoneyCompact } from "@/lib/money";
import { gapSuggestions, shippingGap, shippingRule } from "@/lib/shipping";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BuyFilterChips } from "./buy-filters";
import { useStore, type SortKey } from "./store";
import { COLLECTION_COLORS, itemsForView } from "./view-items";

/**
 * Views that open with the totals card + tiles: a project's and a store's page (their own budget / free-shipping).
 * R14 A3: not To buy — the indicators live on Home and Spending; To buy opens on the toolbar and the list.
 */
export const SUMMARY_VIEWS = ["collection", "store"];
/** Views whose toolbar starts with the "To buy · n items · total" head. */
const SECTION_HEAD_VIEWS = ["to_buy", ...SUMMARY_VIEWS];

/** A money amount with the decimals drawn smaller (hero numbers). */
export function BigMoney({ value: target, className }: { value: number; className?: string }) {
  const s = useStore();
  const { locale } = useI18n();
  // Rolls to the new total (once from 0 on load, then from the previous total).
  const value = useTicker(target);
  const cents = !Number.isInteger(Math.round(target * 100) / 100);
  const parts = useMemo(() => {
    try {
      const nf = new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", {
        style: "currency",
        currency: s.currency,
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      });
      const p = nf.formatToParts(value);
      const i = p.findIndex((x) => x.type === "decimal");
      if (i < 0) return { main: p.map((x) => x.value).join(""), small: "" };
      const tail = p.slice(i);
      // Keep a trailing currency sign (he-IL puts ₪ last) in the big part.
      const trailing = tail.filter((x) => x.type === "currency" || x.type === "literal");
      const decimals = tail.filter((x) => x.type === "decimal" || x.type === "fraction").map((x) => x.value).join("");
      return { main: p.slice(0, i).map((x) => x.value).join(""), small: decimals, trailing: trailing.map((x) => x.value).join("") };
    } catch {
      return { main: formatMoney(value, s.currency, locale), small: "" };
    }
  }, [value, cents, s.currency, locale]);
  return (
    <span className={cn("tabular", className)} dir="ltr">
      {parts.main}
      {parts.small && <small className="ms-[2px] text-[0.43em] font-extrabold opacity-60">{parts.small}</small>}
      {"trailing" in parts && parts.trailing}
    </span>
  );
}

type Segment = { key: string; label: string; value: number; color: string };

function useSummary() {
  const s = useStore();
  return useMemo(() => {
    const viewItems = itemsForView(s.items, s.view);
    const toBuy = countable(viewItems.filter((i) => i.status === "to_buy"), s.altGroups, s.rates);
    const totals = sumTotals(toBuy, s.rates, s.currency);
    // Split by project/list (small muted dots; items without one are grouped as "no project").
    const by = new Map<string, number>();
    for (const i of toBuy) {
      const l = lineTotal(i, s.rates, s.currency);
      if (l == null) continue;
      by.set(i.collectionId ?? "", (by.get(i.collectionId ?? "") ?? 0) + l);
    }
    const segments: Segment[] = [...by.entries()]
      .map(([k, v]) => {
        const c = s.collections.find((x) => x.id === k);
        return { key: k || "none", label: c?.name ?? "", value: v, color: c ? (COLLECTION_COLORS[c.color] ?? COLLECTION_COLORS.slate) : "var(--line-strong)" };
      })
      .sort((a, b) => b.value - a.value);
    // Saved so far: price drops since each item was added (first reading of its store link vs now).
    let saved = 0;
    for (const i of toBuy) {
      const src = activeSource(i, s.rates);
      if (!src || src.price == null) continue;
      const first = i.points.filter((p) => p.sourceId === src.id).sort((a, b) => a.recordedAt - b.recordedAt)[0];
      if (first && first.price > src.price) saved += convert(first.price - src.price, src.currency, s.currency, s.rates) * i.quantity;
    }
    const urgent = toBuy.filter((i) => i.priority === "urgent");
    return { viewItems, toBuy, totals, segments, saved, urgent };
  }, [s.items, s.view, s.altGroups, s.rates, s.currency, s.collections]);
}

/** Across the whole list (not the view): urgent to buy, on the way, and spent this month — the totals card's strip. */
function useStrip() {
  const s = useStore();
  return useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let urgent = 0;
    let onTheWay = 0;
    let spent = 0;
    for (const i of s.items) {
      if (i.status === "to_buy" && i.priority === "urgent") urgent++;
      if (i.status === "ordered") onTheWay++;
      if (i.status !== "to_buy" && (spendDate(i) ?? i.updatedAt) >= from) spent += lineTotal(i, s.rates, s.currency) ?? 0;
    }
    return { urgent, onTheWay, spent };
  }, [s.items, s.rates, s.currency]);
}

/** Closest store to free shipping among what's left to buy (same math as Order by store). */
function useBestShipping(toBuy: ItemWithSources[]) {
  const s = useStore();
  return useMemo(() => {
    const order = toBuy.filter((i) => i.priority !== "someday");
    const leftOut = toBuy.filter((i) => i.priority === "someday");
    const groups = new Map<string, { store: string; total: number }>();
    for (const i of order) {
      const src = activeSource(i, s.rates);
      if (!src?.url) continue;
      const g = groups.get(src.storeKey) ?? { store: src.store, total: 0 };
      g.total += lineTotal(i, s.rates, s.currency) ?? 0;
      groups.set(src.storeKey, g);
    }
    let best: { key: string; store: string; gap: ReturnType<typeof shippingGap>; hint: string | null } | null = null;
    let anyRule = false;
    let anyFree = false;
    for (const [key, g] of groups) {
      const rule = shippingRule(key, s.storeSettings);
      const gap = shippingGap(g.total, rule, s.rates, s.currency);
      if (gap.threshold == null) continue;
      anyRule = true;
      if (gap.free) {
        anyFree = true;
        continue;
      }
      if (!best || gap.remaining < best.gap.remaining) {
        const sug = gapSuggestions(key, gap, order, leftOut, s.rates, s.currency, 1)[0];
        best = { key, store: g.store, gap, hint: sug?.item.title ?? null };
      }
    }
    return { best, anyRule, anyFree };
  }, [toBuy, s.rates, s.currency, s.storeSettings]);
}

function Tile({ tone, className, children, delay }: { tone: "tint" | "surface"; className?: string; children: React.ReactNode; delay?: number }) {
  return (
    <div
      className={cn(
        "rise-in flex min-w-0 flex-col gap-1 rounded-[22px] p-3.5 max-sm:hidden lg:gap-2 lg:rounded-[30px] lg:p-[22px]",
        tone === "tint" ? "bg-tint text-tint-ink" : "border border-line bg-surface",
        className,
      )}
      style={{ animationDelay: `${delay ?? 0}ms` }}
    >
      {children}
    </div>
  );
}

export function HomeSummary() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const sum = useSummary();
  const ship = useBestShipping(sum.toBuy);
  const m = (v: number) => formatMoney(v, s.currency, locale);
  const collection = s.view.type === "collection" ? s.collections.find((c) => c.id === (s.view as { id: string }).id) : null;
  const budget = collection?.kind === "project" ? budgetStats(collection, s.items, s.altGroups, s.rates, s.currency) : null;
  const n = sum.toBuy.length;
  const segTotal = sum.segments.reduce((a, b) => a + b.value, 0);
  const strip = useStrip();
  const phone = useMedia(PHONE);
  const legendMax = phone ? 3 : 4;
  const mK = (v: number) => (phone ? formatMoneyCompact(Math.round(v), s.currency, locale) : m(Math.round(v)));
  // Small text links in the card: the tap area grows to ≥ 40 px without moving anything.
  const hit = "relative after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']";

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4" data-home-summary>
      {/* Totals card: everything at a glance, but calm — the products below are the page. */}
      <div className="rise-in col-span-2 flex flex-col gap-2 rounded-[26px] bg-[image:var(--hero)] p-4 text-on-hero sm:gap-2.5 sm:p-5 lg:col-span-1 lg:min-h-[180px] lg:gap-1.5 lg:rounded-[30px] lg:px-6 lg:py-[18px]" data-totals>
        <span className="flex items-center gap-2 text-[13px] opacity-85">
          {n === 1 ? t.home.leftToBuyOne : f(t.home.leftToBuy, { n })}
          {sum.totals.estimated > 0 && <span className="text-xs opacity-80" data-estimated>· {f(t.home.estimated, { n: sum.totals.estimated })}</span>}
          {sum.saved >= 1 && <em className="ms-auto rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold not-italic">{f(t.home.saved, { amount: m(Math.round(sum.saved)) })}</em>}
        </span>
        <BigMoney value={sum.totals.total} className="text-[34px] font-black leading-[0.95] tracking-[-0.03em] sm:text-[44px] lg:text-[48px]" />
        {segTotal > 0 && (
          <>
            <div className="mt-auto flex h-2 gap-[3px] pt-0.5 lg:h-2.5 lg:gap-1" aria-hidden>
              {sum.segments.map((g, i) => (
                <span key={g.key} className="grow-x rounded-full" style={{ flex: g.value, background: g.color, animationDelay: `${200 + i * 60}ms` }} />
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] lg:text-[13px]" data-totals-legend>
              {sum.segments.slice(0, legendMax).map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => s.setView(g.key === "none" ? { type: "to_buy", f: "none" } : { type: "collection", id: g.key })}
                  className={cn(hit, "flex min-w-0 max-w-full items-center gap-1.5 opacity-90 transition hover:opacity-100")}
                >
                  <i className="size-2 shrink-0 rounded-[3px]" style={{ background: g.color }} />
                  <span className="max-w-[14ch] truncate bidi">{g.label || t.home.unassigned}</span>
                  <span className="tabular font-semibold">{mK(g.value)}</span>
                </button>
              ))}
              {sum.segments.length > legendMax && (
                <button type="button" onClick={() => s.setView({ type: "projects" })} className={cn(hit, "opacity-75 transition hover:opacity-100")}>
                  {f(t.home.more, { n: sum.segments.length - legendMax })}
                </button>
              )}
            </div>
          </>
        )}
        <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/12 pt-2 text-[12px] lg:text-[13px]", segTotal <= 0 && "mt-auto")} data-totals-strip>
          {[
            { key: "urgent", label: t.nav.urgent, value: String(strip.urgent), go: () => s.setView({ type: "to_buy", f: "urgent" }) },
            { key: "ordered", label: t.nav.onTheWay, value: String(strip.onTheWay), go: () => s.setView({ type: "ordered" }) },
            { key: "spent", label: t.home.spentMonth, value: mK(strip.spent), go: () => s.setView({ type: "spending" }) },
          ].map((x, i) => (
            <span key={x.key} className="flex min-w-0 items-center gap-2">
              {i > 0 && <span aria-hidden className="opacity-40">·</span>}
              <button type="button" onClick={x.go} className={cn(hit, "flex items-center gap-1 whitespace-nowrap opacity-85 transition hover:opacity-100")} data-totals-go={x.key}>
                {x.label} <b className="tabular font-bold">{x.value}</b>
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Tile 1: urgent (or the project's budget ring) */}
      {budget && budget.budget != null ? (
        <Tile tone="tint" delay={80}>
          <span className="text-xs font-bold lg:text-[14px]">{t.home.budget}</span>
          <div className="mt-auto flex items-center gap-2.5 lg:gap-3">
            <Ring value={(budget.pct ?? 0) / 100} size={56} stroke={7} color={budget.state === "over" ? "var(--danger)" : "var(--tint-ink)"} track="color-mix(in srgb, var(--tint-ink) 18%, transparent)">
              <span className="tabular text-[13px] font-extrabold">{Math.round(budget.pct ?? 0)}%</span>
            </Ring>
            <div className="min-w-0">
              <div className="tabular text-[20px] font-black leading-none tracking-[-0.02em] lg:text-[26px]">{m(budget.budget)}</div>
              <div className="mt-1 text-[13px] opacity-80">
                {budget.state === "over" ? f(t.home.budgetOver, { amount: m(budget.used - budget.budget) }) : f(t.home.budgetLeft, { amount: m(budget.budget - budget.used) })}
              </div>
            </div>
          </div>
        </Tile>
      ) : (
        <Tile tone="tint" delay={80}>
          <span className="order-2 text-xs font-bold lg:order-none lg:text-[14px]">{t.home.urgent}</span>
          <Ticker value={sum.urgent.length} format={(v) => String(Math.round(v))} className="order-1 text-[26px] font-black leading-none tracking-[-0.02em] lg:order-none lg:mt-auto lg:text-[48px]" />
          <span className="line-clamp-2 text-[13px] opacity-80 bidi max-lg:hidden">{sum.urgent.length ? sum.urgent.slice(0, 3).map((i) => i.title.split(/\s+/).slice(0, 3).join(" ")).join(", ") : t.home.nothingUrgent}</span>
        </Tile>
      )}

      {/* Tile 2: best free-shipping progress */}
      <Tile tone="surface" delay={160}>
        {ship.best ? (
          <>
            <span className="truncate text-[14px] font-bold max-lg:hidden">{f(t.home.freeShipping, { store: ship.best.store })}</span>
            <Ticker value={ship.best.gap.remaining} format={m} className="text-[26px] font-black leading-none tracking-[-0.02em] lg:mt-auto lg:text-[48px]" />
            <span className="truncate text-xs font-bold lg:hidden">{t.phone.toFreeShipping}</span>
            <span className="line-clamp-2 text-[13px] text-muted max-lg:hidden">
              {t.home.toGo} {ship.best.hint && <span className="bidi">{f(t.home.addHint, { name: ship.best.hint.split(/\s+/).slice(0, 4).join(" ") })}</span>}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2 max-lg:mt-1 max-lg:h-1.5" aria-hidden>
              <i className="grow-x block h-full rounded-full bg-brand" style={{ width: `${Math.round(ship.best.gap.progress * 100)}%`, animationDelay: "300ms" }} />
            </div>
          </>
        ) : (
          <>
            <span className="text-[13px] font-bold lg:text-[14px]">{ship.anyRule && ship.anyFree ? t.home.allFree : t.home.noShipping}</span>
            <span className="mt-auto text-[13px] text-muted max-lg:hidden">{ship.anyRule ? "" : t.home.noShippingHint}</span>
            <button type="button" onClick={() => s.setView({ type: "orders" })} className="self-start rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold transition hover:bg-line max-lg:mt-1">
              {t.nav.orders}
            </button>
          </>
        )}
      </Tile>
      <PhoneTilesRow budget={budget && budget.budget != null ? budget : null} ship={ship.best} />
    </section>
  );
}

/** Phones: one compact row instead of the two tiles — the project's budget, else the store closest to free shipping. */
function PhoneTilesRow({ budget, ship }: { budget: ReturnType<typeof budgetStats> | null; ship: ReturnType<typeof useBestShipping>["best"] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const m = (v: number) => formatMoney(v, s.currency, locale);
  const row = "rise-in col-span-2 flex min-h-12 w-full items-center gap-3 rounded-[20px] border border-line bg-surface px-3.5 py-2 text-start sm:hidden";
  if (budget?.budget != null)
    return (
      <div className={row} style={{ animationDelay: "80ms" }} data-phone-tiles="budget">
        <Ring value={(budget.pct ?? 0) / 100} size={30} stroke={4} color={budget.state === "over" ? "var(--danger)" : "var(--brand)"} track="var(--surface-2)" />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <b className="font-bold">{t.home.budget}</b> <span className="tabular">{m(budget.budget)}</span>
        </span>
        <span className={cn("tabular shrink-0 text-[13px] font-semibold", budget.state === "over" ? "text-danger" : "text-muted")}>
          {budget.state === "over" ? f(t.home.budgetOver, { amount: m(budget.used - budget.budget) }) : f(t.home.budgetLeft, { amount: m(budget.budget - budget.used) })}
        </span>
      </div>
    );
  if (!ship) return null;
  return (
    <button type="button" onClick={() => s.setView({ type: "orders" })} className={row} style={{ animationDelay: "80ms" }} data-phone-tiles="shipping">
      <Truck className="size-[18px] shrink-0 text-muted" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[13px]">
          <b className="tabular font-bold">{m(ship.gap.remaining)}</b> {t.phone.toFreeShipping} · <span className="bidi">{ship.store}</span>
        </span>
        <span className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <i className="grow-x block h-full rounded-full bg-brand" style={{ width: `${Math.round(ship.gap.progress * 100)}%`, animationDelay: "300ms" }} />
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
    </button>
  );
}

/** True once the element has scrolled up to the sticky top bar (it is "stuck"). */
function useStuck<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-header-h")) || 0;
      setStuck(window.scrollY > 0 && el.getBoundingClientRect().top <= top + 0.5);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    check();
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return [ref, stuck] as const;
}

/**
 * The section header over the grid: "To buy" with its count and total (summary views), project chips, Category and
 * Sort, and the layout switch (desktop cards/table, phone cards/rows). Sticks under the top bar with a soft surface.
 */
export function FiltersRow({ showProjects = true }: { showProjects?: boolean }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [ref, stuck] = useStuck<HTMLDivElement>();
  const sum = useSummary();
  const section = SECTION_HEAD_VIEWS.includes(s.view.type);
  const viewItems = useMemo(() => itemsForView(s.items, s.view), [s.items, s.view]);
  const chips = useMemo(() => {
    const ids = new Set(viewItems.map((i) => i.collectionId).filter(Boolean));
    return s.collections.filter((c) => ids.has(c.id) && !c.archived).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "project" ? -1 : 1));
  }, [viewItems, s.collections]);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of viewItems) {
      const c = normalizeCategory(i.category) ?? "other";
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return CATEGORIES.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
  }, [viewItems]);
  const sortLabels: Record<SortKey, string> = { newest: t.view.sortNewest, price: t.view.sortPrice, priority: t.view.sortPriority, name: t.view.sortName };
  const chip = (on: boolean) =>
    cn(
      "flex h-[38px] shrink-0 items-center gap-2 rounded-full border px-[15px] text-[13px] font-semibold transition active:scale-[0.97]",
      on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:bg-surface-2",
    );
  const dd = "flex h-[38px] shrink-0 items-center gap-1.5 rounded-full bg-surface-2 pe-3 ps-[15px] text-[13px] font-semibold text-ink transition hover:bg-line";
  const history = s.view.type === "history";
  const orders = s.view.type === "orders";
  const buy = s.view.type === "to_buy";
  const buyF = s.view.type === "to_buy" ? s.view.f : undefined;

  return (
    <div
      ref={ref}
      className={cn(
        "sticky top-[var(--app-header-h,0px)] z-[15] -mx-4 mb-4 flex items-center gap-2 px-4 py-2 transition-[background-color,box-shadow] duration-200 sm:-mx-6 sm:px-6 lg:-mx-3 lg:px-3",
        stuck && "bg-bg/85 shadow-[0_10px_18px_-14px_color-mix(in_srgb,var(--ink)_35%,transparent)] backdrop-blur-md",
      )}
      data-filters
      data-stuck={stuck ? "" : undefined}
    >
      {section && (
        <div className="me-1 min-w-0 shrink-0" data-section-head>
          <h2 className="text-[22px] font-extrabold leading-tight tracking-[-0.02em] lg:text-[24px]">{t.nav.toBuy}</h2>
          <p className="tabular truncate text-[12.5px] text-muted">
            {sum.toBuy.length === 1 ? t.home.countOne : f(t.home.count, { n: sum.toBuy.length })}
            {sum.totals.total > 0 && <> · <b className="font-semibold text-ink">{formatMoney(sum.totals.total, s.currency, locale)}</b></>}
          </p>
        </div>
      )}
      {/* R14 B4: To buy's own filters first (All · Urgent · No project); the project chips narrow it further. */}
      {buy && <BuyFilterChips className="max-sm:hidden" />}
      {buy && showProjects && chips.length > 0 && buyF !== "none" && <span className="h-6 w-px shrink-0 bg-line max-sm:hidden" aria-hidden />}
      {showProjects && chips.length > 0 && buyF !== "none" && (
        <div className="-my-1 flex min-w-0 gap-2 overflow-x-auto py-1 [scrollbar-width:none] max-sm:hidden">
          {!buy && (
            <button type="button" className={chip(!s.collectionFilter)} onClick={() => s.setCollectionFilter(null)}>
              {t.home.all}
            </button>
          )}
          {chips.map((c) => (
            <button key={c.id} type="button" className={chip(s.collectionFilter === c.id)} onClick={() => s.setCollectionFilter(s.collectionFilter === c.id ? null : c.id)}>
              <i className={cn("size-[9px] shrink-0", c.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
              <span className="bidi max-w-[16ch] truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
      <span className="flex-1" />
      {cats.length > 0 && !orders && (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={dd} data-category-filter>
              <span className="font-medium text-muted max-sm:hidden">{t.home.category}</span>
              {s.categoryFilter ? t.categories[s.categoryFilter as keyof typeof t.categories] : t.home.all}
              <ChevronDown className="size-[15px] text-muted" strokeWidth={2.4} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuRadioGroup value={s.categoryFilter ?? ""} onValueChange={(v) => s.setCategoryFilter(v || null)}>
              <MenuRadioItem value="">{t.home.all}</MenuRadioItem>
              {cats.map(([c, n]) => (
                <MenuRadioItem key={c} value={c}>
                  <span className="flex-1">{t.categories[c]}</span>
                  <span className="tabular ms-3 text-xs text-muted">{n}</span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            {s.view.type === "to_buy" && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => s.setView({ type: "orders" })}>
                  <Store className="size-4" /> {t.nav.orders}
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
      )}
      {!history && !orders && (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={dd} aria-label={t.view.sort}>
              <span className="font-medium text-muted max-sm:hidden">{t.home.sort}</span>
              <span className="max-sm:hidden">{sortLabels[s.sort]}</span>
              <ArrowDownWideNarrow className="size-4 sm:hidden" />
              <ChevronDown className="size-[15px] text-muted max-sm:hidden" strokeWidth={2.4} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuRadioGroup value={s.sort} onValueChange={(v) => s.setSort(v as SortKey)}>
              {(Object.keys(sortLabels) as SortKey[]).map((k) => (
                <MenuRadioItem key={k} value={k}>
                  {sortLabels[k]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      )}
      {/* R14 A4: the desktop switch never shows on a phone (Order by store included); phones get the list / grid one. */}
      <div className="flex shrink-0 rounded-full bg-surface-2 p-[3px] max-sm:hidden" role="radiogroup" aria-label={`${t.view.cards} / ${t.view.table}`}>
        {(["cards", "table"] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={s.layout === l}
            onClick={() => s.setLayout(l)}
            data-carry={`layout:${l}`}
            title={l === "cards" ? t.view.cards : t.view.table}
            className={cn("grid size-8 place-items-center rounded-full transition", s.layout === l ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}
          >
            {l === "cards" ? <LayoutGrid className="size-4" /> : <Rows3 className="size-4" />}
          </button>
        ))}
      </div>
      {(
        <div className="flex shrink-0 rounded-full bg-surface-2 p-[3px] sm:hidden" role="radiogroup" aria-label={`${t.view.cards} / ${t.view.rows}`} data-phone-layout-toggle>
          {(["cards", "rows"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={s.phoneLayout === l}
              aria-label={l === "cards" ? t.view.cards : t.view.rows}
              onClick={() => s.setPhoneLayout(l)}
              className={cn("grid size-9 place-items-center rounded-full transition", s.phoneLayout === l ? "bg-surface text-ink shadow-card" : "text-muted")}
            >
              {l === "cards" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
