"use client";

import "./sm.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Camera, Check, ChevronDown, CloudOff, Sun } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { sectionName } from "@/lib/grocery/sections";
import { unitKgFor } from "@/lib/grocery/weights";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { tripApi } from "@/lib/trip-client";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { haptic } from "../use-camera";
import { ProductTile, SectionIcon, sectionColor } from "./art";
import { useSmHome } from "./data";
import { patchTrip, readTrip, useLocalTrip, writeTrip, type LocalTrip } from "./local-trip";
import { storeLabel, useMonthLeft, useTrips } from "./numbers";
import { qtyLabel } from "./qty";
import { QtySteppers, type Measure } from "./qty-steppers";
import { Mono } from "./store-picker";
import { useTripStore } from "./trip-store";
import { bySection } from "./view";

// R18 S2 D3 — store mode + finish (boards StoreMode-phone, Finish-phone), on the S1 engines through the one trip API.
// Start: the store, the list's size + estimate, "Let's go" (the screen stays on). In the store: the big progress header
// (count, %, the aisle rail in section colours, "Now: Deli · 1 left"), sections in this branch's order, the picture tile
// is the check (fills green, spark burst), done sections fold, rows added by someone else during the trip show "added
// now" with an in-app toast (no push while the app is in front: D4), a long press for not found / took something else /
// price / quantity. Finish: confirm → summary (bought, left, minutes, total vs the estimate, left this month) → receipt
// photo or skip → all saved. Everything checked → confetti + "Everything's in the cart".

type Step = "start" | "shop" | "summary" | "saved";

export function StoreMode({ open, onClose, onPickStore }: { open: boolean; onClose: () => void; onPickStore: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    document.documentElement.setAttribute("data-store-mode", "");
    return () => document.documentElement.removeAttribute("data-store-mode");
  }, [open]);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Content className="fixed inset-0 z-50 flex flex-col bg-bg outline-none phone:pt-[env(safe-area-inset-top)] desk:inset-x-0 desk:top-[4vh] desk:mx-auto desk:h-[92vh] desk:max-w-[520px] desk:overflow-hidden desk:rounded-2xl desk:border desk:border-line desk:shadow-pop" aria-describedby={undefined} data-store-mode-screen>
          <D.Title className="sr-only">{t.sm.shop.title}</D.Title>
          {open && <Body onClose={onClose} onPickStore={onPickStore} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Keep the screen on while store mode is open (where the browser can). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const take = async () => {
      try {
        lock = (await (navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen")) ?? null;
      } catch {}
    };
    void take();
    const again = () => document.visibilityState === "visible" && void take();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void lock?.release().catch(() => {});
    };
  }, []);
}

function Body({ onClose, onPickStore }: { onClose: () => void; onPickStore: () => void }) {
  const s = useStore();
  const space = s.spaceId || "-";
  const trip = useLocalTrip(space);
  const [step, setStep] = useState<Step>(() => (readTrip(space) ? "shop" : "start"));
  const [done, setDone] = useState<{ bought: number; left: number; minutes: number; total: number | null; prices: number; est: number | null } | null>(null);
  useWakeLock();
  if (step === "summary" && done) return <Summary done={done} onNext={() => setStep("saved")} />;
  if (step === "saved" && done) return <Saved done={done} onList={onClose} onHome={() => (onClose(), s.setView({ type: "home" }))} />;
  if (step === "start" || !trip) return <Start onGo={() => setStep("shop")} onClose={onClose} onPickStore={onPickStore} />;
  return <Shop trip={trip} onClose={onClose} onFinished={(d) => (setDone(d), setStep("summary"))} />;
}

// ---------- start ----------

function Start({ onGo, onClose, onPickStore }: { onGo: () => void; onClose: () => void; onPickStore: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const space = s.spaceId || "-";
  const { store, order } = useTripStore(space, home);
  const groups = useMemo(() => bySection(s.sm, order), [s.sm, order]);
  const est = useMemo(() => estimateOf(s.sm, home?.prices), [s.sm, home?.prices]);
  const go = () => {
    writeTrip(space, { chain: store?.chain ?? null, branch: store?.branch ?? null, startedAt: Date.now(), rows: s.sm, checked: {}, notFound: {}, prices: {}, live: {} });
    void tripApi.start({ chain: store?.chain ?? null, branch: store?.branch ?? null, planned: s.sm.length });
    haptic(15);
    onGo();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pb-[max(20px,env(safe-area-inset-bottom))]" data-store-start>
      <div className="flex justify-start pt-3">
        <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full" aria-label={t.sm.shop.collapse}>
          <ChevronDown className="size-6" />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        {store && <Mono chain={store.chain} size={56} />}
        <h2 className="bidi text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{store ? storeLabel(store.chain, store.branch, locale) : t.sm.shop.noStore}</h2>
        <div className="gro-rail w-full max-w-[300px]" aria-hidden>
          {groups.map(([k, list]) => (
            <i key={k} style={{ "--k": "var(--line-strong)", "--n": list.length } as React.CSSProperties} />
          ))}
        </div>
        <p className="tabular text-[15px] font-bold text-muted">{est != null ? f(t.sm.shop.itemsEst, { n: s.sm.length, amount: formatMoney(Math.round(est), s.currency, locale) }) : f(t.sm.shop.items, { n: s.sm.length })}</p>
        <p className="flex items-center gap-1.5 text-[13px] text-muted">
          <Sun className="size-4" />
          {t.sm.shop.awake}
        </p>
      </div>
      <button type="button" className="h-14 w-full rounded-[18px] bg-ink text-[17px] font-extrabold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]" onClick={go} data-store-go>
        {t.sm.shop.go}
      </button>
      <button type="button" className="mt-2 h-12 w-full text-[15px] font-bold" onClick={onPickStore} data-store-another>
        {t.sm.shop.another}
      </button>
    </div>
  );
}

const minutesSince = (at: number) => Math.max(1, Math.round((Date.now() - at) / 60_000));

function estimateOf(rows: ItemWithSources[], prices: Record<string, number> | undefined) {
  if (!prices) return null;
  let sum = 0;
  let priced = 0;
  for (const i of rows) {
    const p = i.productKey ? prices[i.productKey] : undefined;
    if (p == null) continue;
    priced++;
    sum += p * (i.unit && i.unit !== "u" && i.amount ? i.amount : i.quantity);
  }
  return priced ? sum : null;
}

// ---------- in the store ----------

function Shop({ trip, onClose, onFinished }: { trip: LocalTrip; onClose: () => void; onFinished: (d: { bought: number; left: number; minutes: number; total: number | null; prices: number; est: number | null }) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const space = s.spaceId || "-";
  const { order } = useTripStore(space, home);
  const { others } = useTrips(home);
  const [confirm, setConfirm] = useState(false);
  const [acting, setActing] = useState<ItemWithSources | null>(null);
  const [burst, setBurst] = useState(0);

  // Rows added during the trip (anyone; someone else's marked "added now" with a toast) join the trip's rows.
  const seen = useRef(new Set(trip.rows.map((r) => r.id)));
  useEffect(() => {
    const fresh = s.sm.filter((i) => !seen.current.has(i.id));
    if (!fresh.length) return;
    for (const i of fresh) seen.current.add(i.id);
    const theirs = fresh.filter((i) => i.addedByUserId && i.addedByUserId !== s.me?.id && i.createdAt > trip.startedAt);
    patchTrip(space, (x) => ({ ...x, rows: [...x.rows, ...fresh.filter((i) => !x.rows.some((r) => r.id === i.id))], live: { ...x.live, ...Object.fromEntries(theirs.map((i) => [i.id, true as const])) } }));
    if (theirs.length) {
      const who = (s.people.find((p) => p.id === theirs[0].addedByUserId)?.name ?? "").split(" ")[0];
      toast(theirs.length === 1 ? f(t.sm.shop.liveToast, { name: who, title: theirs[0].title }) : f(t.sm.shop.liveToastN, { name: who, n: theirs.length }));
    }
  }, [s.sm, s.me?.id, s.people, space, trip.startedAt, f, t]);
  // A row's latest data (an edit by someone else) over the snapshot.
  const rows = useMemo(() => trip.rows.map((r) => s.sm.find((i) => i.id === r.id) ?? r), [trip.rows, s.sm]);
  const groups = useMemo(() => bySection(rows, order), [rows, order]);
  const isDone = (i: ItemWithSources) => !!trip.checked[i.id];
  const total = rows.length;
  const boughtN = rows.filter(isDone).length;
  const notFoundN = rows.filter((i) => trip.notFound[i.id] && !isDone(i)).length;
  const left = total - boughtN - notFoundN;
  const pct = total ? Math.round(((boughtN + notFoundN) / total) * 100) : 0;
  const current = groups.find(([, list]) => list.some((i) => !isDone(i) && !trip.notFound[i.id]));
  const prices = home?.prices ?? {};
  const spent = rows.filter(isDone).reduce((a, i) => a + (trip.prices[i.id] ?? (i.productKey && prices[i.productKey] != null ? prices[i.productKey] * (i.unit && i.unit !== "u" && i.amount ? i.amount : i.quantity) : 0)), 0);
  const est = estimateOf(rows, prices);
  const money = (n: number) => formatMoney(Math.round(n * 100) / 100, s.currency, locale);
  const allIn = total > 0 && left === 0 && boughtN > 0;
  const prevAll = useRef(allIn);
  useEffect(() => {
    if (allIn && !prevAll.current) {
      setBurst((b) => b + 1);
      haptic(30);
    }
    prevAll.current = allIn;
  }, [allIn]);

  const toggle = (i: ItemWithSources) => {
    const on = isDone(i);
    haptic(on ? 8 : 14);
    patchTrip(space, (x) => {
      const checked = { ...x.checked };
      const notFound = { ...x.notFound };
      if (on) delete checked[i.id];
      else {
        checked[i.id] = Date.now();
        delete notFound[i.id];
      }
      return { ...x, checked, notFound };
    });
    void (on ? tripApi.uncheck(i) : tripApi.check(i));
  };
  const finish = async () => {
    setConfirm(false);
    const paid = Object.values(trip.prices).length;
    await tripApi.finish({ total: spent > 0 ? Math.round(spent * 100) / 100 : null });
    writeTrip(space, null);
    onFinished({ bought: boughtN, left: total - boughtN, minutes: minutesSince(trip.startedAt), total: spent > 0 ? spent : null, prices: paid || boughtN, est });
  };
  const tz = s.clock.tz;
  const started = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(trip.startedAt));
  const other = others[0];
  const otherName = other ? (s.people.find((p) => p.id === other.userId)?.name ?? "").split(" ")[0] : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-store-shop>
      <header className="border-b border-line bg-surface px-4 pb-3 pt-2.5">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onClose} className="-ms-1 grid size-10 shrink-0 place-items-center rounded-full" aria-label={t.sm.shop.collapse} data-store-collapse>
            <ChevronDown className="size-6" />
          </button>
          <div className="min-w-0 flex-1">
            <b className="bidi block truncate text-[15.5px] font-extrabold">{storeLabel(trip.chain, trip.branch, locale) ?? t.sm.shop.noStore}</b>
            <span className="block truncate text-[12.5px] text-muted">{f(t.sm.shop.started, { time: started })}{otherName ? ` · ${f(t.sm.shop.alsoHere, { name: otherName })}` : ""}</span>
          </div>
        </div>
        <div className="mt-1 flex items-end justify-between">
          <p className="tabular">
            <b className="text-[40px] font-extrabold leading-none tracking-[-0.03em]" data-store-count>{boughtN}</b>
            <span className="text-[20px] font-bold text-muted"> / {total}</span>
          </p>
          <p className="tabular text-end">
            <b className="block text-[18px] font-extrabold">{pct}%</b>
            <span className="text-[12.5px] text-muted">{f(t.sm.shop.left, { n: left })}</span>
          </p>
        </div>
        <div className="gro-rail mt-3 h-2" aria-hidden>
          {groups.map(([k, list]) => {
            const fin = list.every((i) => isDone(i) || trip.notFound[i.id]);
            return <i key={k} style={{ "--k": fin ? sectionColor(k) : "var(--line-strong)", "--n": list.length } as React.CSSProperties} className={cn(current?.[0] === k && "outline outline-2 outline-offset-1 outline-ink")} />;
          })}
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[13px] text-muted">
          {current && (
            <>
              <SectionIcon section={current[0]} size={22} />
              <span className="min-w-0 flex-1 truncate">{f(t.sm.shop.now, { section: current[0] === "other" ? t.sm.main.other : sectionName(current[0], locale), n: current[1].filter((i) => !isDone(i) && !trip.notFound[i.id]).length })}</span>
            </>
          )}
          {s.offlineAt != null && (
            <span className="ms-auto inline-flex h-7 items-center gap-1 rounded-full bg-warn-soft px-2.5 text-[12.5px] font-bold text-warn">
              <CloudOff className="size-3.5" />
              {t.sm.shop.offline}
            </span>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3" data-store-list>
        {allIn && (
          <p className="mb-3 flex items-center justify-center gap-2 rounded-[16px] bg-ok-soft py-3 text-[15px] font-extrabold text-ok" data-store-allin>
            <Check className="size-5" strokeWidth={3} />
            {t.sm.shop.allIn}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {groups.map(([k, list]) => {
            const fin = list.every((i) => isDone(i) || trip.notFound[i.id]);
            if (fin)
              return (
                <div key={k} className="flex h-12 items-center gap-2.5 rounded-[14px] border border-[color-mix(in_srgb,var(--ok)_40%,var(--line))] bg-ok-soft px-3.5 text-[14.5px] font-bold text-ok" data-store-section-done={k}>
                  <Check className="size-4" strokeWidth={3} />
                  <span className="flex-1 truncate">{k === "other" ? t.sm.main.other : sectionName(k, locale)}</span>
                  <span className="tabular">{list.length}</span>
                </div>
              );
            return (
              <section key={k} className="gro-sec" style={{ "--k": sectionColor(k) } as React.CSSProperties} data-store-section={k}>
                <div className="flex min-h-11 items-center gap-2.5 px-1">
                  <SectionIcon section={k} size={30} />
                  <b className="flex-1 truncate text-[15px] font-extrabold">{k === "other" ? t.sm.main.other : sectionName(k, locale)}</b>
                  <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-bold text-muted">
                    {list.filter(isDone).length}/{list.length}
                  </span>
                </div>
                <div className="gro-box">
                  {list.map((i) => (
                    <StoreRow key={i.id} item={i} done={isDone(i)} missing={!!trip.notFound[i.id]} live={!!trip.live[i.id]} unitKg={unitKgFor(i.productKey, home?.unitKg)} onToggle={() => toggle(i)} onMore={() => setActing(i)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <footer className="relative border-t border-line bg-surface px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <b className="tabular block text-[22px] font-extrabold leading-tight" data-store-spent>{money(spent)}</b>
            <span className="tabular block truncate text-[12.5px] text-muted">{est != null ? f(t.sm.shop.of, { amount: money(est), n: left }) : f(t.sm.shop.ofNoEst, { n: left })}</span>
          </div>
          <button type="button" className={cn("h-[52px] shrink-0 rounded-[16px] px-6 text-[16px] font-extrabold transition-transform duration-150 ease-[var(--ease-out)] active:scale-95", allIn ? "bg-ok text-white" : "bg-ink text-bg")} onClick={() => setConfirm(true)} data-store-finish>
            {t.sm.shop.finish}
          </button>
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line-in" aria-hidden>
          <i className="block h-full rounded-full bg-ink transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${pct}%` }} />
        </div>
        {burst > 0 && <Confetti key={burst} />}
      </footer>
      <Sheet open={confirm} onOpenChange={setConfirm} title={t.sm.shop.confirmTitle} className="phone:top-auto desk:max-w-[420px]">
        <div className="px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-1" data-store-confirm>
          <h2 className="text-[20px] font-extrabold">{t.sm.shop.confirmTitle}</h2>
          <p className="mt-1 text-[14px] text-muted">{total - boughtN ? f(t.sm.shop.confirmSub, { n: total - boughtN }) : t.sm.shop.confirmSubNone}</p>
          <button type="button" className="mt-4 h-[52px] w-full rounded-[16px] bg-ink text-[16px] font-extrabold text-bg" onClick={() => void finish()} data-store-finish-confirm>
            {spent > 0 ? f(t.sm.shop.finishWith, { amount: money(spent) }) : t.sm.shop.finishPlain}
          </button>
          <button type="button" className="mt-1 h-12 w-full text-[15px] font-bold" onClick={() => setConfirm(false)}>
            {t.sm.shop.backToList}
          </button>
        </div>
      </Sheet>
      <RowActions item={acting} onClose={() => setActing(null)} />
    </div>
  );
}

function StoreRow({ item, done, missing, live, unitKg, onToggle, onMore }: { item: ItemWithSources; done: boolean; missing: boolean; live: boolean; unitKg: number | null; onToggle: () => void; onMore: () => void }) {
  const { t, f, locale } = useI18n();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const long = useRef(false);
  return (
    <button
      type="button"
      className={cn("gro-row relative select-none [-webkit-touch-callout:none]", done && "gro-done", missing && "opacity-55", live && "gro-live")}
      onPointerDown={() => {
        long.current = false;
        timer.current = setTimeout(() => {
          long.current = true;
          haptic(10);
          onMore();
        }, 480);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onPointerCancel={() => clearTimeout(timer.current)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMore();
      }}
      onClick={() => {
        if (long.current) return;
        onToggle();
      }}
      aria-pressed={done}
      aria-label={f(done ? t.sm.shop.uncheck : t.sm.shop.check, { title: item.title })}
      data-store-row={item.id}
      data-done={done ? "" : undefined}
    >
      <span className="relative">
        <ProductTile art={item.artKey} section={item.section} photo={item.imageUrl} size={52} got={done} />
        <span className={cn("absolute inset-0 grid place-items-center rounded-[14px] bg-ok text-white transition-[opacity,transform] duration-200 ease-[var(--ease-out)]", done ? "scale-100 opacity-95" : "scale-75 opacity-0")} aria-hidden>
          <Check className="size-6" strokeWidth={3} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("gro-t bidi", done && "text-muted line-through decoration-2")}>{item.title}</span>
        {(item.notes || live || missing) && (
          <span className="gro-s bidi truncate">
            {live && <b className="me-1.5 rounded-[5px] bg-spark px-1 py-px text-[11px] font-bold text-white">{t.sm.shop.live}</b>}
            {missing ? t.sm.shop.notFound : item.notes}
          </span>
        )}
      </span>
      <span className="gro-q">{qtyLabel(item, locale, unitKg)}</span>
    </button>
  );
}

function RowActions({ item, onClose }: { item: ItemWithSources | null; onClose: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  const { home } = useSmHome();
  const space = s.spaceId || "-";
  const [mode, setMode] = useState<"menu" | "sub" | "price" | "qty">("menu");
  const [text, setText] = useState("");
  const [m, setM] = useState<Measure | null>(null);
  const close = () => {
    setMode("menu");
    setText("");
    setM(null);
    onClose();
  };
  const row = "flex min-h-[56px] w-full items-center gap-3 px-4 text-start active:bg-surface-2";
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && close()} title={item?.title ?? ""} className="phone:top-auto desk:max-w-[420px]">
      {item && (
        <div className="pb-[max(14px,env(safe-area-inset-bottom))]" data-store-actions={item.id}>
          <div className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-1">
            <ProductTile art={item.artKey} section={item.section} photo={item.imageUrl} size={44} />
            <b className="bidi min-w-0 flex-1 truncate text-[16px] font-extrabold">{item.title}</b>
          </div>
          {mode === "menu" ? (
            <>
              <button
                type="button"
                className={row}
                onClick={() => {
                  patchTrip(space, (x) => {
                    const checked = { ...x.checked };
                    delete checked[item.id];
                    return { ...x, checked, notFound: { ...x.notFound, [item.id]: true } };
                  });
                  void tripApi.notFound(item);
                  close();
                }}
                data-store-act="not_found"
              >
                <span>
                  <b className="block text-[15.5px] font-bold">{t.sm.shop.notFound}</b>
                  <span className="block text-[12.5px] text-muted">{t.sm.shop.notFoundSub}</span>
                </span>
              </button>
              <button type="button" className={row} onClick={() => setMode("sub")} data-store-act="substitute">
                <span>
                  <b className="block text-[15.5px] font-bold">{t.sm.shop.substitute}</b>
                  <span className="block text-[12.5px] text-muted">{t.sm.shop.substituteSub}</span>
                </span>
              </button>
              <button type="button" className={row} onClick={() => setMode("price")} data-store-act="price">
                <b className="text-[15.5px] font-bold">{t.sm.shop.price}</b>
              </button>
              <button type="button" className={row} onClick={() => (setM({ quantity: item.quantity, count: item.count ?? null, amount: item.amount, unit: item.unit }), setMode("qty"))} data-store-act="qty">
                <b className="text-[15.5px] font-bold">{t.sm.shop.quantity}</b>
              </button>
            </>
          ) : mode === "qty" && m ? (
            <div className="px-4 pt-3">
              <QtySteppers value={m} unitKg={unitKgFor(item.productKey, home?.unitKg)} title={item.title} onChange={setM} />
              <button
                type="button"
                className="mt-4 h-12 w-full rounded-[14px] bg-ink text-[15px] font-bold text-bg"
                onClick={() => {
                  void tripApi.quantity(item, { qty: m.quantity, count: m.count, amount: m.amount, unit: (m.unit as "kg" | "g" | "l" | null) ?? null });
                  s.upsertSm([{ ...item, quantity: m.quantity, count: m.count, amount: m.amount, unit: m.unit as ItemWithSources["unit"] }]);
                  patchTrip(space, (x) => ({ ...x, rows: x.rows.map((r) => (r.id === item.id ? { ...r, quantity: m.quantity, count: m.count, amount: m.amount, unit: m.unit as ItemWithSources["unit"] } : r)) }));
                  close();
                }}
                data-store-qty-save
              >
                {t.sm.shop.save}
              </button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-3 px-4 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (mode === "price") {
                  const p = Number(text.replace(",", "."));
                  if (!(p >= 0)) return;
                  patchTrip(space, (x) => ({ ...x, prices: { ...x.prices, [item.id]: p } }));
                  void tripApi.price(item, p);
                } else {
                  patchTrip(space, (x) => {
                    const notFound = { ...x.notFound };
                    delete notFound[item.id];
                    return { ...x, checked: { ...x.checked, [item.id]: Date.now() }, notFound };
                  });
                  void tripApi.substitute(item, text.trim() || undefined);
                }
                close();
              }}
            >
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                inputMode={mode === "price" ? "decimal" : "text"}
                placeholder={mode === "price" ? t.sm.shop.pricePh : t.sm.shop.substitutePh}
                className="h-12 rounded-[14px] border border-line-strong bg-surface px-3.5 text-[16px] outline-none focus:border-ink"
                data-store-input
              />
              <button type="submit" className="h-12 rounded-[14px] bg-ink text-[15px] font-bold text-bg" data-store-input-save>
                {t.sm.shop.save}
              </button>
            </form>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Confetti() {
  const colors = ["var(--spark)", "var(--ok)", "#3b7fc4", "#c94673", "#d17a22", "#7c5ad9"];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center" aria-hidden data-store-confetti>
      <div className="relative size-0">
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const r = 80 + (i % 4) * 26;
          return <i key={i} className="confetti absolute size-2.5 rounded-[3px]" style={{ background: colors[i % colors.length], "--tx": `${Math.cos(a) * r}px`, "--ty": `${Math.sin(a) * r - 120}px`, animationDelay: `${(i % 5) * 18}ms` } as React.CSSProperties} />;
        })}
      </div>
    </div>
  );
}

// ---------- finish ----------

type Done = { bought: number; left: number; minutes: number; total: number | null; prices: number; est: number | null };

function Summary({ done, onNext }: { done: Done; onNext: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const leftMonth = useMonthLeft(home);
  const money = (n: number) => formatMoney(Math.round(n * 100) / 100, s.currency, locale);
  const month = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", timeZone: s.clock.tz }).format(new Date(s.clock.now));
  const box = "rounded-[16px] border border-line-strong bg-surface p-3";
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-6" data-store-summary>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-ok text-white">
          <Check className="size-8" strokeWidth={3} />
        </span>
        <h2 className="text-[28px] font-extrabold tracking-[-0.02em]">{t.sm.shop.doneTitle}</h2>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {[
          [done.bought, t.sm.shop.bought],
          [done.left, t.sm.shop.stayed],
          [f(t.sm.shop.minutes, { n: done.minutes }), t.sm.shop.inStore],
        ].map(([n, l]) => (
          <div key={String(l)} className={box}>
            <b className="tabular block text-[22px] font-extrabold">{n}</b>
            <span className="text-[12.5px] text-muted">{l}</span>
          </div>
        ))}
      </div>
      <div className={cn(box, "mt-2.5")}>
        <p className="flex items-baseline justify-between">
          <b className="text-[15px] font-extrabold">{t.sm.shop.total}</b>
          <b className="tabular text-[26px] font-extrabold" data-summary-total>{done.total != null ? money(done.total) : "—"}</b>
        </p>
        {done.est != null && (
          <p className="mt-1 flex justify-between text-[13.5px] text-muted">
            {t.sm.shop.estimateBefore}
            <span className="tabular">≈ {money(done.est)}</span>
          </p>
        )}
        {leftMonth != null && (
          <p className="mt-1 flex justify-between text-[13.5px] text-muted">
            {f(t.sm.shop.leftIn, { month })}
            <b className="tabular text-ink">{money(leftMonth - (done.total ?? 0))}</b>
          </p>
        )}
      </div>
      <button type="button" className={cn(box, "mt-2.5 flex items-center gap-3 text-start")} onClick={() => (s.setScanner("receipt"), onNext())} data-summary-receipt>
        <span className="h-14 w-11 shrink-0 rounded-[6px] bg-[repeating-linear-gradient(var(--surface-2)_0_4px,transparent_4px_8px)] border border-line" aria-hidden />
        <span>
          <b className="block text-[15px] font-extrabold">{t.sm.shop.receiptQ}</b>
          <span className="block text-[13px] text-muted">{t.sm.shop.receiptSub}</span>
        </span>
      </button>
      {done.left > 0 && <p className="mt-2.5 px-1 text-[13px] text-muted">{f(t.sm.shop.staysN, { n: done.left })}</p>}
      <div className="mt-auto pt-6">
        <button type="button" className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-ink text-[16px] font-extrabold text-bg" onClick={() => (s.setScanner("receipt"), onNext())} data-summary-photo>
          <Camera className="size-5" />
          {t.sm.shop.takePhoto}
        </button>
        <button type="button" className="mt-1 h-12 w-full text-[15px] font-bold" onClick={onNext} data-summary-skip>
          {t.sm.shop.skip}
        </button>
      </div>
      <Confetti />
    </div>
  );
}

function Saved({ done, onList, onHome }: { done: Done; onList: () => void; onHome: () => void }) {
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const usual = home?.usualDay;
  const day = usual ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + usual.weekday))) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(20px,env(safe-area-inset-bottom))]" data-store-saved>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-ok text-white">
          <Check className="size-10" strokeWidth={3} />
        </span>
        <h2 className="text-[26px] font-extrabold">{t.sm.shop.savedTitle}</h2>
        <p className="text-[14.5px] text-muted">{f(t.sm.shop.savedPrices, { n: done.prices })}</p>
        <p className="text-[14.5px] text-muted">{done.left ? f(t.sm.shop.staysN, { n: done.left }) : t.sm.shop.staysNone}</p>
        {day && <p className="text-[14.5px] text-muted">{f(t.sm.shop.nextShop, { day })}</p>}
      </div>
      <button type="button" className="h-14 w-full rounded-[18px] bg-ink text-[16px] font-extrabold text-bg" onClick={onList} data-saved-list>
        {t.sm.shop.backToList}
      </button>
      <button type="button" className="mt-1 h-12 w-full text-[15px] font-bold" onClick={onHome} data-saved-home>
        {t.sm.shop.home}
      </button>
    </div>
  );
}
