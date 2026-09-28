"use client";

import { ExternalLink, PackageCheck, Split, Truck, Undo2 } from "lucide-react";
import { updateItem } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { activeSource, lineTotal, unitPrice } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { dragIds, ProductImage, useStatusFlow } from "./item-card";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";

function QtyCell({ item }: { item: ItemWithSources }) {
  const s = useStore();
  return (
    <input
      type="number"
      min={1}
      defaultValue={item.quantity}
      key={item.quantity}
      onClick={(e) => e.stopPropagation()}
      onBlur={async (e) => {
        const q = Math.max(1, Math.floor(Number(e.target.value) || 1));
        if (q === item.quantity) return;
        s.upsertItem({ ...item, quantity: q });
        s.upsertItem(await updateItem(item.id, { quantity: q }));
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="tabular h-8 w-14 rounded-md border border-transparent bg-transparent px-1.5 text-center text-sm outline-none hover:border-line focus:border-accent focus:bg-bg"
      aria-label="Quantity"
    />
  );
}

export function ItemTable({ items }: { items: ItemWithSources[] }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const flow = useStatusFlow();
  const order = items.map((i) => i.id);
  const allSelected = items.length > 0 && items.every((i) => s.selected.has(i.id));
  const pr = { urgent: t.item.urgent, normal: t.item.normal, someday: t.item.someday };

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-start text-xs text-faint">
            <th className="w-10 py-2.5 ps-3">
              <input
                type="checkbox"
                aria-label={t.select.selectAll}
                checked={allSelected}
                onChange={() => (allSelected ? s.clearSelection() : s.setSelected(order))}
                className="size-4 accent-[var(--accent)]"
              />
            </th>
            <th className="w-12 py-2.5" />
            <th className="py-2.5 ps-2 text-start font-medium">{t.table.item}</th>
            <th className="py-2.5 ps-2 text-start font-medium">{t.table.store}</th>
            <th className="py-2.5 pe-2 text-end font-medium">{t.table.price}</th>
            <th className="py-2.5 text-center font-medium">{t.table.qty}</th>
            <th className="py-2.5 pe-3 text-end font-medium">{t.table.total}</th>
            <th className="py-2.5 ps-2 text-start font-medium">{t.table.priority}</th>
            <th className="py-2.5 ps-2 text-start font-medium">{t.table.collection}</th>
            <th className="w-20 py-2.5 pe-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const src = activeSource(i, s.rates);
            const unit = unitPrice(i, s.rates, s.currency);
            const total = lineTotal(i, s.rates, s.currency);
            const c = i.collectionId ? s.collections.find((x) => x.id === i.collectionId) : null;
            const purchased = i.status === "purchased";
            const group = i.altGroupId ? s.altGroups.find((g) => g.id === i.altGroupId) : null;
            const checked = s.selected.has(i.id);
            const next = i.status === "to_buy" ? "ordered" : i.status === "ordered" ? "purchased" : "to_buy";
            const nextLabel = i.status === "to_buy" ? t.flow.markOrdered : i.status === "ordered" ? t.flow.markReceived : t.flow.backToBuy;
            return (
              <tr
                key={i.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-nexus-items", JSON.stringify(dragIds(i.id, s.selected)));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={(e) => (s.selected.size || e.metaKey || e.ctrlKey ? s.toggleSelect(i.id, e.shiftKey ? { range: order } : undefined) : s.openItem(i.id))}
                className={cn("cursor-pointer border-b border-line transition last:border-0", checked ? "bg-accent-soft/50" : "hover:bg-sunken/60", purchased && "text-muted")}
              >
                <td className="py-1.5 ps-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={t.select.select}
                    checked={checked}
                    onChange={() => undefined}
                    onClick={(e) => s.toggleSelect(i.id, e.shiftKey ? { range: order } : undefined)}
                    className="size-4 accent-[var(--accent)]"
                  />
                </td>
                <td className="py-1.5">
                  <ProductImage src={i.imageUrl} alt="" className="size-10 rounded-md" iconClass="size-4" />
                </td>
                <td className="max-w-[340px] py-2 ps-2">
                  <div className="truncate font-medium" dir="auto">
                    {i.title}
                  </div>
                  <div className="flex items-center gap-2 truncate text-xs text-faint">
                    {i.status === "ordered" && <span className="font-medium text-info">{t.flow.ordered}</span>}
                    {group && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); s.openAlt(group.id); }} className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline">
                        <Split className="size-3" />
                        {group.name}
                      </button>
                    )}
                    {i.tags?.length ? <span className="truncate">{i.tags.join(", ")}</span> : null}
                  </div>
                </td>
                <td className="py-2 ps-2 text-muted">
                  {src?.store ?? "—"}
                  {i.sources.length > 1 && <span dir="ltr" className="ms-1 inline-block text-xs text-faint">+{i.sources.length - 1}</span>}
                </td>
                <td className="tabular py-2 pe-2 text-end">{unit == null ? <span className="text-faint">—</span> : formatMoney(unit, s.currency, locale)}</td>
                <td className="py-1 text-center">
                  <QtyCell item={i} />
                </td>
                <td className="tabular py-2 pe-3 text-end font-semibold">{total == null ? <span className="font-normal text-faint">—</span> : formatMoney(total, s.currency, locale)}</td>
                <td className="py-2 ps-2">
                  <span className={cn("inline-flex items-center gap-1.5 text-xs", i.priority === "urgent" ? "font-medium text-danger" : "text-muted")}>
                    <span className={cn("size-1.5 rounded-full", i.priority === "urgent" ? "bg-danger" : i.priority === "someday" ? "bg-faint" : "bg-info")} />
                    {pr[i.priority]}
                  </span>
                </td>
                <td className="max-w-[160px] py-2 ps-2 text-xs text-muted">
                  {c ? (
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: COLLECTION_COLORS[c.color] }} />
                      <span className="truncate">{c.name}</span>
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="py-2 pe-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-0.5">
                    {src?.url && (
                      <a href={src.url} target="_blank" rel="noopener noreferrer" aria-label={t.item.openStore} title={t.item.openStore} className="grid size-8 place-items-center rounded-md text-muted hover:bg-line hover:text-fg">
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void flow.setTo(i, next)}
                      aria-label={nextLabel}
                      title={nextLabel}
                      className={cn("grid size-8 place-items-center rounded-md transition", purchased ? "text-muted hover:bg-line" : i.status === "ordered" ? "text-ok hover:bg-ok-soft" : "text-info hover:bg-sunken")}
                    >
                      {i.status === "to_buy" ? <Truck className="size-4" /> : i.status === "ordered" ? <PackageCheck className="size-4" /> : <Undo2 className="size-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
