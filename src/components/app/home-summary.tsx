"use client";

import { useMemo } from "react";
import { ChevronDown, LayoutGrid, Rows3 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/overlays";
import { Ring } from "@/components/ui/ring";
import { activeSource, budgetStats, countable, lineTotal, sumTotals } from "@/lib/calc";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { convert, formatMoney } from "@/lib/money";
import { gapSuggestions, shippingGap, shippingRule } from "@/lib/shipping";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore, type SortKey } from "./store";
import { COLLECTION_COLORS, itemsForView } from "./view-items";

/** Views that open with the totals card + tiles. */
export const SUMMARY_VIEWS = ["to_buy", "urgent", "unsorted", "collection", "store"];

/** A money amount with the decimals drawn smaller (hero numbers). */
export function BigMoney({ value, className }: { value: number; className?: string }) {
  const s = useStore();
  const { locale } = useI18n();
  const parts = useMemo(() => {
    try {
      const nf = new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", {
        style: "currency",
        currency: s.currency,
        minimumFractionDigits: Number.isInteger(Math.round(value * 100) / 100) ? 0 : 2,
        maximumFractionDigits: 2,
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
  }, [value, s.currency, locale]);
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
        "rise-in flex min-h-[170px] min-w-0 flex-col gap-2 rounded-[30px] p-[22px] lg:min-h-[226px]",
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

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4" data-home-summary>
      {/* Totals card */}
      <div className="rise-in col-span-2 flex min-h-[176px] flex-col gap-3 rounded-[28px] bg-[image:var(--hero)] p-5 text-on-hero lg:col-span-1 lg:min-h-[226px] lg:rounded-[30px] lg:px-[26px] lg:py-6" data-totals>
        <span className="flex items-center gap-2 text-[13px] opacity-75 lg:text-[14px]">
          {n === 1 ? t.home.leftToBuyOne : f(t.home.leftToBuy, { n })}
          {sum.saved >= 1 && <em className="ms-auto rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold not-italic opacity-100">{f(t.home.saved, { amount: m(Math.round(sum.saved)) })}</em>}
        </span>
        <BigMoney value={sum.totals.total} className="text-[44px] font-black leading-[0.95] tracking-[-0.03em] lg:text-[60px]" />
        {segTotal > 0 && (
          <>
            <div className="mt-auto flex h-2.5 gap-[3px] lg:h-3 lg:gap-1" aria-hidden>
              {sum.segments.map((g, i) => (
                <span key={g.key} className="grow-x rounded-full" style={{ flex: g.value, background: g.color, animationDelay: `${200 + i * 60}ms` }} />
              ))}
            </div>
            <div className="hidden flex-wrap gap-x-4 gap-y-1 text-[13px] opacity-90 lg:flex">
              {sum.segments.slice(0, 4).map((g) => (
                <span key={g.key} className="flex min-w-0 items-center gap-[7px]">
                  <i className="size-[9px] shrink-0 rounded-[3px]" style={{ background: g.color }} />
                  <span className="truncate bidi">{g.label || t.home.unassigned}</span>
                  <span className="tabular">{m(g.value)}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Tile 1: urgent (or the project's budget ring) */}
      {budget && budget.budget != null ? (
        <Tile tone="tint" delay={80}>
          <span className="text-[14px] font-bold">{t.home.budget}</span>
          <div className="mt-auto flex items-center gap-3">
            <Ring value={(budget.pct ?? 0) / 100} size={64} stroke={8} color={budget.state === "over" ? "var(--danger)" : "var(--tint-ink)"} track="color-mix(in srgb, var(--tint-ink) 18%, transparent)">
              <span className="tabular text-[13px] font-extrabold">{Math.round(budget.pct ?? 0)}%</span>
            </Ring>
            <div className="min-w-0">
              <div className="tabular text-[26px] font-black leading-none tracking-[-0.02em]">{m(budget.budget)}</div>
              <div className="mt-1 text-[13px] opacity-80">
                {budget.state === "over" ? f(t.home.budgetOver, { amount: m(budget.used - budget.budget) }) : f(t.home.budgetLeft, { amount: m(budget.budget - budget.used) })}
              </div>
            </div>
          </div>
        </Tile>
      ) : (
        <Tile tone="tint" delay={80}>
          <span className="text-[14px] font-bold">{t.home.urgent}</span>
          <span className="tabular mt-auto text-[34px] font-black leading-none tracking-[-0.02em] lg:text-[48px]">{sum.urgent.length}</span>
          <span className="line-clamp-2 text-[13px] opacity-80 bidi">{sum.urgent.length ? sum.urgent.slice(0, 3).map((i) => i.title.split(/\s+/).slice(0, 3).join(" ")).join(", ") : t.home.nothingUrgent}</span>
        </Tile>
      )}

      {/* Tile 2: best free-shipping progress */}
      <Tile tone="surface" delay={160}>
        {ship.best ? (
          <>
            <span className="truncate text-[14px] font-bold">{f(t.home.freeShipping, { store: ship.best.store })}</span>
            <span className="tabular mt-auto text-[34px] font-black leading-none tracking-[-0.02em] lg:text-[48px]">{m(ship.best.gap.remaining)}</span>
            <span className="line-clamp-2 text-[13px] text-muted">
              {t.home.toGo} {ship.best.hint && <span className="bidi">{f(t.home.addHint, { name: ship.best.hint.split(/\s+/).slice(0, 4).join(" ") })}</span>}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <i className="grow-x block h-full rounded-full bg-brand" style={{ width: `${Math.round(ship.best.gap.progress * 100)}%`, animationDelay: "300ms" }} />
            </div>
          </>
        ) : (
          <>
            <span className="text-[14px] font-bold">{ship.anyRule && ship.anyFree ? t.home.allFree : t.home.noShipping}</span>
            <span className="mt-auto text-[13px] text-muted">{ship.anyRule ? "" : t.home.noShippingHint}</span>
            <button type="button" onClick={() => s.setView({ type: "orders" })} className="self-start rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold transition hover:bg-line">
              {t.nav.orders}
            </button>
          </>
        )}
      </Tile>
    </section>
  );
}

/** Project chips, then Category and Sort dropdowns (and the cards/table switch). */
export function FiltersRow({ showProjects = true }: { showProjects?: boolean }) {
  const s = useStore();
  const { t } = useI18n();
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

  return (
    <div className="flex items-center gap-2" data-filters>
      {showProjects && chips.length > 0 && (
        <div className="-my-1 flex min-w-0 gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
          <button type="button" className={chip(!s.collectionFilter)} onClick={() => s.setCollectionFilter(null)}>
            {t.home.all}
          </button>
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
          </MenuContent>
        </Menu>
      )}
      {!history && !orders && (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={dd} aria-label={t.view.sort}>
              <span className="font-medium text-muted max-sm:hidden">{t.home.sort}</span>
              <span className="max-sm:hidden">{sortLabels[s.sort]}</span>
              <ChevronDown className="size-[15px] text-muted" strokeWidth={2.4} />
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
      <div className={cn("flex shrink-0 rounded-full bg-surface-2 p-[3px]", !orders && "max-sm:hidden")} role="radiogroup" aria-label={`${t.view.cards} / ${t.view.table}`}>
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
    </div>
  );
}
