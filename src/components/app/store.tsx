"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CURRENCY_COOKIE, type Currency, type Rates } from "@/lib/money";
import type { AltGroup, AppData, Collection, ItemWithSources, StoreSetting } from "@/lib/types";
import type { View } from "@/lib/views";
import { markBooted } from "@/lib/boot";
import { reloadAll } from "@/app/actions";
import { cacheShell, saveSnapshot } from "@/lib/offline";
import type { BudgetHistory } from "@/lib/budget";
import type { ShopScope } from "@/lib/shop-outbox";

export type { View };

export type Panel = "import" | "planner" | "assistant" | "alerts" | "share" | "receipt" | null;

export type Layout = "cards" | "table";

/** A pasted link that is still being read (or failed): shown as a placeholder card/row until the item exists. */
export type PendingAdd = { id: string; label: string; url: string | null; state: "working" | "failed"; collectionId: string | null; retry?: () => void };
export type SortKey = "newest" | "price" | "priority" | "name";

type Editor = { mode: "create"; kind: "project" | "list" } | { mode: "edit"; collection: Collection } | null;

/** Server-known state for the first paint: prefs from cookies, `?v=` from the URL. */
export type UiInit = { layout: Layout | null; sort: SortKey | null; view: string | null; sidebarCollapsed?: boolean };

const LAYOUT_COOKIE = "nexus_layout";
const SORT_COOKIE = "nexus_sort";
const SIDEBAR_COOKIE = "nexus_sidebar";
const setCookie = (k: string, v: string) => {
  document.cookie = `${k}=${v}; path=/; max-age=31536000; samesite=lax`;
};

type Store = {
  /** True while the shell is streamed before the data: content regions render skeletons. */
  loading: boolean;
  items: ItemWithSources[];
  collections: Collection[];
  altGroups: AltGroup[];
  setAltGroups: (g: AltGroup[]) => void;
  upsertAltGroup: (g: AltGroup) => void;
  storeSettings: StoreSetting[];
  upsertStoreSetting: (s: StoreSetting) => void;
  budget: BudgetHistory;
  setBudget: (b: BudgetHistory) => void;
  upsertItems: (items: ItemWithSources[]) => void;
  removeItems: (ids: string[]) => void;
  /** Multi-select */
  selected: Set<string>;
  toggleSelect: (id: string, opts?: { range?: string[] }) => void;
  setSelected: (ids: string[]) => void;
  clearSelection: () => void;
  altOpenId: string | null;
  openAlt: (groupId: string | null) => void;
  rates: Rates;
  aiEnabled: boolean;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  layout: Layout;
  setLayout: (l: Layout) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  view: View;
  setView: (v: View) => void;
  /** Increments on every user-initiated view change; 0 on first load (so the first paint isn't animated). */
  navSeq: number;
  query: string;
  setQuery: (q: string) => void;
  tagFilter: string | null;
  setTagFilter: (t: string | null) => void;
  /** Category dropdown on the home filters row (null = all). */
  categoryFilter: string | null;
  setCategoryFilter: (c: string | null) => void;
  /** Project/list chip on the filters row (null = all). */
  collectionFilter: string | null;
  setCollectionFilter: (c: string | null) => void;
  /** Phone: the "+" menu and the paste field above the dock. */
  plusOpen: boolean;
  setPlusOpen: (o: boolean) => void;
  pasteOpen: boolean;
  setPasteOpen: (o: boolean) => void;
  /** Shopping mode (D2): "pick" shows the scope picker. */
  shop: ShopScope | "pick" | null;
  setShop: (s: ShopScope | "pick" | null) => void;
  /** Full-screen camera: barcode scanner (D1) or receipt capture (E2). */
  scanner: "barcode" | "receipt" | null;
  setScanner: (k: "barcode" | "receipt" | null) => void;
  /** Desktop floating sidebar collapsed to icons (cookie, read on the server). */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (c: boolean) => void;
  upsertItem: (i: ItemWithSources) => void;
  removeItem: (id: string) => void;
  setItems: (items: ItemWithSources[]) => void;
  upsertCollection: (c: Collection) => void;
  removeCollection: (id: string) => void;
  openItemId: string | null;
  openItem: (id: string | null) => void;
  editor: Editor;
  setEditor: (e: Editor) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  navOpen: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (o: boolean) => void;
  extOpen: boolean;
  /** One secondary panel at a time (Round 3 dialogs). */
  panel: Panel;
  setPanel: (p: Panel) => void;
  /** Question handed from the command palette to the assistant. */
  askSeed: string | null;
  askAssistant: (q: string) => void;
  /** File handed to the receipt dialog (dropped on the app), or ready parts from the camera (E2); null = opened empty. */
  receiptSeed: { file?: File; parts?: Blob[]; at: number } | null;
  /** Read-only offline mode: when the shown data is from (null = online, editing allowed). */
  offlineAt: number | null;
  /** Rendering the offline shell from the device snapshot (vs. an online page that lost its connection). */
  offlineShell: boolean;
  openReceipt: (file?: File | null, parts?: Blob[]) => void;
  setExtOpen: (o: boolean) => void;
  setNavOpen: (o: boolean) => void;
  focusAdd: () => void;
  pending: PendingAdd[];
  addPending: (p: PendingAdd) => void;
  patchPending: (id: string, patch: Partial<PendingAdd>) => void;
  dropPending: (id: string) => void;
  /** Items that just arrived from a pasted link; their card plays a one-time "settle in" animation. */
  fresh: Map<string, "new" | "bump">;
  markFresh: (id: string, kind?: "new" | "bump") => void;
};

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

function viewToParam(v: View) {
  switch (v.type) {
    case "collection":
      return `c:${v.id}`;
    case "store":
      return `s:${v.key}`;
    default:
      return v.type;
  }
}

function paramToView(p: string | null): View {
  if (!p) return { type: "to_buy" };
  if (p.startsWith("c:")) return { type: "collection", id: p.slice(2) };
  if (p.startsWith("s:")) return { type: "store", key: p.slice(2) };
  if (["urgent", "history", "unsorted", "ordered", "orders", "spending", "projects"].includes(p)) return { type: p } as View;
  return { type: "to_buy" };
}

function readLocal<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

declare global {
  interface Window {
    __nexusCarry?: string;
  }
}

export function StoreProvider({
  initial,
  initialCurrency,
  ui,
  loading = false,
  offline = null,
  children,
}: {
  initial: AppData;
  initialCurrency: Currency;
  ui: UiInit;
  loading?: boolean;
  /** Set when rendering the offline shell: the snapshot's time. */
  offline?: { at: number } | null;
  children: React.ReactNode;
}) {
  const [items, setItems] = useState(initial.items);
  const [collections, setCollections] = useState(initial.collections);
  const [altGroups, setAltGroups] = useState(initial.altGroups);
  const [storeSettings, setStoreSettings] = useState(initial.storeSettings);
  const [budget, setBudget] = useState(initial.budget);
  const upsertStoreSetting = useCallback((row: StoreSetting) => setStoreSettings((prev) => [...prev.filter((x) => x.storeKey !== row.storeKey), row]), []);
  const [selected, setSelectedState] = useState<Set<string>>(() => new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [altOpenId, setAltOpenId] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [layout, setLayoutState] = useState<Layout>(ui.layout ?? "cards");
  const [sort, setSortState] = useState<SortKey>(ui.sort ?? "newest");
  const [view, setViewState] = useState<View>(() => paramToView(ui.view));
  const [navSeq, setNavSeq] = useState(0);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [scanner, setScanner] = useState<"barcode" | "receipt" | null>(null);
  const [shop, setShop] = useState<ShopScope | "pick" | null>(null);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(!!ui.sidebarCollapsed);
  const setSidebarCollapsed = useCallback((c: boolean) => {
    setSidebarCollapsedState(c);
    setCookie(SIDEBAR_COOKIE, c ? "collapsed" : "open");
  }, []);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const askAssistant = useCallback((q: string) => {
    // Suffix keeps repeated identical questions distinct.
    setAskSeed(`${q}\u200b${Date.now() % 1000}`);
    setPanel("assistant");
  }, []);
  const [receiptSeed, setReceiptSeed] = useState<{ file?: File; parts?: Blob[]; at: number } | null>(null);
  const openReceipt = useCallback((file?: File | null, parts?: Blob[]) => {
    setReceiptSeed(file || parts?.length ? { file: file ?? undefined, parts, at: Date.now() } : null);
    setPanel("receipt");
  }, []);

  // Offline (read-only v1): the shell shows the device snapshot; an online page that loses its connection keeps
  // what it has and turns read-only until it's back, then refreshes.
  const [online, setOnline] = useState(true);
  const [loadedAt] = useState(() => Date.now());
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state */
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      if (offline) window.location.replace(`/${window.location.search}`);
      else reloadAll().then(setItems, () => {});
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [offline]);
  const offlineAt = offline ? offline.at : online ? null : loadedAt;

  // Owner app, online: keep the device snapshot fresh (debounced) and make sure the offline shell is cached.
  useEffect(() => {
    if (loading || offline) return;
    cacheShell();
  }, [loading, offline]);
  useEffect(() => {
    if (loading || offline || !online) return;
    const t = setTimeout(() => void saveSnapshot({ data: { ...initial, items, collections, altGroups, storeSettings, budget }, at: Date.now(), currency }), 1200);
    return () => clearTimeout(t);
  }, [loading, offline, online, initial, items, collections, altGroups, storeSettings, budget, currency]);

  // The app has its data: the phone boot screen can hand off.
  useEffect(() => {
    if (!loading) markBooted();
  }, [loading]);

  // One-time migration of prefs saved in localStorage before they moved to cookies, and `?item=` deep links.
  useEffect(() => {
    if (loading) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from browser-only storage */
    if (!ui.layout) {
      const l = readLocal("nexus.layout", ["cards", "table"] as const, "cards");
      setCookie(LAYOUT_COOKIE, l);
      if (l !== "cards") setLayoutState(l);
    }
    if (!ui.sort) {
      const so = readLocal("nexus.sort", ["newest", "price", "priority", "name"] as const, "newest");
      setCookie(SORT_COOKIE, so);
      if (so !== "newest") setSortState(so);
    }
    const params = new URLSearchParams(window.location.search);
    const itemParam = params.get("item");
    if (itemParam) {
      setOpenItemId(itemParam);
      const url = new URL(window.location.href);
      url.searchParams.delete("item");
      window.history.replaceState(null, "", url);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [loading, ui.layout, ui.sort]);

  const setView = useCallback((v: View) => {
    setViewState(v);
    setNavSeq((n) => n + 1);
    setSelectedState(new Set());
    setTagFilter(null);
    setCategoryFilter(null);
    setCollectionFilter(null);
    setNavOpen(false);
    setPlusOpen(false);
    window.scrollTo({ top: 0 });
    const url = new URL(window.location.href);
    const p = viewToParam(v);
    if (p === "to_buy") url.searchParams.delete("v");
    else url.searchParams.set("v", p);
    window.history.replaceState(null, "", url);
  }, []);

  const setLayout = useCallback((l: Layout) => {
    setLayoutState(l);
    setCookie(LAYOUT_COOKIE, l);
  }, []);
  const setSort = useCallback((s: SortKey) => {
    setSortState(s);
    setCookie(SORT_COOKIE, s);
  }, []);
  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    document.cookie = `${CURRENCY_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // The streamed loading shell is plain HTML until the data arrives (React doesn't hydrate a pending Suspense
  // fallback). page.tsx's inline script remembers the last click on a [data-carry] control there; do it now.
  useEffect(() => {
    const c = loading ? undefined : window.__nexusCarry;
    if (!c) return;
    delete window.__nexusCarry;
    const [kind, arg] = c.split(":");
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hand-over from the loading shell */
    if (kind === "panel") setPanel(arg as Panel);
    else if (kind === "palette") setPaletteOpen(true);
    else if (kind === "settings") setSettingsOpen(true);
    else if (kind === "nav") setNavOpen(true);
    else if (kind === "editor") setEditor({ mode: "create", kind: arg === "list" ? "list" : "project" });
    else if (kind === "layout") setLayout(arg === "table" ? "table" : "cards");
    else if (kind === "view") setView(paramToView(arg));
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const upsertItem = useCallback((i: ItemWithSources) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === i.id);
      if (idx === -1) return [i, ...prev];
      const next = prev.slice();
      next[idx] = i;
      return next;
    });
  }, []);
  const removeItem = useCallback((id: string) => setItems((prev) => prev.filter((p) => p.id !== id)), []);
  const upsertItems = useCallback((list: ItemWithSources[]) => {
    setItems((prev) => {
      const byId = new Map(list.map((i) => [i.id, i]));
      const next = prev.map((p) => byId.get(p.id) ?? p);
      const known = new Set(prev.map((p) => p.id));
      return [...list.filter((i) => !known.has(i.id)), ...next];
    });
  }, []);
  const removeItems = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setItems((prev) => prev.filter((p) => !set.has(p.id)));
    setSelectedState((prev) => new Set([...prev].filter((id) => !set.has(id))));
  }, []);
  const upsertAltGroup = useCallback((g: AltGroup) => {
    setAltGroups((prev) => (prev.some((x) => x.id === g.id) ? prev.map((x) => (x.id === g.id ? g : x)) : [...prev, g]));
  }, []);
  const toggleSelect = useCallback(
    (id: string, opts?: { range?: string[] }) => {
      setSelectedState((prev) => {
        const next = new Set(prev);
        // Shift-click: select everything between the last clicked card and this one.
        if (opts?.range && lastSelected && opts.range.includes(lastSelected)) {
          const a = opts.range.indexOf(lastSelected);
          const b = opts.range.indexOf(id);
          for (const x of opts.range.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastSelected(id);
    },
    [lastSelected],
  );
  const setSelected = useCallback((ids: string[]) => setSelectedState(new Set(ids)), []);
  const clearSelection = useCallback(() => setSelectedState(new Set()), []);
  const upsertCollection = useCallback((c: Collection) => {
    setCollections((prev) => {
      const idx = prev.findIndex((p) => p.id === c.id);
      if (idx === -1) return [...prev, c];
      const next = prev.slice();
      next[idx] = c;
      return next;
    });
  }, []);
  const removeCollection = useCallback((id: string) => {
    setCollections((prev) => prev.filter((p) => p.id !== id));
    setItems((prev) => prev.map((i) => (i.collectionId === id ? { ...i, collectionId: null } : i)));
  }, []);

  const [pending, setPending] = useState<PendingAdd[]>([]);
  const addPending = useCallback((p: PendingAdd) => setPending((prev) => [p, ...prev.filter((x) => x.id !== p.id)]), []);
  const patchPending = useCallback((id: string, patch: Partial<PendingAdd>) => setPending((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))), []);
  const dropPending = useCallback((id: string) => setPending((prev) => prev.filter((x) => x.id !== id)), []);
  const [fresh, setFresh] = useState<Map<string, "new" | "bump">>(() => new Map());
  const markFresh = useCallback((id: string, kind: "new" | "bump" = "new") => {
    setFresh((prev) => new Map(prev).set(id, kind));
    setTimeout(
      () =>
        setFresh((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        }),
      1400,
    );
  }, []);

  const focusAdd = useCallback(() => {
    document.getElementById("add-input")?.focus();
  }, []);

  const value = useMemo<Store>(
    () => ({
      loading,
      items,
      collections,
      altGroups,
      setAltGroups,
      upsertAltGroup,
      storeSettings,
      upsertStoreSetting,
      budget,
      setBudget,
      upsertItems,
      removeItems,
      selected,
      toggleSelect,
      setSelected,
      clearSelection,
      altOpenId,
      openAlt: setAltOpenId,
      rates: initial.rates,
      aiEnabled: initial.aiEnabled,
      currency,
      setCurrency,
      layout,
      setLayout,
      sort,
      setSort,
      view,
      setView,
      navSeq,
      query,
      setQuery,
      tagFilter,
      setTagFilter,
      categoryFilter,
      setCategoryFilter,
      collectionFilter,
      setCollectionFilter,
      plusOpen,
      setPlusOpen,
      pasteOpen,
      setPasteOpen,
      scanner,
      setScanner,
      shop,
      setShop,
      sidebarCollapsed,
      setSidebarCollapsed,
      upsertItem,
      removeItem,
      setItems,
      upsertCollection,
      removeCollection,
      openItemId,
      openItem: setOpenItemId,
      editor,
      setEditor,
      paletteOpen,
      setPaletteOpen,
      navOpen,
      settingsOpen,
      setSettingsOpen,
      extOpen,
      panel,
      setPanel,
      askSeed,
      askAssistant,
      receiptSeed,
      openReceipt,
      offlineAt,
      offlineShell: !!offline,
      setExtOpen,
      setNavOpen,
      focusAdd,
      pending,
      addPending,
      patchPending,
      dropPending,
      fresh,
      markFresh,
    }),
    [loading, pending, addPending, patchPending, dropPending, fresh, markFresh, items, collections, altGroups, upsertAltGroup, storeSettings, upsertStoreSetting, budget, upsertItems, removeItems, selected, toggleSelect, setSelected, clearSelection, altOpenId, initial.rates, initial.aiEnabled, currency, setCurrency, layout, setLayout, sort, setSort, view, setView, navSeq, query, tagFilter, categoryFilter, collectionFilter, plusOpen, pasteOpen, scanner, shop, sidebarCollapsed, setSidebarCollapsed, upsertItem, removeItem, upsertCollection, removeCollection, openItemId, editor, paletteOpen, navOpen, settingsOpen, extOpen, panel, askSeed, askAssistant, receiptSeed, openReceipt, offlineAt, offline, focusAdd],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
