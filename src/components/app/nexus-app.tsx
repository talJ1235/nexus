"use client";

import { forwardRef, memo, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { Pencil, ReceiptText, Share2, ShoppingCart, Sparkles } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlays";
import { countable, sumTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { AltGroup, AppData, ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AddBar, SHOWS_PENDING, type Incoming } from "./add-bar";
import { PendingCard } from "./pending";
import { CollectionDialog } from "./collection-dialog";
import { CommandPalette } from "./command-palette";
import { SettingsDialog } from "./settings-dialog";
import { ReportDialog } from "./report-dialog";
import { ReportsSheet } from "./reports-sheet";
import { ItemActionSheet, ItemShortcuts } from "./quick-actions";
import { HistoryHint, HistoryTools, InsightsSwitch, monthLabel } from "./insights";
import { historyMonthOf } from "./view-items";
import { MeSheet } from "./me-sheet";
import { SpacesLayer } from "./spaces/layer";
import { ImportDialog } from "./import-dialog";
import { AlertsPanel } from "./alerts-panel";
import { TopBar } from "./top-bar";
import { Dock, PhoneTopBar, PlusMenu } from "./phone-shell";
import { FiltersRow, HomeSummary, SUMMARY_VIEWS } from "./home-summary";
import { HomeView } from "./home-view";
import { byArrival, groupByProject, ShopGroupHeader, ShoppingHeader } from "./shopping-tab";
import { PHONE, useMedia } from "@/components/ui/use-media";
import { AssistantPanel } from "./assistant-panel";
import { ShareDialog } from "./share-dialog";
import { ReceiptDialog } from "./receipt-dialog";
import { OfflineBanner, useReadOnly } from "./offline-banner";
import { PanelBoundary } from "@/components/panel-boundary";
import { AltGroupCard, ItemCard } from "./item-card";
import { AltSheet } from "./alt-sheet";
import { OrdersView } from "./orders-view";
import { SelectionBar } from "./selection-bar";
import { SpendingView } from "./spending-view";
import { ProjectHeader, ProjectsView } from "./projects-view";
import { BarcodeScanner } from "./barcode-scanner";
import { ReceiptCamera } from "./receipt-camera";
import { CompareSheet } from "./compare-sheet";
import { Celebration, PullToRefresh } from "./motion-extras";
import { ShoppingMode, ShopOutboxSync } from "./shopping-mode";
import { ItemSheet } from "./item-sheet";
import { ItemTable } from "./item-table";
import { Sidebar } from "./sidebar";
import { SIDEBAR_MAX, SIDEBAR_MIN, SidebarEdge } from "./sidebar-edge";
import { StoreProvider, useOpenItemId, useStore, type PendingAdd, type UiInit } from "./store";
import { LiveSync } from "./live-sync";
import { TestBridge } from "./test-bridge";
import { ContentSkeleton, ProjectHeaderSkeleton, Skel } from "./skeletons";
import { COLLECTION_COLORS, useTable, useViewItems } from "./view-items";
import { FALLBACK_RATES, type Currency } from "@/lib/money";
import { DEFAULT_IMPORT_LIMIT_USD } from "@/lib/import-vat";

/** Everything the first paint needs that the server knows without loading data. */
export type AppBoot = UiInit & { currency: Currency; aiEnabled: boolean };

/** Without `initial` the app renders as the streamed loading shell: real chrome, skeleton content. */
/** `offline` = rendering the offline shell from the device snapshot (read-only). */
export function NexusApp({ boot, initial, incoming, offline }: { boot: AppBoot; initial?: AppData; incoming?: Incoming; offline?: { at: number } }) {
  const data = initial ?? { items: [], collections: [], altGroups: [], storeSettings: [], budget: {}, rates: FALLBACK_RATES, aiEnabled: boot.aiEnabled, importLimitUsd: DEFAULT_IMPORT_LIMIT_USD };
  return (
    <StoreProvider initial={data} initialCurrency={boot.currency} ui={boot} loading={!initial} offline={offline ?? null}>
      <Shell incoming={incoming} />
    </StoreProvider>
  );
}

const LG = "(min-width: 1024px)";
const subscribeLg = (cb: () => void) => {
  const mq = window.matchMedia(LG);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
/** "desktop" / "phone" after hydration; null while server-rendering/hydrating (then both layouts render, CSS hides one). */
function useLayoutSize() {
  return useSyncExternalStore(subscribeLg, () => (window.matchMedia(LG).matches ? "desktop" : "phone"), () => null);
}

/** --app-header-h = the visible sticky top bar's height, so section headers can stick right under it. */
function useHeaderHeightVar() {
  useEffect(() => {
    const set = () => {
      const h = [...document.querySelectorAll<HTMLElement>("[data-app-header]")].map((el) => el.offsetHeight).find((v) => v > 0) ?? 0;
      document.documentElement.style.setProperty("--app-header-h", `${h}px`);
    };
    const ro = new ResizeObserver(set);
    document.querySelectorAll("[data-app-header]").forEach((el) => ro.observe(el));
    set();
    return () => ro.disconnect();
  }, []);
}

function Shell({ incoming }: { incoming?: Incoming }) {
  const s = useStore();
  const { t } = useI18n();
  const collapsed = s.sidebarCollapsed;
  const size = useLayoutSize();
  useHeaderHeightVar();
  // Round 13 C2: while the sidebar's edge is dragged, the grid follows the pointer (no transition).
  const [liveW, setLiveW] = useState<number | null>(null);
  const sw = liveW ?? (collapsed ? SIDEBAR_MIN : SIDEBAR_MAX);

  return (
    <div
      className="min-h-lvh"
      style={{ "--sw": `${sw}px` } as React.CSSProperties}
      data-app-shell
      data-phone-layout={s.phoneLayout}
      data-ready={s.loading ? undefined : ""}
      data-offline={s.offlineAt != null ? "" : undefined}
    >
      <div
        className={cn(
          "lg:grid lg:grid-cols-[var(--sw)_minmax(0,1fr)] lg:gap-2 lg:pe-[26px] lg:ps-1",
          liveW == null && "lg:transition-[grid-template-columns] lg:duration-[400ms] lg:ease-[var(--ease-out)]",
        )}
      >
        <aside className="sticky top-0 hidden h-dvh min-w-0 lg:block" data-sidebar-w={sw}>
          {size !== "phone" && <Sidebar collapsed={liveW != null ? liveW < (SIDEBAR_MIN + SIDEBAR_MAX) / 2 : collapsed} onToggle={() => s.setSidebarCollapsed(!collapsed)} />}
          {size !== "phone" && <SidebarEdge onLive={setLiveW} />}
        </aside>
        <Sheet open={s.navOpen} onOpenChange={s.setNavOpen} title={t.appName} side="start" phone="side" className="max-w-[300px] bg-bg">
          <Sidebar floating={false} />
        </Sheet>

        <div className="min-w-0">
          {/* Phone / tablet header (Part C replaces it with the phone shell). */}
          <div className="empty:hidden lg:pt-4">
            <OfflineBanner />
          </div>
          <header data-app-header className="sticky top-0 z-20 bg-bg/85 px-4 pb-2.5 pt-[max(14px,env(safe-area-inset-top))] backdrop-blur-md sm:px-6 lg:hidden">
            {size !== "desktop" && <PhoneTopBar />}
          </header>
          <div data-app-header className="sticky top-0 z-20 hidden bg-bg/85 pb-3 pt-4 backdrop-blur-md lg:block">
            <div className="mx-auto max-w-[1400px]">
              {size !== "phone" && <TopBar />}
            </div>
          </div>
          {/* overflow-x: clip — the sliding view transition must never make the page wider than a phone (a wider page
              widens the layout viewport and moved the fixed dock, Round 9 A2). Clip keeps sticky headers working. */}
          <main className="mx-auto max-w-[1400px] px-4 pb-40 pt-2 [overflow-x:clip] sm:px-6 lg:px-0 lg:pt-2">
            {/* Header + content switch together as one soft cross-fade; the very first paint is not animated. */}
            <div key={viewKey(s.view, size === "phone")} className={s.navSeq > 0 && !(size === "phone" && isShop(s.view)) ? (s.navDir > 0 ? "view-in view-fwd" : "view-in view-back") : undefined}>
              {s.view.type === "home" ? (
                <HomeView />
              ) : s.loading && s.view.type === "spending" ? (
                <ContentSkeleton />
              ) : s.view.type === "spending" ? (
                <SpendingView />
              ) : s.view.type === "projects" ? (
                s.loading ? <ContentSkeleton /> : <ProjectsView />
              ) : (
                <>
                  <ViewHeader />
                  <Content />
                </>
              )}
            </div>
          </main>
        </div>
      </div>

      {s.space?.role !== "viewer" && <AddBar incoming={incoming} collapsed={collapsed} />}
      {size !== "desktop" && (
        <>
          <Dock />
          <PlusMenu />
        </>
      )}
      <BarcodeScanner open={s.scanner === "barcode"} onClose={() => s.setScanner(null)} />
      <ReceiptCamera />
      <ShoppingMode />
      <PullToRefresh />
      <Celebration />
      <PanelBoundary label="Compare">
        <CompareSheet />
      </PanelBoundary>
      <ShopOutboxSync />

      <ItemSheet />
      <ItemActionSheet />
      <ItemShortcuts />
      <AltSheet />
      <SelectionBar />
      <CollectionDialog />
      <CommandPalette />
      <SettingsDialog />
      <ReportDialog />
      <ReportsSheet />
      <MeSheet />
      <PanelBoundary label="Spaces">
        <SpacesLayer />
      </PanelBoundary>
      {/* R16 B2: live updates of the current space (Ably / fake / polling). */}
      <PanelBoundary label="Live">
        <LiveSync />
      </PanelBoundary>
      {process.env.NODE_ENV !== "production" && <TestBridge />}
      <PanelBoundary label="Import">
        <ImportDialog />
      </PanelBoundary>
      <PanelBoundary label="Alerts">
        <AlertsPanel />
      </PanelBoundary>
      <PanelBoundary label="Assistant">
        <AssistantPanel />
      </PanelBoundary>
      <PanelBoundary label="Share">
        <ShareDialog />
      </PanelBoundary>
      <PanelBoundary label="Receipt">
        <ReceiptDialog />
      </PanelBoundary>
      <ReceiptDrop />
    </div>
  );
}

/** Drop an image/PDF anywhere on the app → read it as a receipt. Drop zones that handle files themselves win. */
function ReceiptDrop() {
  const s = useStore();
  const openItemId = useOpenItemId();
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setOver(false);
      if (!hasFiles(e) || e.defaultPrevented || openItemId || s.readOnly) return;
      e.preventDefault();
      const file = [...(e.dataTransfer?.files ?? [])].find((x) => /^(image\/|application\/pdf$)/.test(x.type));
      if (file) s.openReceipt(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [s]);
  if (!over || s.panel || openItemId || s.readOnly) return null;
  return (
    <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-bg/70 backdrop-blur-[2px]">
      <div className="flex items-center gap-2 text-base font-medium text-accent-ink">
        <ReceiptText className="size-5" />
        {t.scan.dropHint}
      </div>
    </div>
  );
}

/** Phone Shopping tab: To buy and On the way stay one view (the switch's thumb animates; the list pane slides). */
const isShop = (v: ReturnType<typeof useStore>["view"]) => v.type === "to_buy" || v.type === "ordered";
function viewKey(v: ReturnType<typeof useStore>["view"], phone = false) {
  if (phone && isShop(v)) return "shop";
  return v.type === "collection" ? `c:${v.id}` : v.type === "store" ? `s:${v.key}` : v.type;
}

function ViewHeader() {
  const s = useStore();
  const ro = useReadOnly();
  const { t, f, locale } = useI18n();
  const items = useViewItems();
  const collection = s.view.type === "collection" ? s.collections.find((c) => c.id === (s.view as { id: string }).id) : null;

  // A project/list page has its own header (cover, ring, numbers, actions — Round 9 E1), then the section header.
  // Loading one: that header's shape (Round 10 C3), then the item grid.
  if (s.loading && s.view.type === "collection") return <ProjectHeaderSkeleton />;
  if (collection && !s.loading)
    return (
      <>
        <ProjectHeader c={collection} />
        <FiltersRow showProjects={false} />
      </>
    );

  const title = (() => {
    switch (s.view.type) {
      case "to_buy":
        return t.nav.toBuy;
      case "history":
        return t.nav.history;
      case "ordered":
        return t.nav.onTheWay;
      case "orders":
        return t.orders.title;
      case "spending":
        return t.spending.title;
      case "collection":
        return collection?.name ?? "—";
      case "store": {
        const key = s.view.key;
        return s.items.flatMap((i) => i.sources).find((x) => x.storeKey === key)?.store ?? key;
      }
    }
  })();

  const summary = SUMMARY_VIEWS.includes(s.view.type);
  const shop = isShop(s.view);
  const spentView = s.view.type === "history" || s.view.type === "ordered";
  const totals = sumTotals(spentView ? items : countable(items.filter((i) => i.status === "to_buy"), s.altGroups, s.rates), s.rates, s.currency);
  // Data-dependent parts fade in on the first paint after the streamed shell (never on view switches).
  const fadeIn = s.navSeq === 0 ? "load-in" : undefined;
  const titleUnknown = s.loading && (s.view.type === "collection" || s.view.type === "store");

  return (
    <>
    {shop && <ShoppingHeader className="lg:hidden" />}
    <div className={shop ? "contents max-lg:hidden" : "contents"}>
    {s.view.type === "history" && <InsightsSwitch />}
    <div className="mb-3 flex flex-col gap-[18px]">
      <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2", s.view.type === "to_buy" && "sr-only")}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {collection && <span className={cn("size-3", collection.kind === "project" ? "rounded-[4px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[collection.color] }} />}
            <h1 className={cn("truncate text-[26px] font-extrabold tracking-[-0.02em] bidi", (s.view.type === "collection" || s.view.type === "store") && fadeIn)}>
              {titleUnknown ? <Skel className="skeleton-in my-[5px] h-7 w-44 rounded-lg" /> : title}
            </h1>
            {collection && (
              <>
                <Button variant="ghost" size="icon-sm" onClick={() => s.setEditor({ mode: "edit", collection })} aria-label={t.collection.rename} title={t.collection.rename}>
                  <Pencil className="!size-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="ms-1 h-8 px-3" onClick={() => s.setPanel("share")}>
                  <Share2 className="!size-3.5" />
                  <span className="max-sm:hidden">{t.share.shareBtn}</span>
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-3" onClick={() => s.setShop({ kind: "collection", id: collection.id })} data-shop-open>
                  <ShoppingCart className="!size-3.5" />
                  <span className="max-sm:hidden">{t.shop.open}</span>
                </Button>
                {collection.kind === "project" && s.aiEnabled && (
                  <Button variant="outline" size="sm" className="ask-hairline h-8 px-3" disabled={ro.ro} onClick={() => s.setPanel("planner")} data-plan-project>
                    <Sparkles className="!size-3.5" />
                    <span className="max-sm:hidden">{t.projects.plan}</span>
                  </Button>
                )}
              </>
            )}
          </div>
          {collection?.description && <p className="mt-1 max-w-[70ch] text-sm text-muted bidi">{collection.description}</p>}
          {!summary &&
            (s.loading ? (
              <Skel className="skeleton-in mt-[7px] h-3.5 w-52" />
            ) : (
              <p className={cn("tabular mt-1 text-sm text-muted", fadeIn)}>
                {items.length === 1 ? t.collection.itemsCountOne : f(t.collection.itemsCount, { n: items.length })}
                {totals.total > 0 && (
                  <>
                    <span className="mx-2 text-faint">/</span>
                    {spentView ? t.collection.spent : t.view.itemsTotal} <b className="font-semibold text-fg">{totals.estimated ? "~" : ""}{formatMoney(totals.total, s.currency, locale)}</b>
                  </>
                )}
              </p>
            ))}
        </div>
        {spentView && (
          <Button variant="outline" className="h-10 max-sm:w-10 max-sm:px-0" disabled={ro.ro} onClick={() => s.openReceipt()} aria-label={t.scan.title} title={ro.title ?? t.scan.title} data-receipt-open="view">
            <ReceiptText />
            <span className="max-sm:hidden">{t.scan.button}</span>
          </Button>
        )}
      </div>

      {summary && (s.loading ? <SummarySkeleton /> : <div className={fadeIn}><HomeSummary /></div>)}
    </div>
    {s.view.type === "history" && !s.loading && <HistoryTools />}
    {!s.loading && <FiltersRow showProjects={s.view.type !== "collection" && s.view.type !== "orders" && s.view.type !== "history"} />}
    </div>
    {/* Search elsewhere → "Go to History" (stays visible in the phone Shopping tab too). */}
    <HistoryHint />
    </>
  );
}

function SummarySkeleton() {
  return (
    <div className="skeleton-in grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4" aria-hidden>
      <Skel className="col-span-2 h-[156px] rounded-[26px] sm:h-[176px] lg:col-span-1 lg:h-[180px] lg:rounded-[30px]" />
      <Skel className="h-[170px] rounded-[30px] max-sm:hidden lg:h-[180px]" />
      <Skel className="h-[170px] rounded-[30px] max-sm:hidden lg:h-[180px]" />
    </div>
  );
}

function Content() {
  const s = useStore();
  const { t } = useI18n();
  const items = useViewItems();
  const table = useTable();
  const pending = SHOWS_PENDING.includes(s.view.type) ? s.pending : NO_PENDING;

  if (s.loading) return <ContentSkeleton />;
  const fadeIn = s.navSeq === 0 ? "load-in" : undefined;
  if (!items.length && !pending.length) {
    return (
      <div className={cn("grid place-items-center rounded-2xl border border-dashed border-line-strong px-6 py-20 text-center", fadeIn)}>
        <EmptyArt />
        <p className="mt-5 max-w-sm text-[15px] text-muted">{s.query || s.tagFilter || s.categoryFilter || s.collectionFilter ? t.cmd.noResults : s.view.type === "history" || s.view.type === "ordered" ? t.collection.emptyHistory : t.collection.empty}</p>
        {!s.query && s.view.type !== "history" && s.view.type !== "ordered" && (
          <Button variant="accent" className="mt-5" onClick={s.focusAdd}>
            {t.cmd.addLink}
          </Button>
        )}
      </div>
    );
  }
  if (s.view.type === "orders")
    return (
      <div className={fadeIn}>
        <OrdersView items={items} />
      </div>
    );
  if (table)
    return (
      // max-sm:hidden: the server render can't know the width yet (never flash the table on a phone).
      <div className={cn("max-sm:hidden", s.navSeq === 0 && "load-in-rows")}>
        <ItemTable items={items} pending={pending} />
      </div>
    );

  if (s.view.type === "history") return <HistoryTimeline items={items} />;
  if (isShop(s.view)) return <ShopContent items={items} pending={pending} />;
  return <CardGrid items={items} pending={pending} altGroups={s.altGroups} stagger={s.navSeq === 0} />;
}

/**
 * To buy / On the way. Phones (< 640 px): the Shopping tab's list (To buy grouped by project) or grid, in a pane that
 * slides in from the end side going to On the way and from the start side coming back (rows stagger 40 ms, first 8
 * only); list ⇄ grid zooms in (0.96 → 1). Wider screens: the plain grid, as before.
 */
function ShopContent({ items, pending }: { items: ItemWithSources[]; pending: PendingAdd[] }) {
  const s = useStore();
  const phone = useMedia(PHONE);
  const way = s.view.type === "ordered";
  const ordered = useMemo(() => (phone && way && s.shopSort.way === "arrival" ? byArrival(items, s.clock.now, s.clock.tz) : items), [phone, way, s.shopSort.way, items, s.clock]);
  const groups = useMemo(() => (phone && !way && s.phoneLayout === "rows" && s.shopSort.buy === "project" ? groupByProject(ordered, s) : null), [phone, way, s, ordered]);
  // What changed since the last render decides the entrance: the sub-tab slides, list ⇄ grid zooms.
  const [last, setLast] = useState({ v: s.view.type, l: s.phoneLayout, mode: "" as "" | "slide" | "zoom" });
  if (last.v !== s.view.type || last.l !== s.phoneLayout) setLast({ v: s.view.type, l: s.phoneLayout, mode: last.v !== s.view.type ? "slide" : "zoom" });
  if (!phone) return <CardGrid items={items} pending={pending} altGroups={s.altGroups} stagger={s.navSeq === 0} />;
  const anim = last.mode === "slide" ? `shop-pane ${s.navDir > 0 ? "shop-fwd" : "shop-back"}` : last.mode === "zoom" ? "shop-zoom" : "";
  return (
    <div key={`${s.view.type}:${s.phoneLayout}`} className={anim} data-shop-pane={s.view.type}>
      {groups ? (
        <ShopGroups groups={groups} pending={pending} />
      ) : (
        <CardGrid items={ordered} pending={pending} altGroups={s.altGroups} stagger={false} />
      )}
    </div>
  );
}

/** To buy grouped by project (phone list). Groups mount a few at a time (about 12 rows a frame), like CardGrid's
 *  chunks, so opening a long list never blocks a frame. */
function ShopGroups({ groups, pending }: { groups: [string, ItemWithSources[]][]; pending: PendingAdd[] }) {
  const s = useStore();
  const [budget, setBudget] = useState(FIRST_CARDS);
  const total = groups.reduce((a, g) => a + g[1].length, 0);
  useEffect(() => {
    if (budget >= total) return;
    const id = requestAnimationFrame(() => setBudget((b) => b + FIRST_CARDS));
    return () => cancelAnimationFrame(id);
  }, [budget, total]);
  // Groups whose first row starts within the budget (running totals, no mutation during render).
  const starts = groups.map((_, k) => groups.slice(0, k).reduce((a, g) => a + g[1].length, 0));
  const shown = groups.filter((_, k) => starts[k] < budget);
  return (
    <div className="flex flex-col gap-3">
      {pending.length > 0 && <CardGrid items={[]} pending={pending} altGroups={s.altGroups} stagger={false} />}
      {shown.map(([id, list], k) => (
        <section key={id || "none"} className="shop-group">
          <ShopGroupHeader id={id} count={list.length} />
          {/* The first group paints with the page (no empty frame on load or when the list replaces the flat grid). */}
          <CardGrid items={list} pending={NO_PENDING} altGroups={s.altGroups} stagger={k === 0} />
        </section>
      ))}
    </div>
  );
}

/** History as a timeline (Round 11 B2): bought items grouped by month, newest first, each with its count and total. */
function HistoryTimeline({ items }: { items: ItemWithSources[] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const groups = useMemo(() => {
    const m = new Map<string, ItemWithSources[]>();
    for (const i of items) {
      const k = historyMonthOf(i) ?? "";
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m].sort((a, b) => (a[0] && b[0] ? b[0].localeCompare(a[0]) : a[0] ? -1 : 1));
  }, [items]);
  return (
    <div className="relative space-y-7 ps-5 before:absolute before:inset-y-2 before:start-[5px] before:w-px before:bg-line" data-history-timeline>
      {groups.map(([k, list], gi) => {
        const total = sumTotals(list, s.rates, s.currency).total;
        return (
          <section key={k || "none"} data-history-month={k || "none"}>
            <div className="relative mb-3 flex flex-wrap items-baseline gap-x-2.5">
              <span aria-hidden className="absolute -start-5 top-[7px] size-[11px] rounded-full border-2 border-bg bg-ink" />
              <h2 className="text-[17px] font-extrabold">{k ? monthLabel(k, locale) : t.insights.noDate}</h2>
              <span className="tabular text-[13px] text-muted">
                {list.length === 1 ? t.collection.itemsCountOne : f(t.collection.itemsCount, { n: list.length })}
                {total > 0 && <> · <b className="font-semibold text-ink">{formatMoney(total, s.currency, locale)}</b></>}
              </span>
            </div>
            <CardGrid items={list} pending={NO_PENDING} altGroups={s.altGroups} stagger={s.navSeq === 0 && gi === 0} />
          </section>
        );
      })}
    </div>
  );
}

const FIRST_CARDS = 12;
const NO_PENDING: PendingAdd[] = [];

/**
 * The card grid, memoized on its data (UI toggles elsewhere don't re-render it). Long lists mount in chunks of 24 per
 * frame so a view switch never blocks the main thread; cards glide to new places when sorting/filtering/status change.
 */
const CardGrid = memo(function CardGrid({ items, pending, altGroups, stagger }: { items: ItemWithSources[]; pending: PendingAdd[]; altGroups: AltGroup[]; stagger: boolean }) {
  // After a view switch the header paints first and cards follow a frame later (12 per frame); on the very first
  // load (stagger) they're all part of the first paint, as before.
  const [limit, setLimit] = useState(stagger ? FIRST_CARDS * 2 : 0);
  const total = items.length + pending.length;
  useEffect(() => {
    if (limit >= total) return;
    const id = requestAnimationFrame(() => setLimit((n) => n + FIRST_CARDS));
    return () => cancelAnimationFrame(id);
  }, [limit, total]);

  // Alternatives that are still open collapse into one card, placed where the first option would be.
  const order = useMemo(() => items.map((i) => i.id), [items]);
  const cells = useMemo(() => {
    const known = new Set(altGroups.map((g) => g.id));
    const seen = new Set<string>();
    const out: ({ kind: "item"; item: ItemWithSources } | { kind: "group"; id: string; members: ItemWithSources[] })[] = [];
    for (const i of items) {
      if (i.status === "to_buy" && i.altGroupId && known.has(i.altGroupId)) {
        if (seen.has(i.altGroupId)) continue;
        seen.add(i.altGroupId);
        const members = items.filter((m) => m.altGroupId === i.altGroupId && m.status === "to_buy");
        if (members.length > 1) {
          out.push({ kind: "group", id: i.altGroupId, members });
          continue;
        }
      }
      out.push({ kind: "item", item: i });
    }
    return out;
  }, [items, altGroups]);
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}>
      <div className={cn("grid grid-cols-2 gap-2.5 prow:grid-cols-1 prow:gap-2 sm:grid-cols-[repeat(auto-fill,minmax(222px,1fr))] sm:gap-3.5", stagger && "load-in-stagger")} data-card-grid>
        <AnimatePresence initial={false} mode="popLayout">
          {pending.map((p) => (
            <Cell key={p.id}>
              <PendingCard p={p} />
            </Cell>
          ))}
          {cells.slice(0, Math.max(0, limit - pending.length)).map((c) =>
            c.kind === "item" ? <ItemCell key={c.item.id} item={c.item} order={order} /> : (
              <Cell key={`g:${c.id}`}>
                <AltGroupCard groupId={c.id} members={c.members} />
              </Cell>
            ),
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
});

const Cell = forwardRef<HTMLDivElement, { children: React.ReactNode }>(function Cell({ children }, ref) {
  return (
    <motion.div
      ref={ref}
      layout="position"
      className="cv-auto flex min-w-0 flex-col [&>*]:flex-1"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
    >
      {children}
    </motion.div>
  );
});

/** One card in its motion cell — memoized, so mounting more cards (or another card changing) doesn't re-render it. */
const ItemCell = memo(
  forwardRef<HTMLDivElement, { item: ItemWithSources; order: string[] }>(function ItemCell({ item, order }, ref) {
    return (
      <Cell ref={ref}>
        <ItemCard item={item} order={order} />
      </Cell>
    );
  }),
);

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
