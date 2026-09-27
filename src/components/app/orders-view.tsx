"use client";

import { ExternalLink, Truck } from "lucide-react";
import { toast } from "sonner";
import { bulkSetStatus } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { activeSource, countable, lineTotal, unitPrice } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { optimisticStatus, ProductImage } from "./item-card";
import { useStore } from "./store";

/** Everything left to buy, grouped by the store each item will be ordered from. */
export function OrdersView({ items }: { items: ItemWithSources[] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const list = countable(items, s.altGroups, s.rates);

  const groups = new Map<string, { store: string; items: ItemWithSources[] }>();
  for (const i of list) {
    const src = activeSource(i, s.rates);
    const key = src?.storeKey ?? "—";
    const g = groups.get(key) ?? { store: src?.store ?? "—", items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  const rows = [...groups.entries()]
    .map(([key, g]) => {
      let subtotal = 0;
      let missing = 0;
      for (const i of g.items) {
        const l = lineTotal(i, s.rates, s.currency);
        if (l == null) missing++;
        else subtotal += l;
      }
      return { key, ...g, subtotal, missing };
    })
    .sort((a, b) => b.subtotal - a.subtotal);

  const markAll = async (group: ItemWithSources[]) => {
    const entries = group.map((i) => {
      const src = activeSource(i, s.rates);
      return { item: i, paid: src?.price != null ? { price: src.price + (src.shipping ?? 0), currency: src.currency } : null };
    });
    s.upsertItems(entries.map((e) => optimisticStatus(e.item, "ordered", e.paid)));
    try {
      s.upsertItems(await bulkSetStatus(entries.map((e) => ({ id: e.item.id, paid: e.paid })), "ordered"));
      toast.success(f(t.orders.markedAll, { n: group.length }), {
        action: { label: t.item.undo, onClick: async () => s.upsertItems(await bulkSetStatus(group.map((i) => ({ id: i.id, paid: null })), "to_buy")) },
      });
    } catch {
      s.upsertItems(group);
      toast.error(t.errors.generic);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted">{t.orders.subtitle}</p>
      {rows.map((g) => (
        <section key={g.key} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">{g.store}</h2>
              <p className="tabular text-xs text-muted">
                {(g.items.length === 1 ? t.collection.itemsCountOne : f(t.orders.items, { n: g.items.length }))}
                {g.missing > 0 && <span className="text-accent-ink"> · {f(t.orders.noPrice, { n: g.missing })}</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-end">
                <div className="text-[11px] text-faint">{t.orders.subtotal}</div>
                <div className="tabular text-lg font-semibold">{formatMoney(g.subtotal, s.currency, locale)}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void markAll(g.items)}>
                <Truck />
                {t.orders.markAll}
              </Button>
            </div>
          </header>
          <ul className="divide-y divide-line">
            {g.items.map((i) => {
              const src = activeSource(i, s.rates);
              const unit = unitPrice(i, s.rates, s.currency);
              const line = lineTotal(i, s.rates, s.currency);
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <ProductImage src={i.imageUrl} alt="" className="size-11 shrink-0 rounded-md" iconClass="size-4" />
                  <button type="button" onClick={() => s.openItem(i.id)} className="min-w-0 flex-1 text-start">
                    <div className="truncate text-sm font-medium hover:underline" dir="auto">
                      {i.title}
                    </div>
                    <div className="tabular text-xs text-muted">
                      {i.quantity > 1 ? `${i.quantity} × ` : ""}
                      {unit != null ? formatMoney(unit, s.currency, locale) : t.item.noPrice}
                      {src?.shipping == null && unit != null ? ` · ${t.item.shippingUnknown}` : ""}
                    </div>
                  </button>
                  <div className="tabular w-24 shrink-0 text-end text-sm font-semibold">{line != null ? formatMoney(line, s.currency, locale) : "—"}</div>
                  {src && (
                    <a href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-xs font-medium text-muted hover:bg-sunken hover:text-fg">
                      <ExternalLink className="size-3.5" />
                      {t.orders.openStore}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
