"use client";

import "./sm.css";
import { useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, ChevronRight, Plus, ShoppingBasket, ShoppingCart, Sparkles } from "lucide-react";
import { useI18n } from "@/components/providers";
import { basketFor, WEEKLY_BASKET_SIZE } from "@/lib/grocery/basket";
import { sectionName } from "@/lib/grocery/sections";
import { local } from "@/lib/notify/schedule";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PersonPhoto } from "../person-photo";
import { useStore } from "../store";
import { SectionIcon } from "./art";
import { useSmHome, type OpenTrip } from "./data";
import { storeLabel, tripLeft, tripTotal, useAddMany, useEstimate, useMonthLeft, useOpenSm, useTrips } from "./numbers";
import { useOutboxCount } from "./outbox-count";
import { useLocalTrip, type LocalTrip } from "./local-trip";
import { bySection } from "./view";

// R18 S2 A3 — the Home "Next shop" card (board HomeCard-phone) and the trip bar above the dock (board TripBar-phone):
// mine (count left, so far, Back), someone else's (Watch — what you add shows up for them), offline (changes waiting),
// everything checked (Finish). The bar is on every phone screen while a trip runs.

const noop = () => () => {};
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

function useName() {
  const s = useStore();
  return (userId: string) => (s.people.find((p) => p.id === userId)?.name ?? "").split(" ")[0] || "—";
}

function timeOf(ts: number, tz: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(ts));
}

/** A ring around a count (the bar) or "12/23" (the card); `pct` 0–1. */
function Ring({ pct, size, children, tone = "var(--ink)" }: { pct: number; size: number; children: React.ReactNode; tone?: string }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in srgb, currentColor 18%, transparent)" strokeWidth="3.5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))} className="transition-[stroke-dashoffset] duration-500 ease-[var(--ease-out)]" />
      </svg>
      <span className="relative tabular text-[12px] font-extrabold">{children}</span>
    </span>
  );
}

// ---------- the trip bar ----------

export function TripBar() {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(<TripBarInner />, document.body);
}

function TripBarInner() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const { mine: serverMine, others } = useTrips(home);
  // My trip as this device knows it (instant counts; also when it started offline and the server doesn't know yet).
  const local = useLocalTrip(s.spaceId || "-");
  const mine = local ? localAsOpen(local, s.me?.id ?? "", serverMine) : serverMine;
  const open = useOpenSm();
  const name = useName();
  const waiting = useOutboxCount();
  const trip = mine ?? others[0] ?? null;
  if (!trip || s.view.type === "home" && !mine) return null;
  const store = storeLabel(trip.chain, trip.branch, locale);
  const left = tripLeft(trip);
  const total = tripTotal(trip);
  const pct = total ? (total - left) / total : 0;
  const money = (n: number) => formatMoney(Math.round(n * 100) / 100, s.currency, locale);
  const done = !!mine && left === 0 && trip.bought > 0;
  const offline = !!mine && s.offlineAt != null;
  const other = !mine;
  const title = done ? t.sm.bar.done : other ? (store ? f(t.sm.bar.other, { name: name(trip.userId), store }) : f(t.sm.bar.otherNoStore, { name: name(trip.userId) })) : offline ? store ?? t.sm.bar.label : store ? f(t.sm.bar.left, { n: left, store }) : f(t.sm.bar.leftNoStore, { n: left });
  const sub = done ? (trip.spent > 0 ? f(t.sm.bar.doneSub, { amount: money(trip.spent) }) : t.sm.bar.doneSubNone) : other ? f(t.sm.bar.otherSub, { n: left }) : offline ? (waiting ? f(t.sm.bar.offline, { n: waiting }) : t.sm.bar.offlineNone) : f(t.sm.bar.soFar, { amount: money(trip.spent) });
  const action = done ? t.sm.bar.finish : other ? t.sm.bar.watch : t.sm.bar.back;
  return (
    <div
      className={cn(
        "fixed inset-x-3 bottom-[calc(90px+env(safe-area-inset-bottom))] z-[39] flex h-[58px] items-center gap-3 rounded-[18px] ps-2.5 pe-2 shadow-[0_10px_28px_color-mix(in_srgb,var(--ink)_22%,transparent)] desk:hidden [[data-selecting]_&]:hidden [[data-store-mode]_&]:hidden animate-pop-in",
        other ? "border border-line bg-surface text-ink" : "bg-ink text-bg",
      )}
      role="status"
      aria-label={t.sm.bar.label}
      data-trip-bar={done ? "done" : other ? "other" : offline ? "offline" : "mine"}
    >
      {other ? (
        <Ring pct={pct} size={40} tone="#1f7a4d">
          <span className="grid size-7 place-items-center overflow-hidden rounded-full bg-[#7c5ad9] text-[11px] font-bold text-white">
            <PersonPhoto url={s.people.find((p) => p.id === trip.userId)?.image} fallback={name(trip.userId).slice(0, 1)} />
          </span>
        </Ring>
      ) : (
        <Ring pct={done ? 1 : pct} size={40} tone={done ? "#3f9d5a" : "var(--spark)"}>
          {done ? <Check className="size-4" strokeWidth={3} /> : left}
        </Ring>
      )}
      <span className="min-w-0 flex-1">
        <b className="bidi block truncate text-[14.5px] font-extrabold">{title}</b>
        <span className={cn("block truncate text-[12px]", other ? "text-muted" : "opacity-75")}>{sub}</span>
      </span>
      <button
        type="button"
        onClick={() => open(other ? undefined : "shop")}
        className={cn("flex h-[42px] shrink-0 items-center gap-1 rounded-[12px] px-3 text-[14px] font-bold transition-transform duration-150 ease-[var(--ease-out)] active:scale-95", other ? "bg-surface-2 text-ink" : "bg-[color-mix(in_srgb,var(--bg)_16%,transparent)] text-bg")}
        data-trip-bar-go
      >
        {action}
        <ChevronRight className="size-4 rtl:-scale-x-100" />
      </button>
    </div>
  );
}

/** The local trip in the server's shape (counts from this device's checks). */
function localAsOpen(t: LocalTrip, me: string, server: OpenTrip | null): OpenTrip {
  const bought = Object.keys(t.checked).length;
  const notFound = Object.keys(t.notFound).filter((id) => !t.checked[id]).length;
  const spent = Object.values(t.prices).reduce((a, p) => a + p, 0);
  return { id: server?.id ?? "local", userId: me, chain: t.chain, branch: t.branch, startedAt: t.startedAt, planned: t.rows.length, bought, notFound, added: 0, spent: Math.max(spent, server?.spent ?? 0) };
}

// ---------- the Home card ----------

/** The trip Home pins at its top: mine (the device's own first), else another member's; null when nobody shops. */
export function useRunningTrip() {
  const s = useStore();
  const { home } = useSmHome();
  const { mine: serverMine, others } = useTrips(home);
  const local = useLocalTrip(s.spaceId || "-");
  const mine = local ? localAsOpen(local, s.me?.id ?? "", serverMine) : serverMine;
  return { mine, trip: mine ?? others[0] ?? null, local };
}

/**
 * The supermarket on Home. R18 S3 C4: `part` "trip" = the running trip's bar, pinned at the top of Home whatever the
 * layout; "plan" = the next-shop widget (movable / removable in Customise; Home hides it while a trip runs). No part
 * (the empty Home) = whichever applies.
 */
export function NextShopCard({ className, part }: { className?: string; part?: "trip" | "plan" }) {
  const s = useStore();
  const { home } = useSmHome();
  const { mine, trip: running, local } = useRunningTrip();
  if (s.loading) return null;
  if (part === "trip") return running ? <div className={cn("desk:col-span-12", className)} data-next-shop={mine ? "mine" : "other"}><TripCard trip={running} mine={!!mine} /></div> : null;
  // G2: the list is on the device before the server's numbers — show the card at once (no jump on Home when they
  // arrive); only an empty list waits (it may be the first-time card).
  if (!home)
    return s.sm.length && !local ? (
      <div className={cn("desk:col-span-12", className)} data-next-shop="next">
        <NextCard />
      </div>
    ) : null;
  const trip = part === "plan" ? null : running;
  return (
    <div className={cn("desk:col-span-12", className)} data-next-shop={trip ? (mine ? "mine" : "other") : !s.sm.length && !home.trips ? "first" : "next"}>
      {trip ? <TripCard trip={trip} mine={!!mine} /> : !s.sm.length && !home.trips ? <FirstCard /> : <NextCard />}
    </div>
  );
}

const card = "rounded-[22px] border border-line-strong bg-surface p-4 shadow-[var(--card-shadow)]";
const btn = "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]";
const ghost = cn(btn, "border border-line-strong bg-surface text-ink");
const solid = cn(btn, "bg-ink text-bg");

function NextCard() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const est = useEstimate(home);
  const left = useMonthLeft(home);
  const open = useOpenSm();
  const groups = useMemo(() => [...bySection(s.sm, home?.order)].sort((a, b) => b[1].length - a[1].length), [s.sm, home?.order]);
  const now = local(s.clock.now, s.clock.tz);
  const usual = home?.usualDay ?? null;
  const today = usual != null && usual.weekday === now.weekday;
  const day = usual ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + usual.weekday))) : null;
  const sug = home?.suggestions.length ?? 0;
  const n = s.sm.length;
  const money = (x: number) => formatMoney(Math.round(x), s.currency, locale);
  return (
    <section className={cn(card, today && "border-[color-mix(in_srgb,var(--spark)_55%,var(--line-strong))]")} data-next-card={today ? "today" : "next"}>
      <div className={cn("flex items-center gap-1.5 text-[12.5px] font-bold", today ? "text-[color-mix(in_srgb,var(--spark)_70%,var(--ink))]" : "text-muted")}>
        {today ? <CalendarDays className="size-4" /> : <ShoppingBasket className="size-4" />}
        {today ? t.sm.home.today : day ? f(t.sm.home.nextShopDay, { day }) : t.sm.home.nextShop}
      </div>
      <h2 className="tabular mt-1 text-[24px] font-extrabold tracking-[-0.02em]">
        {n === 1 ? t.sm.home.itemsOne : f(t.sm.home.items, { n })}
        {est != null && <> · {f(t.sm.home.est, { amount: money(est) })}</>}
      </h2>
      {left != null && <p className="tabular text-[13px] text-muted">{left >= 0 ? f(t.sm.main.leftMonth, { amount: money(left) }) : f(t.sm.main.overMonth, { amount: money(-left) })}</p>}
      {groups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {groups.slice(0, 4).map(([k, list]) => (
            <span key={k} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-surface-2 pe-2.5 ps-1 text-[13px] font-bold" title={f(t.sm.home.sections, { n: list.length, section: sectionName(k, locale) })}>
              <SectionIcon section={k} size={24} />
              {list.length}
            </span>
          ))}
          {groups.length > 4 && <span className="inline-flex h-8 items-center rounded-[10px] bg-surface-2 px-2.5 text-[13px] font-bold" title={f(t.sm.home.more, { n: groups.length - 4 })}>+{groups.length - 4}</span>}
        </div>
      )}
      {/* The line is always there (loading: kept blank; nothing to suggest: says so) — the card never changes height
          when the server's numbers arrive (no shift on Home, R18 S2 G2). */}
      <p className={cn("mt-3 flex items-center gap-2 text-[13.5px] font-semibold", !home && "invisible", home && sug === 0 && "font-medium text-muted")} aria-hidden={!home || undefined} data-next-sug={home ? sug : undefined}>
        <span className={cn("grid size-5 place-items-center rounded-[6px]", sug > 0 || !home ? "bg-spark text-white" : "bg-surface-2 text-muted")}>
          <Sparkles className="size-3" />
        </span>
        {!home ? " " : sug === 0 ? t.sm.home.suggestsNone : today ? f(t.sm.home.readySince, { n: sug }) : sug === 1 ? t.sm.home.suggestsOne : f(t.sm.home.suggestsMore, { n: sug })}
      </p>
      <div className="mt-3.5 flex gap-2.5">
        <button type="button" className={ghost} onClick={() => open()} data-next-list>
          {t.sm.home.list}
        </button>
        {s.space?.role !== "viewer" && (
          <button type="button" className={solid} onClick={() => open("shop")} data-next-start>
            <ShoppingCart className="size-[18px]" />
            {t.sm.home.start}
          </button>
        )}
      </div>
    </section>
  );
}

function TripCard({ trip, mine }: { trip: OpenTrip; mine: boolean }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const open = useOpenSm();
  const name = useName();
  const store = storeLabel(trip.chain, trip.branch, locale);
  const left = tripLeft(trip);
  const total = tripTotal(trip);
  const done = total - left;
  const who = name(trip.userId);
  return (
    <section className={card} data-trip-card={mine ? "mine" : "other"}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-[color-mix(in_srgb,var(--spark)_70%,var(--ink))]">
            <ShoppingCart className="size-4 shrink-0" />
            <span className="bidi truncate">{mine ? (store ? f(t.sm.home.shoppingNow, { store }) : t.sm.home.shoppingNowNoStore) : store ? f(t.sm.home.isShopping, { name: who, store }) : f(t.sm.home.isShoppingNoStore, { name: who })}</span>
          </div>
          <h2 className="tabular mt-1 text-[24px] font-extrabold tracking-[-0.02em]">
            {f(t.sm.home.progress, { done, total })}
            {trip.spent > 0 && <> · {formatMoney(Math.round(trip.spent * 100) / 100, s.currency, locale)}</>}
          </h2>
          <p className="text-[13px] text-muted">{mine ? f(t.sm.home.startedLeft, { time: timeOf(trip.startedAt, s.clock.tz, locale), n: left }) : f(t.sm.home.startedLive, { time: timeOf(trip.startedAt, s.clock.tz, locale) })}</p>
        </div>
        <Ring pct={total ? done / total : 0} size={48}>
          {done}/{total}
        </Ring>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-line-in" aria-hidden>
        <i className="block h-full rounded-full bg-[#1f7a4d] transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>
      <div className="mt-3.5 flex gap-2.5">
        {mine ? (
          <>
            <button type="button" className={ghost} onClick={() => open("shop")} data-trip-finish>
              {t.sm.home.finish}
            </button>
            <button type="button" className={solid} onClick={() => open("shop")} data-trip-resume>
              {t.sm.home.resume}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={ghost} onClick={() => open()} data-next-list>
              {t.sm.home.list}
            </button>
            {s.space?.role !== "viewer" && (
              <button type="button" className={solid} onClick={() => open("add")} data-trip-add-for>
                <Plus className="size-[18px]" />
                <span className="truncate">{f(t.sm.home.addFor, { name: who })}</span>
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function FirstCard() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const open = useOpenSm();
  const addMany = useAddMany();
  const ro = s.space?.role === "viewer";
  return (
    <section className={card} data-first-card>
      <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-muted">
        <ShoppingBasket className="size-4" />
        {t.sm.title}
      </div>
      <h2 className="mt-1 text-[24px] font-extrabold tracking-[-0.02em]">{t.sm.home.firstTitle}</h2>
      <p className="text-[13.5px] text-muted">{t.sm.home.firstSub}</p>
      {!ro && (
        <div className="mt-3.5 flex gap-2.5">
          <button
            type="button"
            className={ghost}
            onClick={async () => {
              if (await addMany(basketFor({ who: s.obWho, locale }).slice(0, WEEKLY_BASKET_SIZE), { done: (n) => f(t.sm.main.addedN, { n }), failed: t.sm.main.failed })) open();
            }}
            data-first-basket
          >
            {t.sm.home.basket}
          </button>
          <button type="button" className={solid} onClick={() => open("build")} data-first-build>
            {t.sm.home.build}
          </button>
        </div>
      )}
    </section>
  );
}
