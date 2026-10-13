"use client";

import { startTransition, useMemo, useState } from "react";
import { ChevronDown, LayoutGrid, List } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { countable, lineTotal } from "@/lib/calc";
import { dayKeyIn, deliveryTrack } from "@/lib/home";
import { formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BuyFilterChips } from "./buy-filters";
import { useStore, type SortKey } from "./store";
import { rememberShopTab } from "./phone-shell";
import { COLLECTION_COLORS } from "./view-items";

/**
 * Phone "Products" tab (R18 S2 A1, was Shopping — Round 13 B2): the title, To buy · On the way · Projects as one
 * segmented control with a sliding thumb, then (To buy / On the way) a toolbar (sort, a muted summary, list ⇄ grid).
 * Phones only; desktop keeps its own headers. The list below slides in from the end side (forward) or the start side.
 */
export function ShoppingHeader({ className }: { className?: string }) {
  const s = useStore();
  const { t } = useI18n();
  const projects = s.view.type === "projects";
  return (
    <div className={cn("mb-3 flex flex-col gap-2.5", className)} data-shop-header>
      <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{t.sm.products}</h1>
      <ShopSwitch />
      {/* R14 B4: the same filter chips as the desktop toolbar, To buy side only. */}
      {s.view.type === "to_buy" && <BuyFilterChips className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]" />}
      {!projects && <ShopToolbar />}
    </div>
  );
}

function useShopNumbers() {
  const s = useStore();
  return useMemo(() => {
    const toBuy = countable(s.items.filter((i) => i.status === "to_buy"), s.altGroups, s.rates);
    const total = toBuy.reduce((a, i) => a + (lineTotal(i, s.rates, s.currency) ?? 0), 0);
    const urgent = toBuy.filter((i) => i.priority === "urgent").length;
    const ordered = s.items.filter((i) => i.status === "ordered");
    const tracks = ordered.map((i) => ({ i, tr: deliveryTrack(i, s.clock.now, s.clock.tz) }));
    const late = tracks.filter((x) => x.tr.late).length;
    const next = tracks.filter((x) => !x.tr.late && x.i.eta != null).sort((a, b) => a.i.eta! - b.i.eta!)[0]?.i.eta ?? null;
    const projects = new Set(toBuy.map((i) => i.collectionId).filter(Boolean)).size;
    return { toBuy: toBuy.length, total, urgent, ordered: ordered.length, late, next, projects };
  }, [s.items, s.altGroups, s.rates, s.currency, s.clock]);
}

type Seg = "to_buy" | "ordered" | "projects";
const SEGS: Seg[] = ["to_buy", "ordered", "projects"];

/**
 * R18 S2 A1 (Nav-phone): Products = To buy · On the way · Projects as one segmented control with a sliding thumb (was two
 * big cards). The thumb moves on the tap itself (a compositor transition); the list renders in a transition after it.
 */
function ShopSwitch() {
  const s = useStore();
  const { t, dir } = useI18n();
  const n = useShopNumbers();
  const actual: Seg = s.view.type === "ordered" ? "ordered" : s.view.type === "projects" ? "projects" : "to_buy";
  const [pending, setPending] = useState<Seg | null>(null);
  if (pending != null && pending === actual) setPending(null);
  const on = pending ?? actual;
  const projects = s.collections.filter((c) => !c.archived).length;
  const segs: { v: Seg; label: string; count: number }[] = [
    { v: "to_buy", label: t.shopTab.toBuy, count: n.toBuy },
    { v: "ordered", label: t.shopTab.onTheWay, count: n.ordered },
    { v: "projects", label: t.sm.projectsSeg, count: projects },
  ];
  const k = SEGS.indexOf(on);
  return (
    <div className="relative grid grid-cols-3 rounded-[14px] border border-card-line bg-surface-2 p-1" role="tablist" aria-label={t.sm.segLabel} data-shop-switch={on}>
      {/* The thumb slides with a soft spring; RTL slides the other way. */}
      <span
        aria-hidden
        className="shop-thumb absolute bottom-1 start-1 top-1 w-[calc((100%-8px)/3)] rounded-[11px] border border-card-line bg-surface shadow-[0_2px_10px_rgb(0_0_0/0.08)]"
        style={{ transform: `translateX(${dir === "rtl" ? -k * 100 : k * 100}%)` }}
        data-shop-thumb
      />
      {segs.map((c) => {
        const active = c.v === on;
        return (
          <button
            key={c.v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (active) return;
              setPending(c.v);
              rememberShopTab(c.v);
              requestAnimationFrame(() => startTransition(() => s.setView({ type: c.v })));
            }}
            className={cn("relative z-[1] flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-[11px] px-1.5 text-[13.5px] font-bold transition-colors duration-300", active ? "text-ink" : "text-muted")}
            data-shop-tab={c.v}
          >
            <span className="truncate">{c.label}</span>
            {c.count > 0 && <small className={cn("tabular shrink-0 text-[11.5px] font-semibold", active ? "text-muted" : "text-faint")}>{c.count}</small>}
          </button>
        );
      })}
    </div>
  );
}

function ShopToolbar() {
  const s = useStore();
  const { t, f, dir, locale } = useI18n();
  const n = useShopNumbers();
  const way = s.view.type === "ordered";
  const sortLabels: Record<SortKey, string> = { newest: t.view.sortNewest, price: t.view.sortPrice, priority: t.view.sortPriority, name: t.view.sortName };
  const special = way ? s.shopSort.way === "arrival" : s.shopSort.buy === "project";
  const label = special ? (way ? t.shopTab.byArrival : t.shopTab.byProject) : sortLabels[s.sort];
  // R18 S2 A1: the To buy total moved here from the old switch cards.
  const projectsLine = n.projects === 1 ? t.shopTab.projectsOne : n.projects ? f(t.shopTab.projectsN, { n: n.projects }) : "";
  const summary = way ? (n.late ? f(t.shopTab.wayLate, { n: n.late }) : "") : [n.total > 0 ? formatMoney(Math.round(n.total), s.currency, locale) : "", projectsLine].filter(Boolean).join(" · ");
  const value = special ? "special" : s.sort;
  const grid = s.phoneLayout === "cards";
  return (
    <div className="flex items-center gap-2 px-0.5" data-shop-toolbar>
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="flex h-9 items-center gap-1 text-[12.5px] font-semibold text-ink" aria-label={`${t.shopTab.sortBy}: ${label}`} data-shop-sort>
            {label}
            <ChevronDown className="size-3.5 text-muted" strokeWidth={2.4} />
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuRadioGroup
            value={value}
            onValueChange={(v) => {
              if (v === "special") s.setShopSort(way ? { ...s.shopSort, way: "arrival" } : { ...s.shopSort, buy: "project" });
              else {
                s.setSort(v as SortKey);
                s.setShopSort(way ? { ...s.shopSort, way: "plain" } : { ...s.shopSort, buy: "plain" });
              }
            }}
          >
            <MenuRadioItem value="special">{way ? t.shopTab.byArrival : t.shopTab.byProject}</MenuRadioItem>
            <MenuSeparator />
            {(Object.keys(sortLabels) as SortKey[]).map((k) => (
              <MenuRadioItem key={k} value={k}>
                {sortLabels[k]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      <span className="min-w-0 truncate text-[12px] text-muted">{summary}</span>
      {/* List ⇄ grid with a sliding thumb (list by default, remembered). */}
      <div className="relative ms-auto flex shrink-0 rounded-full border border-card-line bg-surface-2 p-[3px]" role="radiogroup" aria-label={t.shopTab.layout} data-phone-layout-toggle>
        <span
          aria-hidden
          className="shop-thumb absolute start-[3px] top-[3px] h-[34px] w-10 rounded-full bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.1)]"
          style={{ transform: grid ? `translateX(${dir === "rtl" ? "-40px" : "40px"})` : "translateX(0)" }}
        />
        {(["rows", "cards"] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={s.phoneLayout === l}
            aria-label={l === "rows" ? t.shopTab.list : t.shopTab.grid}
            onClick={() => s.setPhoneLayout(l)}
            className={cn("relative z-[1] grid h-[34px] w-10 place-items-center rounded-full transition-colors duration-200", s.phoneLayout === l ? "text-ink" : "text-muted")}
          >
            {l === "rows" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** On the way "By arrival": late first, then by eta, no date last. */
export function byArrival(items: ItemWithSources[], now: number, tz: string) {
  const today = dayKeyIn(now, tz);
  const late = (i: ItemWithSources) => (i.eta != null && dayKeyIn(i.eta, tz) < today ? 0 : 1);
  return [...items].sort((a, b) => late(a) - late(b) || (a.eta ?? Infinity) - (b.eta ?? Infinity));
}

/** To buy "By project": groups in sidebar order, items without a project last. */
export function groupByProject(items: ItemWithSources[], s: ReturnType<typeof useStore>) {
  const order = new Map(s.collections.map((c, k) => [c.id, k]));
  const groups = new Map<string, ItemWithSources[]>();
  for (const i of items) {
    const k = i.collectionId && order.has(i.collectionId) ? i.collectionId : "";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : order.get(a[0])! - order.get(b[0])!));
}

/** A group header in the To buy list: dot, name, "N items" and a thin %-bought bar (by money, like Home). */
export function ShopGroupHeader({ id, count }: { id: string; count: number }) {
  const s = useStore();
  const { t, f } = useI18n();
  const c = id ? s.collections.find((x) => x.id === id) : null;
  const pct = useMemo(() => {
    if (!c) return null;
    const mine = s.items.filter((i) => i.collectionId === c.id);
    const left = countable(mine.filter((i) => i.status === "to_buy"), s.altGroups, s.rates).reduce((a, i) => a + (lineTotal(i, s.rates, s.currency) ?? 0), 0);
    const spent = mine.filter((i) => i.status !== "to_buy").reduce((a, i) => a + (lineTotal(i, s.rates, s.currency) ?? 0), 0);
    return left + spent > 0 ? spent / (left + spent) : 0;
  }, [c, s.items, s.altGroups, s.rates, s.currency]);
  const color = c ? COLLECTION_COLORS[c.color] ?? COLLECTION_COLORS.slate : "var(--line-strong)";
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5 pt-1 text-[13px] font-bold" data-shop-group={id || "none"}>
      <i className={cn("size-2 shrink-0", c?.kind === "list" ? "rounded-full" : "rounded-[3px]")} style={{ background: color }} />
      <span className="bidi min-w-0 break-words">{c?.name ?? t.shopTab.noProject}</span>
      <small className="shrink-0 text-[11.5px] font-medium text-muted">{count === 1 ? t.shopTab.groupCountOne : f(t.shopTab.groupCount, { n: count })}</small>
      {pct != null && (
        <span className="ms-auto h-1 w-14 shrink-0 overflow-hidden rounded-full bg-line-in" role="img" aria-label={f(t.shopTab.boughtPct, { pct: Math.round(pct * 100) })}>
          <i className="block h-full rounded-full" style={{ width: `${Math.round(pct * 100)}%`, background: color }} />
        </span>
      )}
    </div>
  );
}
