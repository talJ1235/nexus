"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/components/providers";
import { activeSource, lineTotal, spendDate } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";

type Row = { key: string; label: string; value: number; dot?: string };

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em]">{value}</div>
      {sub && <div className="mt-2 text-xs text-faint">{sub}</div>}
    </div>
  );
}

/** Ranked horizontal bars — one hue; identity comes from the label, not the bar color. */
function RankBars({ title, rows, fmt }: { title: string; rows: Row[]; fmt: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${fmt(r.value)}`}>
            <span className="flex min-w-0 items-center gap-1.5">
              {r.dot && <span className="size-2 shrink-0 rounded-full" style={{ background: r.dot }} />}
              <span className="truncate text-muted bidi">
                {r.label}
              </span>
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="tabular text-end font-medium">{fmt(r.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MonthBars({ months, fmt, locale }: { months: { at: Date; value: number }[]; fmt: (v: number) => string; locale: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.value));
  const label = (d: Date) => d.toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { month: "short" });
  return (
    <div className="relative" dir="ltr">
      <div className="flex h-44 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
        {months.map((m, i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            aria-label={`${label(m.at)} ${m.at.getFullYear()}: ${fmt(m.value)}`}
            className="group relative flex h-full flex-1 items-end outline-none"
          >
            <span
              className={cn("block w-full rounded-t-[4px] transition-[height,background-color] duration-300", m.value > 0 ? (hover === i ? "bg-accent-strong" : "bg-accent") : "bg-transparent")}
              style={{ height: `${m.value > 0 ? Math.max(3, (m.value / max) * 100) : 0}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[11px] text-faint">
        {months.map((m, i) => (
          <span key={i} className={cn("flex-1 text-center", hover === i && "text-fg")}>
            {label(m.at)}
          </span>
        ))}
      </div>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs shadow-pop"
          style={{ left: `${((hover + 0.5) / months.length) * 100}%` }}
        >
          <div className="tabular font-semibold">{fmt(months[hover].value)}</div>
          <div className="text-muted">
            {label(months[hover].at)} {months[hover].at.getFullYear()}
          </div>
        </div>
      )}
    </div>
  );
}

export function SpendingView() {
  const s = useStore();
  const { t, locale } = useI18n();
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
      return { at, value: sum(at.getTime(), end) };
    });

    const byCollection = new Map<string, number>();
    const byStore = new Map<string, { label: string; value: number }>();
    for (const x of spent) {
      const key = x.item.collectionId ?? "";
      byCollection.set(key, (byCollection.get(key) ?? 0) + x.value);
      const src = activeSource(x.item, s.rates);
      const sk = src?.storeKey ?? "—";
      const e = byStore.get(sk) ?? { label: src?.store ?? "—", value: 0 };
      e.value += x.value;
      byStore.set(sk, e);
    }
    const projects: Row[] = [...byCollection.entries()]
      .map(([k, v]) => {
        const c = s.collections.find((x) => x.id === k);
        return { key: k || "none", label: c?.name ?? t.spending.unsorted, value: v, dot: c ? COLLECTION_COLORS[c.color] : undefined };
      })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const stores: Row[] = [...byStore.entries()]
      .map(([k, v]) => ({ key: k, label: v.label, value: v.value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    return { count: spent.length, thisMonth: sum(thisMonth), lastMonth: sum(lastMonth, thisMonth), thisYear: sum(thisYear), months, projects, stores };
  }, [s.items, s.rates, s.currency, s.collections, t.spending.unsorted]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t.spending.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.spending.note}</p>
      </div>
      {data.count === 0 ? (
        <div className="load-in grid place-items-center rounded-2xl border border-dashed border-line-strong px-6 py-20 text-center text-[15px] text-muted">{t.spending.empty}</div>
      ) : (
        <div className="load-in space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label={t.spending.thisMonth} value={fmt(data.thisMonth)} />
            <Tile label={t.spending.lastMonth} value={fmt(data.lastMonth)} />
            <Tile label={t.spending.thisYear} value={fmt(data.thisYear)} />
          </div>
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h3 className="mb-4 text-sm font-semibold">{t.spending.byMonth}</h3>
            <MonthBars months={data.months} fmt={fmt} locale={locale} />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <RankBars title={t.spending.byProject} rows={data.projects} fmt={fmt} />
            <RankBars title={t.spending.byStore} rows={data.stores} fmt={fmt} />
          </div>
        </div>
      )}
    </div>
  );
}
