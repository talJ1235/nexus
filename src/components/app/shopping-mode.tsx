"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { Check, ChevronLeft, Minus, Plus, ScanBarcode, ShoppingCart, Store, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { createItem, setStatus, updateItem } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Spinner } from "@/components/ui/spinner";
import { activeSource, countable, unitPrice } from "@/lib/calc";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { gtinKey } from "@/lib/barcode";
import { formatMoney } from "@/lib/money";
import { flushOutbox, loadOutbox, loadTrip, saveOutbox, saveTrip, type ShopEdit, type ShopScope, type ShopTrip } from "@/lib/shop-outbox";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarcodeScanner } from "./barcode-scanner";
import { optimisticStatus, ProductImage } from "./item-card";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";
import { haptic } from "./use-camera";

const sameScope = (a: ShopScope, b: ShopScope) => JSON.stringify(a) === JSON.stringify(b);
const TRIP_MAX_AGE = 12 * 3600_000;

function inScope(i: ItemWithSources, scope: ShopScope, rates: Parameters<typeof activeSource>[1]) {
  if (scope.kind === "collection") return i.collectionId === scope.id;
  if (scope.kind === "store") return activeSource(i, rates)?.storeKey === scope.key || i.sources.some((x) => x.storeKey === scope.key);
  return true;
}

/** Sends queued "bought" marks whenever the app is online (also after a reload). Mounted once in the shell. */
export function ShopOutboxSync() {
  const s = useStore();
  useEffect(() => {
    if (s.loading || s.offlineShell) return;
    const run = () =>
      void flushOutbox(async (op) => s.upsertItem(await setStatus(op.itemId, "purchased", op.paid))).then((n) => {
        if (n) toast.success(`✓ ${n}`);
      });
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [s.loading, s.offlineShell, s]);
  return null;
}

/** Shopping mode: a focused full-screen list for being in a store. */
export function ShoppingMode() {
  const s = useStore();
  const { t } = useI18n();
  const open = s.shop != null;
  return (
    <D.Root open={open} onOpenChange={(o) => !o && s.setShop(null)}>
      <D.Portal>
        <D.Content className="fixed inset-0 z-50 flex flex-col bg-bg text-ink outline-none overlay-in" aria-describedby={undefined} data-shopping-mode>
          <D.Title className="sr-only">{t.shop.title}</D.Title>
          {s.shop === "pick" ? <ScopePicker /> : s.shop ? <Trip scope={s.shop} /> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ScopePicker() {
  const s = useStore();
  const { t, f } = useI18n();
  const toBuy = s.items.filter((i) => i.status === "to_buy");
  const stores = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const i of toBuy) {
      const src = activeSource(i, s.rates);
      if (!src?.url) continue;
      const e = m.get(src.storeKey) ?? { name: src.store, n: 0 };
      e.n++;
      m.set(src.storeKey, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [toBuy, s.rates]);
  const cols = s.collections.filter((c) => !c.archived).map((c) => ({ c, n: toBuy.filter((i) => i.collectionId === c.id).length })).filter((x) => x.n);
  const row = "flex min-h-16 w-full items-center gap-3 rounded-[22px] border border-line bg-surface px-4 text-start transition active:scale-[0.99]";
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 overflow-y-auto p-4 pt-[max(16px,env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        <D.Close className="grid size-11 place-items-center rounded-full border border-line bg-surface" aria-label={t.phone.closeMenu}>
          <X className="size-5" />
        </D.Close>
        <h2 className="text-[20px] font-extrabold">{t.shop.pick}</h2>
      </div>
      <button type="button" className={row} onClick={() => s.setShop({ kind: "all" })} data-shop-scope="all">
        <span className="grid size-10 place-items-center rounded-[14px] bg-tint text-tint-ink"><ShoppingCart className="size-5" /></span>
        <span className="flex-1 font-bold">{t.shop.everything}</span>
        <span className="tabular text-sm text-muted">{toBuy.length}</span>
      </button>
      {stores.length > 0 && <h3 className="mt-1 text-xs font-semibold text-muted">{t.shop.stores}</h3>}
      {stores.map(([key, v]) => (
        <button key={key} type="button" className={row} onClick={() => s.setShop({ kind: "store", key, name: v.name })}>
          <span className="grid size-10 place-items-center rounded-[14px] bg-surface-2"><Store className="size-5" /></span>
          <span className="flex-1 font-bold">{f(t.shop.at, { store: v.name })}</span>
          <span className="tabular text-sm text-muted">{v.n}</span>
        </button>
      ))}
      {cols.length > 0 && <h3 className="mt-1 text-xs font-semibold text-muted">{t.projects.title}</h3>}
      {cols.map(({ c, n }) => (
        <button key={c.id} type="button" className={row} onClick={() => s.setShop({ kind: "collection", id: c.id })}>
          <span className="grid size-10 place-items-center rounded-[14px] bg-surface-2"><i className={cn("size-3", c.kind === "project" ? "rounded-[4px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} /></span>
          <span className="flex-1 font-bold bidi">{c.name}</span>
          <span className="tabular text-sm text-muted">{n}</span>
        </button>
      ))}
    </div>
  );
}

function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    const req = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
      } catch {}
    };
    void req();
    const vis = () => document.visibilityState === "visible" && void req();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

function Trip({ scope }: { scope: ShopScope }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [trip, setTrip] = useState<ShopTrip>(() => ({ scope, checked: [], edits: {}, added: [], startedAt: Date.now() }));
  const [ready, setReady] = useState(false);
  const [groupBy, setGroupBy] = useState<"category" | "store">(scope.kind === "store" ? "category" : "category");
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [summary, setSummary] = useState(false);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  useWakeLock(true);

  // Resume an unfinished trip for the same scope (reload, phone locked, …).
  useEffect(() => {
    let alive = true;
    void loadTrip().then((saved) => {
      if (!alive) return;
      if (saved && sameScope(saved.scope, scope) && Date.now() - saved.startedAt < TRIP_MAX_AGE) setTrip(saved);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [scope]);
  useEffect(() => {
    if (ready) void saveTrip(trip);
  }, [trip, ready]);

  const items = useMemo(() => {
    const base = countable(s.items.filter((i) => i.status === "to_buy" && inScope(i, scope, s.rates)), s.altGroups, s.rates);
    const extra = s.items.filter((i) => trip.added.includes(i.id) && !base.includes(i));
    return [...base, ...extra];
  }, [s.items, s.altGroups, s.rates, scope, trip.added]);

  const checked = useMemo(() => new Set(trip.checked), [trip.checked]);
  const qtyOf = (i: ItemWithSources) => trip.edits[i.id]?.qty ?? i.quantity;
  const priceOf = (i: ItemWithSources) => trip.edits[i.id]?.price ?? unitPrice(i, s.rates, s.currency);
  const total = items.filter((i) => checked.has(i.id)).reduce((a, i) => a + (priceOf(i) ?? 0) * qtyOf(i), 0);
  const m = (v: number) => formatMoney(v, s.currency, locale);

  const toggle = useCallback((id: string) => {
    haptic(checked.has(id) ? 10 : 25);
    setTrip((tr) => ({ ...tr, checked: tr.checked.includes(id) ? tr.checked.filter((x) => x !== id) : [...tr.checked, id] }));
  }, [checked]);
  const edit = (id: string, e: ShopEdit) => setTrip((tr) => ({ ...tr, edits: { ...tr.edits, [id]: { ...tr.edits[id], ...e } } }));

  const groups = useMemo(() => {
    const open = items.filter((i) => !checked.has(i.id));
    const m = new Map<string, ItemWithSources[]>();
    for (const i of open) {
      const k = groupBy === "store" ? (activeSource(i, s.rates)?.store ?? "—") : (normalizeCategory(i.category) ?? "other");
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    const order = (k: string) => (groupBy === "category" ? CATEGORIES.indexOf(k as (typeof CATEGORIES)[number]) : 0);
    return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [items, checked, groupBy, s.rates]);
  const cart = items.filter((i) => checked.has(i.id));

  const title =
    scope.kind === "all" ? t.shop.everything : scope.kind === "store" ? f(t.shop.at, { store: scope.name }) : (s.collections.find((c) => c.id === scope.id)?.name ?? "—");

  const onCode = (code: string) => {
    const key = gtinKey(code);
    const hit = items.find((i) => [i.gtin, ...i.sources.map((x) => x.gtin)].some((g) => g && gtinKey(g) === key));
    if (!hit) {
      toast(t.shop.notOnList, { description: code });
      return;
    }
    if (!checked.has(hit.id)) toggle(hit.id);
    toast.success(`✓ ${hit.title}`);
  };

  const quickAdd = async () => {
    const title = adding.trim();
    if (!title) return;
    setAdding("");
    try {
      const it = await createItem({ title, brand: null, imageUrl: null, category: null, tags: [], collectionId: scope.kind === "collection" ? scope.id : null, source: null });
      s.upsertItem(it);
      setTrip((tr) => ({ ...tr, added: [...tr.added, it.id], checked: [...tr.checked, it.id] }));
      haptic();
    } catch {
      toast.error(t.errors.generic);
    }
  };

  const finish = async () => {
    setBusy(true);
    const bought = cart.map((i) => ({ item: i, qty: qtyOf(i), price: priceOf(i) }));
    const prev = bought.map((b) => b.item);
    s.upsertItems(bought.map((b) => optimisticStatus({ ...b.item, quantity: b.qty }, "purchased", b.price != null ? { price: b.price, currency: s.currency } : null)));
    const offline = !navigator.onLine;
    try {
      if (offline) {
        const ops = await loadOutbox();
        await saveOutbox([...ops, ...bought.map((b) => ({ id: `${b.item.id}:${Date.now()}`, itemId: b.item.id, paid: b.price != null ? { price: b.price, currency: s.currency } : null, at: Date.now() }))]);
      } else {
        for (const b of bought) {
          if (b.qty !== b.item.quantity) await updateItem(b.item.id, { quantity: b.qty });
          s.upsertItem(await setStatus(b.item.id, "purchased", b.price != null ? { price: b.price, currency: s.currency } : null));
        }
      }
      await saveTrip(null);
      s.setShop(null);
      toast.success(offline ? t.shop.queued : f(t.shop.done, { n: bought.length }), {
        description: m(total),
        action: offline
          ? undefined
          : {
              label: t.item.undo,
              onClick: async () => {
                s.upsertItems(prev);
                for (const p of prev) {
                  if (bought.find((b) => b.item.id === p.id)?.qty !== p.quantity) await updateItem(p.id, { quantity: p.quantity });
                  await setStatus(p.id, p.status);
                }
              },
            },
      });
    } catch {
      s.upsertItems(prev);
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const progress = items.length ? cart.length / items.length : 0;
  const editItem = editing ? items.find((i) => i.id === editing) : null;

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.9 }}>
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <button type="button" onClick={() => s.setShop("pick")} className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface" aria-label={t.shop.pick}>
            <ChevronLeft className="size-5 rtl:-scale-x-100" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-extrabold bidi">{title}</div>
            <div className="tabular text-[13px] text-muted" data-shop-progress>
              {f(t.shop.progress, { done: cart.length, total: items.length })} · {m(total)}
            </div>
          </div>
          <button type="button" onClick={() => setScanning(true)} className="grid size-11 shrink-0 place-items-center rounded-full bg-tint text-tint-ink" aria-label={t.barcode.title} data-shop-scan>
            <ScanBarcode className="size-5" />
          </button>
          <D.Close className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface" aria-label={t.phone.closeMenu}>
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="mx-auto mt-3 h-1.5 max-w-2xl overflow-hidden rounded-full bg-surface-2">
          <motion.i className="block h-full origin-left rounded-full bg-brand rtl:origin-right" animate={{ scaleX: progress }} initial={false} style={{ width: "100%" }} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-32">
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void quickAdd())}>
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t.shop.quickAdd} aria-label={t.shop.quickAdd} className="h-12 min-w-0 flex-1 rounded-full border border-line bg-surface px-5 text-[15px] outline-none focus:border-ink/30" data-shop-add />
            {scope.kind !== "store" && (
              <button type="button" onClick={() => setGroupBy(groupBy === "category" ? "store" : "category")} className="h-12 shrink-0 rounded-full bg-surface-2 px-4 text-[13px] font-semibold">
                {groupBy === "category" ? t.shop.byStore : t.shop.byCategory}
              </button>
            )}
          </form>

          {!ready ? (
            <Spinner className="mx-auto mt-10" />
          ) : (
            <>
              {groups.map(([k, list]) => (
                <section key={k} className="flex flex-col gap-2">
                  <h3 className="px-1 text-xs font-bold text-muted">{groupBy === "category" ? t.categories[k as keyof typeof t.categories] : k}</h3>
                  <AnimatePresence initial={false}>
                    {list.map((i) => (
                      <Row key={i.id} item={i} done={false} qty={qtyOf(i)} price={priceOf(i)} onToggle={() => toggle(i.id)} onLong={() => setEditing(i.id)} />
                    ))}
                  </AnimatePresence>
                </section>
              ))}
              {groups.length === 0 && items.length > 0 && <p className="py-6 text-center text-[15px] font-semibold text-ok">{t.shop.allIn}</p>}
              {items.length === 0 && <p className="py-10 text-center text-muted">{t.shop.empty}</p>}
              {cart.length > 0 && (
                <section className="mt-2 flex flex-col gap-2">
                  <h3 className="flex items-center gap-1.5 px-1 text-xs font-bold text-muted">
                    <ShoppingCart className="size-3.5" /> {t.shop.inCart}
                  </h3>
                  <AnimatePresence initial={false}>
                    {cart.map((i) => (
                      <Row key={i.id} item={i} done qty={qtyOf(i)} price={priceOf(i)} onToggle={() => toggle(i.id)} onLong={() => setEditing(i.id)} />
                    ))}
                  </AnimatePresence>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-bg to-40% px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-10">
        <button
          type="button"
          disabled={!cart.length}
          onClick={() => setSummary(true)}
          className="pointer-events-auto mx-auto flex h-14 w-full max-w-2xl items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-bold text-on-brand shadow-pop transition active:scale-[0.98] disabled:opacity-40"
          data-shop-finish
        >
          {t.shop.finish}
          {cart.length > 0 && <span className="tabular opacity-80">· {m(total)}</span>}
        </button>
      </div>

      {editItem && <EditSheet item={editItem} qty={qtyOf(editItem)} price={priceOf(editItem)} onChange={(e) => edit(editItem.id, e)} onClose={() => setEditing(null)} />}
      {summary && (
        <div className="fixed inset-0 z-20 grid place-items-end bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[10px] sm:place-items-center" onClick={() => setSummary(false)}>
          <div className="m-3 w-[calc(100%-24px)] max-w-md animate-pop-in rounded-[30px] bg-surface p-5 shadow-pop" onClick={(e) => e.stopPropagation()} data-shop-summary>
            <h3 className="text-[18px] font-extrabold">{t.shop.summary}</h3>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                [t.shop.bought, String(cart.length)],
                [t.shop.total, m(total)],
                [t.shop.skipped, String(items.length - cart.length)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[18px] bg-surface-2 p-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="tabular mt-1 text-[17px] font-black">{v}</dd>
                </div>
              ))}
            </dl>
            <button type="button" disabled={busy} onClick={() => void finish()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand font-bold text-on-brand disabled:opacity-60" data-shop-confirm>
              {busy ? <Spinner /> : <Check className="size-5" />} {f(t.shop.markBought, { n: cart.length })}
            </button>
            <button type="button" onClick={() => setSummary(false)} className="mt-2 h-11 w-full rounded-full text-sm font-semibold text-muted">
              {t.shop.keepShopping}
            </button>
          </div>
        </div>
      )}
      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onCode={(c) => { onCode(c); setScanning(false); }} />
    </MotionConfig>
  );
}

function Row({ item, done, qty, price, onToggle, onLong }: { item: ItemWithSources; done: boolean; qty: number; price: number | null; onToggle: () => void; onLong: () => void }) {
  const s = useStore();
  const { locale } = useI18n();
  const timer = useRef<number>(0);
  const long = useRef(false);
  return (
    <motion.button
      layout
      layoutId={`shop-${item.id}`}
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      onPointerDown={() => {
        long.current = false;
        timer.current = window.setTimeout(() => {
          long.current = true;
          onLong();
        }, 480);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => !long.current && onToggle()}
      className={cn("flex min-h-16 w-full select-none items-center gap-3 rounded-[22px] border border-line bg-surface p-2 pe-4 text-start", done && "bg-surface-2/60")}
      data-shop-row={done ? "done" : "open"}
    >
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors duration-200", done ? "border-ok bg-ok text-white" : "border-line-strong")}>
        <motion.span initial={false} animate={{ scale: done ? 1 : 0, rotate: done ? 0 : -45 }}>
          <Check className="size-4" strokeWidth={3} />
        </motion.span>
      </span>
      <ProductImage src={item.imageUrl} alt="" className={cn("size-12 shrink-0 rounded-[14px] transition-opacity", done && "opacity-50")} iconClass="size-5" />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] font-bold bidi transition-colors", done && "text-muted line-through decoration-2")}>{item.title}</span>
        {qty > 1 && <span className="tabular text-xs text-muted" dir="ltr">×{qty}</span>}
      </span>
      {price != null && <span className={cn("tabular shrink-0 text-[15px] font-extrabold", done && "text-muted")}>{formatMoney(price * qty, s.currency, locale)}</span>}
    </motion.button>
  );
}

function EditSheet({ item, qty, price, onChange, onClose }: { item: ItemWithSources; qty: number; price: number | null; onChange: (e: ShopEdit) => void; onClose: () => void }) {
  const { t } = useI18n();
  const s = useStore();
  return (
    <div className="fixed inset-0 z-20 grid place-items-end bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[10px] sm:place-items-center" onClick={onClose}>
      <div className="m-3 w-[calc(100%-24px)] max-w-md animate-pop-in rounded-[30px] bg-surface p-5 shadow-pop" onClick={(e) => e.stopPropagation()} data-shop-edit>
        <div className="truncate text-[16px] font-extrabold bidi">{item.title}</div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-muted">{t.shop.qty}</span>
          <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
            <button type="button" className="grid size-10 place-items-center rounded-full active:scale-90" onClick={() => onChange({ qty: Math.max(1, qty - 1) })} aria-label={t.item.qtyLess}><Minus className="size-4" /></button>
            <b className="tabular min-w-6 text-center">{qty}</b>
            <button type="button" className="grid size-10 place-items-center rounded-full active:scale-90" onClick={() => onChange({ qty: qty + 1 })} aria-label={t.item.qtyMore}><Plus className="size-4" /></button>
          </div>
        </div>
        <label className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-muted">{t.shop.pricePaid} ({s.currency})</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            defaultValue={price ?? ""}
            onChange={(e) => onChange({ price: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
            className="tabular h-11 w-32 rounded-full border border-line bg-surface-2 px-4 text-end text-[16px] outline-none"
          />
        </label>
        <button type="button" onClick={onClose} className="mt-5 h-12 w-full rounded-full bg-brand font-bold text-on-brand">
          {t.shop.doneEditing}
        </button>
      </div>
    </div>
  );
}
