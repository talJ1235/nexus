"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CURRENCY_COOKIE, type Currency, type Rates } from "@/lib/money";
import type { AltGroup, AppData, Collection, ItemWithSources } from "@/lib/types";
import type { View } from "@/lib/views";

export type { View };

export type Panel = "import" | "planner" | "assistant" | "alerts" | "share" | null;

export type Layout = "cards" | "table";

/** A pasted link that is still being read (or failed): shown as a placeholder card/row until the item exists. */
export type PendingAdd = { id: string; label: string; url: string | null; state: "working" | "failed"; collectionId: string | null; retry?: () => void };
export type SortKey = "newest" | "price" | "priority" | "name";

type Editor = { mode: "create"; kind: "project" | "list" } | { mode: "edit"; collection: Collection } | null;

type Store = {
  items: ItemWithSources[];
  collections: Collection[];
  altGroups: AltGroup[];
  setAltGroups: (g: AltGroup[]) => void;
  upsertAltGroup: (g: AltGroup) => void;
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
  if (["urgent", "history", "unsorted", "ordered", "orders", "spending"].includes(p)) return { type: p } as View;
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

export function StoreProvider({ initial, initialCurrency, children }: { initial: AppData; initialCurrency: Currency; children: React.ReactNode }) {
  const [items, setItems] = useState(initial.items);
  const [collections, setCollections] = useState(initial.collections);
  const [altGroups, setAltGroups] = useState(initial.altGroups);
  const [selected, setSelectedState] = useState<Set<string>>(() => new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [altOpenId, setAltOpenId] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [layout, setLayoutState] = useState<Layout>("cards");
  const [sort, setSortState] = useState<SortKey>("newest");
  const [view, setViewState] = useState<View>({ type: "to_buy" });
  const [navSeq, setNavSeq] = useState(0);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
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

  // Restore per-device UI prefs + view from URL after mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from browser-only storage */
    setLayoutState(readLocal("nexus.layout", ["cards", "table"] as const, "cards"));
    setSortState(readLocal("nexus.sort", ["newest", "price", "priority", "name"] as const, "newest"));
    const params = new URLSearchParams(window.location.search);
    setViewState(paramToView(params.get("v")));
    const itemParam = params.get("item");
    if (itemParam) {
      setOpenItemId(itemParam);
      const url = new URL(window.location.href);
      url.searchParams.delete("item");
      window.history.replaceState(null, "", url);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const setView = useCallback((v: View) => {
    setViewState(v);
    setNavSeq((n) => n + 1);
    setSelectedState(new Set());
    setTagFilter(null);
    setNavOpen(false);
    const url = new URL(window.location.href);
    const p = viewToParam(v);
    if (p === "to_buy") url.searchParams.delete("v");
    else url.searchParams.set("v", p);
    window.history.replaceState(null, "", url);
  }, []);

  const setLayout = useCallback((l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem("nexus.layout", l);
    } catch {}
  }, []);
  const setSort = useCallback((s: SortKey) => {
    setSortState(s);
    try {
      localStorage.setItem("nexus.sort", s);
    } catch {}
  }, []);
  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    document.cookie = `${CURRENCY_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax`;
  }, []);

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
      items,
      collections,
      altGroups,
      setAltGroups,
      upsertAltGroup,
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
    [pending, addPending, patchPending, dropPending, fresh, markFresh, items, collections, altGroups, upsertAltGroup, upsertItems, removeItems, selected, toggleSelect, setSelected, clearSelection, altOpenId, initial.rates, initial.aiEnabled, currency, setCurrency, layout, setLayout, sort, setSort, view, setView, navSeq, query, tagFilter, upsertItem, removeItem, upsertCollection, removeCollection, openItemId, editor, paletteOpen, navOpen, settingsOpen, extOpen, panel, askSeed, askAssistant, focusAdd],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
