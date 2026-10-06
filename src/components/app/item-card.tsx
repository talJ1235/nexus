"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Flag, FolderInput, Inbox, Minus, Package, Plus, Split, Trash2, Truck } from "lucide-react";
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
import { AddedBy } from "./spaces/space-ui";
import { useReadOnly } from "./offline-banner";
import { useMedia } from "@/components/ui/use-media";
import { COLLECTION_COLORS } from "./view-items";
import { pictureStyleOf } from "@/lib/picture-url";
import { revealAt, swipeRelease, velocity } from "@/lib/gestures";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { DeliveryTrack } from "./delivery-track";
import { dayKeyIn, deliveryTrack } from "@/lib/home";
import { ItemContextMenu, openItemActions, SHORTCUT, StatusIcon, statusActs, useActionLabels, useItemActions } from "./quick-actions";

/**
 * The one product picture frame (Round 11 D1), used everywhere a product picture shows. Cut-outs — and pictures not
 * normalized yet — sit on a white "paper" tile (slightly dimmed in dark mode, hairline edge); photos fill the frame.
 * The style comes from the stored file name (lib/picture-url.ts).
 */
export function ProductImage({ src, alt, className, iconClass, pending, ...rest }: { src: string | null; alt: string; className?: string; iconClass?: string; pending?: boolean } & React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | boolean>) {
  const [failed, setFailed] = useState(false);
  const shown = !!src && !failed;
  const style = shown ? pictureStyleOf(src) : null;
  return (
    <div {...rest} data-pic={shown ? (style ?? "raw") : undefined} className={cn("relative grid place-items-center overflow-hidden", shown ? (style === "photo" ? "bg-tile" : "pic-paper") : "bg-tile", pending && !src && "shimmer", className)}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote store images; thumbnails are pre-sized WebP
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          // Fade in once decoded. Cached images may finish before hydration, so check `complete` on mount too.
          ref={(el) => {
            if (!el?.complete) return;
            if (el.naturalWidth) el.dataset.loaded = "";
            else setFailed(true); // failed before hydration (onError never fired): show the placeholder
          }}
          onLoad={(e) => {
            e.currentTarget.dataset.loaded = "";
          }}
          onError={() => setFailed(true)}
          className={cn(
            "product-img size-full transition-[opacity,transform] duration-[450ms] ease-[var(--ease-out)] group-hover:scale-[1.04]",
            style === "photo" ? "object-cover" : "object-contain",
            !style && "p-[8%]",
          )}
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
  const ro = useReadOnly();
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

  const acts = useItemActions();
  const labels = useActionLabels();
  const moves = statusActs(item.status);
  const [leaving, setLeaving] = useState(false);
  // Phone rows: swipe toward the start edge = Delete, toward the end edge = status blocks; long-press = select.
  // Phone cards: long-press = the action sheet (Round 11 C1).
  const g = useCardGestures({
    enabled: !ro.ro,
    blocks: moves.length,
    onRowHold: () => s.toggleSelect(item.id),
    onCardHold: () => openItemActions([item.id]),
    onDelete: () => void acts.remove([item]),
  });
  const leave = (fn: () => unknown) => {
    setLeaving(true);
    setTimeout(fn, 200);
  };

  const category = normalizeCategory(item.category);
  const flag =
    item.status === "ordered" ? { label: t.flow.ordered, tone: "info", icon: <Truck className="size-3" /> }
    : item.status === "purchased" ? { label: t.flow.received, tone: "ok", icon: <Check className="size-3" strokeWidth={3} /> }
    : item.priority === "urgent" ? { label: t.item.urgent, tone: "urgent", icon: <Flag className="size-3" strokeWidth={2.6} /> }
    : atLowest ? { label: t.item.lowestShort, tone: "low", title: t.history.atLowest }
    : item.priority === "someday" ? { label: t.item.someday, tone: "muted" }
    : null;

  const side = Math.sign(g.dx * (dir === "rtl" ? -1 : 1));
  const [firstStatus] = useState(item.status);
  const sweep = firstStatus !== item.status;
  return (
    <div className={cn("relative flex flex-col", leaving && "row-leave")} data-swipe-held={g.held || undefined}>
      {/* Phone row swipe layers (behind the row): status blocks at the start edge, Delete at the end edge. */}
      {side > 0 && (
        <div dir={dir} className="absolute inset-0 hidden overflow-hidden rounded-[12px] prow:flex" data-swipe-layer="status">
          {moves.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => {
                g.close();
                leave(() => acts.setStatus([item], x));
              }}
              className={cn(
                "flex w-[84px] shrink-0 flex-col items-center justify-center gap-1 text-[11.5px] font-bold text-white",
                x === "ordered" ? "bg-info" : x === "purchased" ? "bg-ok" : "bg-ink text-bg",
              )}
              data-swipe-action={x}
            >
              <StatusIcon status={x} className="size-5" />
              {labels.status(x)}
            </button>
          ))}
        </div>
      )}
      {side < 0 && (
        <div dir={dir} className="absolute inset-0 hidden justify-end overflow-hidden rounded-[12px] bg-danger prow:flex" data-swipe-layer="delete">
          <button type="button" onClick={() => leave(() => acts.remove([item]))} className="flex w-[92px] flex-col items-center justify-center gap-1 text-[11.5px] font-bold text-white" data-swipe-action="delete">
            <Trash2 className="size-5" />
            {t.quick.delete}
          </button>
        </div>
      )}
    <ItemContextMenu item={item}>
    <article
      draggable={!g.touch}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-nexus-items", JSON.stringify(dragIds(item.id, s.selected)));
        e.dataTransfer.effectAllowed = "move";
      }}
      {...g.handlers}
      style={g.dx ? { transform: `translateX(${g.dx}px)`, transition: g.dragging ? "none" : "transform 260ms var(--ease-out)" } : undefined}
      data-item-card={item.id}
      className={cn(
        "group relative flex flex-1 flex-col rounded-[var(--radius-card)] border bg-surface p-1.5 prow:touch-pan-y transition-[border-color,box-shadow,transform] duration-[250ms] ease-[var(--ease-out)] prow:flex-row prow:items-center prow:gap-[11px] prow:rounded-[12px] prow:px-3 prow:py-2.5 pcard:overflow-hidden pcard:rounded-[12px] pcard:p-0",
        isSelected
          ? "border-brand shadow-[0_0_0_1px_var(--brand)]"
          : "border-line shadow-card hover:-translate-y-[3px] hover:border-line-strong hover:shadow-lift active:shadow-lift max-sm:border-card-line max-sm:shadow-[var(--card-shadow)]",
        fresh === "new" && "fill-in",
        fresh === "bump" && "bump",
      )}
    >
      <button
        type="button"
        onClick={(e) => (selecting || e.metaKey || e.ctrlKey ? s.toggleSelect(item.id, e.shiftKey ? { range: order } : undefined) : morphOpen(item.id, () => s.openItem(item.id)))}
        className="absolute inset-0 z-[1] rounded-[var(--radius-card)] max-sm:rounded-[12px]"
        aria-label={item.title}
      />

      {/* A status change sweeps a soft tint across the card (not on first paint). */}
      {sweep && <span key={item.status} aria-hidden className="status-sweep pointer-events-none absolute inset-0 z-[3] overflow-hidden rounded-[inherit]" />}
      <div className="relative prow:shrink-0" data-card-img>
        <ProductImage src={item.imageUrl} alt="" pending={s.imagePending.has(item.id)} className="aspect-[5/4] w-full rounded-[var(--radius-tile)] prow:size-[42px] prow:rounded-[9px] pcard:aspect-[4/3] pcard:rounded-none pcard:border-b pcard:border-line-in" iconClass="prow:size-5" />
        {item.imageSource === "icon" && (
          <span className="nx-tag pointer-events-none absolute bottom-2 start-2 max-sm:hidden" data-tone="muted" title={t.item.iconHint}>
            {t.item.iconBadge}
          </span>
        )}
        <span className="pointer-events-none absolute start-2 top-2 hidden pcard:block">
          {item.status === "ordered" ? <EtaPill item={item} solid /> : item.priority === "urgent" && item.status === "to_buy" ? <UrgentPill /> : null}
        </span>
        {collection && (
          <span className="pointer-events-none absolute bottom-2 start-2 hidden max-w-[calc(100%-16px)] items-center gap-[5px] rounded-full border border-[#e5e5e1] bg-white/90 px-[7px] py-px text-[10.5px] font-semibold text-[#3a3a3a] pcard:flex">
            <i className="size-[7px] shrink-0 rounded-full" style={{ background: COLLECTION_COLORS[collection.color] }} />
            <span className="bidi truncate">{collection.name}</span>
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-[9px] top-[9px] flex items-start justify-between gap-2 prow:hidden pcard:hidden">
          <span className="relative min-w-0">
            {category && (
              <span className={cn("nx-tag transition-opacity max-sm:hidden", (selecting || isSelected) ? "opacity-0" : "sm:group-hover:opacity-0")} data-tone="muted" data-tag="category">
                <span>{t.categories[category]}</span>
              </span>
            )}
            <SelectBox
              checked={isSelected}
              onToggle={(e) => s.toggleSelect(item.id, e.shiftKey ? { range: order } : undefined)}
              className={cn("pointer-events-auto absolute start-0 top-0 z-[2]", !selecting && !isSelected && "opacity-0 group-hover:opacity-100 max-sm:hidden")}
            />
          </span>
          <span className={cn("flex shrink-0 gap-1 transition-opacity", !selecting && "sm:group-hover:opacity-0 sm:group-focus-within:opacity-0")}>
            {item.quantity > 1 && item.status !== "to_buy" && (
              <span dir="ltr" className="nx-tag tabular">×{item.quantity}</span>
            )}
            {flag && (
              <span title={flag.title} className="nx-tag" data-tone={flag.tone} data-tag="flag">
                {flag.icon}
                {flag.label}
              </span>
            )}
          </span>
        </div>

        {!selecting && <HoverBar item={item} moves={moves} />}
      </div>

      <div className="flex flex-1 flex-col gap-[5px] px-2 pb-1.5 pt-2.5 prow:min-w-0 prow:gap-[2px] prow:p-0 pcard:gap-0.5 pcard:px-[11px] pcard:pb-[11px] pcard:pt-[9px]">
        <h3 className="bidi line-clamp-2 min-h-[2.7em] text-[14px] font-semibold leading-[1.35] text-ink prow:line-clamp-1 prow:min-h-0 prow:text-[13.5px] pcard:min-h-[34px] pcard:text-[13px] pcard:leading-[1.3]">
          {item.title}
        </h3>
        {/* Phones show the store here (rows are grouped by project; cards carry a project pill). */}
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted pcard:text-[11.5px]">
          <AddedBy userId={item.addedByUserId} />
          {collection && (
            <>
              <i className={cn("size-2 shrink-0 max-sm:hidden", collection.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[collection.color] }} />
              <span className="bidi min-w-0 truncate max-sm:hidden">{collection.name}</span>
            </>
          )}
          {collection && stores[0] && <span aria-hidden className="max-sm:hidden">·</span>}
          {stores[0] && <span className="min-w-0 truncate">{stores[0]}</span>}
          {stores.length > 1 && (
            <span dir="ltr" className="shrink-0 text-[11px] max-sm:hidden">
              +{stores.length - 1}
            </span>
          )}
          {item.status === "ordered" && total != null && (
            <span className="hidden min-w-0 shrink-0 prow:inline">
              · <span className="tabular">{formatMoney(total, s.currency, locale)}</span>
            </span>
          )}
          {!stores[0] && category && <span className="hidden min-w-0 truncate max-sm:block">{t.categories[category]}</span>}
        </div>
        {/* On the way, phones: the 4-segment track (with stage names in the list). */}
        {item.status === "ordered" && <PhoneTrack item={item} />}
        <div className={cn("mt-auto flex min-h-[34px] items-center gap-2 pt-0.5 prow:hidden pcard:min-h-0 pcard:pt-[3px]", item.status === "ordered" && "pcard:hidden")}>
          <CardPrice item={item} className="pcard:text-[15px]" />
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
      {/* Phone rows, end side: Urgent pill + price (To buy), the ETA pill (On the way). */}
      <span className="hidden shrink-0 items-center gap-2 prow:flex">
        {item.status === "ordered" ? (
          <EtaPill item={item} />
        ) : (
          <>
            {item.priority === "urgent" && item.status === "to_buy" && <UrgentPill />}
            <span className="flex flex-col items-end gap-0.5">
              <CardPrice item={item} className="text-[14px]" />
              {item.quantity > 1 && <span className="tabular text-[11px] text-muted" dir="ltr">×{item.quantity}</span>}
            </span>
          </>
        )}
      </span>
    </article>
    </ItemContextMenu>
    </div>
  );
}

function UrgentPill() {
  const { t } = useI18n();
  return (
    <span className="rounded-full bg-ink px-[7px] py-0.5 text-[10.5px] font-bold text-bg" data-pill="urgent">
      {t.shopTab.urgent}
    </span>
  );
}

/** On the way: when it arrives (info), or late (warn), or no date — the same rules as the track (lib/home). */
function EtaPill({ item, solid }: { item: ItemWithSources; solid?: boolean }) {
  const s = useDataStore();
  const { t, f, locale } = useI18n();
  const tr = deliveryTrack(item, s.clock.now, s.clock.tz);
  let label = t.shopTab.noDate;
  if (tr.late) {
    const days = Math.round((Date.parse(dayKeyIn(s.clock.now, s.clock.tz)) - Date.parse(dayKeyIn(item.eta!, s.clock.tz))) / 86_400_000);
    label = days > 1 ? f(t.shopTab.daysLate, { n: days }) : t.shopTab.late;
  } else if (item.eta != null) {
    const ahead = (item.eta - s.clock.now) / 86_400_000;
    label = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", ahead < 6.5 ? { weekday: "short", timeZone: s.clock.tz } : { day: "numeric", month: "short", timeZone: s.clock.tz }).format(new Date(item.eta));
  }
  return (
    // On a picture (grid cards) the pill is a solid fill, like every tag over pictures (Round 11 D2).
    <span className={cn("whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-bold", solid ? (tr.late ? "bg-warn text-bg" : item.eta != null ? "bg-info text-bg" : "bg-ink text-bg") : tr.late ? "bg-warn-soft text-warn" : item.eta != null ? "bg-info-soft text-info" : "bg-surface-2 text-muted")} data-pill="eta" data-late={tr.late || undefined} suppressHydrationWarning>
      {label}
    </span>
  );
}

function PhoneTrack({ item }: { item: ItemWithSources }) {
  const s = useDataStore();
  const tr = deliveryTrack(item, s.clock.now, s.clock.tz);
  return (
    <>
      <DeliveryTrack track={tr} labels className="mt-1.5 hidden prow:block" />
      <DeliveryTrack track={tr} className="mt-1.5 hidden pcard:block" />
    </>
  );
}

/** Desktop: hover (or keyboard focus) shows the card's quick actions — status, Move, Delete — with their keys, in the
 *  picture's top-end corner (the flags step aside), away from the middle of the card where people click to open it. */
function HoverBar({ item, moves }: { item: ItemWithSources; moves: Status[] }) {
  const s = useDataStore();
  const { t } = useI18n();
  const ro = useReadOnly();
  const acts = useItemActions();
  const labels = useActionLabels();
  const btn = "grid size-7 place-items-center rounded-full bg-surface text-ink shadow-card transition hover:bg-surface-2 disabled:opacity-50 [&_svg]:size-[15px]";
  const collections = s.collections.filter((c) => !c.archived);
  return (
    <div className="pointer-events-none absolute end-[9px] top-[9px] z-[2] flex gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 max-sm:hidden" data-hover-bar>
      {moves.map((x, i) => (
        <button
          key={x}
          type="button"
          onClick={() => void acts.setStatus([item], x)}
          disabled={ro.ro}
          title={ro.title ?? labels.tip(labels.status(x), SHORTCUT[x])}
          aria-label={labels.status(x)}
          className={cn(btn, i === 0 && "bg-brand text-on-brand hover:bg-brand-hover")}
          data-hover-action={x}
        >
          <StatusIcon status={x} />
        </button>
      ))}
      <Menu>
        <MenuTrigger asChild>
          <button type="button" disabled={ro.ro} title={ro.title ?? labels.tip(t.quick.moveShort, SHORTCUT.move)} aria-label={t.quick.move} className={btn} data-hover-action="move">
            <FolderInput />
          </button>
        </MenuTrigger>
        <MenuContent align="end" className="max-h-80 overflow-y-auto">
          <MenuItem onSelect={() => void acts.move([item], null)}>
            <Inbox /> {t.nav.unsorted}
          </MenuItem>
          <MenuSeparator />
          {collections.map((c) => (
            <MenuItem key={c.id} onSelect={() => void acts.move([item], c.id)}>
              <i className={cn("size-2.5 shrink-0", c.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
              <span className="bidi truncate">{c.name}</span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <button type="button" onClick={() => void acts.remove([item])} disabled={ro.ro} title={ro.title ?? labels.tip(t.quick.delete, SHORTCUT.delete)} aria-label={t.quick.delete} className={cn(btn, "hover:text-danger")} data-hover-action="delete">
        <Trash2 />
      </button>
    </div>
  );
}

const BLOCK = 84;
const DEL_W = 92;
const HOLD_MS = 480;
/** Only one row is held open at a time: the row that holds it (its stable close ref). */
let heldRow: { current: () => void } | null = null;
const tick = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

/**
 * Phone gestures on a product (Round 11 C1). Rows (`[data-phone-layout=rows]`): swipe toward the start edge reveals
 * Delete (a full swipe deletes), toward the end edge the status blocks; past the threshold the row stays open until a
 * tap. Long-press: a row toggles selection, a grid card opens the action sheet. Vertical scrolling stays native; RTL
 * mirrors the directions (the dock stays LTR). Haptic tick at each threshold.
 * Round 12 #2: both directions use one rule (`swipeRelease`): the distance decides — past 40 % of that side's actions
 * the row snaps open and stays, below it closes — and a fast fling decides too. The release reads the live offset
 * (a ref, not the last rendered state), and a pointer cancelled after the drag began is released the same way.
 */
function useCardGestures({ enabled, blocks, onRowHold, onCardHold, onDelete }: { enabled: boolean; blocks: number; onRowHold: () => void; onCardHold: () => void; onDelete: () => void }) {
  const [dx, setDx] = useState(0);
  const [held, setHeld] = useState<0 | 1 | -1>(0);
  const [dragging, setDragging] = useState(false);
  const touch = useMedia("(hover: none) and (pointer: coarse)");
  const st = useRef<{ x: number; y: number; base: number; cur: number; on: boolean; rows: boolean; dir: 1 | -1; w: number; ticks: Set<string>; timer: number; samples: { t: number; v: number }[] } | null>(null);
  const suppress = useRef(false);
  const close = () => {
    setDx(0);
    setHeld(0);
    if (heldRow === closeRef) heldRow = null;
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  const hold = (side: 0 | 1 | -1, x: number) => {
    setDx(x);
    setHeld(side);
    if (side) {
      // Round 12 #2: compare the stable ref — comparing a fresh closure never matched, so a row held open a second
      // time (after a tap closed it) closed itself straight away.
      if (heldRow && heldRow !== closeRef) heldRow.current();
      heldRow = closeRef;
    }
  };
  if (!enabled) return { dx: 0, held: 0, dragging: false, touch, close, handlers: {} };
  const release = (cancelled: boolean) => {
    const g = st.current;
    st.current = null;
    if (!g) return;
    clearTimeout(g.timer);
    setDragging(false);
    if (!g.on) {
      // A tap on a row that is held open just closes it; a cancelled touch (the page scrolled) leaves it as it was.
      if (held && !cancelled) {
        suppress.current = true;
        close();
      } else if (!held) setDx(0);
      return;
    }
    suppress.current = true;
    g.samples.push({ t: performance.now(), v: g.cur }); // a finger that stopped before lifting is not a fling
    const res = swipeRelease({ dx: g.cur, vx: velocity(g.samples), dir: g.dir, statusW: blocks * BLOCK, deleteW: DEL_W, rowW: g.w });
    if (res === "remove") {
      setDx(-g.w * g.dir);
      setHeld(0);
      setTimeout(onDelete, 180);
    } else if (res === "delete") hold(-1, -DEL_W * g.dir);
    else if (res === "status") hold(1, blocks * BLOCK * g.dir);
    else close();
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" || !window.matchMedia("(max-width: 639px)").matches) return;
      const el = e.currentTarget as HTMLElement;
      const rows = !!el.closest('[data-phone-layout="rows"]');
      const dir: 1 | -1 = document.documentElement.dir === "rtl" ? -1 : 1;
      const timer = window.setTimeout(() => {
        const g = st.current;
        if (!g || g.on) return;
        st.current = null;
        suppress.current = true;
        tick(14);
        if (g.rows) onRowHold();
        else onCardHold();
      }, HOLD_MS);
      st.current = { x: e.clientX, y: e.clientY, base: dx, cur: dx, on: false, rows, dir, w: el.offsetWidth, ticks: new Set(), timer, samples: [] };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = st.current;
      if (!g) return;
      const mx = e.clientX - g.x;
      const my = e.clientY - g.y;
      if (Math.abs(mx) > 8 || Math.abs(my) > 8) clearTimeout(g.timer);
      if (!g.rows) {
        if (Math.abs(mx) > 8 || Math.abs(my) > 8) st.current = null;
        return;
      }
      if (!g.on) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return void (st.current = null);
        if (Math.abs(mx) < 12) return;
        g.on = true;
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      const statusW = blocks * BLOCK;
      let logical = (g.base + mx) * g.dir;
      if (logical > statusW) logical = statusW + (logical - statusW) * 0.25; // rubber band past the blocks
      logical = Math.max(-g.w, logical);
      for (const [k, hit] of [["s", logical >= revealAt(statusW)], ["d", logical <= -revealAt(DEL_W)], ["f", logical <= -g.w * 0.5]] as const) {
        if (hit && !g.ticks.has(k)) {
          g.ticks.add(k);
          tick();
        } else if (!hit) g.ticks.delete(k);
      }
      g.cur = logical * g.dir;
      g.samples.push({ t: performance.now(), v: g.cur });
      if (g.samples.length > 8) g.samples.shift();
      setDx(g.cur);
    },
    onPointerUp: () => release(false),
    onPointerCancel: () => release(true),
    onClickCapture: (e: React.MouseEvent) => {
      if (suppress.current) {
        e.stopPropagation();
        e.preventDefault();
        suppress.current = false;
      }
    },
    // Long-press must not open the browser's own menu / image callout on phones.
    onContextMenu: (e: React.MouseEvent) => {
      if (window.matchMedia("(max-width: 639px)").matches && touch) e.preventDefault();
    },
  };
  return { dx, held, dragging, touch, close, handlers };
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

export function ItemCardSkeleton({ badge }: { badge?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-1.5">
      <div className="relative">
        <div className="skeleton aspect-[4/3] w-full rounded-[var(--radius-tile)]" />
        {badge && <span className="absolute end-2 top-2 h-[22px] w-[74px] rounded-full bg-surface/80" />}
      </div>
      <div className="space-y-2.5 p-3.5">
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-2/3 rounded" />
        <div className="skeleton mt-3 h-6 w-20 rounded" />
      </div>
    </div>
  );
}
