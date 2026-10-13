"use client";

import { Minus, Plus } from "lucide-react";
import { useI18n } from "@/components/providers";
import { measure } from "@/lib/grocery/weights";
import { cn } from "@/lib/utils";
import { unitWord } from "./qty";

// R18 S2 B1/B2 — "How many" and "Weight" side by side (board ItemSheet-phone): either one, or both. When one is set and
// the product's unit weight is known, the other shows its estimate (≈) in muted text until the person sets it.

export type Measure = { quantity: number; count: number | null; amount: number | null; unit: string | null };

const r1 = (n: number) => Math.round(n * 10) / 10;

export function QtySteppers({ value, onChange, unitKg, title, learned }: { value: Measure; onChange: (m: Measure) => void; unitKg: number | null; title: string; learned?: boolean }) {
  const { t, f, locale } = useI18n();
  // Products sold by weight (a known unit weight, a count or a weight already) count pieces; packs count units.
  const weighed = unitKg != null || value.count != null || value.unit === "kg" || value.unit === "g";
  const m = measure(value, unitKg);
  const liquid = value.unit === "l";
  const grams = value.unit === "g";
  const howMany = weighed ? (value.count ?? null) : value.quantity;
  const shownCount = howMany ?? (m.approx === "count" ? m.count : null);
  const kgSaid = value.amount != null && (value.unit === "kg" || value.unit === "g") ? value.amount : null;
  const weightText = liquid
    ? `${value.amount ?? 0} ${unitWord("l", locale)}`
    : kgSaid != null
      ? `${kgSaid} ${unitWord(grams ? "g" : "kg", locale)}`
      : m.kg != null
        ? `≈ ${r1(m.kg)} ${unitWord("kg", locale)}`
        : "—";

  const setCount = (n: number) => {
    if (!weighed) return onChange({ ...value, quantity: Math.max(1, Math.min(999, n)) });
    onChange({ ...value, count: n <= 0 ? null : Math.min(999, n) });
  };
  const stepCount = (d: number) => setCount((shownCount ?? 0) + d);
  const stepWeight = (d: number) => {
    if (liquid) return onChange({ ...value, amount: Math.max(0.25, r1((value.amount ?? 1) + d * 0.5)) });
    if (grams) {
      const g = Math.max(0, (value.amount ?? 0) + d * 50);
      return onChange({ ...value, amount: g || null, unit: g ? "g" : null });
    }
    const base = value.amount ?? (m.kg != null ? r1(m.kg) : 0);
    const kg = Math.max(0, r1(base + d * 0.1));
    onChange({ ...value, amount: kg || null, unit: kg ? "kg" : null });
  };
  const box = "flex h-14 items-center gap-1 rounded-[14px] border border-line-strong bg-surface p-1";
  const step = "grid size-11 shrink-0 place-items-center rounded-[11px] bg-surface-2 text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-90 disabled:opacity-40";
  const g = unitKg ? Math.round(unitKg * 1000) : null;
  return (
    <div data-qty-steppers>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <b className="text-[13.5px] font-bold">{t.sm.qty.title}</b>
        {weighed && <span className="text-[12.5px] text-muted">{t.sm.qty.either}</span>}
      </div>
      <div className={cn("grid gap-2.5", weighed ? "grid-cols-2" : "grid-cols-1")}>
        <div>
          {weighed && <span className="mb-1 block text-[12.5px] font-semibold text-muted">{t.sm.qty.howMany}</span>}
          <div className={box}>
            <button type="button" className={step} aria-label={`${t.sm.qty.howMany}: ${t.sm.qty.less}`} onClick={() => stepCount(-1)} disabled={!weighed && value.quantity <= 1} data-qty-count-less>
              <Minus className="size-5" />
            </button>
            <b className={cn("tabular min-w-0 flex-1 truncate text-center text-[18px] font-extrabold", howMany == null && "font-semibold text-muted")} data-qty-count>
              {shownCount == null ? "—" : howMany == null ? `≈ ${shownCount}` : shownCount}
            </b>
            <button type="button" className={step} aria-label={`${t.sm.qty.howMany}: ${t.sm.qty.more}`} onClick={() => stepCount(1)} data-qty-count-more>
              <Plus className="size-5" />
            </button>
          </div>
        </div>
        {weighed && (
        <div>
          <span className="mb-1 block text-[12.5px] font-semibold text-muted">{t.sm.qty.weight}</span>
          <div className={box}>
            <button type="button" className={step} aria-label={`${t.sm.qty.weight}: ${t.sm.qty.less}`} onClick={() => stepWeight(-1)} disabled={value.amount == null && m.kg == null} data-qty-weight-less>
              <Minus className="size-5" />
            </button>
            <b className={cn("tabular min-w-0 flex-1 truncate text-center text-[17px] font-extrabold", kgSaid == null && !liquid && "font-semibold text-muted")} data-qty-weight>
              {weightText}
            </b>
            <button type="button" className={step} aria-label={`${t.sm.qty.weight}: ${t.sm.qty.more}`} onClick={() => stepWeight(1)} data-qty-weight-more>
              <Plus className="size-5" />
            </button>
          </div>
        </div>
        )}
      </div>
      {g != null && (m.approx === "kg" || m.approx === "count") && <p className="mt-1.5 text-[12.5px] text-muted">{learned ? f(t.sm.qty.estimated, { title: title.toLowerCase(), g }) : f(t.sm.qty.estimatedFallback, { g })}</p>}
    </div>
  );
}
