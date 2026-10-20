"use client";

import "./sm.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Activity, ArrowLeft, ChevronDown, ChevronRight, GripVertical, LocateFixed, Search, Store } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { useBackClose } from "@/components/ui/sheet-drag";
import { dismissSectionOrder, findBranches, mapSupermarketStores, saveSupermarketStore, setSectionOrder } from "@/app/supermarket-actions";
import { Spinner } from "@/components/ui/spinner";
import logos from "@/lib/grocery/chain-logos.json";
import { CHAINS, chainLogo } from "@/lib/grocery/chains";
import { normalize } from "@/lib/grocery/normalize";
import { cleanOrder, DEFAULT_ORDER, sectionName, type SectionKey } from "@/lib/grocery/sections";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { SectionIcon } from "./art";
import { refreshSmHome, useSmHome } from "./data";
import { chainDef, monoColor, storeLabel } from "./numbers";
import { setTripStore, useTripStore, type StoreRef } from "./trip-store";

// R18 S2 D2 — the store picker (board Store-phone P7): "This trip only" vs "Make it my default", search by chain / city /
// street (no location), recent branches; and the section order per branch (P8): drag (or move up / down), the learned
// suggestion banner (Use this order · Not now, the moved sections marked), reset.

/** R19 A10: a chain's real logo (public/chains), or a plain store tile in the chain's colour — never a first letter. */
export function ChainLogo({ chain, size = 40 }: { chain: string; size?: number }) {
  const d = chainDef(chain);
  const r = Math.round(size * 0.28);
  if (HAS_LOGO.has(chain))
    // eslint-disable-next-line @next/next/no-img-element -- a 128 px local webp, already the size it shows at
    return <img src={chainLogo(chain)} alt="" width={size} height={size} className="shrink-0 bg-white object-contain shadow-[0_0_0_1px_var(--line-in)]" style={{ width: size, height: size, borderRadius: r }} data-chain-logo={chain} />;
  return (
    <span className="grid shrink-0 place-items-center text-white" style={{ width: size, height: size, borderRadius: r, background: d ? monoColor(d.color) : "var(--muted)" }} aria-hidden data-chain-logo="tile">
      <Store style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </span>
  );
}
/** Kept for the settings / onboarding callers. */
export const Mono = ChainLogo;

const HAS_LOGO = new Set<string>(logos);
const keyOf = (s: StoreRef) => `${s.chain}|${s.branch}`;

export function StorePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={t.sm.store.title} className="desk:max-w-[460px]">
      {open && <PickerBody onClose={onClose} />}
    </Sheet>
  );
}

type Hit = Awaited<ReturnType<typeof findBranches>>[number];
const GRID = 8;

function PickerBody({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const space = s.spaceId || "-";
  const trip = useTripStore(space, home);
  const [mode, setMode] = useState<"trip" | "default">(home?.store ? "trip" : "default");
  const [q, setQ] = useState("");
  const [chainSel, setChainSel] = useState<string | null>(null);
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [moreChains, setMoreChains] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picked, setPicked] = useState<StoreRef | null>(trip.store);
  const def = home?.store ?? null;
  const visits = useMemo(() => home?.visits ?? {}, [home?.visits]);
  const rows = useMemo(() => home?.stores ?? [], [home?.stores]);
  const known: StoreRef[] = useMemo(() => {
    const list = rows.map((x) => ({ chain: x.chain, branch: x.branch, branchId: x.branchId ?? null }));
    return list.sort((a, b) => (def && keyOf(a) === keyOf(def) ? -1 : def && keyOf(b) === keyOf(def) ? 1 : (visits[keyOf(b)]?.last ?? 0) - (visits[keyOf(a)]?.last ?? 0)));
  }, [rows, def, visits]);
  const input = useRef<HTMLInputElement>(null);
  // Stores typed before the directory: matched to their real branch once (the rest ask: "Choose the exact branch").
  const mappedOnce = useRef(false);
  useEffect(() => {
    if (mappedOnce.current || s.space?.role === "viewer" || !rows.some((x) => !x.branchId)) return;
    mappedOnce.current = true;
    void mapSupermarketStores().then((n) => { if (n > 0) void refreshSmHome(space, locale); }, () => {});
  }, [rows, s.space?.role, space, locale]);
  const searching = !!q.trim() || !!chainSel || !!near;
  useEffect(() => {
    if (!searching) return;
    let live = true;
    const id = setTimeout(() => void findBranches(q, chainSel, near).then((r) => live && setHits(r), () => live && setHits([])), 160);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q, chainSel, near, searching]);
  const chains = useMemo(() => [...CHAINS].sort((a, b) => Number(!!b.big) - Number(!!a.big) || Number(HAS_LOGO.has(b.id)) - Number(HAS_LOGO.has(a.id)) || Number(!!a.pharm) - Number(!!b.pharm)), []);
  const name = (id: string) => {
    const d = chainDef(id);
    return d ? (locale === "he" ? d.he : d.en) : id;
  };
  const locate = () => {
    if (near) return setNear(null);
    if (!navigator.geolocation) return toast(t.sm.store.nearOff);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => (setLocating(false), setNear({ lat: Math.round(p.coords.latitude * 1000) / 1000, lng: Math.round(p.coords.longitude * 1000) / 1000 })),
      () => (setLocating(false), toast(t.sm.store.nearOff)),
      { timeout: 8000, maximumAge: 600_000 },
    );
  };
  const sub = (x: StoreRef) => {
    if (!x.branchId && x.branch) return t.sm.store.pickExact;
    const v = visits[keyOf(x)];
    const times = !v ? "" : v.trips === 1 ? t.sm.store.once : v.trips === 2 ? t.sm.store.twice : f(t.sm.store.times, { n: v.trips });
    const last = v ? f(t.sm.store.lastTrip, { date: new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", timeZone: s.clock.tz }).format(new Date(v.last)) }) : "";
    return [x.branch, v && v.trips > 2 ? last : times].filter(Boolean).join(" · ");
  };
  const go = async () => {
    if (!picked) return;
    const label = storeLabel(picked.chain, picked.branch, locale) ?? picked.chain;
    try {
      if (mode === "default") {
        await saveSupermarketStore(picked.chain, picked.branch, true, picked.branchId ?? null);
        setTripStore(space, null);
        await refreshSmHome(space, locale);
        toast.success(f(t.sm.store.saved, { store: label }));
      } else {
        // Known to the space (its own section order lives there), not the default.
        if (!known.some((x) => keyOf(x) === keyOf(picked))) await saveSupermarketStore(picked.chain, picked.branch, false, picked.branchId ?? null);
        setTripStore(space, def && keyOf(def) === keyOf(picked) ? null : picked);
        await refreshSmHome(space, locale);
        toast(f(t.sm.store.tripOnly, { store: label }));
      }
      onClose();
    } catch {
      toast.error(t.sm.store.failed);
    }
  };
  const seg = (on: boolean) => cn("flex min-h-[64px] flex-col justify-center rounded-[16px] border px-3.5 py-2 text-start transition-colors duration-150", on ? "border-ink border-2 bg-surface" : "border-line-strong bg-surface");
  const radio = (on: boolean) => (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-ink" : "border-line-strong")} aria-hidden>
      {on && <i className="size-3 rounded-full bg-ink" />}
    </span>
  );
  const row = "flex min-h-[68px] w-full items-center gap-3 border-t border-line-in px-3 py-2 text-start first:border-t-0 active:bg-surface-2";
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-store-picker>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-1">
        <h2 className="text-[21px] font-extrabold">{t.sm.store.title}</h2>
        <p className="mt-0.5 text-[13px] text-muted">{t.sm.store.fromFiles}</p>
        {/* R18 S3 B11: first how this choice counts — before any branch is picked. */}
        <p className="mb-1.5 mt-3 px-1 text-[13px] font-semibold text-muted" id="store-mode-q">{t.sm.store.modeQ}</p>
        <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-labelledby="store-mode-q">
          <button type="button" role="radio" aria-checked={mode === "trip"} className={seg(mode === "trip")} onClick={() => setMode("trip")} disabled={!def} data-store-mode="trip">
            <b className="text-[15px] font-extrabold">{t.sm.store.thisTrip}</b>
            <span className="bidi text-[12.5px] text-muted">{def ? f(t.sm.store.thisTripSub, { store: storeLabel(def.chain, null, locale) ?? def.chain }) : t.sm.store.thisTripNoDefault}</span>
          </button>
          <button type="button" role="radio" aria-checked={mode === "default"} className={seg(mode === "default")} onClick={() => setMode("default")} data-store-mode="default">
            <b className="text-[15px] font-extrabold">{t.sm.store.makeDefault}</b>
            <span className="text-[12.5px] text-muted">{t.sm.store.makeDefaultSub}</span>
          </button>
        </div>
        <div className="mt-3 flex h-[52px] items-center gap-2.5 rounded-[16px] border border-line-strong bg-surface ps-3.5 pe-1.5 focus-within:border-ink">
          <Search className="size-[18px] shrink-0 text-muted" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.sm.store.search} aria-label={t.sm.store.search} className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" data-store-search />
          <button type="button" onClick={locate} aria-pressed={!!near} aria-label={t.sm.store.nearMe} title={t.sm.store.nearMe} className={cn("grid size-10 shrink-0 place-items-center rounded-full transition-transform duration-150 active:scale-95", near ? "bg-ink text-bg" : "text-muted")} data-store-near>
            {locating ? <Spinner /> : <LocateFixed className="size-[18px]" />}
          </button>
        </div>
        {/* The chains (logos): 8, then all of them; a tap narrows the branches to that chain. */}
        <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label={t.sm.store.chains} data-store-chains>
          {(moreChains ? chains : chains.slice(0, GRID)).map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chainSel === c.id}
              onClick={() => setChainSel(chainSel === c.id ? null : c.id)}
              className={cn("flex min-h-[86px] flex-col items-center justify-center gap-1.5 rounded-[18px] bg-surface px-1 py-2 text-center text-[11.5px] font-bold leading-tight text-ink/80 transition-transform duration-150 active:scale-[0.96]", chainSel === c.id ? "shadow-[0_0_0_2px_var(--ink)]" : "shadow-[0_0_0_1px_var(--line-in)]")}
              data-store-chain={c.id}
            >
              <ChainLogo chain={c.id} size={40} />
              <span className="bidi line-clamp-2">{name(c.id)}</span>
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex justify-center">
          <button type="button" onClick={() => setMoreChains(!moreChains)} className="flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-bold text-muted" data-store-more-chains>
            {moreChains ? t.sm.store.fewerChains : f(t.sm.store.moreChains, { n: chains.length - GRID })}
            <ChevronDown className={cn("size-4 transition-transform duration-200", moreChains && "rotate-180")} />
          </button>
        </div>
        <p className="mb-1.5 mt-2 flex items-baseline justify-between px-1 text-[13px] font-semibold text-muted">
          {searching ? (chainSel ? f(t.sm.store.branchesOf, { chain: name(chainSel) }) : t.sm.store.branches) : t.sm.store.recent}
          {searching && hits && <span>{f(t.sm.store.found, { n: hits.length })}</span>}
        </p>
        {searching ? (
          hits && hits.length > 0 ? (
            <div className="overflow-hidden rounded-[18px] border border-line-strong bg-surface" role="radiogroup">
              {hits.map((b) => {
                const ref: StoreRef = { chain: b.chain, branch: b.name, branchId: b.id };
                const on = !!picked && (picked.branchId ? picked.branchId === b.id : keyOf(picked) === keyOf(ref));
                const where = [b.address, locale === "he" ? b.city : b.cityEn || b.city].filter(Boolean).join(", ");
                return (
                  <button key={b.id} type="button" role="radio" aria-checked={on} onClick={() => setPicked(ref)} className={row} data-store-option={b.id}>
                    <ChainLogo chain={b.chain} size={36} />
                    <span className="min-w-0 flex-1">
                      <b className="bidi block truncate text-[15px] font-extrabold">{name(b.chain)} · {b.name}</b>
                      <span className="bidi block truncate text-[12.5px] text-muted">{b.online ? t.sm.store.online : where || "—"}</span>
                    </span>
                    {b.km != null && <span className="tabular shrink-0 text-[12px] font-semibold text-muted" data-store-km>{f(t.sm.store.km, { n: b.km })}</span>}
                    {radio(on)}
                  </button>
                );
              })}
            </div>
          ) : hits ? (
            <p className="rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] text-muted" data-store-no-hits>{t.sm.store.noHits}</p>
          ) : null
        ) : (
          known.length > 0 && (
            <div className="overflow-hidden rounded-[18px] border border-line-strong bg-surface" role="radiogroup">
              {known.map((x) => {
                const on = !!picked && keyOf(picked) === keyOf(x);
                const exact = !!x.branchId || !x.branch;
                return (
                  <button
                    key={keyOf(x)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      if (exact) return setPicked(x);
                      // Typed before the directory and not matched: find the real branch (asked once — then it's saved).
                      setChainSel(x.chain);
                      setQ(x.branch);
                      input.current?.focus();
                    }}
                    className={row}
                    data-store-option={keyOf(x)}
                    data-store-exact={exact ? undefined : "ask"}
                  >
                    <ChainLogo chain={x.chain} size={36} />
                    <span className="min-w-0 flex-1">
                      <b className="bidi block truncate text-[15px] font-extrabold">{x.branch ? `${name(x.chain)} · ${x.branch}` : name(x.chain)}</b>
                      <span className={cn("bidi block truncate text-[12.5px]", exact ? "text-muted" : "font-semibold text-info")}>{sub(x)}</span>
                    </span>
                    {def && keyOf(def) === keyOf(x) && <span className="shrink-0 rounded-[7px] bg-surface-2 px-2 py-0.5 text-[12px] font-bold text-muted">{t.sm.store.default}</span>}
                    {exact ? radio(on) : <ChevronRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" />}
                  </button>
                );
              })}
            </div>
          )
        )}
        <p className="mt-3 px-1 text-[12.5px] text-muted">{t.sm.store.note}</p>
      </div>
      <div className="px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-2">
        <button type="button" disabled={!picked} className="h-[52px] w-full rounded-[16px] bg-ink text-[16px] font-extrabold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-40" onClick={() => void go()} data-store-go>
          {mode === "default" ? t.sm.store.setDefault : t.sm.store.shopHere}
        </button>
      </div>
    </div>
  );
}

// ---------- the section order of a branch ----------

/** The sections that change place between two orders (for "2 sections swap places" and the moved marks). */
export function movedSections(from: readonly string[], to: readonly string[]) {
  return to.filter((k, i) => from.indexOf(k) !== i);
}

export function SectionOrder({ open, onClose, onPickStore }: { open: boolean; onClose: () => void; onPickStore: () => void }) {
  const { t } = useI18n();
  useBackClose(open, onClose);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 overlay-in phone:hidden" />
        <D.Content className="sm-push fixed inset-0 z-50 flex flex-col bg-bg outline-none phone:pt-[env(safe-area-inset-top)] desk:inset-x-0 desk:top-[6vh] desk:mx-auto desk:h-[86vh] desk:max-w-[520px] desk:overflow-hidden desk:rounded-2xl desk:border desk:border-line desk:shadow-pop desk:animate-pop-in" data-section-order>
          <D.Title className="sr-only">{t.sm.order.title}</D.Title>
          <D.Description className="sr-only">{t.sm.order.title}</D.Description>
          {open && <OrderBody onClose={onClose} onPickStore={onPickStore} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function OrderBody({ onClose, onPickStore }: { onClose: () => void; onPickStore: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const space = s.spaceId || "-";
  const { store } = useTripStore(space, home);
  const row = store ? home?.stores.find((x) => x.chain === store.chain && x.branch === store.branch) ?? null : null;
  const saved: SectionKey[] = row?.sectionOrder ? cleanOrder(row.sectionOrder) : [...DEFAULT_ORDER];
  const [order, setOrder] = useState<SectionKey[]>(saved);
  const suggested = row?.suggestedOrder ? cleanOrder(row.suggestedOrder) : null;
  const [banner, setBanner] = useState(!!suggested);
  const moved = suggested && banner ? new Set(movedSections(order, suggested)) : new Set<string>();
  const label = store ? storeLabel(store.chain, store.branch, locale) ?? store.chain : "";
  const persist = async (next: SectionKey[] | null) => {
    if (!store) return;
    try {
      await setSectionOrder(store.chain, store.branch, next);
      await refreshSmHome(space, locale);
    } catch {
      toast.error(t.sm.order.failed);
    }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    setOrder(next);
    void persist(next);
  };
  // The first pair the suggestion puts the other way round ("dairy comes before bread").
  const pair = suggested ? (() => {
    for (let i = 0; i < suggested.length; i++) for (let j = i + 1; j < suggested.length; j++) if (order.indexOf(suggested[i]) > order.indexOf(suggested[j])) return [suggested[i], suggested[j]] as const;
    return null;
  })() : null;
  const nMoved = suggested ? movedSections(order, suggested).length : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full" aria-label={t.sm.add.back} data-order-back>
          <ArrowLeft className="size-5 rtl:-scale-x-100" />
        </button>
        <h2 className="flex-1 text-[19px] font-extrabold">{t.sm.order.title}</h2>
        {store && (
          <button
            type="button"
            className="h-10 rounded-full px-3 text-[14px] font-bold text-muted"
            onClick={() => {
              setOrder([...DEFAULT_ORDER]);
              void persist(null);
              toast(t.sm.order.resetDone);
            }}
            data-order-reset
          >
            {t.sm.order.reset}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2">
        {!store ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <p className="max-w-[30ch] text-[14.5px] text-muted">{t.sm.order.noStore}</p>
            <button type="button" className="h-11 rounded-[14px] bg-ink px-4 text-[15px] font-bold text-bg" onClick={onPickStore}>
              {t.sm.order.chooseStore}
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="flex min-h-14 w-full items-center gap-3 rounded-[16px] border border-line-strong bg-surface px-3 text-start" onClick={onPickStore} data-order-store>
              <Mono chain={store.chain} size={36} />
              <span className="min-w-0 flex-1">
                <b className="bidi block truncate text-[15px] font-extrabold">{storeLabel(store.chain, null, locale)}</b>
                {store.branch && <span className="bidi block truncate text-[12.5px] text-muted">{store.branch}</span>}
              </span>
              <span className="text-[12.5px] text-muted">{t.sm.order.thisBranch}</span>
              <ChevronDown className="size-4 text-muted" />
            </button>
            {suggested && banner && pair && (
              <div className="mt-3 rounded-[18px] border border-[color-mix(in_srgb,var(--info)_35%,var(--line-strong))] bg-[color-mix(in_srgb,var(--info)_7%,var(--surface))] p-3.5" data-order-suggestion>
                <div className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface text-info">
                    <Activity className="size-[18px]" />
                  </span>
                  <span>
                    <b className="block text-[15.5px] font-extrabold">{f(t.sm.order.learned, { a: sectionName(pair[0], locale), b: sectionName(pair[1], locale) })}</b>
                    <span className="block text-[13px] text-muted">{t.sm.order.learnedSub}</span>
                  </span>
                </div>
                <p className="mt-2.5 flex items-center gap-2 text-[13px] text-muted">
                  <SectionIcon section={pair[0]} size={24} />
                  <ChevronRight className="size-3.5 rtl:-scale-x-100" />
                  <SectionIcon section={pair[1]} size={24} />
                  {nMoved === 2 ? t.sm.order.swapsTwo : f(t.sm.order.swaps, { n: nMoved })}
                </p>
                <div className="mt-3 flex gap-2.5">
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-[13px] bg-ink text-[14.5px] font-bold text-bg"
                    onClick={() => {
                      setOrder(suggested);
                      setBanner(false);
                      void persist(suggested);
                      toast.success(f(t.sm.order.saved, { store: label }));
                    }}
                    data-order-use
                  >
                    {t.sm.order.use}
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-[13px] border border-line-strong bg-surface text-[14.5px] font-bold"
                    onClick={() => {
                      setBanner(false);
                      if (store) void dismissSectionOrder(store.chain, store.branch).then(() => refreshSmHome(space, locale), () => {});
                    }}
                    data-order-not-now
                  >
                    {t.sm.order.notNow}
                  </button>
                </div>
              </div>
            )}
            <p className="mb-1.5 mt-4 flex items-baseline justify-between px-1 text-[13px] font-semibold text-muted">
              {t.sm.order.walk}
              <span>{t.sm.order.drag}</span>
            </p>
            <DragList order={order} moved={moved} onMove={move} />
          </>
        )}
      </div>
    </div>
  );
}

/** Drag a row by its handle (pointer: the row follows the finger, the others make room); arrow keys on the handle too. */
function DragList({ order, moved, onMove }: { order: SectionKey[]; moved: Set<string>; onMove: (from: number, to: number) => void }) {
  const { t, f, locale } = useI18n();
  const ROW = 56;
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const start = useRef(0);
  const to = drag ? Math.max(0, Math.min(order.length - 1, drag.from + Math.round(drag.dy / ROW))) : -1;
  return (
    <ol className="overflow-hidden rounded-[18px] border border-line-strong bg-surface" data-order-list>
      {order.map((k, i) => {
        const dragging = drag?.from === i;
        // The others shift by one row while the dragged one passes them.
        const shift = drag && !dragging ? (i > drag.from && i <= to ? -ROW : i < drag.from && i >= to ? ROW : 0) : 0;
        return (
          <li
            key={k}
            className={cn("relative flex items-center gap-3 border-b border-line-in bg-surface px-3 last:border-b-0", dragging ? "z-10 shadow-pop" : "transition-transform duration-200 ease-[var(--ease-out)]")}
            style={{ height: ROW, transform: `translateY(${dragging ? drag!.dy : shift}px)` }}
            data-order-row={k}
          >
            <span className="tabular w-5 shrink-0 text-center text-[13px] font-bold text-muted">{i + 1}</span>
            <SectionIcon section={k} size={30} />
            <b className="min-w-0 flex-1 truncate text-[15.5px] font-bold">{sectionName(k, locale)}</b>
            {moved.has(k) && <span className="shrink-0 rounded-[7px] bg-info-soft px-1.5 py-0.5 text-[11.5px] font-bold text-info">{t.sm.order.moved}</span>}
            <button
              type="button"
              className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-[10px] text-muted active:cursor-grabbing"
              aria-label={f(t.sm.order.dragLabel, { section: sectionName(k, locale) })}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                start.current = e.clientY;
                setDrag({ from: i, dy: 0 });
              }}
              onPointerMove={(e) => drag && setDrag({ from: drag.from, dy: e.clientY - start.current })}
              onPointerUp={() => {
                if (drag) onMove(drag.from, to);
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  onMove(i, i - 1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  onMove(i, i + 1);
                }
              }}
              data-order-handle={k}
            >
              <GripVertical className="size-5" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
