"use client";

import { ExternalLink, Truck } from "lucide-react";
import { toast } from "@/lib/toast";
import { bulkSetStatus } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { StoreMark, storeVar } from "@/components/ui/store-mark";
import { activeSource, countable, lineTotal, unitPrice } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { optimisticStatus, ProductImage } from "./item-card";
import { ItemTable } from "./item-table";
import { useStore } from "./store";

/** Everything left to buy, grouped by the store each item will be ordered from. */
export function OrdersView({ items }: { items: ItemWithSources[] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const list = countable(items, s.altGroups, s.rates);

  const table = s.layout === "table";
  const groups = new Map<string, { store: string; url: string | null; items: ItemWithSources[] }>();
  for (const i of list) {
    const src = activeSource(i, s.rates);
    const key = src?.url ? src.storeKey : "—";
    const g = groups.get(key) ?? { store: src?.url ? src.store : "—", url: src?.url || null, items: [] };
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
    const req = bulkSetStatus(entries.map((e) => ({ id: e.item.id, paid: e.paid })), "ordered");
    let undone = false;
    const id = toast.success(f(t.orders.markedAll, { n: group.length }), {
      action: {
        label: t.item.undo,
        onClick: async () => {
          undone = true;
          s.upsertItems(group);
          await req.catch(() => null);
          s.upsertItems(await bulkSetStatus(group.map((i) => ({ id: i.id, paid: null })), "to_buy"));
        },
      },
    });
    try {
      const saved = await req;
      if (!undone) s.upsertItems(saved);
    } catch {
      s.upsertItems(group);
      toast.error(t.errors.generic, { id });
    }
  };

  return (
    <div className="space-y-4" data-orders-layout={table ? "table" : "cards"}>
      <p className="max-w-[70ch] text-sm text-muted">{t.orders.subtitle}</p>
      {rows.map((g) => {
        const known = g.key !== "—";
        return (
          <section key={g.key} style={known ? storeVar(g.key) : undefined} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <header className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-3", known && "store-bar store-tint")}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {known && <StoreMark store={g.store} storeKey={g.key} url={g.url} size={24} />}
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{g.store}</h2>
                  <p className="tabular text-xs text-muted">
                    {g.items.length === 1 ? t.collection.itemsCountOne : f(t.orders.items, { n: g.items.length })}
                    {g.missing > 0 && <span className="text-accent-ink"> · {f(t.orders.noPrice, { n: g.missing })}</span>}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-end">
                  <div className="text-[11px] text-faint">{t.orders.subtotal}</div>
                  <div className="tabular text-lg font-semibold max-sm:text-base">{formatMoney(g.subtotal, s.currency, locale)}</div>
                </div>
                <Button size="sm" variant="outline" className="max-sm:size-10 max-sm:px-0" onClick={() => void markAll(g.items)} aria-label={t.orders.markAll} title={t.orders.markAll}>
                  <Truck />
                  <span className="max-sm:hidden">{t.orders.markAll}</span>
                </Button>
              </div>
            </header>
            {table ? (
              <>
                <div className="hidden md:block">
                  <ItemTable items={g.items} bare />
                </div>
                <ul className="divide-y divide-line md:hidden">
                  {g.items.map((i) => {
                    const unit = unitPrice(i, s.rates, s.currency);
                    const line = lineTotal(i, s.rates, s.currency);
                    return (
                      <li key={i.id} className={cn(known && "store-line")}>
                        <button type="button" onClick={() => s.openItem(i.id)} className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-start active:bg-sunken">
                          <span className="min-w-0 flex-1">
                            <span className="bidi block truncate text-sm">{i.title}</span>
                            <span className="tabular block text-[11px] text-faint">
                              {i.quantity > 1 ? `${i.quantity} × ` : ""}
                              {unit != null ? formatMoney(unit, s.currency, locale) : t.item.noPrice}
                            </span>
                          </span>
                          <span className="tabular shrink-0 text-sm font-semibold">{line != null ? formatMoney(line, s.currency, locale) : "—"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <ul className="divide-y divide-line">
                {g.items.map((i) => {
                  const src = activeSource(i, s.rates);
                  const unit = unitPrice(i, s.rates, s.currency);
                  const line = lineTotal(i, s.rates, s.currency);
                  return (
                    <li key={i.id} className={cn("flex items-center gap-3 px-4 py-2.5", known && "store-line")}>
                      <ProductImage src={i.imageUrl} alt="" className="size-11 shrink-0 rounded-md" iconClass="size-4" />
                      <button type="button" onClick={() => s.openItem(i.id)} className="min-w-0 flex-1 text-start">
                        <div className="truncate text-sm font-medium hover:underline bidi">
                          {i.title}
                        </div>
                        <div className="tabular text-xs text-muted">
                          {i.quantity > 1 ? `${i.quantity} × ` : ""}
                          {unit != null ? formatMoney(unit, s.currency, locale) : t.item.noPrice}
                          {src?.shipping == null && unit != null ? ` · ${t.item.shippingUnknown}` : ""}
                        </div>
                      </button>
                      <div className="tabular w-24 shrink-0 text-end text-sm font-semibold max-sm:w-auto">{line != null ? formatMoney(line, s.currency, locale) : "—"}</div>
                      {src?.url && (
                        <a href={src.url} target="_blank" rel="noopener noreferrer" aria-label={t.orders.openStore} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-xs font-medium text-muted hover:bg-sunken hover:text-fg max-sm:size-10 max-sm:justify-center max-sm:px-0">
                          <ExternalLink className="size-3.5" />
                          <span className="max-sm:hidden">{t.orders.openStore}</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
