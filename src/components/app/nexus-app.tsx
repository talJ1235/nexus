"use client";

import { useMemo } from "react";
import { ArrowDownWideNarrow, Download, LayoutGrid, Menu as MenuIcon, Pencil, Rows3, Search, Share2, Sparkles, X, Command } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger, Sheet } from "@/components/ui/overlays";
import { budgetStats, countable, sumTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { AppData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AddBar, type Incoming } from "./add-bar";
import { CollectionDialog } from "./collection-dialog";
import { CommandPalette } from "./command-palette";
import { SettingsDialog } from "./settings-dialog";
import { ImportDialog } from "./import-dialog";
import { AlertsBell, AlertsPanel } from "./alerts-panel";
import { AssistantPanel } from "./assistant-panel";
import { AltGroupCard, ItemCard } from "./item-card";
import { AltSheet } from "./alt-sheet";
import { OrdersView } from "./orders-view";
import { SelectionBar } from "./selection-bar";
import { SpendingView } from "./spending-view";
import { ItemSheet } from "./item-sheet";
import { ItemTable } from "./item-table";
import { Sidebar } from "./sidebar";
import { StoreProvider, useStore, type SortKey } from "./store";
import { COLLECTION_COLORS, useViewItems } from "./view-items";
import type { Currency } from "@/lib/money";

export function NexusApp({ initial, currency, incoming }: { initial: AppData; currency: Currency; incoming?: Incoming }) {
  return (
    <StoreProvider initial={initial} initialCurrency={currency}>
      <Shell incoming={incoming} />
    </StoreProvider>
  );
}

function Shell({ incoming }: { incoming?: Incoming }) {
  const s = useStore();
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 border-e border-line bg-bg lg:block">
        <Sidebar />
      </aside>
      <Sheet open={s.navOpen} onOpenChange={s.setNavOpen} title={t.appName} side="start" className="max-w-[300px] bg-bg">
        <Sidebar />
      </Sheet>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1400px] items-start gap-2 px-4 py-3 sm:px-6 lg:px-8">
            <Button variant="ghost" size="icon" className="mt-1.5 lg:hidden" onClick={() => s.setNavOpen(true)} aria-label="Menu">
              <MenuIcon />
            </Button>
            <LogoMark className="mt-2.5 hidden size-7 sm:block lg:hidden" />
            <div className="min-w-0 flex-1">
              <AddBar incoming={incoming} />
            </div>
            {s.aiEnabled && (
              <Button variant="ghost" size="icon" className="mt-1.5" onClick={() => s.setPanel("assistant")} aria-label={t.ai.title} title={t.ai.openAssistant}>
                <Sparkles />
              </Button>
            )}
            <AlertsBell />
            <Button variant="ghost" size="icon" className="mt-1.5 lg:hidden" onClick={() => s.setPaletteOpen(true)} aria-label={t.view.search}>
              <Command />
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
          {/* Header + content switch together as one soft cross-fade; the very first paint is not animated. */}
          <div key={viewKey(s.view)} className={s.navSeq > 0 ? "view-in" : undefined}>
            {s.view.type === "spending" ? (
              <SpendingView />
            ) : (
              <>
                <ViewHeader />
                <Content />
              </>
            )}
          </div>
        </main>
      </div>

      <ItemSheet />
      <AltSheet />
      <SelectionBar />
      <CollectionDialog />
      <CommandPalette />
      <SettingsDialog />
      <ImportDialog />
      <AlertsPanel />
      <AssistantPanel />
    </div>
  );
}

function viewKey(v: ReturnType<typeof useStore>["view"]) {
  return v.type === "collection" ? `c:${v.id}` : v.type === "store" ? `s:${v.key}` : v.type;
}

function ViewHeader() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const items = useViewItems();
  const collection = s.view.type === "collection" ? s.collections.find((c) => c.id === (s.view as { id: string }).id) : null;

  const title = (() => {
    switch (s.view.type) {
      case "to_buy":
        return t.nav.toBuy;
      case "urgent":
        return t.nav.urgent;
      case "history":
        return t.nav.history;
      case "ordered":
        return t.nav.onTheWay;
      case "orders":
        return t.orders.title;
      case "spending":
        return t.spending.title;
      case "unsorted":
        return t.nav.unsorted;
      case "collection":
        return collection?.name ?? "—";
      case "store": {
        const key = s.view.key;
        return s.items.flatMap((i) => i.sources).find((x) => x.storeKey === key)?.store ?? key;
      }
    }
  })();

  const toBuy = countable(items.filter((i) => i.status === "to_buy"), s.altGroups, s.rates);
  const spentView = s.view.type === "history" || s.view.type === "ordered";
  const totals = sumTotals(spentView ? items : toBuy, s.rates, s.currency);
  const budget = collection?.kind === "project" ? budgetStats(collection, s.items, s.altGroups, s.rates, s.currency) : null;

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) for (const tag of i.tags ?? []) m.set(tag, (m.get(tag) ?? 0) + 1);
    return [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [items]);

  const exportHref = (() => {
    const p = new URLSearchParams({ currency: s.currency, locale });
    if (s.view.type === "collection") p.set("collection", s.view.id);
    else p.set("view", s.view.type === "store" ? `store:${s.view.key}` : s.view.type);
    return `/api/export?${p}`;
  })();

  const sortLabels: Record<SortKey, string> = { newest: t.view.sortNewest, price: t.view.sortPrice, priority: t.view.sortPriority, name: t.view.sortName };

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {collection && <span className={cn("size-3", collection.kind === "project" ? "rounded-[4px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[collection.color] }} />}
            <h1 className="truncate text-[26px] font-semibold tracking-[-0.02em]" dir="auto">
              {title}
            </h1>
            {collection && (
              <Button variant="ghost" size="icon-sm" onClick={() => s.setEditor({ mode: "edit", collection })} aria-label={t.collection.rename} title={t.collection.rename}>
                {collection.shareToken ? <Share2 className="!size-3.5" /> : <Pencil className="!size-3.5" />}
              </Button>
            )}
          </div>
          {collection?.description && (
            <p className="mt-1 max-w-[70ch] text-sm text-muted" dir="auto">
              {collection.description}
            </p>
          )}
          <p className="tabular mt-1 text-sm text-muted">
            {(items.length === 1 ? t.collection.itemsCountOne : f(t.collection.itemsCount, { n: items.length }))}
            {totals.total > 0 && (
              <>
                <span className="mx-2 text-faint">/</span>
                {spentView ? t.collection.spent : t.view.itemsTotal}{" "}
                <b className="font-semibold text-fg">{formatMoney(totals.total, s.currency, locale)}</b>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={s.query}
              onChange={(e) => s.setQuery(e.target.value)}
              placeholder={t.view.search}
              aria-label={t.view.search}
              className="h-9 w-40 rounded-lg border border-line bg-surface pe-7 ps-8 text-sm outline-none transition placeholder:text-faint focus:w-56 focus:border-accent sm:w-48"
            />
            {s.query && (
              <button type="button" onClick={() => s.setQuery("")} className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg" aria-label={t.view.clear}>
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {!spentView && s.view.type !== "orders" && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon" variant="outline" aria-label={t.view.sort} title={`${t.view.sort}: ${sortLabels[s.sort]}`}>
                  <ArrowDownWideNarrow />
                </Button>
              </MenuTrigger>
              <MenuContent>
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
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label={`${t.view.cards} / ${t.view.table}`}>
            {(["cards", "table"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={s.layout === l}
                onClick={() => s.setLayout(l)}
                title={l === "cards" ? t.view.cards : t.view.table}
                className={cn("grid size-8 place-items-center rounded-md transition", s.layout === l ? "bg-fg text-bg" : "text-muted hover:text-fg")}
              >
                {l === "cards" ? <LayoutGrid className="size-4" /> : <Rows3 className="size-4" />}
              </button>
            ))}
          </div>
          {items.length > 0 && (
            <a href={exportHref} className="grid size-9 place-items-center rounded-lg border border-line-strong bg-surface text-fg transition hover:bg-sunken" title={t.collection.export} aria-label={t.collection.export}>
              <Download className="size-4" />
            </a>
          )}
        </div>
      </div>

      {budget && budget.budget != null && <BudgetBar stats={budget} />}

      {tagCounts.length > 1 && (
        <div className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => s.setTagFilter(null)}
            className={cn("h-7 shrink-0 rounded-full border px-3 text-[13px] transition", !s.tagFilter ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}
          >
            {t.view.allTags}
          </button>
          {tagCounts.map(([tag, n]) => (
            <button
              key={tag}
              type="button"
              onClick={() => s.setTagFilter(s.tagFilter === tag ? null : tag)}
              className={cn("h-7 shrink-0 rounded-full border px-3 text-[13px] transition", s.tagFilter === tag ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}
            >
              {tag} <span className="tabular opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetBar({ stats }: { stats: ReturnType<typeof budgetStats> }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const b = stats.budget ?? 0;
  const spentPct = b ? Math.min(100, (stats.spent / b) * 100) : 0;
  const plannedPct = b ? Math.min(100 - spentPct, (stats.planned / b) * 100) : 0;
  const m = (v: number) => formatMoney(v, s.currency, locale);
  return (
    <div className={cn("mt-4 rounded-xl border p-4", stats.state === "over" ? "border-danger/50 bg-danger-soft/50" : "border-line bg-surface")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span className="text-muted">
            {t.collection.budget} <b className="tabular font-semibold text-fg">{m(b)}</b>
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-full bg-ok" /> {t.collection.spent} <b className="tabular font-semibold text-fg">{m(stats.spent)}</b>
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-full bg-accent" /> {t.collection.planned} <b className="tabular font-semibold text-fg">{m(stats.planned)}</b>
          </span>
        </div>
        <span className={cn("tabular text-sm font-medium", stats.state === "over" ? "text-danger" : stats.state === "near" ? "text-accent-ink" : "text-muted")}>
          {stats.state === "over"
            ? f(t.collection.over, { amount: m(stats.used - b) })
            : stats.state === "near"
              ? f(t.collection.nearing, { pct: Math.round(stats.pct ?? 0) })
              : `${t.collection.remaining} ${m(b - stats.used)}`}
        </span>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full bg-ok transition-[width] duration-500" style={{ width: `${spentPct}%` }} />
        <div className={cn("h-full transition-[width] duration-500", stats.state === "over" ? "bg-danger" : "bg-accent")} style={{ width: `${stats.state === "over" ? 100 - spentPct : plannedPct}%` }} />
      </div>
    </div>
  );
}

function Content() {
  const s = useStore();
  const { t } = useI18n();
  const items = useViewItems();

  if (!items.length) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong px-6 py-20 text-center">
        <EmptyArt />
        <p className="mt-5 max-w-sm text-[15px] text-muted">{s.query || s.tagFilter ? t.cmd.noResults : s.view.type === "history" || s.view.type === "ordered" ? t.collection.emptyHistory : t.collection.empty}</p>
        {!s.query && s.view.type !== "history" && s.view.type !== "ordered" && (
          <Button variant="accent" className="mt-5" onClick={s.focusAdd}>
            {t.cmd.addLink}
          </Button>
        )}
      </div>
    );
  }
  if (s.view.type === "orders") return <OrdersView items={items} />;
  if (s.layout === "table") return <ItemTable items={items} />;

  // Alternatives that are still open collapse into one card, placed where the first option would be.
  const known = new Set(s.altGroups.map((g) => g.id));
  const seen = new Set<string>();
  const cells: React.ReactNode[] = [];
  const order = items.map((i) => i.id);
  for (const i of items) {
    if (i.status === "to_buy" && i.altGroupId && known.has(i.altGroupId)) {
      if (seen.has(i.altGroupId)) continue;
      seen.add(i.altGroupId);
      const members = items.filter((m) => m.altGroupId === i.altGroupId && m.status === "to_buy");
      if (members.length > 1) {
        cells.push(<AltGroupCard key={`g:${i.altGroupId}`} groupId={i.altGroupId} members={members} />);
        continue;
      }
    }
    cells.push(<ItemCard key={i.id} item={i} order={order} />);
  }
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-4">{cells}</div>;
}

/** Empty-state illustration: a price tag hanging from a node. */
function EmptyArt() {
  return (
    <svg viewBox="0 0 120 90" className="h-24 w-32" aria-hidden>
      <path d="M60 8v18" className="stroke-line-strong" strokeWidth="2" strokeDasharray="3 4" />
      <circle cx="60" cy="8" r="4" className="fill-line-strong" />
      <g transform="rotate(-8 60 55)">
        <path d="M36 32h40a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6H36L24 55z" className="fill-accent" />
        <circle cx="34" cy="55" r="3.2" className="fill-bg" />
        <rect x="44" y="47" width="28" height="5" rx="2.5" className="fill-accent-fg/70" opacity=".55" />
        <rect x="44" y="58" width="18" height="5" rx="2.5" className="fill-accent-fg/70" opacity=".35" />
      </g>
    </svg>
  );
}
