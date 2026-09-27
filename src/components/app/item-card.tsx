"use client";

import { useState } from "react";
import { Check, ExternalLink, Package, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { setPurchased } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { activeSource, cheapestSource, lineTotal, unitPrice } from "@/lib/calc";
import { convert, formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";

export function ProductImage({ src, alt, className, iconClass }: { src: string | null; alt: string; className?: string; iconClass?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn("relative grid place-items-center overflow-hidden bg-tile", className)}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote store images; thumbnails are pre-sized WebP
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-contain p-[9%] mix-blend-multiply" />
      ) : (
        <Package className={cn("size-8 text-[#b9b4a8]", iconClass)} strokeWidth={1.4} />
      )}
    </div>
  );
}

export function usePurchaseToggle() {
  const s = useStore();
  const { t } = useI18n();
  return async (item: ItemWithSources) => {
    const purchasing = item.status === "to_buy";
    const src = activeSource(item, s.rates);
    const paid = purchasing && src?.price != null ? { price: src.price + (src.shipping ?? 0), currency: src.currency } : null;
    const optimistic: ItemWithSources = purchasing
      ? { ...item, status: "purchased", purchasedAt: Date.now(), purchasedPrice: paid?.price ?? null, purchasedCurrency: paid?.currency ?? null }
      : { ...item, status: "to_buy", purchasedAt: null, purchasedPrice: null, purchasedCurrency: null };
    s.upsertItem(optimistic);
    try {
      s.upsertItem(await setPurchased(item.id, purchasing, paid));
      if (purchasing)
        toast.success(t.item.markPurchased, {
          description: item.title,
          action: {
            label: t.item.undo,
            onClick: async () => s.upsertItem(await setPurchased(item.id, false)),
          },
        });
    } catch {
      s.upsertItem(item);
      toast.error(t.errors.generic);
    }
  };
}

export function PriceTag({ item, size = "md" }: { item: ItemWithSources; size?: "md" | "lg" }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const unit = unitPrice(item, s.rates, s.currency);
  if (unit == null) return <span className={cn("price-tag muted", size === "lg" ? "text-base" : "text-[13px]")}>{t.item.noPrice}</span>;
  return <span className={cn("price-tag", size === "lg" ? "text-lg" : "text-[14px]")}>{formatMoney(unit, s.currency, locale)}</span>;
}

export function ItemCard({ item }: { item: ItemWithSources }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const toggle = usePurchaseToggle();
  const src = activeSource(item, s.rates);
  const cheapest = cheapestSource(item, s.rates);
  const collection = item.collectionId ? s.collections.find((c) => c.id === item.collectionId) : null;
  const total = lineTotal(item, s.rates, s.currency);
  const stores = Array.from(new Set(item.sources.map((x) => x.store)));
  const purchased = item.status === "purchased";

  // Savings hint: how much cheaper the best store is than the priciest one.
  let spread: number | null = null;
  if (item.sources.length > 1 && cheapest) {
    const vals = item.sources.filter((x) => x.price != null).map((x) => convert(x.price! + (x.shipping ?? 0), x.currency, s.currency, s.rates));
    if (vals.length > 1) spread = Math.max(...vals) - Math.min(...vals);
  }

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card",
      )}
    >
      <button type="button" onClick={() => s.openItem(item.id)} className="absolute inset-0 z-[1] rounded-[var(--radius-card)]" aria-label={item.title} />

      <div className="relative">
        <ProductImage src={item.imageUrl} alt="" className="aspect-[5/4] w-full" />
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {item.priority === "urgent" && !purchased && <span className="rounded-md bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-white">{t.item.urgent}</span>}
            {item.priority === "someday" && !purchased && <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">{t.item.someday}</span>}
          </div>
          <div className="flex gap-1">
            {purchased && (
              <span className="grid size-6 place-items-center rounded-md bg-ok text-white" title={t.nav.history}>
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            )}
            {item.quantity > 1 && (
              <span dir="ltr" className="tabular rounded-md bg-black/70 px-1.5 py-0.5 text-[12px] font-semibold text-white backdrop-blur">
                ×{item.quantity}
              </span>
            )}
          </div>
        </div>

        <div className="absolute bottom-2.5 end-2.5 z-[2] flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100">
          {src && (
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              title={t.item.openStore}
              aria-label={t.item.openStore}
              className="grid size-8 place-items-center rounded-lg bg-white/90 text-[#14171b] shadow-card backdrop-blur transition hover:bg-white"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
          <button
            type="button"
            onClick={() => void toggle(item)}
            title={purchased ? t.item.markToBuy : t.item.markPurchased}
            aria-label={purchased ? t.item.markToBuy : t.item.markPurchased}
            className={cn("grid size-8 place-items-center rounded-lg shadow-card backdrop-blur transition", purchased ? "bg-white/90 text-[#14171b] hover:bg-white" : "bg-ok text-white hover:brightness-110")}
          >
            {purchased ? <Undo2 className="size-4" /> : <Check className="size-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5 pt-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <span className="truncate font-medium">{stores[0] ?? "—"}</span>
          {stores.length > 1 && (
            <span dir="ltr" className="shrink-0 rounded bg-sunken px-1 text-[11px] text-muted">
              +{stores.length - 1}
            </span>
          )}
          {collection && (
            <>
              <span className="text-faint">·</span>
              <span className="flex min-w-0 items-center gap-1 truncate">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: COLLECTION_COLORS[collection.color] }} />
                <span className="truncate">{collection.name}</span>
              </span>
            </>
          )}
        </div>
        <h3 className="line-clamp-2 text-[14.5px] font-medium leading-snug text-fg" dir="auto">
          {item.title}
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <PriceTag item={item} />
          <div className="text-end text-[11.5px] leading-tight text-faint">
            {purchased && item.purchasedAt ? (
              <span className="text-ok">{f(t.item.purchasedOn, { date: new Date(item.purchasedAt).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short" }) })}</span>
            ) : item.quantity > 1 && total != null ? (
              <span className="tabular">
                {t.item.total} {formatMoney(total, s.currency, locale)}
              </span>
            ) : spread != null && spread > 0 ? (
              <span className="tabular font-medium text-accent-ink">{f(t.item.saveUpTo, { amount: formatMoney(Math.round(spread), s.currency, locale) })}</span>
            ) : src?.shipping == null && src?.price != null && !purchased ? (
              <span>{t.item.shippingUnknown}</span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ItemCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="skeleton aspect-[5/4] w-full" />
      <div className="space-y-2.5 p-3.5">
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-2/3 rounded" />
        <div className="skeleton mt-3 h-6 w-20 rounded" />
      </div>
    </div>
  );
}
