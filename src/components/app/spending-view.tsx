"use client";

import { useMemo, useState } from "react";
import { Store } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { StoreMark } from "@/components/ui/store-mark";
import { Ticker } from "@/components/ui/ticker";
import { capFor, monthKey } from "@/lib/budget";
import { activeSource, lineTotal, sourceTotal, spendDate } from "@/lib/calc";
import { normalizeCategory } from "@/lib/categories";
import { convert, formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MonthBudget } from "./budget-card";
import { ProductImage } from "./item-card";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";

type Row = { key: string; label: string; value: number; dot?: string; mark?: { store: string; storeKey: string; url: string | null } };

function Card({ title, children, className, delay = 0 }: { title?: string; children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <section className={cn("rise-in rounded-[26px] border border-line bg-surface p-5", className)} style={{ animationDelay: `${delay}ms` }}>
      {title && <h3 className="mb-4 text-[15px] font-extrabold">{title}</h3>}
      {children}
    </section>
  );
}

function Tile({ label, value, fmt, sub, delay }: { label: string; value: number; fmt: (v: number) => string; sub?: string; delay?: number }) {
  return (
    <div className="rise-in rounded-[22px] border border-line bg-surface p-4 lg:rounded-[26px]" style={{ animationDelay: `${delay ?? 0}ms` }}>
      <div className="text-xs font-semibold text-muted">{label}</div>
      <Ticker value={value} format={fmt} className="mt-1.5 block text-[24px] font-black leading-none tracking-[-0.02em] lg:text-[30px]" />
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Ranked horizontal bars that grow in; identity comes from the dot / store mark, the bar is one hue. */
function RankBars({ rows, fmt }: { rows: Row[]; fmt: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${fmt(r.value)}`}>
          <span className="flex min-w-0 items-center gap-2">
            {r.mark ? <StoreMark store={r.mark.store} storeKey={r.mark.storeKey} url={r.mark.url} size={20} /> : r.dot && <span className="size-2.5 shrink-0 rounded-[4px]" style={{ background: r.dot }} />}
            <span className="truncate font-medium bidi">{r.label}</span>
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <span className="grow-x block h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.dot ?? "var(--brand)", animationDelay: `${150 + i * 50}ms` }} />
          </span>
          <span className="tabular text-end font-semibold">{fmt(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Spend per month; bars grow in once; a tick marks the cap that month had (bars over it turn red). */
function MonthBars({ months, fmt, locale, capLabel }: { months: { at: Date; value: number; cap: number | null }[]; fmt: (v: number) => string; locale: string; capLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => Math.max(m.value, m.cap ?? 0)));
  const label = (d: Date) => d.toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { month: "short" });
  return (
    <div className="relative" dir="ltr">
      <div className="flex h-48 items-end gap-1.5 border-b border-line" onMouseLeave={() => setHover(null)}>
        {months.map((m, i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            aria-label={`${label(m.at)} ${m.at.getFullYear()}: ${fmt(m.value)}${m.cap != null ? ` · ${capLabel.replace("{amount}", fmt(m.cap))}` : ""}`}
            className="group relative flex h-full flex-1 items-end outline-none"
          >
            <span
              className={cn(
                "grow-y block w-full rounded-t-[8px] rounded-b-[3px] transition-[height,background-color,opacity] duration-300",
                m.value <= 0 ? "bg-transparent" : m.cap != null && m.value > m.cap ? "bg-danger" : "bg-brand",
                hover != null && hover !== i && "opacity-50",
              )}
              style={{ height: `${m.value > 0 ? Math.max(3, (m.value / max) * 100) : 0}%`, animationDelay: `${i * 35}ms` }}
            />
            {m.cap != null && <span aria-hidden data-cap-tick className="absolute inset-x-0 h-0.5 rounded-full bg-ink/60" style={{ bottom: `${(m.cap / max) * 100}%` }} />}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-[11px] text-muted">
        {months.map((m, i) => (
          <span key={i} className={cn("flex-1 text-center", hover === i && "font-semibold text-ink")}>
            {label(m.at)}
          </span>
        ))}
      </div>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[14px] border border-line bg-surface px-3 py-2 text-xs shadow-pop"
          style={{ left: `${((hover + 0.5) / months.length) * 100}%` }}
        >
          <div className="tabular font-bold">{fmt(months[hover].value)}</div>
          <div className="text-muted">
            {label(months[hover].at)} {months[hover].at.getFullYear()}
          </div>
          {months[hover].cap != null && <div className="tabular text-muted">{capLabel.replace("{amount}", fmt(months[hover].cap!))}</div>}
        </div>
      )}
    </div>
  );
}

/** Saved by buying at the cheaper store: priciest known store total vs the one bought from, × qty. */
function savingOf(i: ItemWithSources, rates: Parameters<typeof activeSource>[1], currency: string) {
  const src = activeSource(i, rates);
  const paid = src ? sourceTotal(src) : null;
  if (!src || paid == null) return 0;
  const totals = i.sources.map((x) => (sourceTotal(x) == null ? null : convert(sourceTotal(x)!, x.currency, currency, rates))).filter((v): v is number => v != null);
  if (totals.length < 2) return 0;
  return Math.max(0, Math.max(...totals) - convert(paid, src.currency, currency, rates)) * i.quantity;
}

export function SpendingView() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const fmt = (v: number) => formatMoney(Math.round(v), s.currency, locale);

  const data = useMemo(() => {
    const spent = s.items
      .filter((i) => i.status !== "to_buy")
      .map((i) => ({ item: i, at: spendDate(i) ?? i.updatedAt, value: lineTotal(i, s.rates, s.currency) ?? 0 }));
    const now = new Date();
    const monthStart = (y: number, m: number) => new Date(y, m, 1).getTime();
    const thisMonth = monthStart(now.getFullYear(), now.getMonth());
    const lastMonth = monthStart(now.getFullYear(), now.getMonth() - 1);
    const thisYear = monthStart(now.getFullYear(), 0);
    const sum = (from: number, to = Infinity) => spent.filter((x) => x.at >= from && x.at < to).reduce((a, x) => a + x.value, 0);

    const months = Array.from({ length: 12 }, (_, k) => {
      const at = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1);
      const end = new Date(at.getFullYear(), at.getMonth() + 1, 1).getTime();
      const cap = capFor(monthKey(at), s.budget);
      return { at, value: sum(at.getTime(), end), cap: cap ? convert(cap.cap!, cap.currency, s.currency, s.rates) : null };
    });

    const byCollection = new Map<string, number>();
    const byStore = new Map<string, Row>();
    const byCategory = new Map<string, number>();
    let savings = 0;
    for (const x of spent) {
      const key = x.item.collectionId ?? "";
      byCollection.set(key, (byCollection.get(key) ?? 0) + x.value);
      const src = activeSource(x.item, s.rates);
      const sk = src?.storeKey ?? "—";
      const e = byStore.get(sk) ?? { key: sk, label: src?.store ?? "—", value: 0, mark: src ? { store: src.store, storeKey: src.storeKey, url: src.url } : undefined };
      e.value += x.value;
      byStore.set(sk, e);
      const cat = normalizeCategory(x.item.category) ?? "other";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + x.value);
      savings += savingOf(x.item, s.rates, s.currency);
    }
    const top = <T extends Row>(rows: T[], n = 6) => rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, n);
    const projects = top(
      [...byCollection.entries()].map(([k, v]) => {
        const c = s.collections.find((x) => x.id === k);
        return { key: k || "none", label: c?.name ?? t.spending.unsorted, value: v, dot: c ? COLLECTION_COLORS[c.color] : "var(--line-strong)" };
      }),
    );
    const stores = top([...byStore.values()]);
    const categories = top([...byCategory.entries()].map(([k, v]) => ({ key: k, label: t.categories[k as keyof typeof t.categories] ?? k, value: v })), 5);
    const biggest = spent.filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
    return { count: spent.length, thisMonth: sum(thisMonth), lastMonth: sum(lastMonth, thisMonth), thisYear: sum(thisYear), months, projects, stores, categories, biggest, savings };
  }, [s.items, s.rates, s.currency, s.collections, s.budget, t]);

  return (
    <div data-stats>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{t.spending.title}</h1>
          <p className="mt-1 text-sm text-muted">{t.spending.note}</p>
        </div>
        <Button variant="outline" className="h-10" onClick={() => s.setView({ type: "orders" })} data-stats-orders>
          <Store /> {t.nav.orders}
        </Button>
      </div>
      <div className="mb-4">
        <MonthBudget />
      </div>
      {data.count === 0 ? (
        <div className="load-in grid place-items-center rounded-[26px] border border-dashed border-line-strong px-6 py-20 text-center text-[15px] text-muted">{t.spending.empty}</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t.spending.thisMonth} value={data.thisMonth} fmt={fmt} delay={60} />
            <Tile label={t.spending.lastMonth} value={data.lastMonth} fmt={fmt} delay={100} />
            <Tile label={t.spending.thisYear} value={data.thisYear} fmt={fmt} delay={140} />
            <Tile label={t.spending.savings} value={data.savings} fmt={fmt} sub={t.spending.savingsHint} delay={180} />
          </div>
          <Card title={t.spending.byMonth} delay={120}>
            <MonthBars months={data.months} fmt={fmt} locale={locale} capLabel={t.budget.capLine} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t.spending.byProject} delay={160}>
              <RankBars rows={data.projects} fmt={fmt} />
            </Card>
            <Card title={t.spending.byStore} delay={200}>
              <RankBars rows={data.stores} fmt={fmt} />
            </Card>
            <Card title={t.spending.topCategories} delay={240}>
              <RankBars rows={data.categories} fmt={fmt} />
            </Card>
            <Card title={t.spending.biggest} delay={280}>
              <ul className="space-y-2">
                {data.biggest.map((x) => (
                  <li key={x.item.id}>
                    <button type="button" onClick={() => s.openItem(x.item.id)} className="flex w-full items-center gap-3 rounded-[16px] p-1 text-start transition hover:bg-surface-2">
                      <ProductImage src={x.item.imageUrl} alt="" className="size-11 shrink-0 rounded-[13px]" iconClass="size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold bidi">{x.item.title}</span>
                        <span className="block text-xs text-muted">{new Date(x.at).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                      </span>
                      <span className="tabular text-sm font-extrabold">{fmt(x.value)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {data.count > 5 && <p className="mt-2 text-xs text-muted">{f(t.spending.ofCount, { n: data.count })}</p>}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
