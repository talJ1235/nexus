"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, ReceiptText, Share2, ShoppingCart, Sparkles } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlays";
import { countable, sumTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { AppData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AddBar, SHOWS_PENDING, type Incoming } from "./add-bar";
import { PendingCard } from "./pending";
import { CollectionDialog } from "./collection-dialog";
import { CommandPalette } from "./command-palette";
import { SettingsDialog } from "./settings-dialog";
import { ImportDialog } from "./import-dialog";
import { AlertsPanel } from "./alerts-panel";
import { TopBar } from "./top-bar";
import { Dock, PhoneTopBar, PlusMenu } from "./phone-shell";
import { FiltersRow, HomeSummary, SUMMARY_VIEWS } from "./home-summary";
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
import { ProjectsView } from "./projects-view";
import { BarcodeScanner } from "./barcode-scanner";
import { ReceiptCamera } from "./receipt-camera";
import { CompareSheet } from "./compare-sheet";
import { ShoppingMode, ShopOutboxSync } from "./shopping-mode";
import { ItemSheet } from "./item-sheet";
import { ItemTable } from "./item-table";
import { Sidebar } from "./sidebar";
import { StoreProvider, useStore, type UiInit } from "./store";
import { ContentSkeleton, Skel } from "./skeletons";
import { COLLECTION_COLORS, useViewItems } from "./view-items";
import { FALLBACK_RATES, type Currency } from "@/lib/money";

/** Everything the first paint needs that the server knows without loading data. */
export type AppBoot = UiInit & { currency: Currency; aiEnabled: boolean };

/** Without `initial` the app renders as the streamed loading shell: real chrome, skeleton content. */
/** `offline` = rendering the offline shell from the device snapshot (read-only). */
export function NexusApp({ boot, initial, incoming, offline }: { boot: AppBoot; initial?: AppData; incoming?: Incoming; offline?: { at: number } }) {
  const data = initial ?? { items: [], collections: [], altGroups: [], storeSettings: [], budget: {}, rates: FALLBACK_RATES, aiEnabled: boot.aiEnabled };
  return (
    <StoreProvider initial={data} initialCurrency={boot.currency} ui={boot} loading={!initial} offline={offline ?? null}>
      <Shell incoming={incoming} />
    </StoreProvider>
  );
}

function Shell({ incoming }: { incoming?: Incoming }) {
  const s = useStore();
  const { t } = useI18n();
  const collapsed = s.sidebarCollapsed;

  return (
    <div
      className="min-h-dvh"
      style={{ "--sw": collapsed ? "76px" : "248px" } as React.CSSProperties}
      data-app-shell
      data-ready={s.loading ? undefined : ""}
      data-offline={s.offlineAt != null ? "" : undefined}
    >
      <div
        className={cn(
          "lg:grid lg:gap-5 lg:pe-[26px] lg:ps-4 lg:transition-[grid-template-columns] lg:duration-[450ms] lg:ease-[var(--ease-out)]",
          collapsed ? "lg:grid-cols-[76px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]",
        )}
      >
        <aside className="sticky top-4 hidden h-[calc(100dvh-32px)] min-w-0 lg:mt-4 lg:block">
          <Sidebar collapsed={collapsed} onToggle={() => s.setSidebarCollapsed(!collapsed)} />
        </aside>
        <Sheet open={s.navOpen} onOpenChange={s.setNavOpen} title={t.appName} side="start" className="max-w-[300px] bg-bg">
          <Sidebar floating={false} />
        </Sheet>

        <div className="min-w-0">
          {/* Phone / tablet header (Part C replaces it with the phone shell). */}
          <div className="empty:hidden lg:pt-4">
            <OfflineBanner />
          </div>
          <header className="sticky top-0 z-20 bg-bg/85 px-4 pb-2.5 pt-[max(14px,env(safe-area-inset-top))] backdrop-blur-md sm:px-6 lg:hidden">
            <PhoneTopBar />
          </header>
          <div className="sticky top-0 z-20 hidden bg-bg/85 pb-3 pt-4 backdrop-blur-md lg:block">
            <div className="mx-auto max-w-[1400px]">
              <TopBar />
            </div>
          </div>
          <main className="mx-auto max-w-[1400px] px-4 pb-40 pt-2 sm:px-6 lg:px-0 lg:pt-2">
            {/* Header + content switch together as one soft cross-fade; the very first paint is not animated. */}
            <div key={viewKey(s.view)} className={s.navSeq > 0 ? "view-in" : undefined}>
              {s.loading && s.view.type === "spending" ? (
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

      <AddBar incoming={incoming} collapsed={collapsed} />
      <Dock />
      <PlusMenu />
      <BarcodeScanner open={s.scanner === "barcode"} onClose={() => s.setScanner(null)} />
      <ReceiptCamera />
      <ShoppingMode />
      <PanelBoundary label="Compare">
        <CompareSheet />
      </PanelBoundary>
      <ShopOutboxSync />

      <ItemSheet />
      <AltSheet />
      <SelectionBar />
      <CollectionDialog />
      <CommandPalette />
      <SettingsDialog />
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
      if (!hasFiles(e) || e.defaultPrevented || s.openItemId || s.offlineAt != null) return;
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
  if (!over || s.panel || s.openItemId || s.offlineAt != null) return null;
  return (
    <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-bg/70 backdrop-blur-[2px]">
      <div className="flex items-center gap-2 text-base font-medium text-accent-ink">
        <ReceiptText className="size-5" />
        {t.scan.dropHint}
      </div>
    </div>
  );
}

function viewKey(v: ReturnType<typeof useStore>["view"]) {
  return v.type === "collection" ? `c:${v.id}` : v.type === "store" ? `s:${v.key}` : v.type;
}

function ViewHeader() {
  const s = useStore();
  const ro = useReadOnly();
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

  const summary = SUMMARY_VIEWS.includes(s.view.type);
  const spentView = s.view.type === "history" || s.view.type === "ordered";
  const totals = sumTotals(spentView ? items : countable(items.filter((i) => i.status === "to_buy"), s.altGroups, s.rates), s.rates, s.currency);
  // Data-dependent parts fade in on the first paint after the streamed shell (never on view switches).
  const fadeIn = s.navSeq === 0 ? "load-in" : undefined;
  const titleUnknown = s.loading && (s.view.type === "collection" || s.view.type === "store");

  return (
    <div className="mb-5 flex flex-col gap-[18px]">
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
                  <Button variant="outline" size="sm" className="ask-hairline h-8 px-3" disabled={ro.ro} onClick={() => s.askAssistant(f(t.projects.planSeed, { name: collection.name }))} data-plan-project>
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
                    {spentView ? t.collection.spent : t.view.itemsTotal} <b className="font-semibold text-fg">{formatMoney(totals.total, s.currency, locale)}</b>
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
      {!s.loading && <FiltersRow showProjects={s.view.type !== "collection" && s.view.type !== "orders"} />}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="skeleton-in grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4" aria-hidden>
      <Skel className="col-span-2 h-[176px] rounded-[28px] lg:col-span-1 lg:h-[226px] lg:rounded-[30px]" />
      <Skel className="h-[170px] rounded-[30px] lg:h-[226px]" />
      <Skel className="h-[170px] rounded-[30px] lg:h-[226px]" />
    </div>
  );
}

function Content() {
  const s = useStore();
  const { t } = useI18n();
  const items = useViewItems();
  const pending = SHOWS_PENDING.includes(s.view.type) ? s.pending : [];

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
  if (s.layout === "table")
    return (
      <div className={s.navSeq === 0 ? "load-in-rows" : undefined}>
        <ItemTable items={items} pending={pending} />
      </div>
    );

  // Alternatives that are still open collapse into one card, placed where the first option would be.
  const known = new Set(s.altGroups.map((g) => g.id));
  const seen = new Set<string>();
  const cells: React.ReactNode[] = pending.map((p) => <PendingCard key={p.id} p={p} />);
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
  return <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(222px,1fr))] sm:gap-3.5", s.navSeq === 0 && "load-in-stagger")}>{cells}</div>;
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
