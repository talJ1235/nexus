"use client";

import { useState } from "react";
import { Check, ExternalLink, Minus, Package, PackageCheck, Plus, Split, Truck, Undo2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { setStatus, updateItem } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { activeSource, cheapestSource, lineTotal, lowestSeen, unitPrice } from "@/lib/calc";
import { convert, formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { normalizeCategory } from "@/lib/categories";
import { useStore } from "./store";
import { useReadOnly } from "./offline-banner";
import { COLLECTION_COLORS } from "./view-items";

export function ProductImage({ src, alt, className, iconClass }: { src: string | null; alt: string; className?: string; iconClass?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn("relative grid place-items-center overflow-hidden bg-tile", className)}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote store images; thumbnails are pre-sized WebP
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          // Fade in once decoded. Cached images may finish before hydration, so check `complete` on mount too.
          ref={(el) => {
            if (el?.complete && el.naturalWidth) el.dataset.loaded = "";
          }}
          onLoad={(e) => {
            e.currentTarget.dataset.loaded = "";
          }}
          onError={() => setFailed(true)}
          className="product-img size-full object-contain p-[9%] mix-blend-multiply dark:rounded-[14px] dark:mix-blend-normal"
        />
      ) : (
        <Package className={cn("size-8 text-tile-ink", iconClass)} strokeWidth={1.4} />
      )}
    </div>
  );
}

export type Status = ItemWithSources["status"];
const NEXT: Record<Status, Status> = { to_buy: "ordered", ordered: "purchased", purchased: "to_buy" };

function paidFor(item: ItemWithSources, rates: Parameters<typeof activeSource>[1]) {
  const src = activeSource(item, rates);
  return src?.price != null ? { price: src.price + (src.shipping ?? 0), currency: src.currency } : null;
}

export function optimisticStatus(item: ItemWithSources, status: Status, paid: ReturnType<typeof paidFor>): ItemWithSources {
  const t = Date.now();
  if (status === "to_buy") return { ...item, status, orderedAt: null, purchasedAt: null, purchasedPrice: null, purchasedCurrency: null };
  const price = paid ? { purchasedPrice: paid.price, purchasedCurrency: paid.currency } : {};
  return status === "ordered" ? { ...item, status, orderedAt: t, purchasedAt: null, ...price } : { ...item, status, purchasedAt: t, ...price };
}

/** Moves an item along To buy → Ordered → Received, with undo. */
export function useStatusFlow() {
  const s = useStore();
  const { t } = useI18n();
  const setTo = async (item: ItemWithSources, status: Status) => {
    const paid = status !== "to_buy" && item.status === "to_buy" ? paidFor(item, s.rates) : null;
    s.upsertItem(optimisticStatus(item, status, paid));
    // The toast shows at once (the change is already on screen); Undo waits for the save before reverting it.
    const req = setStatus(item.id, status, paid);
    let undone = false;
    const id =
      status !== "to_buy"
        ? toast.success(status === "ordered" ? t.flow.markedOrdered : t.flow.markedReceived, {
            description: item.title,
            action: {
              label: t.item.undo,
              onClick: async () => {
                undone = true;
                s.upsertItem(item);
                await req.catch(() => null);
                s.upsertItem(await setStatus(item.id, item.status));
              },
            },
          })
        : undefined;
    try {
      const saved = await req;
      if (!undone) s.upsertItem(saved);
    } catch {
      s.upsertItem(item);
      toast.error(t.errors.generic, { id });
    }
  };
  return { setTo, advance: (item: ItemWithSources) => setTo(item, NEXT[item.status]), paidFor: (item: ItemWithSources) => paidFor(item, s.rates) };
}

export function PriceTag({ item, size = "md" }: { item: ItemWithSources; size?: "md" | "lg" }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const unit = unitPrice(item, s.rates, s.currency);
  if (unit == null) return <span className={cn("price-tag muted", size === "lg" ? "text-base" : "text-[13px]")}>{t.item.noPrice}</span>;
  return <span className={cn("price-tag", size === "lg" ? "text-lg" : "text-[14px]")}>{formatMoney(unit, s.currency, locale)}</span>;
}

const shortDate = (ms: number, locale: string) => new Date(ms).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short" });

/** Drag payload: the selection if the dragged card is part of it, otherwise just this item. */
export function dragIds(id: string, selected: Set<string>) {
  return selected.has(id) ? [...selected] : [id];
}

export function SelectBox({ checked, onToggle, className }: { checked: boolean; onToggle: (e: React.MouseEvent) => void; className?: string }) {
  const ro = useReadOnly();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={ro.ro}
      title={ro.title}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e);
      }}
      className={cn(
        "grid size-6 place-items-center rounded-md border-2 shadow-card backdrop-blur transition",
        checked ? "border-accent bg-accent text-accent-fg" : "border-white/90 bg-black/25 text-transparent hover:bg-black/40",
        className,
      )}
    >
      <Check className="size-3.5" strokeWidth={3.2} />
    </button>
  );
}

export function ItemCard({ item, order }: { item: ItemWithSources; order: string[] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const flow = useStatusFlow();
  const ro = useReadOnly();
  const src = activeSource(item, s.rates);
  const cheapest = cheapestSource(item, s.rates);
  const collection = item.collectionId ? s.collections.find((c) => c.id === item.collectionId) : null;
  const total = lineTotal(item, s.rates, s.currency);
  const unit = unitPrice(item, s.rates, s.currency);
  // "Lowest price seen" only when the price actually moved: some store link has 2+ different readings.
  const moved = item.sources.some((src) => new Set(item.points.filter((p) => p.sourceId === src.id).map((p) => p.price)).size > 1);
  const low = moved ? lowestSeen(item, s.rates, s.currency) : null;
  const atLowest = item.status === "to_buy" && low != null && unit != null && unit <= low * 1.005;
  const stores = Array.from(new Set(item.sources.filter((x) => x.url).map((x) => x.store)));
  const selecting = s.selected.size > 0;
  const isSelected = s.selected.has(item.id);
  const fresh = s.fresh.get(item.id);

  // Savings hint: how much cheaper the best store is than the priciest one.
  let spread: number | null = null;
  if (item.sources.length > 1 && cheapest) {
    const vals = item.sources.filter((x) => x.price != null).map((x) => convert(x.price! + (x.shipping ?? 0), x.currency, s.currency, s.rates));
    if (vals.length > 1) spread = Math.max(...vals) - Math.min(...vals);
  }

  const next = NEXT[item.status];
  const nextLabel = item.status === "to_buy" ? t.flow.markOrdered : item.status === "ordered" ? t.flow.markReceived : t.flow.backToBuy;

  const category = normalizeCategory(item.category);
  const flag =
    item.status === "ordered" ? { label: t.flow.ordered, cls: "bg-info text-white", icon: <Truck className="size-3" /> }
    : item.status === "purchased" ? { label: t.flow.received, cls: "bg-ok text-white", icon: <Check className="size-3" strokeWidth={3} /> }
    : item.priority === "urgent" ? { label: t.item.urgent, cls: "bg-ink text-bg" }
    : atLowest ? { label: t.item.lowestShort, cls: "bg-tint text-tint-ink", title: t.history.atLowest }
    : item.priority === "someday" ? { label: t.item.someday, cls: "bg-surface text-muted" }
    : null;

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-nexus-items", JSON.stringify(dragIds(item.id, s.selected)));
        e.dataTransfer.effectAllowed = "move";
      }}
      data-item-card
      className={cn(
        "group relative flex flex-col rounded-[var(--radius-card)] border bg-surface p-1.5 transition-[border-color,box-shadow,transform] duration-[250ms] ease-[var(--ease-out)] max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:rounded-[22px] max-sm:p-[7px] max-sm:pe-3",
        isSelected ? "border-brand shadow-[0_0_0_1px_var(--brand)]" : "border-line hover:-translate-y-[3px] hover:shadow-[0_14px_30px_color-mix(in_srgb,var(--ink)_10%,transparent)]",
        fresh === "new" && "fill-in",
        fresh === "bump" && "bump",
      )}
    >
      <button
        type="button"
        onClick={(e) => (selecting || e.metaKey || e.ctrlKey ? s.toggleSelect(item.id, e.shiftKey ? { range: order } : undefined) : s.openItem(item.id))}
        className="absolute inset-0 z-[1] rounded-[var(--radius-card)] max-sm:rounded-[22px]"
        aria-label={item.title}
      />

      <div className="relative max-sm:shrink-0">
        <ProductImage src={item.imageUrl} alt="" className="aspect-[16/11] w-full rounded-[var(--radius-tile)] max-sm:size-14 max-sm:rounded-[17px]" iconClass="max-sm:size-6" />
        <div className="pointer-events-none absolute inset-x-[9px] top-[9px] flex items-start justify-between gap-2 max-sm:hidden">
          <span className="relative min-w-0">
            {category && (
              <span className={cn("block truncate rounded-full bg-surface px-[9px] py-1 text-[11px] font-bold text-muted transition-opacity", (selecting || isSelected) ? "opacity-0" : "sm:group-hover:opacity-0")}>
                {t.categories[category]}
              </span>
            )}
            <SelectBox
              checked={isSelected}
              onToggle={(e) => s.toggleSelect(item.id, e.shiftKey ? { range: order } : undefined)}
              className={cn("pointer-events-auto absolute start-0 top-0 z-[2]", !selecting && !isSelected && "opacity-0 group-hover:opacity-100 max-sm:hidden")}
            />
          </span>
          <span className="flex shrink-0 gap-1">
            {item.quantity > 1 && item.status !== "to_buy" && (
              <span dir="ltr" className="tabular rounded-full bg-surface px-[9px] py-1 text-[11px] font-bold text-ink">×{item.quantity}</span>
            )}
            {flag && (
              <span title={flag.title} className={cn("inline-flex items-center gap-1 rounded-full px-[9px] py-1 text-[11px] font-bold", flag.cls)}>
                {flag.icon}
                {flag.label}
              </span>
            )}
          </span>
        </div>

        {!selecting && (
          <div className="absolute bottom-2 end-2 z-[2] flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 max-sm:hidden">
            {src?.url && (
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                title={t.item.openStore}
                aria-label={t.item.openStore}
                className="grid size-8 place-items-center rounded-full bg-surface text-ink shadow-card transition hover:bg-surface-2"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => void flow.setTo(item, next)}
              disabled={ro.ro}
              title={ro.title ?? nextLabel}
              aria-label={nextLabel}
              className="grid size-8 place-items-center rounded-full bg-brand text-on-brand shadow-card transition hover:bg-brand-hover"
            >
              {item.status === "to_buy" ? <Truck className="size-4" /> : item.status === "ordered" ? <PackageCheck className="size-4" /> : <Undo2 className="size-4" />}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-[5px] px-2 pb-1.5 pt-2.5 max-sm:min-w-0 max-sm:gap-[3px] max-sm:p-0">
        <h3 className="bidi line-clamp-2 min-h-[2.7em] text-[14px] font-bold leading-[1.35] text-ink max-sm:line-clamp-1 max-sm:min-h-0">{item.title}</h3>
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          {collection && (
            <>
              <i className={cn("size-2 shrink-0", collection.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[collection.color] }} />
              <span className="bidi min-w-0 truncate">{collection.name}</span>
            </>
          )}
          {collection && stores[0] && <span aria-hidden className="max-sm:hidden">·</span>}
          {stores[0] && <span className="min-w-0 truncate max-sm:hidden">{stores[0]}</span>}
          {stores.length > 1 && (
            <span dir="ltr" className="shrink-0 text-[11px] max-sm:hidden">
              +{stores.length - 1}
            </span>
          )}
          {category && collection && <span aria-hidden className="sm:hidden">·</span>}
          {category && <span className="min-w-0 truncate sm:hidden">{t.categories[category]}</span>}
        </div>
        <div className="mt-auto flex min-h-[34px] items-center gap-2 pt-0.5 max-sm:hidden">
          <CardPrice item={item} />
          {item.status === "to_buy" ? (
            <QtyStepper item={item} className="relative z-[2] ms-auto" />
          ) : (
            <span className="ms-auto min-w-0 truncate text-end text-[11.5px] leading-tight">
              {item.status === "purchased" && item.purchasedAt ? (
                <span className="text-ok">{f(t.flow.receivedOn, { date: shortDate(item.purchasedAt, locale) })}</span>
              ) : item.status === "ordered" ? (
                <span className="text-info">{item.eta ? f(t.flow.arrives, { date: shortDate(item.eta, locale) }) : item.orderedAt ? f(t.flow.orderedOn, { date: shortDate(item.orderedAt, locale) }) : null}</span>
              ) : null}
            </span>
          )}
        </div>
        {item.status === "to_buy" && (spread != null && spread > 0 ? (
          <span className="tabular -mt-0.5 text-[11.5px] font-medium text-ok max-sm:hidden">{f(t.item.saveUpTo, { amount: formatMoney(Math.round(spread), s.currency, locale) })}</span>
        ) : item.quantity > 1 && total != null ? (
          <span className="tabular -mt-0.5 text-[11.5px] text-muted max-sm:hidden">
            {t.item.total} <b className="font-semibold">{formatMoney(total, s.currency, locale)}</b>
          </span>
        ) : null)}
      </div>
      <span className="flex shrink-0 flex-col items-end gap-0.5 sm:hidden">
        <CardPrice item={item} className="text-[16px]" />
        {item.quantity > 1 && <span className="tabular text-[11px] text-muted" dir="ltr">×{item.quantity}</span>}
      </span>
    </article>
  );
}

/** Card price: big and plain (no tag), "No price" muted. */
export function CardPrice({ item, className }: { item: ItemWithSources; className?: string }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const unit = unitPrice(item, s.rates, s.currency);
  if (unit == null) return <span className={cn("text-[13px] font-medium text-muted", className)}>{t.item.noPrice}</span>;
  return <span className={cn("tabular text-[18px] font-extrabold tracking-[-0.01em]", className)}>{formatMoney(unit, s.currency, locale)}</span>;
}

/** − qty + on the card; saves right away (optimistic), reverts on error. */
export function QtyStepper({ item, className }: { item: ItemWithSources; className?: string }) {
  const s = useStore();
  const { t } = useI18n();
  const ro = useReadOnly();
  const set = async (q: number) => {
    if (q < 1 || q > 999) return;
    s.upsertItem({ ...item, quantity: q });
    try {
      s.upsertItem(await updateItem(item.id, { quantity: q }));
    } catch {
      s.upsertItem(item);
      toast.error(t.errors.generic);
    }
  };
  const btn = "grid size-7 place-items-center rounded-full text-ink transition hover:bg-surface active:scale-90 disabled:opacity-40";
  return (
    <div className={cn("flex items-center gap-0.5 rounded-full bg-surface-2 p-[3px]", className)} data-qty-stepper>
      <button type="button" className={btn} disabled={ro.ro || item.quantity <= 1} onClick={() => void set(item.quantity - 1)} aria-label={t.item.qtyLess}>
        <Minus className="size-3.5" strokeWidth={2.4} />
      </button>
      <b className="tabular min-w-4 text-center text-[13px]">{item.quantity}</b>
      <button type="button" className={btn} disabled={ro.ro} onClick={() => void set(item.quantity + 1)} aria-label={t.item.qtyMore}>
        <Plus className="size-3.5" strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** One card standing in for a group of alternatives. */
export function AltGroupCard({ groupId, members }: { groupId: string; members: ItemWithSources[] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const group = s.altGroups.find((g) => g.id === groupId);
  const chosen = group?.chosenItemId ? members.find((m) => m.id === group.chosenItemId) : null;
  const prices = members.map((m) => unitPrice(m, s.rates, s.currency)).filter((v): v is number => v != null);
  const from = prices.length ? Math.min(...prices) : null;
  const shown = (chosen ? [chosen, ...members.filter((m) => m.id !== chosen.id)] : members).slice(0, 3);

  return (
    <article
      className="group relative flex flex-col"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-nexus-items", JSON.stringify(members.map((m) => m.id)));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      {/* stacked sheets behind the card */}
      <span aria-hidden className="absolute inset-x-3 -top-1.5 h-4 rounded-t-[var(--radius-card)] border border-b-0 border-line bg-raised" />
      <span aria-hidden className="absolute inset-x-1.5 -top-[3px] h-4 rounded-t-[var(--radius-card)] border border-b-0 border-line bg-surface" />
      <button
        type="button"
        onClick={() => s.openAlt(groupId)}
        className="relative flex flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-start transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card"
      >
        <div className="m-1.5 mb-0 grid aspect-[4/3] grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-tile)] bg-line">
          {shown.map((m, i) => (
            <ProductImage key={m.id} src={m.imageUrl} alt="" className={cn("h-full", shown.length === 1 && "col-span-3", shown.length === 2 && i === 0 && "col-span-2")} iconClass="size-6" />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3.5 pt-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent-ink">
            <Split className="size-3.5" />
            {f(t.alt.badge, { n: members.length })}
          </div>
          <h3 className="bidi line-clamp-2 text-[14.5px] font-medium leading-snug">
            {group?.name ?? t.alt.title}
          </h3>
          <div className="mt-auto flex items-end justify-between gap-2 pt-1">
            {chosen ? (
              <PriceTag item={chosen} />
            ) : from != null ? (
              <span className="price-tag muted text-[13px]">{f(t.alt.from, { amount: formatMoney(from, s.currency, locale) })}</span>
            ) : (
              <span className="price-tag muted text-[13px]">{t.item.noPrice}</span>
            )}
            {chosen && <span className="truncate text-[11.5px] text-ok">{t.alt.picked}</span>}
          </div>
        </div>
      </button>
    </article>
  );
}

export function ItemCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-1.5">
      <div className="skeleton aspect-[4/3] w-full rounded-[var(--radius-tile)]" />
      <div className="space-y-2.5 p-3.5">
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-2/3 rounded" />
        <div className="skeleton mt-3 h-6 w-20 rounded" />
      </div>
    </div>
  );
}
