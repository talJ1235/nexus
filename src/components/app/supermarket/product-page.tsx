"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, Minus, Pencil, Plus, Tag } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useBackClose } from "@/components/ui/sheet-drag";
import { addToSupermarket, setProductLearned, smProductPage, updateSmItem } from "@/app/supermarket-actions";
import { chainById } from "@/lib/grocery/chains";
import { sectionName } from "@/lib/grocery/sections";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile } from "./art";
import { Money } from "./money";
import { asItem } from "./numbers";
import { countOf, withCountOf } from "./qty-steppers";
import { ChainLogo } from "./store-picker";

// R19 D2 (boards Product-phone, Product-desktop) — the product page: a real photo, name, brand, size, barcode, tags
// (section, ₪ per 100 g); the price at my store with the deal tip ("verify at the till"); the same product at every
// chain (a bar per price, the cheapest marked, mine highlighted); 90 days of my chain's price; same type, cheaper (by unit
// price); "what Nexus learned"; a count stepper + "In the list". Opened from a row (A5), the search (D5), compare (D3).

const EVENT = "nexus:sm-product";
export type ProductTarget = { gtin: string; itemId?: string | null };
export function openProduct(t: ProductTarget) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: t }));
}

type Data = NonNullable<Awaited<ReturnType<typeof smProductPage>>>;
const noSub = () => () => {};

export function ProductPage({ onEdit }: { onEdit?: (itemId: string) => void }) {
  const [target, setTarget] = useState<ProductTarget | null>(null);
  const hydrated = useSyncExternalStore(noSub, () => true, () => false);
  useEffect(() => {
    const on = (e: Event) => setTarget((e as CustomEvent<ProductTarget>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const { t } = useI18n();
  const open = target != null;
  useBackClose(open, () => setTarget(null));
  if (!hydrated) return null;
  return (
    <D.Root open={open} onOpenChange={(o) => !o && setTarget(null)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 overlay-in phone:hidden" />
        <D.Content className="sm-push fixed inset-0 z-50 flex flex-col bg-bg outline-none phone:pt-[env(safe-area-inset-top)] desk:inset-x-0 desk:top-[5vh] desk:mx-auto desk:h-[90vh] desk:max-w-[920px] desk:overflow-hidden desk:rounded-2xl desk:border desk:border-line desk:shadow-pop desk:animate-pop-in" aria-describedby={undefined} data-product-page={target?.gtin}>
          <D.Title className="sr-only">{t.sm.product.title}</D.Title>
          {target && <Body key={target.gtin} target={target} onClose={() => setTarget(null)} onOpen={setTarget} onEdit={onEdit} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

const UNIT: Record<string, [string, string]> = { g: ["גרם", "g"], kg: ["ק״ג", "kg"], ml: ["מ״ל", "ml"], l: ["ליטר", "L"], u: ["יח׳", "pcs"] };

function Body({ target, onClose, onOpen, onEdit }: { target: ProductTarget; onClose: () => void; onOpen: (t: ProductTarget) => void; onEdit?: (itemId: string) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const he = locale === "he";
  const [data, setData] = useState<Data | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void smProductPage(target.gtin, target.itemId ?? null).then((d) => live && setData(d), () => live && setData(null));
    return () => {
      live = false;
    };
  }, [target.gtin, target.itemId]);
  const item = target.itemId ? s.sm.find((i) => i.id === target.itemId) : undefined;
  const m = item ? { quantity: item.quantity, count: item.count ?? null, amount: item.amount, unit: item.unit } : null;
  const [n, setN] = useState(() => (m ? (countOf(m, null).shown ?? item!.quantity) : 1));
  const [learned, setLearned] = useState<boolean | null>(null);
  const ro = s.space?.role === "viewer";
  const p = data?.product;
  const size = p && p.qty != null && p.unit ? `${p.qty} ${UNIT[p.unit]?.[he ? 0 : 1] ?? p.unit}` : p?.weighted ? (he ? "לפי משקל" : "by weight") : "";
  const per100 = p && data?.here.price != null && p.qty && (p.unit === "g" || p.unit === "ml") ? (data.here.price / p.qty) * 100 : null;
  const chainName = (id: string | null) => (id ? ((c) => (c ? (he ? c.he : c.en) : id))(chainById(id)) : "");
  const time = (ms: number | null) => (ms ? new Intl.DateTimeFormat(he ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: s.clock.tz }).format(new Date(ms)) : null);
  const dealText = (d: Data["here"]["deals"][number]) =>
    d.kind === "n_for" && d.price != null ? f(t.sm.shelf.nFor, { n: d.n, price: `₪${d.price}` }) : d.kind === "price" && d.price != null ? f(t.sm.shelf.dealPrice, { price: `₪${d.price.toFixed(2)}` }) : d.kind === "pct" && d.rate ? f(t.sm.shelf.pct, { rate: Math.round(d.rate) }) : d.description;
  const save = async () => {
    try {
      if (item && m) {
        const next = withCountOf(m, null, n);
        const r = await updateSmItem(item.id, { quantity: next.quantity, count: next.count, amount: next.amount, unit: (next.unit as "kg" | "g" | "l" | null) ?? null });
        if (r) s.upsertSm([asItem(r)]);
      } else if (p) {
        const r = await addToSupermarket({ title: p.short ?? p.name, qty: n, ...(/^\d{8,14}$/.test(p.gtin) ? { gtin: p.gtin } : {}) });
        s.upsertSm([asItem(r.item)]);
        toast(f(t.sm.product.added, { name: p.short ?? p.name }));
      }
      onClose();
    } catch {
      toast.error(t.sm.sheet.failed);
    }
  };
  const max = Math.max(1, ...(data?.chains ?? []).map((c) => c.price));
  const cheapest = data?.chains[0]?.price ?? null;
  const hist = data?.history ?? [];
  const chart = useMemo(() => histPath(hist), [hist]);
  const lowest = hist.length ? Math.min(...hist.map((h) => h.price)) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 px-2">
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full text-ink active:scale-95" aria-label={t.sm.add.back} data-product-back>
          <ArrowLeft className="size-5 rtl:-scale-x-100" />
        </button>
        <span className="flex-1" />
        {item && onEdit && !ro && (
          <button type="button" onClick={() => (onClose(), onEdit(item.id))} className="grid size-11 place-items-center rounded-full text-muted active:scale-95" aria-label={t.sm.product.edit} title={t.sm.product.edit} data-product-edit>
            <Pencil className="size-[18px]" />
          </button>
        )}
      </div>
      {data === undefined ? (
        <div className="space-y-3 p-4">
          <div className="skeleton-in h-40 rounded-[22px] bg-surface-2" />
          <div className="skeleton-in h-24 rounded-[22px] bg-surface-2" />
        </div>
      ) : !data || !p ? (
        <p className="p-6 text-[14px] text-muted">{t.sm.product.gone}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 desk:grid desk:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] desk:gap-6 desk:px-6" data-product-body>
          <div className="flex flex-col gap-3">
            {/* Hero */}
            <div className="flex items-start gap-3.5">
              <span className="grid size-[112px] shrink-0 place-items-center overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_1px_var(--line-in)]">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a 160 px catalog thumbnail
                  <img src={p.imageUrl} alt="" className="size-full object-contain" data-product-photo />
                ) : (
                  <ProductTile section={p.section} size={96} />
                )}
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <h1 className="bidi text-[20px] font-extrabold leading-tight" data-product-name>{p.name}</h1>
                <p className="bidi mt-0.5 text-[13.5px] text-muted">{[p.brand, size].filter(Boolean).join(" · ")}</p>
                {!p.internal && <p className="mt-0.5 font-mono text-[11.5px] text-muted" dir="ltr">{p.gtin}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5" data-product-tags>
                  {p.section && <span className="rounded-[7px] bg-surface-2 px-2 py-0.5 text-[12px] font-semibold">{sectionName(p.section, locale)}</span>}
                  {per100 != null && (
                    <span className="rounded-[7px] bg-surface-2 px-2 py-0.5 text-[12px] font-semibold">
                      {f(t.sm.product.per100, { price: `₪${per100.toFixed(2)}`, unit: p.unit === "ml" ? (he ? "מ״ל" : "ml") : he ? "גרם" : "g" })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* At my store */}
            <section className="rounded-[22px] bg-surface p-4 shadow-[0_0_0_1px_var(--line-in)]" data-product-here>
              <div className="flex items-center gap-2">
                {data.here.chain && <ChainLogo chain={data.here.chain} size={28} />}
                <span className="bidi min-w-0 flex-1 truncate text-[13px] text-muted">{data.here.chain ? f(t.sm.product.atYours, { store: [chainName(data.here.chain), data.here.branchName].filter(Boolean).join(" · ") }) : t.sm.shelf.noStore}</span>
                {time(data.here.updatedAt) && <span className="shrink-0 text-[12px] font-semibold text-[var(--save)]">{f(t.sm.shelf.updated, { time: time(data.here.updatedAt)! })}</span>}
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                {data.here.price != null ? <Money v={data.here.price} className="text-[30px] font-extrabold" /> : <span className="text-[15px] font-bold text-muted">{t.sm.match.notThere}</span>}
                <span className="text-[13px] text-muted">{p.weighted ? t.sm.product.perKg : t.sm.product.each}</span>
              </div>
              {data.here.deals.map((d, k) => (
                <p key={k} className="mt-2 flex items-start gap-2 rounded-[14px] bg-[var(--deal-t)] px-3 py-2 text-[13px] font-semibold text-[var(--deal)]" data-product-deal>
                  <Tag className="mt-0.5 size-4 shrink-0" />
                  <span className="bidi">
                    <b>{dealText(d)}</b>
                    {d.club ? ` · ${t.sm.shelf.club}` : ""}
                    {d.ends ? ` · ${f(t.sm.product.until, { date: new Intl.DateTimeFormat(he ? "he-IL" : "en-GB", { day: "numeric", month: "numeric" }).format(new Date(d.ends)) })}` : ""} · {t.sm.shelf.verify}
                  </span>
                </p>
              ))}
            </section>
            {/* 90 days */}
            {hist.length > 0 && (
              <section className="rounded-[22px] bg-surface p-4 shadow-[0_0_0_1px_var(--line-in)]" data-product-history={hist.length}>
                <h2 className="mb-2 text-[14px] font-extrabold">{t.sm.product.history}</h2>
                <svg viewBox="0 0 300 80" className="h-20 w-full" aria-hidden>
                  <path d={chart.line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
                  {chart.dots.map((d, k) => (
                    <circle key={k} cx={d.x} cy={d.y} r={d.deal ? 3.5 : 2.5} fill={d.deal ? "var(--deal)" : "var(--ink)"} />
                  ))}
                </svg>
                {lowest != null && <p className="mt-1 text-[12.5px] text-muted">{f(t.sm.product.lowest, { price: `₪${lowest.toFixed(2)}` })}</p>}
              </section>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-3 desk:mt-0">
            {/* Every chain */}
            {data.chains.length > 0 && (
              <section className="rounded-[22px] bg-surface px-4 py-2 shadow-[0_0_0_1px_var(--line-in)]" data-product-chains={data.chains.length}>
                <h2 className="pb-1 pt-2 text-[14px] font-extrabold">{t.sm.product.allChains}</h2>
                {data.chains.slice(0, 12).map((c) => {
                  const mine = c.chain === data.here.chain && (!c.branchId || c.branchId === data.here.branchId);
                  return (
                    <div key={`${c.chain}|${c.branchId ?? ""}`} className={cn("flex min-h-[48px] items-center gap-2.5 border-t border-line-in py-1.5 first-of-type:border-t-0", mine && "font-bold")} data-product-chain={c.chain} data-mine={mine ? "yes" : undefined}>
                      <ChainLogo chain={c.chain} size={28} />
                      <span className="min-w-0 flex-[0_1_42%]">
                        <b className="bidi block truncate text-[13.5px]">{chainName(c.chain)}</b>
                        {c.where && <span className="bidi block truncate text-[11.5px] text-muted">{c.where}</span>}
                      </span>
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <i className={cn("block h-full rounded-full", c.price === cheapest ? "bg-[var(--save)]" : mine ? "bg-ink" : "bg-line-strong")} style={{ width: `${Math.max(8, (c.price / max) * 100)}%` }} />
                      </span>
                      <span className="flex shrink-0 flex-col items-end leading-tight">
                        <Money v={c.price} className="text-[14px] font-extrabold" />
                        {c.price === cheapest ? <small className="text-[11px] font-bold text-[var(--save)]">{t.sm.product.cheapest}</small> : mine ? <small className="text-[11px] text-muted">{t.sm.product.yours}</small> : null}
                      </span>
                    </div>
                  );
                })}
              </section>
            )}
            {/* Same type, cheaper */}
            {data.cheaper.length > 0 && (
              <section data-product-cheaper={data.cheaper.length}>
                <h2 className="mb-2 px-1 text-[14px] font-extrabold">{t.sm.product.cheaper}</h2>
                <div className="grid grid-cols-3 gap-2">
                  {data.cheaper.map((a) => (
                    <button key={a.gtin} type="button" onClick={() => onOpen({ gtin: a.gtin, itemId: null })} className="flex min-w-0 flex-col items-start gap-1 rounded-[18px] bg-surface p-2 text-start shadow-[0_0_0_1px_var(--line-in)] active:scale-[0.97]" data-product-alt={a.gtin}>
                      <ProductTile photo={a.imageUrl} section={a.section} size={44} />
                      <b className="bidi line-clamp-2 text-[12.5px] leading-tight">{a.short ?? a.name}</b>
                      <Money v={a.price} className="text-[13.5px] font-extrabold" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {/* What Nexus learned */}
            {data.learned && item && !ro && (
              <section className="flex items-center gap-3 rounded-[22px] bg-surface p-4 shadow-[0_0_0_1px_var(--line-in)]" data-product-learned>
                <span className="bidi min-w-0 flex-1 text-[13.5px]">{f(t.sm.product.learned, { name: data.learned.label })}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={learned ?? data.learned.on}
                  onClick={() => {
                    const on = !(learned ?? data.learned!.on);
                    setLearned(on);
                    void setProductLearned(item.id, p.gtin, on).catch(() => (setLearned(!on), toast.error(t.sm.sheet.failed)));
                  }}
                  className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200", learned ?? data.learned.on ? "bg-ink" : "bg-line-strong")}
                  data-product-learned-switch
                >
                  <i className={cn("absolute top-0.5 size-6 rounded-full bg-bg shadow transition-[inset-inline-start] duration-200", learned ?? data.learned.on ? "start-[22px]" : "start-0.5")} />
                </button>
              </section>
            )}
          </div>
        </div>
      )}
      {p && !ro && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-t from-bg from-70% to-transparent px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-3 desk:static desk:bg-none desk:pt-2">
          <div className="flex h-[52px] items-center gap-1 rounded-full bg-surface px-1.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <button type="button" onClick={() => setN(Math.max(1, n - 1))} disabled={n <= 1} className="grid size-10 place-items-center rounded-full active:scale-90 disabled:opacity-40" aria-label={t.sm.qty.less} data-product-less>
              <Minus className="size-[18px]" />
            </button>
            <span className="tabular min-w-6 text-center text-[16px] font-extrabold" data-product-n>{n}</span>
            <button type="button" onClick={() => setN(n + 1)} className="grid size-10 place-items-center rounded-full active:scale-90" aria-label={t.sm.qty.more} data-product-more>
              <Plus className="size-[18px]" />
            </button>
          </div>
          <button type="button" onClick={() => void save()} className="h-[52px] flex-1 rounded-[16px] bg-ink text-[15px] font-extrabold text-bg active:scale-[0.98]" data-product-cta>
            {item ? f(t.sm.product.inList, { n }) : t.sm.product.add}
          </button>
        </div>
      )}
    </div>
  );
}

/** The 90-day line: x by day, y by price (the cheaper the lower), deal days as amber dots. */
function histPath(h: { day: string; price: number; deal: number | null }[]) {
  if (!h.length) return { line: "", dots: [] as { x: number; y: number; deal: boolean }[] };
  const t0 = Date.parse(h[0].day);
  const span = Math.max(1, Date.parse(h[h.length - 1].day) - t0);
  const lo = Math.min(...h.map((x) => x.deal ?? x.price));
  const hi = Math.max(...h.map((x) => x.price));
  const y = (v: number) => (hi === lo ? 40 : 70 - ((v - lo) / (hi - lo)) * 60);
  const pts = h.map((x) => ({ x: h.length === 1 ? 150 : ((Date.parse(x.day) - t0) / span) * 290 + 5, y: y(x.price), deal: x.deal != null }));
  // Steps: a price holds until the day it changes.
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${pts[i].x.toFixed(1)} V${pts[i].y.toFixed(1)}`;
  d += ` H295`;
  return { line: d, dots: pts };
}
