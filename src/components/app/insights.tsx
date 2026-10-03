"use client";

import { useMemo } from "react";
import { ChevronDown, History, Search, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { Segmented } from "./settings-dialog";
import { useStore } from "./store";
import { COLLECTION_COLORS, historyMonthOf, historyStoreOf, itemsForView, matchesQuery } from "./view-items";

export function monthLabel(key: string, locale: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { month: "long", year: "numeric" });
}

/** Phone / tablet: the dock's last tab is "Insights" — Spending · History at the top of both views (Round 11 B2). */
export function InsightsSwitch() {
  const s = useStore();
  const { t } = useI18n();
  const value = s.view.type === "history" ? "history" : "spending";
  return (
    <div className="mb-4 lg:hidden" data-insights-switch={value}>
      <Segmented<"spending" | "history">
        label={t.insights.title}
        value={value}
        onChange={(v) => v !== value && s.setView({ type: v })}
        options={[
          { value: "spending", label: t.insights.spending },
          { value: "history", label: t.insights.history },
        ]}
      />
    </div>
  );
}

/** History: search bought items + Month / Store / Project filters. */
export function HistoryTools() {
  const s = useStore();
  const { t, locale } = useI18n();
  const bought = useMemo(() => itemsForView(s.items, { type: "history" }), [s.items]);
  const months = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of bought) {
      const k = historyMonthOf(i);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  }, [bought]);
  const stores = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const i of bought) {
      const src = historyStoreOf(i);
      if (!src) continue;
      const cur = m.get(src.storeKey);
      m.set(src.storeKey, { name: cur?.name ?? src.store, n: (cur?.n ?? 0) + 1 });
    }
    return [...m].sort((a, b) => b[1].n - a[1].n);
  }, [bought]);
  const projects = useMemo(() => {
    const ids = new Set(bought.map((i) => i.collectionId).filter(Boolean));
    return s.collections.filter((c) => ids.has(c.id));
  }, [bought, s.collections]);

  const dd = (on: boolean) =>
    cn(
      "flex h-10 shrink-0 items-center gap-1.5 rounded-full pe-3 ps-4 text-[13px] font-semibold transition active:scale-[0.97]",
      on ? "bg-ink text-bg" : "bg-surface-2 text-ink hover:bg-line",
    );
  const storeName = stores.find(([k]) => k === s.historyStore)?.[1].name;
  const project = projects.find((c) => c.id === s.collectionFilter);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-history-tools>
      <label className="flex h-10 min-w-0 flex-[1_1_220px] items-center gap-2 rounded-full border border-line bg-surface pe-1 ps-4 text-muted">
        <Search className="size-[17px] shrink-0" />
        <input
          value={s.historyQuery}
          onChange={(e) => s.setHistoryQuery(e.target.value)}
          placeholder={t.insights.search}
          aria-label={t.insights.search}
          enterKeyHint="search"
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
          data-history-search
        />
        {s.historyQuery && (
          <button type="button" onClick={() => s.setHistoryQuery("")} className="grid size-8 place-items-center rounded-full hover:bg-surface-2" aria-label={t.phone.closeSearch}>
            <X className="size-4" />
          </button>
        )}
      </label>
      <div className="flex min-w-0 gap-2 overflow-x-auto [scrollbar-width:none]">
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={dd(!!s.historyMonth)} data-history-month-filter>
              <span className="max-w-[16ch] truncate">{s.historyMonth ? monthLabel(s.historyMonth, locale) : t.insights.month}</span>
              <ChevronDown className="size-[15px] opacity-60" strokeWidth={2.4} />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuRadioGroup value={s.historyMonth ?? ""} onValueChange={(v) => s.setHistoryMonth(v || null)}>
              <MenuRadioItem value="">{t.insights.allMonths}</MenuRadioItem>
              {months.map(([k, n]) => (
                <MenuRadioItem key={k} value={k}>
                  <span className="flex-1">{monthLabel(k, locale)}</span>
                  <span className="tabular ms-3 text-xs text-muted">{n}</span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        {stores.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <button type="button" className={dd(!!s.historyStore)} data-history-store-filter>
                <span className="bidi max-w-[14ch] truncate">{storeName ?? t.insights.store}</span>
                <ChevronDown className="size-[15px] opacity-60" strokeWidth={2.4} />
              </button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuRadioGroup value={s.historyStore ?? ""} onValueChange={(v) => s.setHistoryStore(v || null)}>
                <MenuRadioItem value="">{t.insights.all}</MenuRadioItem>
                {stores.map(([k, v]) => (
                  <MenuRadioItem key={k} value={k}>
                    <span className="bidi flex-1">{v.name}</span>
                    <span className="tabular ms-3 text-xs text-muted">{v.n}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}
        {projects.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <button type="button" className={dd(!!project)} data-history-project-filter>
                {project && <i className={cn("size-[9px] shrink-0", project.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[project.color] }} />}
                <span className="bidi max-w-[14ch] truncate">{project?.name ?? t.insights.project}</span>
                <ChevronDown className="size-[15px] opacity-60" strokeWidth={2.4} />
              </button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuRadioGroup value={s.collectionFilter ?? ""} onValueChange={(v) => s.setCollectionFilter(v || null)}>
                <MenuRadioItem value="">{t.insights.all}</MenuRadioItem>
                {projects.map((c) => (
                  <MenuRadioItem key={c.id} value={c.id}>
                    <span className="bidi flex-1">{c.name}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}
      </div>
    </div>
  );
}

/** Searching another view: bought items that match too → a way to History, with the search carried over. */
export function HistoryHint() {
  const s = useStore();
  const { t, f } = useI18n();
  const n = useMemo(() => (s.query.trim() && s.view.type !== "history" ? itemsForView(s.items, { type: "history" }).filter((i) => matchesQuery(i, s.query)).length : 0), [s.items, s.query, s.view.type]);
  if (!n) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const q = s.query;
        s.setView({ type: "history" });
        s.setHistoryQuery(q);
        s.setQuery("");
      }}
      className="mb-4 flex min-h-11 w-full items-center gap-3 rounded-[18px] border border-line bg-surface px-4 py-2.5 text-start transition hover:bg-surface-2"
      data-go-history
    >
      <History className="size-[18px] shrink-0 text-muted" />
      <span className="min-w-0 flex-1 text-[14px] text-muted">{n === 1 ? t.insights.inHistoryOne : f(t.insights.inHistory, { n })}</span>
      <b className="shrink-0 text-[14px] font-bold">{t.insights.goHistory}</b>
    </button>
  );
}
