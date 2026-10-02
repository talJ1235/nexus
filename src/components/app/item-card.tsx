"use client";

import { useRef, useState } from "react";
import { Check, ExternalLink, Flag, Minus, Package, PackageCheck, Plus, Scale, Split, Truck, Undo2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { setStatus, updateItem } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { activeSource, cheapestSource, lineTotal, lowestSeen, unitPrice } from "@/lib/calc";
import { convert, formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { normalizeCategory } from "@/lib/categories";
import { importCheck, isForeignStore } from "@/lib/import-vat";
import { useDataStore } from "./store";
import { useReadOnly } from "./offline-banner";
import { COLLECTION_COLORS } from "./view-items";

export function ProductImage({ src, alt, className, iconClass, pending, ...rest }: { src: string | null; alt: string; className?: string; iconClass?: string; pending?: boolean } & React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | boolean>) {
  const [failed, setFailed] = useState(false);
  return (
    <div {...rest} className={cn("relative grid place-items-center overflow-hidden bg-tile", pending && !src && "shimmer", className)}>
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
          className="product-img size-full object-contain p-[9%] mix-blend-multiply transition-[opacity,transform] duration-[450ms] ease-[var(--ease-out)] group-hover:scale-[1.04] dark:rounded-[14px] dark:mix-blend-normal"
        />
      ) : (
        <Package className={cn("size-8 text-tile-ink", iconClass)} strokeWidth={1.4} />
      )}
    </div>
  );
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const cardImg = (id: string | null) => (id ? document.querySelector<HTMLElement>(`[data-item-card="${CSS.escape(id)}"] [data-card-img] > div`) : null);
const onScreen = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
};

/**
 * Shared-element morph between a card's picture and the item sheet's (FLIP on one cloned element: transform and
 * opacity only, so it stays on the compositor however long the list is). The sheet itself just fades while it runs.
 * Only one clone ever exists: a new morph lands the previous one first, and every clone is removed when its
 * animation ends or is cancelled, with a safety timeout on top (Round 10 A1: a picture was left behind on close).
 */
let flying: (() => void) | null = null;
const landMorph = () => flying?.();

function fly(src: HTMLElement, a: DOMRect, to: HTMLElement | null, done: () => void) {
  landMorph();
  const b = to && onScreen(to) ? to.getBoundingClientRect() : null;
  const clone = src.cloneNode(true) as HTMLElement;
  for (const el of [clone, ...clone.querySelectorAll<HTMLElement>("[data-sheet-img], [data-card-img]")]) {
    el.removeAttribute("data-sheet-img");
    el.removeAttribute("data-card-img");
  }
  clone.dataset.morphClone = "";
  clone.querySelectorAll("img").forEach((i) => (i.dataset.loaded = ""));
  const box = b ?? a;
  Object.assign(clone.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: "0", zIndex: "60", pointerEvents: "none", transformOrigin: b ? "0 0" : "50% 50%", borderRadius: getComputedStyle(b ? to! : src).borderRadius, opacity: "1" });
  document.body.appendChild(clone);
  const hidden = b ? to! : null;
  const prev = hidden?.style.opacity ?? "";
  if (hidden) hidden.style.opacity = "0";
  // Target off-screen (or gone): the picture shrinks and fades where it is instead of flying somewhere unseen.
  const anim = b
    ? clone.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" })
    : clone.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.85)" }], { duration: 220, easing: "ease-out", fill: "forwards" });
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    if (flying === finish) flying = null;
    if (hidden) hidden.style.opacity = prev;
    clone.remove();
    done();
  };
  const timer = setTimeout(finish, 450);
  anim.onfinish = finish;
  anim.oncancel = finish;
  flying = finish;
}

export function morphOpen(id: string, open: () => void) {
  landMorph();
  const from = cardImg(id);
  if (reduceMotion() || !from || !onScreen(from)) return open();
  const a = from.getBoundingClientRect(); // measured before the sheet mounts
  document.documentElement.dataset.morphing = "";
  open();
  requestAnimationFrame(() => {
    const to = document.querySelector<HTMLElement>("[data-sheet-img]");
    if (!to) return void delete document.documentElement.dataset.morphing;
    // The sheet keeps its fade after the morph ends: dropping it would restart the slide-in (the "jump").
    to.closest("[role=dialog]")?.setAttribute("data-morphed", "");
    fly(from, a, to, () => delete document.documentElement.dataset.morphing);
  });
}
export function morphClose(id: string | null, close: () => void) {
  landMorph();
  const from = document.querySelector<HTMLElement>("[data-sheet-img]");
  if (reduceMotion() || !from) return close();
  // Clone the sheet's picture before it unmounts and fly it to where its card is now (re-measured at close).
  fly(from, from.getBoundingClientRect(), cardImg(id), () => {});
  close();
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
  const s = useDataStore();
  const { t } = useI18n();
  const warnImport = useImportWarning();
  const setTo = async (item: ItemWithSources, status: Status) => {
    const paid = status !== "to_buy" && item.status === "to_buy" ? paidFor(item, s.rates) : null;
    if (status === "ordered") warnImport([item]);
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

/**
 * Marking items as ordered from a foreign store: if that store's order (these + what was ordered there in the last
 * day) is over the VAT-free import limit, say so — with the estimated VAT.
 */
export function useImportWarning() {
  const s = useDataStore();
  const { t, f, locale } = useI18n();
  return (items: ItemWithSources[]) => {
    const src = items[0] ? activeSource(items[0], s.rates) : null;
    if (!src || !isForeignStore(src.storeKey, src.currency)) return;
    const ids = new Set(items.map((i) => i.id));
    const recent = s.items.filter((i) => !ids.has(i.id) && i.status === "ordered" && (i.orderedAt ?? 0) > Date.now() - 86_400_000 && activeSource(i, s.rates)?.storeKey === src.storeKey);
    const c = importCheck([...items, ...recent], { rates: s.rates, currency: s.currency, limitUsd: s.importLimitUsd });
    if (!c.over) return;
    toast.warning(t.importVat.toast, {
      description: f(t.importVat.detail, { total: Math.round(c.totalUsd), vat: formatMoney(Math.round(c.vat), s.currency, locale), remove: Math.ceil(c.removeUsd) }),
      duration: 10_000,
    });
  };
}

export function PriceTag({ item, size = "md" }: { item: ItemWithSources; size?: "md" | "lg" }) {
  const s = useDataStore();
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
  const s = useDataStore();
  const { t, f, locale, dir } = useI18n();
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
  const swipe = useRowSwipe(() => void flow.setTo(item, next), () => s.toggleSelect(item.id), !ro.ro && item.status !== "purchased");

  const category = normalizeCategory(item.category);
  const flag =
    item.status === "ordered" ? { label: t.flow.ordered, cls: "bg-info text-white", icon: <Truck className="size-3" /> }
    : item.status === "purchased" ? { label: t.flow.received, cls: "bg-ok text-white", icon: <Check className="size-3" strokeWidth={3} /> }
    : item.priority === "urgent" ? { label: t.item.urgent, cls: "bg-surface text-danger shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_35%,transparent)]", icon: <Flag className="size-3" strokeWidth={2.6} /> }
    : atLowest ? { label: t.item.lowestShort, cls: "bg-tint text-tint-ink", title: t.history.atLowest }
    : item.priority === "someday" ? { label: t.item.someday, cls: "bg-surface text-muted" }
    : null;

  const endSwipe = (dir === "rtl" ? -swipe.dx : swipe.dx) > 0;
  const [firstStatus] = useState(item.status);
  const sweep = firstStatus !== item.status;
  return (
    <div className="relative flex flex-col">
      {/* Phone swipe: toward the end = next status, toward the start = select (actions bar). */}
      {swipe.dx !== 0 && (
        <div
          aria-hidden
          dir="ltr"
          className={cn(
            "absolute inset-0 hidden items-center rounded-[22px] px-5 text-sm font-bold prow:flex",
            swipe.dx > 0 ? "justify-start" : "justify-end",
            endSwipe ? "bg-info text-white" : "bg-ink text-bg",
            Math.abs(swipe.dx) < SWIPE_AT && "opacity-70",
          )}
        >
          {endSwipe ? (
            <span className="flex items-center gap-2">{item.status === "to_buy" ? <Truck className="size-5" /> : <PackageCheck className="size-5" />}{nextLabel}</span>
          ) : (
            <span className="flex items-center gap-2"><Check className="size-5" />{t.select.select}</span>
          )}
        </div>
      )}
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-nexus-items", JSON.stringify(dragIds(item.id, s.selected)));
        e.dataTransfer.effectAllowed = "move";
      }}
      {...swipe.handlers}
      style={swipe.dx ? { transform: `translateX(${swipe.dx}px)`, transition: "none" } : undefined}
      data-item-card={item.id}
      className={cn(
        "group relative flex flex-1 flex-col rounded-[var(--radius-card)] border bg-surface p-1.5 transition-[border-color,box-shadow,transform] duration-[250ms] ease-[var(--ease-out)] prow:flex-row prow:items-center prow:gap-3 prow:rounded-[22px] prow:p-[7px] prow:pe-3 pcard:rounded-[22px] pcard:p-1",
        isSelected
          ? "border-brand shadow-[0_0_0_1px_var(--brand)]"
          : "border-line shadow-card hover:-translate-y-[3px] hover:border-line-strong hover:shadow-lift active:shadow-lift",
        fresh === "new" && "fill-in",
        fresh === "bump" && "bump",
      )}
    >
      <button
        type="button"
        onClick={(e) => (selecting || e.metaKey || e.ctrlKey ? s.toggleSelect(item.id, e.shiftKey ? { range: order } : undefined) : morphOpen(item.id, () => s.openItem(item.id)))}
        className="absolute inset-0 z-[1] rounded-[var(--radius-card)] max-sm:rounded-[22px]"
        aria-label={item.title}
      />

      {/* A status change sweeps a soft tint across the card (not on first paint). */}
      {sweep && <span key={item.status} aria-hidden className="status-sweep pointer-events-none absolute inset-0 z-[3] overflow-hidden rounded-[inherit]" />}
      <div className="relative prow:shrink-0" data-card-img>
        <ProductImage src={item.imageUrl} alt="" pending={s.imagePending.has(item.id)} className="aspect-[5/4] w-full rounded-[var(--radius-tile)] prow:size-14 prow:rounded-[17px] pcard:aspect-square pcard:rounded-[18px]" iconClass="prow:size-6" />
        {item.imageSource === "icon" && (
          <span className="pointer-events-none absolute bottom-2 start-2 rounded-full bg-surface/90 px-2 py-0.5 text-[10.5px] font-bold text-muted max-sm:hidden" title={t.item.iconHint}>
            {t.item.iconBadge}
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-[9px] top-[9px] flex items-start justify-between gap-2 prow:hidden pcard:inset-x-1.5 pcard:top-1.5">
          <span className="relative min-w-0">
            {category && (
              <span className={cn("block truncate rounded-full bg-surface px-[9px] py-1 text-[11px] font-bold text-muted transition-opacity max-sm:hidden", (selecting || isSelected) ? "opacity-0" : "sm:group-hover:opacity-0")}>
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
            {item.status === "to_buy" && (
              <button
                type="button"
                onClick={() => s.setCompareItemId(item.id)}
                title={t.compare.button}
                aria-label={t.compare.button}
                className="grid size-8 place-items-center rounded-full bg-surface text-ink shadow-card transition hover:bg-surface-2"
              >
                <Scale className="size-4" />
              </button>
            )}
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

      <div className="flex flex-1 flex-col gap-[5px] px-2 pb-1.5 pt-2.5 prow:min-w-0 prow:gap-[3px] prow:p-0 pcard:gap-1 pcard:px-1.5 pcard:pb-1 pcard:pt-2">
        <h3 className="bidi line-clamp-2 min-h-[2.7em] text-[14px] font-semibold leading-[1.35] text-ink prow:line-clamp-1 prow:min-h-0 prow:font-bold pcard:text-[13px]">
          {item.priority === "urgent" && item.status === "to_buy" && <i aria-hidden className="me-1.5 hidden size-2 rounded-full bg-danger align-middle prow:inline-block" />}
          {item.title}
        </h3>
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
          {category && collection && <span aria-hidden className="hidden prow:inline">·</span>}
          {category && <span className="hidden min-w-0 truncate prow:block">{t.categories[category]}</span>}
        </div>
        <div className="mt-auto flex min-h-[34px] items-center gap-2 pt-0.5 prow:hidden pcard:min-h-0 pcard:pt-0">
          <CardPrice item={item} className="pcard:text-[17px]" />
          {item.quantity > 1 && item.status === "to_buy" && <span className="tabular hidden text-[12px] font-semibold text-muted pcard:inline" dir="ltr">×{item.quantity}</span>}
          {item.status === "to_buy" ? (
            <QtyStepper item={item} className="relative z-[2] ms-auto max-sm:hidden" />
          ) : (
            <span className="ms-auto min-w-0 truncate text-end text-[11.5px] leading-tight max-sm:hidden">
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
      <span className="hidden shrink-0 flex-col items-end gap-0.5 prow:flex">
        <CardPrice item={item} className="text-[16px]" />
        {item.quantity > 1 && <span className="tabular text-[11px] text-muted" dir="ltr">×{item.quantity}</span>}
      </span>
    </article>
    </div>
  );
}

const SWIPE_AT = 84;

/** Horizontal swipe on phone rows (vertical scrolling stays native). RTL: "toward the end" is to the left. */
function useRowSwipe(onEnd: () => void, onStart: () => void, enabled: boolean) {
  const [dx, setDx] = useState(0);
  const st = useRef<{ x: number; y: number; on: boolean; dir: number } | null>(null);
  const swiped = useRef(false);
  const handlers = enabled
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType === "mouse" || !window.matchMedia("(max-width: 639px)").matches || !(e.currentTarget as HTMLElement).closest('[data-phone-layout="rows"]')) return;
          st.current = { x: e.clientX, y: e.clientY, on: false, dir: document.documentElement.dir === "rtl" ? -1 : 1 };
          swiped.current = false;
        },
        onPointerMove: (e: React.PointerEvent) => {
          const g = st.current;
          if (!g) return;
          const mx = e.clientX - g.x;
          const my = e.clientY - g.y;
          if (!g.on) {
            if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return void (st.current = null);
            if (Math.abs(mx) < 12) return;
            g.on = true;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          }
          setDx(Math.max(-140, Math.min(140, mx * 0.9)));
        },
        onPointerUp: () => {
          const g = st.current;
          st.current = null;
          if (!g?.on) return;
          swiped.current = true;
          const towardEnd = dx * g.dir > 0;
          if (Math.abs(dx) >= SWIPE_AT) {
            try {
              navigator.vibrate?.(20);
            } catch {}
            if (towardEnd) onEnd();
            else onStart();
          }
          setDx(0);
        },
        onPointerCancel: () => {
          st.current = null;
          setDx(0);
        },
        onClickCapture: (e: React.MouseEvent) => {
          if (swiped.current) {
            e.stopPropagation();
            e.preventDefault();
            swiped.current = false;
          }
        },
      }
    : {};
  return { dx, handlers };
}

/** Card price: big and plain (no tag), "No price" muted. */
export function CardPrice({ item, className }: { item: ItemWithSources; className?: string }) {
  const s = useDataStore();
  const { t, locale } = useI18n();
  const unit = unitPrice(item, s.rates, s.currency);
  // No price: always small and muted (the size override is for real prices).
  if (unit == null) return <span className="text-[13px] font-medium text-muted">{t.item.noPrice}</span>;
  return <span className={cn("tabular text-[19px] font-black tracking-[-0.02em] text-ink", className)}>{formatMoney(unit, s.currency, locale)}</span>;
}

/** − qty + on the card; saves right away (optimistic), reverts on error. */
export function QtyStepper({ item, className }: { item: ItemWithSources; className?: string }) {
  const s = useDataStore();
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
  const s = useDataStore();
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
