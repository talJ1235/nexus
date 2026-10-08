"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "@/lib/toast";
import { saveMonthlyBudget } from "@/app/money-actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Pop, PopContent, PopTrigger } from "@/components/ui/overlays";
import { Ring } from "@/components/ui/ring";
import { Ticker } from "@/components/ui/ticker";
import { PHONE, useMedia } from "@/components/ui/use-media";
import { capFor, monthForecast, monthKey } from "@/lib/budget";
import { CURRENCIES, formatMoney, formatMoneyCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { useConflictToast } from "./conflicts";
import { isConflict } from "@/lib/conflict";

const NORMAL_KEY = "nexus.budget.normal";

/** Amount + currency + Save. Used in Settings and in the Spending view's popover. */
export function BudgetEditor({ onSaved, autoFocus }: { onSaved?: () => void; autoFocus?: boolean }) {
  const s = useStore();
  const conflict = useConflictToast();
  const { t } = useI18n();
  const cur = capFor(monthKey(new Date()), s.budget);
  const [amount, setAmount] = useState(cur?.cap != null ? String(cur.cap) : "");
  const [currency, setCurrency] = useState(cur?.currency ?? s.currency);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = amount.trim() ? Number(amount) : null;
    if (v != null && !(v > 0)) return;
    setBusy(true);
    try {
      // R16 B3: against the cap this screen showed.
      const res = await saveMonthlyBudget(v, currency, cur?.cap ?? null);
      if (isConflict<typeof s.budget>(res)) {
        s.setBudget(res.row);
        conflict.one(res.by, { applyMine: () => void saveMonthlyBudget(v, currency).then(s.setBudget, () => toast.error(t.errors.generic)) });
        return;
      }
      s.setBudget(res);
      toast.success(t.budget.saved);
      onSaved?.();
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex gap-2"
    >
      <div className="flex min-w-0 flex-1">
        <Input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t.budget.none}
          aria-label={t.budget.cap}
          name="monthlyBudget"
          autoFocus={autoFocus}
          className="tabular min-w-0 rounded-e-none"
        />
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 rounded-e-lg border border-s-0 border-line-strong bg-sunken px-2 text-sm text-fg outline-none" aria-label={t.item.currency}>
          {[...new Set([...CURRENCIES, currency])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="accent" disabled={busy}>
        {t.item.save}
      </Button>
    </form>
  );
}

function readNormal() {
  try {
    return localStorage.getItem(NORMAL_KEY) === "1";
  } catch {
    return false;
  }
}

/** This month: received + ordered + forecast (urgent, optionally normal to-buy) against the monthly cap. */
export function MonthBudget() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [includeNormal, setIncludeNormal] = useState(false);
  // Per-device toggle, read after hydration (the server can't see localStorage).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from browser-only storage
  useEffect(() => setIncludeNormal(readNormal()), []);
  const [editOpen, setEditOpen] = useState(false);
  const m = (v: number) => formatMoney(Math.round(v), s.currency, locale);
  // Phones: big amounts compact (₪12.4K) so the hero number, ring and button share one row.
  const phone = useMedia(PHONE);
  const mK = (v: number) => (phone ? formatMoneyCompact(Math.round(v), s.currency, locale) : m(v));

  const fc = useMemo(() => {
    const now = new Date();
    return monthForecast({
      items: s.items,
      altGroups: s.altGroups,
      rates: s.rates,
      currency: s.currency,
      from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
      cap: capFor(monthKey(now), s.budget),
      includeNormal,
    });
  }, [s.items, s.altGroups, s.rates, s.currency, s.budget, includeNormal]);

  const toggleNormal = () => {
    const next = !includeNormal;
    setIncludeNormal(next);
    try {
      localStorage.setItem(NORMAL_KEY, next ? "1" : "0");
    } catch {
      // per-device convenience only
    }
  };

  // Bar scale: the cap, or the total once it's over (then a marker shows where the cap is).
  const scale = Math.max(fc.cap ?? 0, fc.total, 1);
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const segs = [
    { key: "spent", value: fc.spent, label: t.budget.spent, cls: "bg-white" },
    { key: "committed", value: fc.committed, label: t.budget.committed, cls: "bg-spark" },
    { key: "forecast", value: fc.forecast, label: includeNormal ? t.budget.forecastAll : t.budget.forecast, cls: fc.state === "over" ? "bg-[var(--hero-danger)]" : "bg-white/40" },
  ];
  const status =
    fc.state === "over"
      ? f(t.budget.over, { amount: m(fc.total - fc.cap!) })
      : fc.state === "near"
        ? f(t.budget.near, { pct: Math.round(fc.pct ?? 0) })
        : fc.state === "ok"
          ? f(t.budget.left, { amount: m(fc.cap! - fc.total) })
          : null;

  const ringPct = fc.cap ? Math.min(1, fc.total / fc.cap) : 0;
  return (
    <section data-month-budget={fc.state} className="rise-in min-w-0 rounded-[30px] bg-[image:var(--hero)] p-5 text-on-hero lg:px-[26px] lg:py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] opacity-75">{t.budget.title}</h3>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <Ticker value={fc.total} format={mK} className="text-[36px] font-black leading-[0.95] tracking-[-0.03em] sm:text-[44px] lg:text-[56px]" />
            {fc.cap != null && <span className="text-sm opacity-70">{f(t.budget.of, { amount: mK(fc.cap) })}</span>}
          </div>
          {status && <div className={cn("tabular mt-2 text-sm font-semibold", fc.state === "over" ? "text-[var(--hero-danger)]" : "opacity-85")}>{status}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          {fc.cap != null && (
            <Ring value={ringPct} size={phone ? 52 : 64} stroke={phone ? 7 : 8} color={fc.state === "over" ? "var(--hero-danger)" : "var(--spark)"} track="rgb(255 255 255 / 0.16)">
              <span className="tabular text-[13px] font-extrabold">{Math.round(fc.pct ?? 0)}%</span>
            </Ring>
          )}
          <Pop open={editOpen} onOpenChange={setEditOpen}>
            <PopTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 bg-white/15 text-on-hero hover:bg-white/25 hover:text-on-hero max-sm:size-10 max-sm:px-0"
                aria-label={fc.cap == null ? t.budget.set : t.budget.edit}
                data-budget-edit
              >
                <Pencil />
                <span className="max-sm:sr-only">{fc.cap == null ? t.budget.set : t.budget.edit}</span>
              </Button>
            </PopTrigger>
            <PopContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-2">
              <div className="text-sm font-medium">{t.budget.cap}</div>
              <p className="text-xs leading-relaxed text-muted">{t.budget.capHint}</p>
              <BudgetEditor autoFocus onSaved={() => setEditOpen(false)} />
            </PopContent>
          </Pop>
        </div>
      </div>

      <div className="relative mt-5">
        <div className="flex h-3 gap-1 overflow-hidden rounded-full bg-white/12" role="img" aria-label={`${t.budget.title}: ${m(fc.total)}${fc.cap != null ? ` / ${m(fc.cap)}` : ""}`}>
          {segs.map((sg, i) => (
            <div key={sg.key} className={cn("grow-x h-full rounded-full", sg.cls)} style={{ width: pct(sg.value), animationDelay: `${200 + i * 80}ms` }} />
          ))}
        </div>
        {fc.cap != null && fc.total > fc.cap && <span aria-hidden className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-white" style={{ insetInlineStart: pct(fc.cap) }} />}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        {segs.map((sg) => (
          <span key={sg.key} className="flex items-center gap-1.5 opacity-90">
            <span className={cn("size-[9px] rounded-[3px]", sg.cls)} /> {sg.label} <b className="tabular font-bold">{mK(sg.value)}</b>
          </span>
        ))}
        {fc.unpriced > 0 && <span className="text-xs opacity-70">{f(t.budget.unpriced, { n: fc.unpriced })}</span>}
      </div>

      <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-3 text-sm opacity-85">
        <button
          type="button"
          role="switch"
          aria-checked={includeNormal}
          onClick={toggleNormal}
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition", includeNormal ? "bg-spark" : "bg-white/25")}
        >
          <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start]", includeNormal ? "start-[22px]" : "start-0.5")} />
        </button>
        {t.budget.includeNormal}
      </label>
    </section>
  );
}
