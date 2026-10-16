"use client";

import "./sm.css";
import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, CloudOff, ListOrdered, Palette, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { clearTripLook, setTripLook } from "@/app/supermarket-actions";
import { sectionName } from "@/lib/grocery/sections";
import { lookFor, TRIP_COLOR_KEYS, TRIP_COLORS, TRIP_STYLES, tripColor, tripLookKey, type TripLook } from "@/lib/grocery/trip-look";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { PersonPhoto } from "../person-photo";
import { sectionColor } from "./art";
import { patchSmHome, useSmHome } from "./data";
import { chainDef, monoColor } from "./numbers";
import type { StoreRef } from "./trip-store";

// R18 S5 B1 + B2 (board StartTrip-phone) — the start-shopping screen: fixed (no scroll, S4 E1), painted in the person's
// look (B2: Auto = the store's colour, or one of 8; Vivid / Soft / Night) with one soft light sweep on open (2.4 s; none
// with reduced motion) and a faint dot grain. Top: close (back to the list), the look button, the store chip (change
// store), "offline". Day + time, the title, three glass stats (items, estimate, minutes at this store — from ≥ 2 trips,
// "~"), the route card (aisle bar + the first five sections in this branch's order, "+ N more"; the first trip says the
// order will be learned), who gets told, "Let's go" → the content scales / blurs out (420 ms) into store mode, whose
// header starts in the same colour with the same aisle bar.

const storeKey = (s: StoreRef | null) => (s ? `${s.chain}|${s.branch}` : null);

/** The person's look for this store, and the colours it paints with (text on `color` reaches 4.5:1). */
export function useTripLook(store: StoreRef | null) {
  const { home } = useSmHome();
  const { resolvedTheme } = useTheme();
  const key = storeKey(store);
  const look = lookFor(home?.tripLooks, key);
  const def = chainDef(store?.chain);
  const storeHex = def ? (def.color.startsWith("#") ? def.color : monoColor(def.color)) : null;
  const { accent } = tripColor(look, storeHex, resolvedTheme === "dark");
  return { look, key, color: accent };
}

const WEEKDAY_FMT = (locale: string, tz: string) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: tz });

export function StartTrip({
  store,
  order,
  rows,
  est,
  onGo,
  onClose,
  onPickStore,
}: {
  store: StoreRef | null;
  order: readonly string[];
  rows: readonly (readonly [string, ItemWithSources[]])[];
  est: number | null;
  onGo: () => void;
  onClose: () => void;
  onPickStore: () => void;
}) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const { look, color, key } = useTripLook(store);
  const [picking, setPicking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const def = chainDef(store?.chain);
  const name = def ? (locale === "he" ? def.he : def.en) : store?.chain;
  const count = rows.reduce((a, [, l]) => a + l.length, 0);
  const visit = key ? home?.visits?.[key] : undefined;
  const learnedRow = store ? home?.stores.find((x) => x.chain === store.chain && x.branch === store.branch) : null;
  const learned = !!learnedRow?.sectionOrder;
  const firstHere = !!store && !visit?.trips;
  const minutes = visit?.minutes ?? null;
  const now = WEEKDAY_FMT(locale, s.clock.tz).formatToParts(new Date(s.clock.now));
  const day = now.find((p) => p.type === "weekday")?.value ?? "";
  const time = `${now.find((p) => p.type === "hour")?.value ?? ""}:${now.find((p) => p.type === "minute")?.value ?? ""}`;
  const others = s.space?.kind === "shared" ? s.people.filter((p) => p.id !== s.me?.id) : [];
  const names = new Intl.ListFormat(locale === "he" ? "he" : "en", { type: "conjunction" }).format(others.slice(0, 3).map((p) => p.name.split(" ")[0]));
  const top = rows.slice(0, 5);
  const more = rows.length - top.length;
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce";
  const go = () => {
    if (leaving) return;
    if (reduce()) return onGo();
    setLeaving(true);
    setTimeout(onGo, 420);
  };
  const glass = look.style === "soft" ? "trip-glass-soft" : "trip-glass";
  return (
    <div className={cn("trip-screen", look.style !== "vivid" && `trip-${look.style}`)} style={{ "--c": color } as React.CSSProperties} data-store-start data-trip-look={`${look.color}:${look.style}`}>
      <div className="trip-light" aria-hidden />
      <div className="trip-grain" aria-hidden />
      <div className={cn("relative flex min-h-0 flex-1 flex-col px-5 pb-[max(20px,env(safe-area-inset-bottom))]", leaving && "trip-go-out")}>
        <div className="flex items-center gap-2 pt-3">
          <button type="button" onClick={onClose} className="trip-x" aria-label={t.sm.shop.backToList} data-store-close>
            <X className="size-5" />
          </button>
          <button type="button" onClick={() => setPicking(true)} className="trip-x" aria-label={t.sm.shop.look} data-trip-look-open>
            <Palette className="size-5" />
          </button>
          <span className="flex-1" />
          {s.offlineAt != null && (
            <span className="trip-chip px-3 text-[12.5px]" data-trip-offline>
              <CloudOff className="size-4" />
              {t.sm.shop.offlineAnyway}
            </span>
          )}
          <button type="button" onClick={onPickStore} className="trip-chip min-w-0 max-w-[60%] pe-2 ps-1.5" aria-label={store ? `${t.sm.shop.changeStore}: ${name}` : t.sm.shop.changeStore} data-store-another>
            <span className="trip-cb">{(locale === "he" ? def?.monoHe : def?.mono)?.slice(0, 2) ?? "·"}</span>
            <span className="flex min-w-0 flex-col text-start leading-tight">
              <b className="bidi truncate text-[13.5px]">{store ? name : t.sm.shop.noStore}</b>
              {store?.branch && <span className="bidi truncate text-[11.5px] font-semibold opacity-85">{store.branch}</span>}
            </span>
            <ChevronDown className="size-4 shrink-0" />
          </button>
        </div>
        <div className="trip-rise flex min-h-0 flex-1 flex-col">
          <p className="mt-6 text-[14px] font-bold opacity-90" data-trip-when>
            {day} · {time}
          </p>
          <h2 className="mt-1 text-[34px] font-extrabold leading-[1.1] tracking-[-0.025em]" data-store-start-title>
            {t.sm.shop.ready}
          </h2>
          <div className="mt-4 flex gap-2">
            <div className={glass}>
              <b className="tabular" data-trip-stat="items">{count}</b>
              <span>{t.sm.shop.statItems}</span>
            </div>
            {est != null && (
              <div className={glass}>
                <b className="tabular" data-trip-stat="est">{formatMoney(Math.round(est), s.currency, locale)}</b>
                <span>{t.sm.shop.statEst}</span>
              </div>
            )}
            {minutes != null && (
              <div className={glass}>
                <b className="tabular" data-trip-stat="mins">{`⁦~${minutes}⁩`}</b>
                <span>{t.sm.shop.statMins}</span>
              </div>
            )}
          </div>
          <div className={cn("trip-route mt-3", look.style === "soft" && "trip-route-soft")} data-trip-route>
            <p className="flex items-center gap-2 text-[13px] font-bold opacity-90">
              <ListOrdered className="size-4 shrink-0" />
              <span className="min-w-0">
                {firstHere ? t.sm.shop.routeFirst : learned && visit ? (visit.trips === 1 ? t.sm.shop.routeLearnedOne : f(t.sm.shop.routeLearned, { n: visit.trips })) : t.sm.shop.routeUsual}
              </span>
            </p>
            <div className="trip-aisle mt-2.5" aria-hidden data-trip-aisle>
              {rows.map(([k, l]) => (
                <i key={k} style={{ "--k": sectionColor(k), flexGrow: l.length } as React.CSSProperties} />
              ))}
            </div>
            <ul className="mt-1.5">
              {top.map(([k, l]) => (
                <li key={k} className="trip-sec" style={{ "--k": sectionColor(k) } as React.CSSProperties} data-trip-sec={k}>
                  <i aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{k === "other" ? t.sm.main.other : sectionName(k, locale)}</span>
                  <b className="tabular">{l.length}</b>
                </li>
              ))}
            </ul>
            {more > 0 && <p className="ps-5 pt-0.5 text-[12.5px] font-semibold opacity-85">{more === 1 ? t.sm.shop.moreSection : f(t.sm.shop.moreSections, { n: more })}</p>}
          </div>
          {others.length > 0 && (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold opacity-90" data-trip-told>
              <span className="flex">
                {others.slice(0, 3).map((p, i) => (
                  <span key={p.id} className={cn("grid size-[22px] place-items-center overflow-hidden rounded-full text-[10px] font-extrabold text-white ring-2 ring-[var(--c)] [&_img]:size-full [&_img]:object-cover", i > 0 && "-ms-1.5")} style={{ background: ["#c94673", "#1a9a8f", "#2f6fd1"][i] }}>
                    <PersonPhoto url={p.image} fallback={p.name.slice(0, 1).toUpperCase()} />
                  </span>
                ))}
              </span>
              <span className="min-w-0 truncate">{others.length === 1 ? f(t.sm.shop.willSeeOne, { names }) : f(t.sm.shop.willSee, { names })}</span>
            </p>
          )}
          <span className="flex-1" />
          <button type="button" className="trip-go" onClick={go} data-store-go>
            {t.sm.shop.go}
            <span className="trip-go-ar" aria-hidden>
              <ArrowRight className="size-5 rtl:-scale-x-100" />
            </span>
          </button>
          <button type="button" className="trip-back" onClick={onClose} data-trip-back>
            {t.sm.shop.backToList}
          </button>
        </div>
      </div>
      <LookSheet open={picking} onClose={() => setPicking(false)} look={look} storeKey={key} storeColor={def ? monoColor(def.color) : TRIP_COLORS.ink} />
      <span hidden data-trip-order={order.join(",")} />
    </div>
  );
}

/** B2: "Screen look" — Auto + 8 colours, Vivid / Soft / Night, "Only for this store" (default on). Saves at once. */
function LookSheet({ open, onClose, look, storeKey: key, storeColor }: { open: boolean; onClose: () => void; look: TripLook & { perStore: boolean }; storeKey: string | null; storeColor: string }) {
  const s = useStore();
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  // "Only for this store" starts on (the brief); unticked, the pick applies to every store.
  const [only, setOnly] = useState(true);
  const save = async (next: TripLook, perStore = only) => {
    const at = perStore && key ? key : null;
    patchSmHome(s.spaceId || "-", (h) => {
      const looks = { ...(h.tripLooks ?? {}) };
      if (!at && key) delete looks[tripLookKey(key)];
      looks[tripLookKey(at)] = JSON.stringify({ color: next.color, style: next.style });
      return { ...h, tripLooks: looks };
    });
    try {
      if (!at && key) await clearTripLook(key);
      await setTripLook(next, at);
    } catch {
      toast.error(t.sm.main.failed);
    }
  };
  const prev = useMemo(() => {
    const c = tripColor(look, storeColor, resolvedTheme === "dark").accent;
    return { vivid: c, soft: `color-mix(in srgb, ${c} 14%, #f6f5f2)`, night: `radial-gradient(80% 80% at 80% 0%, ${c}, #0c0c0c 75%)` };
  }, [look, storeColor, resolvedTheme]);
  const sw = "relative grid size-11 place-items-center rounded-full text-white transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.92]";
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={t.sm.shop.look} fit>
      <div className="flex flex-col gap-4 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-1" data-trip-look-sheet>
        <div>
          <h2 className="text-[20px] font-extrabold tracking-[-0.01em]">{t.sm.shop.look}</h2>
          <p className="mt-0.5 text-[14px] text-muted">{t.sm.shop.lookSub}</p>
        </div>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t.sm.shop.look}>
          {(["auto", ...TRIP_COLOR_KEYS] as const).map((k) => {
            const on = look.color === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={k === "auto" ? t.sm.shop.lookAuto : t.sm.shop.colors[k]}
                className={cn(sw, on && "shadow-[0_0_0_3px_var(--surface),0_0_0_5px_var(--ink)]")}
                style={{ background: k === "auto" ? `conic-gradient(${storeColor}, #c8611a, #127f78, #2563c9, #6a46c8, ${storeColor})` : TRIP_COLORS[k] }}
                onClick={() => void save({ color: k, style: look.style })}
                data-trip-color={k}
              >
                {on && <Check className="size-5" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
        <div>
          <p className="mb-2 text-[13.5px] font-bold">{t.sm.shop.lookStyle}</p>
          <div className="flex gap-2" role="radiogroup" aria-label={t.sm.shop.lookStyle}>
            {TRIP_STYLES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={look.style === m}
                className={cn("flex flex-1 flex-col items-center gap-1.5 rounded-[16px] bg-surface-2 p-2 text-[12.5px] font-bold transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]", look.style === m && "bg-surface shadow-[inset_0_0_0_2px_var(--ink)]")}
                onClick={() => void save({ color: look.color, style: m })}
                data-trip-style={m}
              >
                <i className="block h-[46px] w-full rounded-[10px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]" style={{ background: prev[m] }} />
                {t.sm.shop[m]}
              </button>
            ))}
          </div>
        </div>
        {key && (
          <label className="flex min-h-11 items-center gap-3 text-[14.5px] font-semibold">
            <input
              type="checkbox"
              className="size-5 accent-[var(--ink)]"
              checked={only}
              onChange={(e) => {
                setOnly(e.target.checked);
                void save({ color: look.color, style: look.style }, e.target.checked);
              }}
              data-trip-per-store
            />
            {t.sm.shop.perStore}
          </label>
        )}
        <button type="button" className="h-12 rounded-full bg-ink text-[15px] font-bold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]" onClick={onClose} data-trip-look-done>
          {t.sm.shop.lookDone}
        </button>
      </div>
    </Sheet>
  );
}
