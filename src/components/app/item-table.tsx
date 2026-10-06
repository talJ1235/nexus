"use client";

import { ExternalLink, PackageCheck, Split, Truck, Undo2 } from "lucide-react";
import { updateItem } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { StoreMark } from "@/components/ui/store-mark";
import { activeSource, lastPaidEstimate, lineTotal, unitPrice } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { dragIds, ProductImage, useStatusFlow } from "./item-card";
import { useStore, type PendingAdd } from "./store";
import { AddedBy } from "./spaces/space-ui";
import { PendingRow } from "./pending";
import { COLLECTION_COLORS } from "./view-items";
import { ItemContextMenu } from "./quick-actions";

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

export function ItemTable({ items, pending = [], bare = false }: { items: ItemWithSources[]; pending?: PendingAdd[]; bare?: boolean }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const flow = useStatusFlow();
  const order = items.map((i) => i.id);
  const allSelected = items.length > 0 && items.every((i) => s.selected.has(i.id));
  // R16 A6: checkboxes stay out of sight until a row is hovered / focused, or anything is selected (then all show).
  const selecting = s.selected.size > 0;
  const pr = { urgent: t.item.urgent, normal: t.item.normal, someday: t.item.someday };

  return (
    <div className={cn("overflow-x-auto", !bare && "rounded-[var(--radius-card)] border border-line bg-surface")}>
      <table className={cn("w-full min-w-[760px] text-sm", bare && "table-fixed")}>
        <thead>
          <tr className="border-b border-line text-start text-xs font-semibold text-muted">
            <th className="w-10 py-2.5 pe-3 ps-4">
              {selecting && (
                <input
                  type="checkbox"
                  aria-label={t.select.selectAll}
                  checked={allSelected}
                  onChange={() => (allSelected ? s.clearSelection() : s.setSelected(order))}
                  className="size-4 accent-[var(--accent)]"
                  data-select-all
                />
              )}
            </th>
            <th className="w-12 py-2.5" />
            <th className="py-2.5 ps-2 text-start font-medium">{t.table.item}</th>
            <th className={cn("py-2.5 ps-2 text-start font-medium", bare && "w-40")}>{t.table.store}</th>
            <th className={cn("py-2.5 pe-2 text-end font-medium", bare && "w-24")}>{t.table.price}</th>
            <th className={cn("py-2.5 text-center font-medium", bare && "w-16")}>{t.table.qty}</th>
            <th className={cn("py-2.5 pe-3 text-end font-medium", bare && "w-28")}>{t.table.total}</th>
            <th className={cn("py-2.5 ps-2 text-start font-medium", bare && "w-24")}>{t.table.priority}</th>
            <th className={cn("py-2.5 ps-2 text-start font-medium", bare && "w-36")}>{t.table.collection}</th>
            <th className="w-20 py-2.5 pe-3" />
          </tr>
        </thead>
        <tbody>
          {pending.map((p) => (
            <PendingRow key={p.id} p={p} cols={10} />
          ))}
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
              <ItemContextMenu key={i.id} item={i}>
              <tr
                data-item-row={i.id}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && s.openItem(i.id)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-nexus-items", JSON.stringify(dragIds(i.id, s.selected)));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={(e) => (s.selected.size || e.metaKey || e.ctrlKey ? s.toggleSelect(i.id, e.shiftKey ? { range: order } : undefined) : s.openItem(i.id))}
                className={cn("group/row cursor-pointer border-b border-line outline-none transition last:border-0 focus-visible:bg-sunken", s.fresh.has(i.id) && "fill-in", checked ? "bg-accent-soft/50" : "hover:bg-sunken/60", purchased && "text-muted")}
              >
                <td className="py-2 pe-3 ps-4" onClick={(e) => e.stopPropagation()} data-row-check>
                  <input
                    type="checkbox"
                    aria-label={t.select.select}
                    checked={checked}
                    onChange={() => undefined}
                    onClick={(e) => s.toggleSelect(i.id, e.shiftKey ? { range: order } : undefined)}
                    className={cn(
                      "size-4 accent-[var(--accent)] transition-opacity duration-[120ms] motion-reduce:transition-none",
                      !selecting && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100",
                    )}
                  />
                </td>
                <td className="py-1.5">
                  <ProductImage src={i.imageUrl} alt="" className="size-11 rounded-[13px]" iconClass="size-4" />
                </td>
                <td className="max-w-[340px] py-2 ps-2">
                  <div className="bidi truncate font-bold">
                    {i.title}
                  </div>
                  <div className="flex items-center gap-2 truncate text-xs text-faint">
                    <AddedBy userId={i.addedByUserId} />
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
                  <span className="flex min-w-0 items-center gap-2">
                    {src?.url && <StoreMark store={src.store} storeKey={src.storeKey} url={src.url} size={18} />}
                    <span className="truncate">{src?.store ?? "—"}</span>
                    {i.sources.length > 1 && <span dir="ltr" className="inline-block text-xs text-faint">+{i.sources.length - 1}</span>}
                  </span>
                </td>
                <td className="tabular py-2 pe-2 text-end">{unit == null ? <span className="text-faint">—</span> : lastPaidEstimate(i, s.rates) ? <span className="text-muted" data-last-paid title={t.item.lastPaid}>~{formatMoney(unit, s.currency, locale)}</span> : formatMoney(unit, s.currency, locale)}</td>
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
              </ItemContextMenu>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
