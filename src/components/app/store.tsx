"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { installClientErrorCapture } from "@/lib/client-errors";
import { recordNav } from "@/lib/client-diag";
import type { ReportFields } from "@/lib/reports";
import { CURRENCY_COOKIE, type Currency, type Rates } from "@/lib/money";
import type { Changes } from "@/lib/db-scoped/changes";
import type { Alert, AltGroup, AppData, Collection, ItemWithSources, Person, SpaceCard, SpaceInfo, StoreSetting } from "@/lib/types";
import { DEFAULT_HOME_PREFS, type HomePrefs } from "@/lib/home";
import { DEFAULT_SHOP_SORT, readShopSort, saveShopSort, type ShopSort } from "@/lib/shop-sort";
import { paramToView, type View } from "@/lib/views";
import { markBooted } from "@/lib/boot";
import { primeCamera } from "@/lib/camera";
import { prewarmScanners } from "@/lib/barcode-reader";
import { reloadAll } from "@/app/actions";
import { ensureImages } from "@/app/image-actions";
import { cacheShell, saveSnapshot } from "@/lib/offline";
import type { BudgetHistory } from "@/lib/budget";
import type { ShopScope } from "@/lib/shop-outbox";

export type { View };

export type Panel = "import" | "planner" | "assistant" | "alerts" | "share" | "receipt" | null;

export type Layout = "cards" | "table";
/** A report being written: fields drafted by the assistant (or empty), plus the exchange it came from. */
export type ReportDraft = Partial<ReportFields> & {
  assistant?: { question: string; answer: string } | null;
  /** R16 C1: opened from a failure toast's Report action. */
  failure?: { code: string; what: string; link?: string | null; image?: string | null };
};
/** Phones: 2-column cards (default) or one row per item. */
export type PhoneLayout = "cards" | "rows";

/** A pasted link that is still being read (or failed): shown as a placeholder card/row until the item exists. */
export type PendingAdd = { id: string; label: string; url: string | null; state: "working" | "failed"; collectionId: string | null; retry?: () => void };
export type SortKey = "newest" | "price" | "priority" | "name";

type Editor = { mode: "create"; kind: "project" | "list" } | { mode: "edit"; collection: Collection } | null;

/** Server-known state for the first paint: prefs from cookies, `?v=` from the URL. */
export type UiInit = { layout: Layout | null; sort: SortKey | null; view: string | null; filter?: string | null; sidebarCollapsed?: boolean; phoneLayout?: PhoneLayout | null; homeLayout?: string | null; now?: number; tz?: string | null };

/** Home's clock: the first paint uses the server's time + the saved time zone (same HTML on both sides), then the
 *  device's. weekStartsOn from the browser locale (Monday-first where it says so). */
export type Clock = { now: number; tz: string; weekStartsOn: 0 | 1 };
const TZ_COOKIE = "nexus_tz";
const DEFAULT_TZ = "Asia/Jerusalem";

/** Home sections that Customize can move or hide (the header card is fixed). */
export const HOME_SECTIONS = ["suggest", "week", "needs", "ontheway", "pace", "projects", "noticed"] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];
export type HomeLayout = { order: HomeSection[]; hidden: HomeSection[] };
export const DEFAULT_HOME_LAYOUT: HomeLayout = { order: [...HOME_SECTIONS], hidden: [] };
/** Cookie form: "suggest.week.-noticed…" (order; "-" = hidden). Unknown ids dropped, missing ones appended. */
export function parseHomeLayout(v: string | null | undefined): HomeLayout {
  if (!v) return DEFAULT_HOME_LAYOUT;
  const order: HomeSection[] = [];
  const hidden: HomeSection[] = [];
  for (const raw of v.split(".")) {
    const id = raw.replace(/^-/, "") as HomeSection;
    if (!HOME_SECTIONS.includes(id) || order.includes(id)) continue;
    order.push(id);
    if (raw.startsWith("-")) hidden.push(id);
  }
  for (const id of HOME_SECTIONS) if (!order.includes(id)) order.push(id);
  return { order, hidden };
}
export const homeLayoutCookie = (l: HomeLayout) => l.order.map((id) => (l.hidden.includes(id) ? `-${id}` : id)).join(".");

const LAYOUT_COOKIE = "nexus_layout";
const SORT_COOKIE = "nexus_sort";
const PHONE_LAYOUT_COOKIE = "nexus_phone_layout";
const SIDEBAR_COOKIE = "nexus_sidebar";
const HOME_COOKIE = "nexus_home";
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
  /** Recent price alerts (Home "Needs you"); refreshed with the page. */
  alerts: Alert[];
  /** Home: dismissed rows / snoozed suggestions, the AI-phrasing switch. */
  homePrefs: HomePrefs;
  setHomePrefs: (p: HomePrefs) => void;
  /** Home section order + hidden ones (Customize, cookie). */
  homeLayout: HomeLayout;
  setHomeLayout: (l: HomeLayout) => void;
  clock: Clock;
  /** Phone Shopping tab sort: To buy "By project" / On the way "By arrival", or the plain sort (localStorage). */
  shopSort: ShopSort;
  setShopSort: (v: ShopSort) => void;
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
  phoneLayout: PhoneLayout;
  setPhoneLayout: (l: PhoneLayout) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  view: View;
  setView: (v: View) => void;
  /** R16 A12: swap in another space's data (from loadAppData) without a reload; lands on Home. */
  replaceData: (next: AppData, opts?: { keepView?: boolean }) => void;
  /** R16 B1: the change-feed revision the store is at, and merging a changesSince result into it (UI state kept). */
  getRev: () => number;
  applyChanges: (ch: Changes) => ChangeSummary;
  /** R16 B4: members online in this space now (Ably presence; empty when polling) → their mode. */
  present: Map<string, "app" | "shopping">;
  setPresent: (m: Map<string, "app" | "shopping">) => void;
  /** Increments on every user-initiated view change; 0 on first load (so the first paint isn't animated). */
  navSeq: number;
  /** Direction of the last view change in sidebar order (views slide that way). */
  navDir: 1 | -1;
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
  /** History view: its own search and Month (YYYY-MM) / Store (storeKey) filters (Round 11 B2). */
  historyQuery: string;
  setHistoryQuery: (q: string) => void;
  historyMonth: string | null;
  setHistoryMonth: (m: string | null) => void;
  historyStore: string | null;
  setHistoryStore: (k: string | null) => void;
  /** Phone: the "+" menu (read it with usePlusOpen — R16 A11) and the paste field above the dock. */
  setPlusOpen: (o: boolean) => void;
  pasteOpen: boolean;
  setPasteOpen: (o: boolean) => void;
  /** Items whose picture is being looked for (E4): their image tile shimmers until it fills in. */
  imagePending: Set<string>;
  fillImages: (ids: string[]) => void;
  /** VAT-free import limit, USD (G2). */
  importLimitUsd: number;
  /** R15: the current space's id ("" in an old offline snapshot) — receipt uploads go under spaces/<id>/. */
  spaceId: string;
  /** R15: the signed-in user is the admin (Settings → Invite codes). */
  admin: boolean;
  /** R15 C1: the current space (null in an old offline snapshot), every space the user is in, a shared space's people. */
  space: SpaceInfo | null;
  spaces: SpaceCard[];
  people: Person[];
  me: { id: string; name: string; email: string } | null;
  /** No write controls: the offline snapshot, or the viewer role in this space (the server refuses anyway). */
  readOnly: boolean;
  setImportLimitUsd: (v: number) => void;
  /** Compare-stores sheet (G1) for this item. */
  compareItemId: string | null;
  setCompareItemId: (id: string | null) => void;
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
  /** Which item's sheet is open lives in its own context (useOpenItemId) so opening one doesn't re-render the app. */
  openItem: (id: string | null) => void;
  editor: Editor;
  setEditor: (e: Editor) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  navOpen: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (o: boolean) => void;
  extOpen: boolean;
  /** Round 8 D3: the "Report a problem" form (null = closed) and the Reports screen. */
  reportDraft: ReportDraft | null;
  openReport: (d?: ReportDraft) => void;
  closeReport: () => void;
  reportsOpen: boolean;
  setReportsOpen: (o: boolean) => void;
  /** Round 9 A1: the phone "Me" sheet (settings, look, reports, extension, Telegram, export, log out). */
  meOpen: boolean;
  setMeOpen: (o: boolean) => void;
  /** One secondary panel at a time (Round 3 dialogs). */
  panel: Panel;
  setPanel: (p: Panel) => void;
  /** Question handed from the command palette to the assistant. */
  askSeed: string | null;
  askAssistant: (q: string) => void;
  /** Clear the seed once the chat has sent it (R14 A1: a new chat or a reopen must not resend it). */
  consumeAskSeed: () => void;
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

/** R16 B4: what one person changed in a feed update. */
export type PersonTally = { added: number; changed: number; checked: number; removed: number };
export type ChangeSummary = { by: Map<string, PersonTally>; closed: { by: string | null } | null };

const Ctx = createContext<Store | null>(null);

// R16 A11: the "+" menu's open state lives outside the store, so opening/closing it re-renders only the dock button
// and the sheet (it used to re-render the whole app first: a 130–145 ms long task at 6× CPU, the close "stutter").
let plusOpenNow = false;
const plusListeners = new Set<() => void>();
export function setPlusOpen(o: boolean) {
  if (o === plusOpenNow) return;
  plusOpenNow = o;
  for (const l of plusListeners) l();
}
const subscribePlus = (l: () => void) => {
  plusListeners.add(l);
  return () => plusListeners.delete(l);
};
export const usePlusOpen = () => useSyncExternalStore(subscribePlus, () => plusOpenNow, () => false);
/** The same store, refreshed only when item data changes (not on UI toggles): cards and rows read this one, so opening a
 *  menu, a sheet or a panel doesn't re-render every card. Only the data fields and stable callbacks are fresh here. */
const DataCtx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

const OpenItemCtx = createContext<string | null>(null);
export const useOpenItemId = () => useContext(OpenItemCtx);

export function useDataStore() {
  const s = useContext(DataCtx);
  if (!s) throw new Error("useDataStore outside provider");
  return s;
}

/** Sidebar order: view switches slide forward/back along it. */
const VIEW_ORDER: View["type"][] = ["home", "to_buy", "ordered", "orders", "history", "spending", "projects", "collection", "store"];

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

export { paramToView };

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
  const [alerts, setAlerts] = useState<Alert[]>(initial.alerts ?? []);
  // R16 A12: the space/people/me/rates part of the load lives in state too, so a space switch can swap it in place.
  const [base, setBase] = useState<AppData>(initial);
  const [homePrefs, setHomePrefs] = useState<HomePrefs>(initial.home ?? DEFAULT_HOME_PREFS);
  const [clock, setClock] = useState<Clock>(() => ({ now: ui.now ?? Date.now(), tz: ui.tz || DEFAULT_TZ, weekStartsOn: 0 }));
  useEffect(() => {
    const tick = () => {
      let tz = DEFAULT_TZ;
      let weekStartsOn: 0 | 1 = 0;
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
        const loc = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
        weekStartsOn = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay === 1 ? 1 : 0;
      } catch {}
      setClock({ now: Date.now(), tz, weekStartsOn });
      setCookie(TZ_COOKIE, encodeURIComponent(tz));
    };
    tick();
    // Day/greeting roll-over while the app stays open.
    const id = window.setInterval(tick, 10 * 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [shopSort, setShopSortState] = useState<ShopSort>(DEFAULT_SHOP_SORT);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only pref */
    setShopSortState(readShopSort());
  }, []);
  const setShopSort = useCallback((v: ShopSort) => {
    setShopSortState(v);
    saveShopSort(v);
  }, []);
  const [homeLayout, setHomeLayoutState] = useState<HomeLayout>(() => parseHomeLayout(ui.homeLayout));
  const setHomeLayout = useCallback((l: HomeLayout) => {
    setHomeLayoutState(l);
    setCookie(HOME_COOKIE, homeLayoutCookie(l));
  }, []);
  const upsertStoreSetting = useCallback((row: StoreSetting) => setStoreSettings((prev) => [...prev.filter((x) => x.storeKey !== row.storeKey), row]), []);
  const [selected, setSelectedState] = useState<Set<string>>(() => new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [altOpenId, setAltOpenId] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [layout, setLayoutState] = useState<Layout>(ui.layout ?? "cards");
  // Round 13 B3: phones default to the list (rows); the last choice is remembered (cookie).
  const [phoneLayout, setPhoneLayoutState] = useState<PhoneLayout>(ui.phoneLayout ?? "rows");
  const [sort, setSortState] = useState<SortKey>(ui.sort ?? "newest");
  const [view, setViewState] = useState<View>(() => paramToView(ui.view, ui.filter));
  const [navSeq, setNavSeq] = useState(0);
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const viewRef = useRef<View>(paramToView(ui.view, ui.filter));
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyMonth, setHistoryMonth] = useState<string | null>(null);
  const [historyStore, setHistoryStore] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [scanner, setScannerState] = useState<"barcode" | "receipt" | null>(null);
  // Opening a camera screen starts the camera in the tap itself and loads its decoder in parallel (Round 10 B1).
  const setScanner = useCallback((k: "barcode" | "receipt" | null) => {
    if (k) {
      primeCamera();
      prewarmScanners();
    }
    setScannerState(k);
  }, []);
  const [shop, setShop] = useState<ShopScope | "pick" | null>(null);
  const [imagePending, setImagePending] = useState<Set<string>>(() => new Set());
  const [compareItemId, setCompareItemId] = useState<string | null>(null);
  const [importLimitUsd, setImportLimitUsd] = useState(initial.importLimitUsd ?? 130);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(!!ui.sidebarCollapsed);
  const setSidebarCollapsed = useCallback((c: boolean) => {
    setSidebarCollapsedState(c);
    setCookie(SIDEBAR_COOKIE, c ? "collapsed" : "open");
  }, []);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  useEffect(() => {
    openRef.current = openItemId;
  }, [openItemId]);
  const [editor, setEditor] = useState<Editor>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState<ReportDraft | null>(null);
  const openReport = useCallback((d?: ReportDraft) => setReportDraft(d ?? {}), []);
  const closeReport = useCallback(() => setReportDraft(null), []);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const askAssistant = useCallback((q: string) => {
    // Suffix keeps repeated identical questions distinct.
    setAskSeed(`${q}\u200b${Date.now()}`);
    setPanel("assistant");
  }, []);
  const consumeAskSeed = useCallback(() => setAskSeed(null), []);
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
    const t = setTimeout(() => void saveSnapshot({ data: { ...base, alerts, items, collections, altGroups, storeSettings, budget, importLimitUsd, home: homePrefs }, at: Date.now(), currency }), 1200);
    return () => clearTimeout(t);
  }, [loading, offline, online, base, alerts, items, collections, altGroups, storeSettings, budget, currency, importLimitUsd, homePrefs]);

  // Recent client errors, for problem reports and the assistant's troubleshooting (lib/client-errors).
  useEffect(() => {
    installClientErrorCapture();
    recordNav(viewRef.current.type);
  }, []);

  // The app has its data: the phone boot screen can hand off.
  useEffect(() => {
    if (loading) return;
    markBooted();
    // Phones: warm the camera screens' code in idle time, so "Scan a barcode" / the receipt camera open fast.
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    const id = idle(() => prewarmScanners({ download: true }), { timeout: 4000 });
    return () => (window.cancelIdleCallback ?? clearTimeout)(id);
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
    // R14 B4: an old Urgent / Unsorted link → the filtered To buy (the address too).
    const legacy = params.get("v");
    if (legacy === "urgent" || legacy === "unsorted") {
      const url = new URL(window.location.href);
      url.searchParams.set("v", "to_buy");
      url.searchParams.set("f", legacy === "urgent" ? "urgent" : "none");
      window.history.replaceState(null, "", url);
    }
    const itemParam = params.get("item");
    if (itemParam) {
      setOpenItemId(itemParam);
      const url = new URL(window.location.href);
      url.searchParams.delete("item");
      window.history.replaceState(null, "", url);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [loading, ui.layout, ui.sort]);

  const applyView = useCallback((v: View) => {
    recordNav(v.type);
    if (v.type === "to_buy" || v.type === "ordered") {
      try {
        localStorage.setItem("nexus.shopTab", v.type);
      } catch {}
    }
    setNavDir(VIEW_ORDER.indexOf(v.type) >= VIEW_ORDER.indexOf(viewRef.current.type) ? 1 : -1);
    viewRef.current = v;
    setViewState(v);
    setNavSeq((n) => n + 1);
    setSelectedState(new Set());
    setTagFilter(null);
    setCategoryFilter(null);
    setCollectionFilter(null);
    setHistoryQuery("");
    setHistoryMonth(null);
    setHistoryStore(null);
    setNavOpen(false);
    setPlusOpen(false);
    window.scrollTo({ top: 0 });
    const url = new URL(window.location.href);
    const p = viewToParam(v);
    if (p === "home") url.searchParams.delete("v");
    else url.searchParams.set("v", p);
    if (v.type === "to_buy" && v.f) url.searchParams.set("f", v.f);
    else url.searchParams.delete("f");
    window.history.replaceState(null, "", url);
  }, []);
  const setView = useCallback((v: View) => {
    // Project page → Projects: the header's cover morphs back into its card (Round 10 A2; the way in is
    // project-cover.tsx openProject). Same view transition, reduced motion → plain.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (viewRef.current.type === "collection" && v.type === "projects" && doc.startViewTransition && document.querySelector("[data-project-header] [data-project-cover]") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      doc.startViewTransition(() => flushSync(() => applyView(v)));
      return;
    }
    applyView(v);
  }, [applyView]);

  // R16 B1: where the store is in the space's change feed.
  const revRef = useRef(initial.rev ?? 0);
  const getRev = useCallback(() => revRef.current, []);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const openRef = useRef<string | null>(null);
  const [present, setPresent] = useState<Map<string, "app" | "shopping">>(() => new Map());

  // R16 A12: a space switch swaps the whole data set in place (shell and sidebar stay mounted) and lands on Home.
  // keepView: the change feed's reset (same space, data reloaded) — nothing moves.
  const replaceData = useCallback(
    (next: AppData, opts?: { keepView?: boolean }) => {
      revRef.current = next.rev ?? 0;
      setItems(next.items);
      setCollections(next.collections);
      setAltGroups(next.altGroups);
      setStoreSettings(next.storeSettings);
      setBudget(next.budget);
      setAlerts(next.alerts ?? []);
      setHomePrefs(next.home ?? DEFAULT_HOME_PREFS);
      setImportLimitUsd(next.importLimitUsd ?? 130);
      setBase(next);
      if (opts?.keepView) {
        const ids = new Set(next.items.map((i) => i.id));
        if (openRef.current && !ids.has(openRef.current)) setOpenItemId(null);
        setSelectedState((prev) => new Set([...prev].filter((id) => ids.has(id))));
        return;
      }
      setPresent(new Map());
      setOpenItemId(null);
      setAltOpenId(null);
      setCompareItemId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("item");
      window.history.replaceState(window.history.state, "", url);
      applyView({ type: "home" });
    },
    [applyView],
  );

  /**
   * R16 B1: merge a changesSince result — upsert by id, remove tombstoned rows — without touching UI state (view,
   * selection, scroll, an open sheet shows the new values; an item removed under its open sheet closes it). Returns who
   * did what (B4 activity toasts).
   */
  const applyChanges = useCallback((ch: Changes): ChangeSummary => {
    const summary: ChangeSummary = { by: new Map(), closed: null };
    const tally = (by: string | null | undefined, k: keyof PersonTally) => {
      if (!by) return;
      const t = summary.by.get(by) ?? { added: 0, changed: 0, checked: 0, removed: 0 };
      t[k]++;
      summary.by.set(by, t);
    };
    const known = new Map(itemsRef.current.map((i) => [i.id, i]));
    for (const it of ch.items) {
      const was = known.get(it.id);
      if (!was) tally(it.revBy, "added");
      else if (it.status === "purchased" && was.status !== "purchased") tally(it.revBy, "checked");
      else tally(it.revBy, "changed");
    }
    const gone = (tbl: string) => new Set(ch.removed.filter((r) => r.tbl === tbl).map((r) => r.id));
    const goneItems = gone("items");
    for (const r of ch.removed) if (r.tbl === "items" && known.has(r.id)) tally(r.by, "removed");
    if (ch.items.length || goneItems.size)
      setItems((prev) => {
        const byId = new Map(ch.items.map((i) => [i.id, i]));
        const next = prev.filter((p) => !goneItems.has(p.id)).map((p) => byId.get(p.id) ?? p);
        const have = new Set(prev.map((p) => p.id));
        return [...ch.items.filter((i) => !have.has(i.id)), ...next];
      });
    if (goneItems.size) {
      setSelectedState((prev) => (Array.from(prev).some((id) => goneItems.has(id)) ? new Set([...prev].filter((id) => !goneItems.has(id))) : prev));
      if (openRef.current && goneItems.has(openRef.current)) {
        summary.closed = { by: ch.removed.find((r) => r.id === openRef.current)?.by ?? null };
        setOpenItemId(null);
      }
    }
    const merge = <T,>(prev: T[], rows: T[], drop: Set<string>, key: (x: T) => string) => {
      if (!rows.length && !drop.size) return prev;
      const byKey = new Map(rows.map((r) => [key(r), r]));
      const next = prev.filter((x) => !drop.has(key(x))).map((x) => byKey.get(key(x)) ?? x);
      const have = new Set(prev.map(key));
      return [...next, ...rows.filter((r) => !have.has(key(r)))];
    };
    const goneCols = gone("collections");
    if (ch.collections.length || goneCols.size) {
      setCollections((prev) => merge(prev, ch.collections, goneCols, (c) => c.id));
      if (goneCols.size) setItems((prev) => prev.map((i) => (i.collectionId && goneCols.has(i.collectionId) ? { ...i, collectionId: null } : i)));
    }
    setAltGroups((prev) => merge(prev, ch.altGroups, gone("alt_groups"), (g) => g.id));
    setStoreSettings((prev) => merge(prev, ch.storeSettings, gone("store_settings"), (x) => x.storeKey));
    const goneAlerts = gone("alerts");
    if (ch.alerts.length || goneAlerts.size) setAlerts((prev) => merge(prev, ch.alerts, goneAlerts, (a) => a.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60));
    if (ch.budget) setBudget(ch.budget);
    if (ch.importLimitUsd != null) setImportLimitUsd(ch.importLimitUsd);
    revRef.current = Math.max(revRef.current, ch.rev);
    return summary;
  }, []);

  const setLayout = useCallback((l: Layout) => {
    setLayoutState(l);
    setCookie(LAYOUT_COOKIE, l);
  }, []);
  const setPhoneLayout = useCallback((l: PhoneLayout) => {
    setPhoneLayoutState(l);
    setCookie(PHONE_LAYOUT_COOKIE, l);
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

  const fillImages = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setImagePending((p) => new Set([...p, ...ids]));
    void ensureImages(ids)
      .then((got) => {
        if (got.length)
          setItems((prev) => {
            const byId = new Map(got.map((i) => [i.id, i]));
            return prev.map((p) => byId.get(p.id) ?? p);
          });
      })
      .catch(() => {})
      .finally(() => setImagePending((p) => new Set([...p].filter((x) => !ids.includes(x)))));
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
      alerts,
      homePrefs,
      setHomePrefs,
      homeLayout,
      setHomeLayout,
      clock,
      shopSort,
      setShopSort,
      upsertItems,
      removeItems,
      selected,
      toggleSelect,
      setSelected,
      clearSelection,
      altOpenId,
      openAlt: setAltOpenId,
      rates: base.rates,
      aiEnabled: base.aiEnabled,
      currency,
      setCurrency,
      layout,
      setLayout,
      phoneLayout,
      setPhoneLayout,
      sort,
      setSort,
      view,
      setView,
      navSeq,
      navDir,
      query,
      setQuery,
      tagFilter,
      setTagFilter,
      categoryFilter,
      setCategoryFilter,
      collectionFilter,
      setCollectionFilter,
      historyQuery,
      setHistoryQuery,
      historyMonth,
      setHistoryMonth,
      historyStore,
      setHistoryStore,
      setPlusOpen,
      pasteOpen,
      setPasteOpen,
      scanner,
      setScanner,
      shop,
      setShop,
      imagePending,
      fillImages,
      compareItemId,
      setCompareItemId,
      importLimitUsd,
      spaceId: base.space?.id ?? "",
      admin: !!base.me?.admin,
      space: base.space ?? null,
      spaces: base.spaces ?? [],
      people: base.people ?? [],
      me: base.me ? { id: base.me.id ?? "", name: base.me.name, email: base.me.email } : null,
      readOnly: offlineAt != null || base.space?.role === "viewer",
      replaceData,
      getRev,
      applyChanges,
      present,
      setPresent,
      setImportLimitUsd,
      sidebarCollapsed,
      setSidebarCollapsed,
      upsertItem,
      removeItem,
      setItems,
      upsertCollection,
      removeCollection,
      openItem: setOpenItemId,
      editor,
      setEditor,
      paletteOpen,
      setPaletteOpen,
      navOpen,
      settingsOpen,
      setSettingsOpen,
      extOpen,
      reportDraft,
      openReport,
      closeReport,
      reportsOpen,
      setReportsOpen,
      meOpen,
      setMeOpen,
      panel,
      setPanel,
      askSeed,
      askAssistant,
      consumeAskSeed,
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
    [loading, pending, addPending, patchPending, dropPending, fresh, markFresh, base, replaceData, getRev, applyChanges, present, items, collections, altGroups, upsertAltGroup, storeSettings, upsertStoreSetting, budget, alerts, homePrefs, homeLayout, setHomeLayout, clock, shopSort, setShopSort, upsertItems, removeItems, selected, toggleSelect, setSelected, clearSelection, altOpenId, currency, setCurrency, layout, setLayout, phoneLayout, setPhoneLayout, sort, setSort, view, setView, navSeq, navDir, query, tagFilter, categoryFilter, collectionFilter, historyQuery, historyMonth, historyStore, pasteOpen, scanner, setScanner, shop, imagePending, fillImages, compareItemId, importLimitUsd, sidebarCollapsed, setSidebarCollapsed, upsertItem, removeItem, upsertCollection, removeCollection, editor, paletteOpen, navOpen, settingsOpen, extOpen, reportDraft, openReport, closeReport, reportsOpen, meOpen, panel, askSeed, askAssistant, consumeAskSeed, receiptSeed, openReceipt, offlineAt, offline, focusAdd],
  );

  const dataValue = useMemo(
    () => value,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only the data the cards read
    [items, collections, altGroups, base.rates, currency, selected, toggleSelect, fresh, imagePending, offlineAt, offline, importLimitUsd, storeSettings],
  );

  return (
    <Ctx.Provider value={value}>
      <DataCtx.Provider value={dataValue}>
        <OpenItemCtx.Provider value={openItemId}>{children}</OpenItemCtx.Provider>
      </DataCtx.Provider>
    </Ctx.Provider>
  );
}
