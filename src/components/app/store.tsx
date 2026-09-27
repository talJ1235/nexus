"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CURRENCY_COOKIE, type Currency, type Rates } from "@/lib/money";
import type { AppData, Collection, ItemWithSources } from "@/lib/types";
import type { View } from "@/lib/views";

export type { View };

export type Layout = "cards" | "table";
export type SortKey = "newest" | "price" | "priority" | "name";

type Editor = { mode: "create"; kind: "project" | "list" } | { mode: "edit"; collection: Collection } | null;

type Store = {
  items: ItemWithSources[];
  collections: Collection[];
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
  setNavOpen: (o: boolean) => void;
  focusAdd: () => void;
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
  if (p === "urgent" || p === "history" || p === "unsorted") return { type: p };
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
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [layout, setLayoutState] = useState<Layout>("cards");
  const [sort, setSortState] = useState<SortKey>("newest");
  const [view, setViewState] = useState<View>({ type: "to_buy" });
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Restore per-device UI prefs + view from URL after mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from browser-only storage */
    setLayoutState(readLocal("nexus.layout", ["cards", "table"] as const, "cards"));
    setSortState(readLocal("nexus.sort", ["newest", "price", "priority", "name"] as const, "newest"));
    setViewState(paramToView(new URLSearchParams(window.location.search).get("v")));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const setView = useCallback((v: View) => {
    setViewState(v);
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

  const focusAdd = useCallback(() => {
    document.getElementById("add-input")?.focus();
  }, []);

  const value = useMemo<Store>(
    () => ({
      items,
      collections,
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
      setNavOpen,
      focusAdd,
    }),
    [items, collections, initial.rates, initial.aiEnabled, currency, setCurrency, layout, setLayout, sort, setSort, view, setView, query, tagFilter, upsertItem, removeItem, upsertCollection, removeCollection, openItemId, editor, paletteOpen, navOpen, focusAdd],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
