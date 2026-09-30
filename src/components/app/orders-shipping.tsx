"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { updateItem } from "@/app/actions";
import { saveStoreSetting } from "@/app/money-actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Pop, PopContent, PopTrigger } from "@/components/ui/overlays";
import { CURRENCIES, formatMoney } from "@/lib/money";
import type { GapSuggestion, ShippingGap, ShippingRule } from "@/lib/shipping";
import type { ItemWithSources } from "@/lib/types";
import { lineTotal } from "@/lib/calc";
import { useStore } from "./store";

/** Progress toward the store's free-shipping threshold (in the store hue) + the settings popover. Stores without a
 *  rule get no row (their settings button sits in the group header). */
export function ShippingRow({ storeKey, store, gap, rule }: { storeKey: string; store: string; gap: ShippingGap; rule: (ShippingRule & { saved: boolean }) | null }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const money = (v: number) => formatMoney(v, s.currency, locale);
  const has = gap.threshold != null;
  if (!has && gap.fee === 0) return null;
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-2" data-shipping={has ? (gap.free ? "free" : "gap") : "none"}>
      {has ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className={gap.free ? "font-medium text-ok" : "font-medium"}>{gap.free ? t.orders.free : f(t.orders.toFree, { amount: money(gap.remaining) })}</span>
            <span className="tabular shrink-0 text-faint">{money(gap.threshold!)}</span>
          </div>
          <div
            role="progressbar"
            aria-label={t.orders.shipping}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(gap.progress * 100)}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"
          >
            <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${gap.progress * 100}%`, background: "var(--store)" }} />
          </div>
        </div>
      ) : (
        <span className="flex-1 text-xs text-faint">{f(t.orders.fee, { amount: money(gap.fee) })}</span>
      )}
      <ShippingSettings storeKey={storeKey} store={store} rule={rule} />
    </div>
  );
}

export function ShippingSettings({ storeKey, store, rule }: { storeKey: string; store: string; rule: (ShippingRule & { saved: boolean }) | null }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState("");
  const [fee, setFee] = useState("");
  const [currency, setCurrency] = useState("ILS");
  const [busy, setBusy] = useState(false);

  const onOpen = (o: boolean) => {
    if (o) {
      setMin(rule?.freeShippingMin != null ? String(rule.freeShippingMin) : "");
      setFee(rule?.shippingFee != null ? String(rule.shippingFee) : "");
      setCurrency(rule?.currency ?? s.currency);
    }
    setOpen(o);
  };
  const num = (v: string) => (v.trim() && Number(v) >= 0 ? Number(v) : null);
  const save = async () => {
    setBusy(true);
    try {
      s.upsertStoreSetting(await saveStoreSetting({ storeKey, freeShippingMin: num(min), shippingFee: num(fee), currency }));
      setOpen(false);
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };
  const currencies = [...new Set([...CURRENCIES, currency])];

  return (
    <Pop open={open} onOpenChange={onOpen}>
      <PopTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="max-sm:size-10" aria-label={f(t.orders.shippingFor, { store })} title={f(t.orders.shippingFor, { store })} data-shipping-edit>
          <Settings2 />
        </Button>
      </PopTrigger>
      <PopContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-3"
        >
          <div className="truncate text-sm font-medium">{f(t.orders.shippingFor, { store })}</div>
          <label className="block text-xs text-muted">
            {t.orders.freeFrom}
            <div className="mt-1 flex">
              <Input type="number" min={0} step="any" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder={t.orders.none} className="tabular rounded-e-none" autoFocus name="freeShippingMin" />
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 rounded-e-lg border border-s-0 border-line-strong bg-sunken px-2 text-sm text-fg outline-none" aria-label={t.item.currency}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </label>
          <label className="block text-xs text-muted">
            {t.orders.flatFee}
            <Input type="number" min={0} step="any" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder={t.orders.none} className="tabular mt-1" name="shippingFee" />
          </label>
          {rule && !rule.saved && <p className="text-xs leading-relaxed text-muted">{t.orders.prefilled}</p>}
          <Button type="submit" size="sm" variant="accent" className="w-full max-sm:h-10" disabled={busy}>
            {t.item.save}
          </Button>
        </form>
      </PopContent>
    </Pop>
  );
}

/** One-click fixes for the gap (switch source / include), then the rest of the store's someday items. */
export function GapList({ suggestions, leftOut }: { suggestions: GapSuggestion[]; leftOut: ItemWithSources[] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const money = (v: number) => formatMoney(v, s.currency, locale);
  const shown = new Set(suggestions.map((x) => x.item.id));
  const rest: GapSuggestion[] = leftOut
    .filter((i) => !shown.has(i.id))
    .map((item) => ({ kind: "include", item, adds: lineTotal(item, s.rates, s.currency) ?? 0, closes: false }));
  if (!suggestions.length && !rest.length) return null;

  const apply = async (x: GapSuggestion) => {
    const before = x.item;
    const patch = x.kind === "switch" ? { chosenSourceId: x.sourceId } : { priority: "normal" as const };
    const undoPatch = x.kind === "switch" ? { chosenSourceId: before.chosenSourceId } : { priority: before.priority };
    s.upsertItem({ ...before, ...patch });
    const req = updateItem(before.id, patch);
    let undone = false;
    const store = x.kind === "switch" ? before.sources.find((src) => src.id === x.sourceId)?.store ?? "" : "";
    const id = toast.success(x.kind === "switch" ? f(t.orders.switched, { store }) : t.orders.included, {
      action: {
        label: t.item.undo,
        onClick: async () => {
          undone = true;
          s.upsertItem(before);
          await req.catch(() => null);
          s.upsertItem(await updateItem(before.id, undoPatch));
        },
      },
    });
    try {
      const saved = await req;
      if (!undone) s.upsertItem(saved);
    } catch {
      s.upsertItem(before);
      toast.error(t.errors.generic, { id });
    }
  };

  const row = (x: GapSuggestion) => (
    <li key={x.item.id} className="flex items-center gap-3 px-4 py-2" data-gap-suggestion={x.kind}>
      <button type="button" onClick={() => s.openItem(x.item.id)} className="min-w-0 flex-1 text-start">
        <span className="bidi block truncate text-sm">{x.item.title}</span>
        <span className="tabular block text-xs text-muted">
          {money(x.adds)}
          {x.kind === "switch" && (
            <>
              {" · "}
              {f(t.orders.switchFrom, { store: x.fromStore })}
              {" · "}
              {Math.abs(x.diff) < 0.005 ? t.orders.samePrice : x.diff < 0 ? f(t.orders.cheaper, { amount: money(-x.diff) }) : f(t.orders.pricier, { amount: money(x.diff) })}
            </>
          )}
          {x.closes && <span className="text-ok"> · {t.orders.closes}</span>}
        </span>
      </button>
      <Button size="sm" variant="outline" className="max-sm:h-10" onClick={() => void apply(x)}>
        {x.kind === "switch" ? t.orders.switch : t.orders.include}
      </Button>
    </li>
  );

  return (
    <div className="border-t border-line bg-sunken/40">
      {suggestions.length > 0 && (
        <>
          <h3 className="px-4 pt-2.5 text-xs font-semibold text-muted">{t.orders.closeGap}</h3>
          <ul>{suggestions.map(row)}</ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          <h3 className="px-4 pt-2.5 text-xs font-semibold text-muted">{t.orders.leftOut}</h3>
          <ul>{rest.map(row)}</ul>
        </>
      )}
    </div>
  );
}
