"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Package, RefreshCw, Sparkles, Tag, TrendingDown, TrendingUp, Truck, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { toast } from "@/lib/toast";
import { updateItem } from "@/app/actions";
import { calendarSubscribed } from "@/app/cal-actions";
import { googleTemplateUrl } from "@/lib/ics";
import { buyAgain, dismissHome, homeLook, phraseSuggestions, undismissHome, type Phrased } from "@/app/home-actions";
import type { HomeAi } from "@/lib/home-ai";
import { useMedia } from "@/components/ui/use-media";
import { EXTENSION_RETIRED, useExtension } from "./use-extension";
import { Sheet } from "@/components/ui/overlays";
import { activeSource } from "@/lib/calc";
import { AXIS_LOCK, pagerOffset, pagerRelease, velocity } from "@/lib/gestures";
import { dayKeyIn, fallbackInsights, fallbackSuggestions, HIDE_MS, homeModel, homeSuggestions, mergeHome, monthGrid, shiftMonth, type HomeModel, type Insight, type NeedRow, type Suggestion, type WeekEvent } from "@/lib/home";
import { formatMoney, formatMoneyCompact, formatMoneyShort } from "@/lib/money";
import { FitMoney } from "@/components/ui/fit-money";
import { cn } from "@/lib/utils";
import { DeliveryTrack } from "./delivery-track";
import { ProductImage, useStatusFlow } from "./item-card";
import { useReadOnly } from "./offline-banner";
import { useAddActions } from "./add-actions";
import { useMeName } from "./spaces/space-ui";
import { useStore, type HomeSection } from "./store";
import { Card } from "./home-card";
import { Customise, WidgetGrid, type RenderWidget } from "./home-grid";
import { ActivityWidget, ByCategoryWidget, DropsWidget, MostBoughtWidget, NextDeliveryWidget, VsLastWidget } from "./home-extra";
import { defaultLayout, rowsFor, type HomeLayout, type WidgetId } from "@/lib/home-layout";
import { homeExtras } from "@/lib/home-widgets";
import { monthStartIn } from "@/lib/budget";
import { COLLECTION_COLORS } from "./view-items";
import { trackAiWork } from "@/lib/ai-work";

type T = ReturnType<typeof useI18n>["t"];

// ---------- Formatting (dates in the user's time zone; day keys are "YYYY-MM-DD") ----------

const utc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function useFmt() {
  const s = useStore();
  const { locale, f } = useI18n();
  return useMemo(() => {
    const tag = locale === "he" ? "he-IL" : "en-GB";
    const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone: "UTC", ...o });
    const wShort = fmt({ weekday: "short" });
    const wLong = fmt({ weekday: "long" });
    const mShort = fmt({ month: "short" });
    const mLong = fmt({ month: "long" });
    // Composed from single fields: whole-date patterns differ between the server's and the browser's ICU (a text
    // hydration mismatch), single names don't.
    const compose = (key: string, w: Intl.DateTimeFormat, m: Intl.DateTimeFormat) => {
      const d = utc(key);
      return locale === "he" ? `${w.format(d)}, ${d.getUTCDate()} ב${m.format(d)}` : `${w.format(d)} ${d.getUTCDate()} ${m.format(d)}`;
    };
    const dShort = { format: (d: Date) => compose(d.toISOString().slice(0, 10), wShort, mShort) };
    const dLong = { format: (d: Date) => compose(d.toISOString().slice(0, 10), wLong, mLong) };
    return {
      f,
      money: (v: number) => formatMoney(Math.round(v), s.currency, locale),
      /** Polish #23: a money figure that turns compact when it doesn't fit its line (never an ellipsis). */
      fit: (v: number) => <FitMoney full={formatMoney(Math.round(v), s.currency, locale)} short={formatMoneyShort(Math.round(v), s.currency, locale)} />,
      compact: (v: number) => formatMoneyCompact(Math.round(v), s.currency, locale),
      wd: (key: string) => wShort.format(utc(key)),
      dayShort: (key: string) => dShort.format(utc(key)),
      dateLong: (key: string) => dLong.format(utc(key)),
      month: (monthKey: string) => mLong.format(utc(`${monthKey}-01`)),
      /** 0 = Sunday … (4 Oct 2026 was a Sunday). */
      weekday: (d: number) => wLong.format(utc(`2026-10-${String(4 + d).padStart(2, "0")}`)),
      pct: (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%`,
    };
  }, [s.currency, locale, f]);
}
type Fmt = ReturnType<typeof useFmt>;

/** When an eta day is: its weekday when within the week ahead, else the short date. */
function whenLabel(key: string, today: string, fm: Fmt) {
  const d = Math.round((utc(key).getTime() - utc(today).getTime()) / 86_400_000);
  return d >= 0 && d < 7 ? fm.wd(key) : fm.dayShort(key);
}

// ---------- The view ----------

export function HomeView() {
  const s = useStore();
  const { clock } = s;
  const model = useMemo(
    () =>
      homeModel({
        items: s.items,
        alerts: s.alerts,
        budget: s.budget,
        storeSettings: s.storeSettings,
        rates: s.rates,
        now: clock.now,
        tz: clock.tz,
        weekStartsOn: clock.weekStartsOn,
        collections: s.collections,
        altGroups: s.altGroups,
        currency: s.currency,
        dismissed: s.homePrefs.dismissed,
        notify: s.homePrefs.notify,
      }),
    [s.items, s.alerts, s.budget, s.storeSettings, s.rates, clock, s.collections, s.altGroups, s.currency, s.homePrefs.dismissed, s.homePrefs.notify],
  );
  const ruleSugs = useMemo(() => homeSuggestions(model), [model]);
  const ext = useExtension();
  const desktop = useMedia("(min-width: 1024px)");
  // R15 D2: the extension is retired — never suggest it.
  const extOk = EXTENSION_RETIRED ? null : desktop ? ext.available : null;
  const fbCounts = useMemo(() => [fallbackSuggestions(model, { extension: extOk, receipts: null }).length, fallbackInsights(model).length] as const, [model, extOk]);
  const look = useHomeLook(model.empty ? -1 : ruleSugs.length, model.noticed.length, fbCounts[0], fbCounts[1]);
  // R14 A2: exact rules first, then the AI's look, then the broad fallbacks (≤ 4 suggestions, ≤ 3 insights).
  const sugs = useMemo(() => {
    const now = clock.now;
    const hidden = (key: string) => (s.homePrefs.dismissed[`sug:${key}`] ?? 0) > now;
    const ai: Suggestion[] = (look.ai?.suggestions ?? []).map((x, k) => ({
      key: `ai:${model.today}:${k}`,
      kind: "ai",
      score: 0,
      facts: { title: x.title, why: x.why },
      action:
        x.action.type === "open" && x.action.itemId ? { type: "open", itemId: x.action.itemId }
        : x.action.type === "add" && x.action.itemId ? { type: "add", itemId: x.action.itemId }
        : x.action.type === "budget" && x.action.collectionId ? { type: "budget", collectionId: x.action.collectionId }
        : { type: "none" },
    }));
    const fb = fallbackSuggestions(model, { extension: extOk, receipts: look.receipts });
    return mergeHome(ruleSugs, ai.filter((x) => !hidden(x.key)), fb, 4);
  }, [ruleSugs, look, model, extOk, clock.now, s.homePrefs.dismissed]);
  const noticed = useMemo(() => {
    const ai: Insight[] = (look.ai?.insights ?? []).map((x, k) => ({ key: `ai:${model.today}:${k}`, kind: "ai", text: x.text, ...(x.action && x.action.type !== "none" && { action: { ...x.action, type: x.action.type } }) }));
    return mergeHome(model.noticed, ai, fallbackInsights(model), 3);
  }, [look, model]);
  const [editing, setEditing] = useState<HomeLayout | null>(null);
  const shared = s.space?.kind === "shared";
  // E2: the new indicators' numbers (pure, lib/home-widgets).
  const extras = useMemo(() => {
    const lastKey = shiftMonth(model.month, -1);
    const monthFrom = monthStartIn(model.month, clock.tz);
    const monthTo = monthStartIn(shiftMonth(model.month, 1), clock.tz);
    return homeExtras({ items: s.items, alerts: s.alerts, rates: s.rates, currency: s.currency, now: clock.now, tz: clock.tz, monthFrom, monthTo, lastMonthFrom: monthStartIn(lastKey, clock.tz), lastMonthKey: lastKey, me: s.me?.id });
  }, [s.items, s.alerts, s.rates, s.currency, clock, model, s.me?.id]);

  // One renderer for view and Customise; the R13 sections stay out of view while they have nothing to show.
  const render = useCallback<RenderWidget>(
    (id, h, edit) => {
      const has: Partial<Record<WidgetId, boolean>> = {
        suggest: sugs.length > 0,
        week: model.week.events.length > 0,
        needs: model.needs.length > 0,
        ontheway: model.packages.length > 0,
        pace: model.pace.cap != null || model.pace.usual != null || model.stats.budget.spent > 0,
        projects: model.projects.length > 0,
        noticed: noticed.length > 0,
      };
      if (!edit && has[id] === false) return null;
      const c = "h-full";
      switch (id) {
        case "left":
        case "budget":
        case "way":
        case "saved":
          return <Stats model={model} only={id} />;
        case "suggest":
          return <SuggestCard sugs={sugs} className={c} />;
        case "week":
          return <WeekCard model={model} className={c} />;
        case "needs":
          return <NeedsCard model={model} rows={rowsFor(h, 3, 8)} className={c} />;
        case "ontheway":
          return <OnTheWayCard model={model} rows={rowsFor(h, 3, 8)} className={c} />;
        case "pace":
          return <PaceCard model={model} className={c} />;
        case "projects":
          return <ProjectsCard model={model} rows={rowsFor(h, 3, 8)} className={c} />;
        case "noticed":
          return <NoticedCard list={noticed} className={c} />;
        case "drops":
          return <DropsWidget x={extras} h={h} className={c} />;
        case "vslast":
          return <VsLastWidget x={extras} h={h} className={c} />;
        case "nextdel":
          return <NextDeliveryWidget x={extras} h={h} className={c} />;
        case "bycat":
          return <ByCategoryWidget x={extras} h={h} className={c} />;
        case "most":
          return <MostBoughtWidget x={extras} h={h} className={c} />;
        case "activity":
          return <ActivityWidget x={extras} h={h} className={c} />;
      }
    },
    [model, sugs, noticed, extras],
  );

  if (s.loading || s.switching) return <HomeSkeleton />;
  if (model.empty) return <HomeEmpty model={model} />;

  const stagger = s.navSeq === 0;
  if (editing)
    return (
      <div className="flex flex-col gap-3 pb-4 lg:grid lg:grid-cols-12 lg:gap-[14px]" data-home dir="auto">
        <Customise
          draft={editing}
          setDraft={setEditing as React.Dispatch<React.SetStateAction<HomeLayout>>}
          render={render}
          shared={shared}
          desktop={desktop}
          onDone={() => {
            s.setHomeLayout(editing);
            setEditing(null);
          }}
          onReset={() => setEditing(defaultLayout(shared))}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-3 pb-4 lg:grid lg:grid-cols-12 lg:gap-[14px]" data-home dir="auto">
      <HomeHeader model={model} onCustomize={() => setEditing(s.homeLayout)} />
      <WidgetGrid layout={s.homeLayout} render={render} stagger={stagger} />
    </div>
  );
}

// ---------- Header card: date, greeting, Customize, status strip (A6), stats (A2) ----------

function greeting(now: number, tz: string, t: T) {
  let h = 12;
  try {
    h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
  } catch {}
  return h >= 5 && h < 12 ? t.dash.morning : h >= 12 && h < 17 ? t.dash.afternoon : h >= 17 && h < 23 ? t.dash.evening : t.dash.night;
}

function HomeHeader({ model, onCustomize }: { model: HomeModel; onCustomize: () => void }) {
  const s = useStore();
  const meName = useMeName();
  const { t, f } = useI18n();
  const fm = useFmt();
  return (
    <section className="contents lg:col-span-12 lg:flex lg:flex-col lg:rounded-xl lg:border lg:border-card-line lg:bg-surface lg:shadow-[var(--card-shadow)]" data-home-header>
      <div className="flex items-end gap-3 px-1 pt-1 lg:gap-4 lg:px-6 lg:pb-4 lg:pt-[22px]">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-muted" suppressHydrationWarning>
            {fm.dateLong(model.today)}
          </div>
          <h1 className="mt-0.5 truncate text-[23px] font-extrabold leading-tight tracking-[-0.03em] lg:text-[30px]" suppressHydrationWarning>
            {f(greeting(s.clock.now, s.clock.tz, t), { name: meName })}
          </h1>
        </div>
        <button
            type="button"
            onClick={onCustomize}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-card-line bg-surface px-3 text-[12.5px] font-semibold text-ink transition hover:border-ink/40 max-lg:size-10 max-lg:justify-center max-lg:px-0"
            aria-label={t.dash.customize}
            data-home-customize
          >
            <LayoutGrid className="size-4" />
            <span className="max-lg:hidden">{t.dash.customize}</span>
          </button>
      </div>
      {/* R16 E1: the four numbers are widgets now; the strip stays with the greeting. */}
      <div className="r13-card overflow-hidden empty:hidden max-lg:mt-1 lg:contents">
        <StatusStrip model={model} />
      </div>
    </section>
  );
}

/** R16 E1: a status tile's section may not be on Home (presets, hidden widgets) — the nearest widget that is. */
const SECTION_FALLBACK: Partial<Record<HomeSection, string[]>> = {
  pace: ["pace", "stat-budget", "bycat"],
  ontheway: ["ontheway", "nextdel", "stat-way"],
  needs: ["needs"],
};

/** Scroll to a section and flash its outline (600 ms). Picks the visible copy. False when nothing on Home matches. */
function goToSection(id: HomeSection): boolean {
  const ids = SECTION_FALLBACK[id] ?? [id];
  const el = ids.map((x) => [...document.querySelectorAll<HTMLElement>(`[data-home-section~="${x}"]`)].find((e) => e.offsetParent !== null)).find(Boolean);
  if (!el) return false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.classList.remove("r13-flash");
  void el.offsetWidth;
  el.classList.add("r13-flash");
  window.setTimeout(() => el.classList.remove("r13-flash"), 1400);
  return true;
}

const TONE_CHIP = { warn: "bg-warn-soft text-warn", info: "bg-info-soft text-info", ok: "bg-ok-soft text-ok", bad: "bg-danger-soft text-danger" } as const;

function StatusStrip({ model }: { model: HomeModel }) {
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  const st = model.status;
  const tiles: { id: HomeSection; tone: keyof typeof TONE_CHIP; icon: React.ReactNode; big: string; line: string; sub: string; short: string }[] = [];
  if (st.needYou) {
    const kinds = st.needYou.kinds.map((k) => t.dash.needKinds[k]);
    tiles.push({ id: "needs", tone: "warn", icon: <AlertTriangle />, big: String(st.needYou.count), line: st.needYou.count === 1 ? t.dash.needYouOne : f(t.dash.needYou, { n: st.needYou.count }), sub: kinds.join(", "), short: t.dash.needYouShort });
  }
  if (st.packages) {
    const p = st.packages;
    const sub = [p.next != null ? f(t.dash.nextOn, { day: fm.wd(dayKeyIn(p.next, model.ctx.tz)) }) : null, p.late ? (p.lateName && p.late === 1 ? f(t.dash.lateCount, { n: 1 }) : f(t.dash.lateCount, { n: p.late })) : null].filter(Boolean).join(" · ");
    tiles.push({ id: "ontheway", tone: p.late ? "warn" : "info", icon: <Truck />, big: String(p.count), line: p.count === 0 ? t.dash.packagesNone : p.count === 1 ? t.dash.packagesOne : f(t.dash.packages, { n: p.count }), sub, short: t.dash.packagesShort });
  }
  if (st.pace) {
    const under = st.pace.delta >= 0;
    const month = fm.month(model.month);
    tiles.push({
      id: "pace",
      tone: under ? "ok" : "bad",
      icon: under ? <TrendingDown /> : <TrendingUp />,
      big: fm.compact(Math.abs(st.pace.delta)),
      line: f(under ? t.dash.under : t.dash.over, { amount: fm.money(Math.abs(st.pace.delta)) }),
      sub: f(under ? t.dash.onTrack : t.dash.offTrack, { month }),
      short: under ? t.dash.underShort : t.dash.overShort,
    });
  }
  if (!tiles.length) return null;
  return (
    <div
      className="grid border-b border-line-in lg:mx-6 lg:mb-5 lg:overflow-hidden lg:rounded-[10px] lg:border lg:border-card-line"
      style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
      data-home-status
    >
      {tiles.map((x, k) => (
        <button
          key={x.id}
          type="button"
          onClick={() => {
            // Nothing for it on Home (hidden / not in the preset): Needs you → the alerts panel, the rest → their views.
            if (goToSection(x.id)) return;
            if (x.id === "needs") s.setPanel("alerts");
            else s.setView({ type: x.id === "pace" ? "spending" : "ordered" });
          }}
          className={cn("group flex min-w-0 items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-surface-2 max-lg:gap-2 lg:px-4 lg:py-3", k > 0 && "border-s border-line-in")}
          aria-label={f(t.dash.goTo, { name: x.line })}
          data-home-tile={x.id}
        >
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4 max-lg:size-6 max-lg:self-start max-lg:rounded-md max-lg:[&_svg]:size-3.5", TONE_CHIP[x.tone])}>{x.icon}</span>
          {/* Phone: big number + a 2-line label; desktop: bold line + muted line + chevron. */}
          <span className="min-w-0 lg:hidden">
            <b className="tabular block text-[18px] font-extrabold leading-none tracking-[-0.02em]">{x.big}</b>
            <span className="mt-1 line-clamp-2 block text-[11px] leading-tight text-muted">{x.short}</span>
          </span>
          <span className="min-w-0 flex-1 max-lg:hidden">
            <b className="block truncate text-[14.5px] font-bold">{x.line}</b>
            <span className="block truncate text-[12px] text-muted">{x.sub}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 max-lg:hidden rtl:-scale-x-100" />
        </button>
      ))}
    </div>
  );
}

function Meter({ parts, marker, className }: { parts: { value: number; color: string }[]; marker?: number; className?: string }) {
  const total = parts.reduce((a, b) => a + b.value, 0);
  return (
    <div className={cn("relative mt-1", className)}>
      <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {total > 0 && parts.map((p, k) => <i key={k} className="grow-x block h-full rounded-full" style={{ flex: `${p.value} 0 0`, background: p.color }} />)}
      </div>
      {marker != null && <em className="absolute -bottom-[3px] -top-[3px] w-0.5 rounded-full bg-ink" style={{ insetInlineStart: `calc(${Math.min(1, Math.max(0, marker)) * 100}% - 1px)` }} aria-hidden />}
    </div>
  );
}

function Stat({ label, value, small, children, valueClass }: { label: string; value: React.ReactNode; small?: string; children?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5 lg:gap-1.5 lg:px-5 lg:pb-[18px] lg:pt-4">
      <span className="truncate text-[12px] font-semibold text-muted lg:text-[12.5px]" data-stat-label>
        {label}
      </span>
      <span className={cn("tabular truncate text-[20px] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-[28px]", valueClass)}>
        {value}
        {small && <small className="ms-1 text-[12px] font-medium tracking-normal text-muted lg:text-[13px]">{small}</small>}
      </span>
      {children}
    </div>
  );
}

const STAT_ORDER = ["left", "budget", "way", "saved"] as const;
function StatCell({ only, children }: { only: (typeof STAT_ORDER)[number]; children: React.ReactNode }) {
  const kids = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <section className="r13-card r13-section flex h-full min-w-0 flex-col [&>*]:flex-1" data-home-section={`stat-${only}`} data-home-stat={only}>
      {kids[STAT_ORDER.indexOf(only)]}
    </section>
  );
}

/** The four numbers (R16 E1: each its own widget — `only` picks one; the cell gives it a card). */
function Stats({ model, only }: { model: HomeModel; only: "left" | "budget" | "way" | "saved" }) {
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  const { leftToBuy: l, budget: b, onTheWay: o, saved } = model.stats;
  const month = fm.month(model.month);
  const segColor = (id: string | null) => {
    const c = id ? s.collections.find((x) => x.id === id) : null;
    return c ? COLLECTION_COLORS[c.color] ?? COLLECTION_COLORS.slate : "var(--line-strong)";
  };
  const segName = (id: string | null) => (id ? s.collections.find((x) => x.id === id)?.name ?? "" : t.dash.other);
  const nextKey = o.next != null ? dayKeyIn(o.next, model.ctx.tz) : null;
  return (
    <StatCell only={only}>
      <Stat label={t.dash.leftToBuy} value={fm.fit(l.total)}>
        <span className="truncate text-[12px] text-muted">
          <b className="font-bold text-warn">{l.count === 1 ? t.dash.itemsOne : f(t.dash.items, { n: l.count })}</b>
          {l.urgent > 0 && <> · {f(t.dash.urgentN, { n: l.urgent })}</>}
        </span>
        <Meter parts={l.segments.map((g) => ({ value: g.value, color: segColor(g.collectionId) }))} />
        <span className="flex min-w-0 gap-2.5 overflow-hidden text-[11px] text-muted max-lg:hidden">
          {l.segments.slice(0, 3).map((g) => (
            <span key={g.key} className="flex min-w-0 items-center gap-1.5">
              <i className="size-2 shrink-0 rounded-full" style={{ background: segColor(g.collectionId) }} />
              <span className="truncate">{segName(g.collectionId)}</span>
            </span>
          ))}
        </span>
      </Stat>
      {b.cap != null ? (
        <Stat label={f(t.dash.monthBudget, { month })} value={fm.fit(b.spent)} small={f(t.dash.ofCap, { amount: fm.money(b.cap) })}>
          <span className="truncate text-[12px] text-muted">
            {b.left! >= 0 ? (
              <b className="font-bold text-ok">
                <span className="max-lg:hidden">{f(b.daysToGo === 1 ? t.dash.leftDaysOne : t.dash.leftDays, { amount: fm.money(b.left!), n: b.daysToGo })}</span>
                <span className="lg:hidden">{f(t.dash.leftDaysShort, { amount: fm.money(b.left!), n: b.daysToGo })}</span>
              </b>
            ) : (
              <b className="font-bold text-danger">{f(t.dash.overBy, { amount: fm.money(-b.left!) })}</b>
            )}
          </span>
          <Meter parts={[{ value: Math.min(b.spent, b.cap), color: b.spent > b.cap ? "var(--danger)" : "var(--ink)" }, { value: Math.max(0, b.cap - b.spent), color: "transparent" }]} marker={b.todayFrac} />
          <span className="truncate text-[11px] text-muted max-lg:hidden">{t.dash.meterNote}</span>
        </Stat>
      ) : (
        <Stat label={f(t.dash.spentIn, { month })} value={fm.fit(b.spent)}>
          <span className="line-clamp-2 text-[12px] text-muted">{b.vsUsualPct != null ? f(t.dash.vsUsual, { pct: fm.pct(b.vsUsualPct) }) : t.dash.noUsual}</span>
          {b.usual != null && b.usual > 0 && <Meter parts={[{ value: Math.min(b.spent, b.usual), color: "var(--ink)" }, { value: Math.max(0, b.usual - b.spent), color: "transparent" }]} marker={b.todayFrac} />}
        </Stat>
      )}
      <Stat label={t.dash.onTheWay} value={String(o.count)} small={o.count === 1 ? t.dash.packageOne : t.dash.packagesN}>
        <span className="truncate text-[12px] text-muted">
          {nextKey ? (
            <>
              {t.dash.nextDay.split("{day}")[0]}
              <b className="font-bold text-info">{whenLabel(nextKey, model.today, fm)}</b>
              {t.dash.nextDay.split("{day}")[1]}
            </>
          ) : (
            o.count > 0 && t.dash.noneDue
          )}
          {o.late > 0 && <b className="font-bold text-warn"> · {f(t.dash.lateCount, { n: o.late })}</b>}
        </span>
        {o.pips.length > 0 && (
          <span className="mt-1.5 flex gap-1" aria-hidden>
            {o.pips.slice(0, 8).map((p, k) => (
              <i key={k} className={cn("h-1.5 flex-1 rounded-full", p === "late" ? "bg-warn" : p === "week" ? "bg-info" : "bg-info/35")} />
            ))}
          </span>
        )}
      </Stat>
      {saved.total > 0.5 ? (
        <Stat label={t.dash.savedYear} value={fm.fit(saved.total)} valueClass="text-ok">
          <span className="truncate text-[12px] text-muted">{saved.month > 0.5 ? <b className="font-bold text-ok">+{f(t.dash.thisMonth, { amount: fm.money(saved.month) })}</b> : null}</span>
          <span className="flex flex-col text-[11px] leading-snug text-muted max-lg:hidden">
            {saved.drops > 0.5 && <span>{f(t.dash.fromDrops, { amount: fm.money(saved.drops) })}</span>}
            {saved.freeShipping > 0.5 && <span>{f(t.dash.fromShipping, { amount: fm.money(saved.freeShipping) })}</span>}
          </span>
        </Stat>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5 px-3 py-3 lg:px-5 lg:pt-4">
          <span className="truncate text-[12px] font-semibold text-muted lg:text-[12.5px]">{t.dash.savedYear}</span>
          <span className="text-[13px] font-semibold leading-snug text-muted" data-saved-empty>
            {t.dash.startSaving}
          </span>
        </div>
      )}
    </StatCell>
  );
}

// ---------- Section chrome ----------

// ---------- A3: Nexus suggests ----------

function template(x: Suggestion, t: T, fm: Fmt) {
  const F = x.facts;
  const v = (k: string) => String(F[k] ?? "");
  switch (x.kind) {
    case "deal":
      return F.partner
        ? { title: fm.f(t.dash.sug.dealBoth.title, { item: v("item"), pct: v("pct"), partner: v("partner") }), why: fm.f(t.dash.sug.dealBoth.why, { store: v("store") }), cta: t.dash.sug.dealBoth.cta }
        : { title: fm.f(t.dash.sug.deal.title, { item: v("item"), pct: v("pct") }), why: fm.f(t.dash.sug.deal.why, { store: v("store"), saving: fm.money(Number(F.saving) || 0) }), cta: t.dash.sug.deal.cta };
    case "reorder":
      return { title: fm.f(t.dash.sug.reorder.title, { item: v("item") }), why: fm.f(t.dash.sug.reorder.why, { days: v("everyDays"), n: v("times") }), cta: t.dash.sug.reorder.cta };
    case "wait":
      return { title: fm.f(t.dash.sug.wait.title, { item: v("item"), day: fm.weekday(Number(F.day)) }), why: fm.f(t.dash.sug.wait.why, { pct: v("pct") }), cta: t.dash.sug.wait.cta };
    case "budget":
      return { title: fm.f(t.dash.sug.budget.title, { project: v("project") }), why: fm.f(t.dash.sug.budget.why, { min: fm.money(Number(F.min)), max: fm.money(Number(F.max)) }), cta: t.dash.sug.budget.cta };
    case "ai": {
      const a = x.action.type;
      return { title: v("title"), why: v("why"), cta: a === "none" ? null : a === "add" ? t.dash.sug.ai.ctaAdd : a === "budget" ? t.dash.sug.ai.ctaBudget : t.dash.sug.ai.cta };
    }
    case "set_budget":
      return t.dash.sug.setBudget;
    case "target":
      return { ...t.dash.sug.target, title: fm.f(t.dash.sug.target.title, { item: v("item") }) };
    case "eta":
      return { ...t.dash.sug.eta, title: fm.f(t.dash.sug.eta.title, { item: v("item") }) };
    case "stale":
      return { title: fm.f(t.dash.sug.stale.title, { item: v("item") }), why: fm.f(t.dash.sug.stale.why, { days: v("days") }), cta: t.dash.sug.stale.cta };
    case "extension":
      return t.dash.sug.extension;
    case "receipt":
      return t.dash.sug.receipt;
  }
}

/**
 * R14 A2: the AI's own look at Home (server: once a day when the rules are thin, cached; off / no key → null) and
 * the receipt count the fallbacks need. Never blocks render. `ruleSugs` −1 = empty account (no call).
 */
function useHomeLook(ruleSugs: number, ruleIns: number, fbSugs: number, fbIns: number) {
  const s = useStore();
  const { locale } = useI18n();
  const [look, setLook] = useState<{ ai: HomeAi | null; receipts: number | null }>({ ai: null, receipts: null });
  const on = s.homePrefs.aiSuggestions;
  useEffect(() => {
    if (ruleSugs < 0 || s.offlineAt != null || s.loading) return;
    let alive = true;
    trackAiWork(homeLook({ ruleSugs, ruleIns, fbSugs: Math.min(fbSugs, 20), fbIns, currency: s.currency, locale: locale === "he" ? "he" : "en" }))
      // A transition: the whole Home re-renders with it, and it often lands during the opening animation.
      .then((r) => alive && startTransition(() => setLook(r)))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per rule counts / language / switch
  }, [ruleSugs, ruleIns, fbSugs, fbIns, locale, on, s.loading]);
  return on ? look : { ai: null, receipts: look.receipts };
}

/** AI phrasing for today's candidates (server: once a day, cached; {} = keep the templates). Never blocks render. */
function usePhrased(sugs: Suggestion[]) {
  const s = useStore();
  const { locale } = useI18n();
  const [map, setMap] = useState<Phrased>({});
  const keys = sugs.map((x) => x.key).join("|");
  const on = s.homePrefs.aiSuggestions && s.offlineAt == null;
  useEffect(() => {
    if (!on || !keys) return;
    let alive = true;
    trackAiWork(
      phraseSuggestions(
        sugs.map(({ key, kind, facts }) => ({ key, kind, facts })),
        locale,
      ),
    )
      .then((m) => alive && setMap(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the candidate keys, not the array identity
  }, [keys, locale, on]);
  return on ? map : {};
}

/** Hide a row / snooze a suggestion for 7 days, with Undo. */
function useDismiss() {
  const s = useStore();
  const { t } = useI18n();
  return (key: string, label?: string) => {
    const before = s.homePrefs;
    s.setHomePrefs({ ...before, dismissed: { ...before.dismissed, [key]: Date.now() + HIDE_MS } });
    const req = dismissHome(key);
    toast.success(t.dash.dismissed, {
      description: label,
      action: {
        label: t.dash.undo,
        onClick: async () => {
          s.setHomePrefs(before);
          await req.catch(() => null);
          await undismissHome(key).catch(() => null);
        },
      },
    });
    req.catch(() => s.setHomePrefs(before));
  };
}

function SuggestCard({ sugs, className, style }: { sugs: Suggestion[]; className?: string; style?: React.CSSProperties }) {
  const s = useStore();
  const { t, f, dir } = useI18n();
  const fm = useFmt();
  const ro = useReadOnly();
  // Only the exact rules get AI phrasing; AI items are already written and fallbacks keep their templates.
  const phrased = usePhrased(sugs.filter((y) => y.kind === "deal" || y.kind === "reorder" || y.kind === "wait" || y.kind === "budget"));
  const dismiss = useDismiss();
  const [idx, setIdx] = useState(0);
  // Where the next suggestion slides in from (px, physical): set by a swipe, default (12 px) otherwise.
  const [from, setFrom] = useState<number | null>(null);
  const i = Math.min(idx, sugs.length - 1);
  const x = sugs[i];
  const tpl = template(x, t, fm);
  const ai = phrased[x.key];
  const rtl = dir === "rtl";
  const go = (d: number, fromPx?: number) => {
    setFrom(fromPx ?? null);
    setIdx((i + d + sugs.length) % sugs.length);
  };
  const { swapRef, handlers: swipeHandlers, dragging } = useSwipePager({ count: sugs.length, index: i, go, rtl });
  const run = async () => {
    const a = x.action;
    if (a.type === "none") return;
    if (a.type === "cmd") {
      if (a.cmd === "monthly_budget") return s.setView({ type: "spending" });
      if (a.cmd === "extension") return s.setExtOpen(true);
      return s.openReceipt();
    }
    if (a.type === "open") return s.openItem(a.itemId);
    if (a.type === "budget") {
      const c = s.collections.find((c) => c.id === a.collectionId);
      if (c) s.setEditor({ mode: "edit", collection: c });
      return;
    }
    if (a.type === "add") {
      try {
        const it = await buyAgain(a.itemId);
        s.upsertItem(it);
        s.markFresh(it.id);
        toast.success(t.dash.added, { description: it.title });
      } catch {
        toast.error(t.errors.generic);
      }
      return;
    }
    // "Order both": the partner joins the same order, then Order by store shows it.
    if (a.partner) {
      const p = a.partner;
      const before = s.items.find((it) => it.id === p.itemId);
      if (before) s.upsertItem({ ...before, ...p.apply });
      try {
        s.upsertItem(await updateItem(p.itemId, p.apply));
        toast.success(t.dash.addedOrder, { description: before?.title });
      } catch {
        if (before) s.upsertItem(before);
        toast.error(t.errors.generic);
        return;
      }
      s.setView({ type: "orders" });
    } else s.openItem(a.itemId);
  };
  const pager = (
    <div className="flex items-center gap-1.5" data-sug-pager>
      <button type="button" onClick={() => go(-1)} className="grid size-7 place-items-center rounded-full border border-card-line bg-surface text-ink @max-[600px]:hidden" aria-label={t.dash.prev}>
        <ChevronLeft className="size-3.5 rtl:-scale-x-100" />
      </button>
      <span className="flex gap-1">
        {sugs.map((y, k) => (
          <button key={y.key} type="button" onClick={() => setIdx(k)} aria-label={f(t.dash.ofN, { i: k + 1, n: sugs.length })} aria-current={k === i ? "true" : undefined} className="relative grid h-5 place-items-center after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">
            <i className={cn("block h-1.5 rounded-full transition-[width,background-color] duration-300", k === i ? "w-4 bg-ai" : "w-1.5 bg-card-line")} />
          </button>
        ))}
      </span>
      <button type="button" onClick={() => go(1)} className="grid size-7 place-items-center rounded-full border border-card-line bg-surface text-ink @max-[600px]:hidden" aria-label={t.dash.next}>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" />
      </button>
    </div>
  );
  return (
    <section
      className={cn("r13-sug r13-section @container touch-pan-y", sugs.length > 1 && "lg:cursor-grab", dragging && "select-none lg:cursor-grabbing", className)}
      style={style}
      {...swipeHandlers}
      data-dragging={dragging || undefined}
      data-home-section="suggest"
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label={t.dash.suggests}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || sugs.length < 2) return;
        if (e.key === "ArrowLeft") (e.preventDefault(), go(rtl ? 1 : -1));
        if (e.key === "ArrowRight") (e.preventDefault(), go(rtl ? -1 : 1));
      }}
      data-sug-index={i}
      data-sug-count={sugs.length}
      data-sug-kinds={sugs.map((y) => y.kind).join(" ")}
    >
      <div className="r13-sug-in flex flex-col gap-2 px-3.5 py-3 @min-[600px]:flex-row @min-[600px]:items-center @min-[600px]:gap-[18px] @min-[600px]:px-5 @min-[600px]:py-4">
        <div className="flex items-center gap-2.5 @min-[600px]:contents">
          <span className="r13-orb grid size-[26px] shrink-0 place-items-center rounded-lg text-white @min-[600px]:size-11 @min-[600px]:rounded-xl [&_svg]:size-3.5 @min-[600px]:[&_svg]:size-[22px]" aria-hidden>
            <Sparkles />
          </span>
          <span className="flex flex-1 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-ai @min-[600px]:hidden">{t.dash.suggests}</span>
          {sugs.length > 1 && <span className="@min-[600px]:hidden">{pager}</span>}
        </div>
        <div key={x.key} ref={swapRef} style={from != null ? ({ "--sug-from": `${from}px` } as React.CSSProperties) : undefined} className="r13-swap flex min-w-0 flex-1 flex-col gap-[3px]" data-sug-swipe data-sug-key={x.key} data-sug-kind={x.kind} data-sug-source={ai || x.kind === "ai" ? "ai" : "template"} aria-live="polite">
          <span className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ai @max-[600px]:hidden">
            {t.dash.suggests}
            {sugs.length > 1 && <em className="font-semibold normal-case not-italic tracking-normal text-muted">{f(t.dash.ofN, { i: i + 1, n: sugs.length })}</em>}
          </span>
          <b className="text-[15px] font-semibold leading-snug @min-[600px]:text-[16px]" data-sug-title>
            {ai?.title ?? tpl.title}
          </b>
          <span className="text-[12.5px] text-muted @max-[600px]:line-clamp-1">{ai?.why || tpl.why}</span>
        </div>
        <div className="flex items-center gap-2">
          {tpl.cta && (
            <button type="button" onClick={() => void run()} disabled={ro.ro && x.action.type !== "open"} className="h-9 rounded-full bg-brand px-4 text-[13px] font-semibold text-on-brand transition active:scale-[0.97] disabled:opacity-50" data-sug-cta>
              {tpl.cta}
            </button>
          )}
          <button type="button" onClick={() => dismiss(`sug:${x.key}`, ai?.title ?? tpl.title)} className="h-9 rounded-full px-3 text-[13px] font-semibold text-muted transition hover:text-ink" data-sug-notnow>
            {t.dash.notNow}
          </button>
          {sugs.length > 1 && <span className="ms-1 @max-[600px]:hidden">{pager}</span>}
        </div>
      </div>
    </section>
  );
}

/**
 * R16 A7 — swipe (touch) / drag (mouse) between suggestions. Follows the pointer 1:1 once the gesture is horizontal
 * (axis lock after 8 px, so vertical scrolling still works), rubber-bands at either end, snaps on release (25 % of the
 * width or a fling). RTL mirrors. Reduced motion: no glide, instant snap. A drag never clicks the button under it.
 */
function useSwipePager({ count, index, go, rtl }: { count: number; index: number; go: (d: number, from?: number) => void; rtl: boolean }) {
  const swapRef = useRef<HTMLDivElement>(null);
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  const g = useRef<{ id: number; x0: number; y0: number; axis: "x" | "y" | null; dx: number; samples: { t: number; v: number }[] } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dir: 1 | -1 = rtl ? -1 : 1;
  const place = (x: number, animate: boolean) => {
    const el = swapRef.current;
    if (!el) return;
    el.style.transition = animate && !reduce ? "transform 260ms var(--ease-out)" : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
  };
  const end = (e: React.PointerEvent<HTMLElement>, cancel = false) => {
    const st = g.current;
    g.current = null;
    if (!st || st.axis !== "x") return;
    setDragging(false);
    const width = e.currentTarget.getBoundingClientRect().width || 320;
    const step = cancel ? 0 : pagerRelease({ dx: st.dx, vx: reduce ? 0 : velocity(st.samples), dir, width, index, count });
    if (step) {
      place(0, false);
      // The next suggestion comes in from the side the finger pushed toward.
      go(step, Math.sign(st.dx) * 40);
    } else place(0, true);
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (count < 2 || (e.pointerType === "mouse" && e.button !== 0)) return;
      // Mouse: a drag starting on a button stays a click (touch decides by movement instead).
      if (e.pointerType === "mouse" && (e.target as HTMLElement).closest("button, a")) return;
      dragged.current = false;
      g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, dx: 0, samples: [{ t: e.timeStamp, v: 0 }] };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const st = g.current;
      if (!st || st.id !== e.pointerId) return;
      const dx = e.clientX - st.x0;
      const dy = e.clientY - st.y0;
      if (!st.axis) {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
        st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (st.axis === "y") {
          g.current = null;
          return;
        }
        dragged.current = true;
        setDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      st.dx = dx;
      st.samples.push({ t: e.timeStamp, v: dx });
      if (st.samples.length > 8) st.samples.shift();
      place(pagerOffset(dx, dir, index > 0, index < count - 1), false);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e, true),
    // A finished drag swallows the click that follows it.
    onClickCapture: (e: React.MouseEvent) => {
      if (!dragged.current) return;
      dragged.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
  return { swapRef, handlers, dragging };
}

// ---------- This week ----------

const EV_TONE: Record<WeekEvent["kind"], { text: string; dot: string; icon: React.ReactNode }> = {
  late: { text: "text-warn", dot: "bg-warn", icon: <AlertTriangle /> },
  arrive: { text: "text-info", dot: "bg-info", icon: <Truck /> },
  reorder: { text: "text-ink", dot: "bg-ink", icon: <RefreshCw /> },
  deal: { text: "text-ok", dot: "bg-ok", icon: <Tag /> },
  budget: { text: "text-ok", dot: "bg-ok", icon: <CalendarDays /> },
};

function evText(e: WeekEvent, t: T, fm: Fmt, tz: string) {
  if (e.kind === "budget") return { title: t.dash.ev.budget.title, sub: fm.f(t.dash.ev.budget.sub, { amount: fm.money(e.left) }) };
  const name = e.item.title;
  if (e.kind === "late") return { title: fm.f(t.dash.ev.late.title, { name }), sub: fm.f(t.dash.ev.late.sub, { day: fm.dayShort(dayKeyIn(e.item.eta!, tz)) }) };
  return { title: name, sub: t.dash.ev[e.kind].sub };
}

function WeekCard({ model, className, style }: { model: HomeModel; className?: string; style?: React.CSSProperties }) {
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  const [open, setOpen] = useState(false);
  // R14 C1: "Month" — desktop: the card grows in place to the month grid; phone: a bottom sheet.
  const [month, setMonth] = useState(false);
  const desktop = useMedia("(min-width: 1024px)");
  const { days, today, events } = model.week;
  const tz = model.ctx.tz;
  const onEv = (e: WeekEvent) => {
    setMonth(false);
    if (e.kind === "budget") s.setView({ type: "spending" });
    else s.openItem(e.item.id);
  };
  const upcoming = events.filter((e) => e.day >= today);
  const list = open ? upcoming : upcoming.slice(0, 3);
  const fold = (shown: boolean) => cn("grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-out)]", shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0");
  return (
    <Card id="week" title={t.dash.week} icon={<CalendarDays />} className={className} style={style} link={month && desktop ? t.dash.monthClose : t.dash.monthLink} onLink={() => setMonth(!month)}>
      <span className="sr-only">{events.length === 1 ? t.dash.weekCountOne : f(t.dash.weekCount, { n: events.length })}</span>
      {desktop && (
        <div className={fold(month)} aria-hidden={!month} inert={!month}>
          <div className="min-h-0 overflow-hidden">
            <MonthCalendar model={model} onEv={onEv} />
          </div>
        </div>
      )}
      {!desktop && (
        <Sheet open={month} onOpenChange={setMonth} title={t.dash.monthTitle}>
          <MonthCalendar model={model} onEv={onEv} />
        </Sheet>
      )}
      {/* Desktop: 7 columns on a line, at most 2 events a day. */}
      <div className={cn(fold(!(month && desktop)), "max-lg:hidden")}>
      <div className="min-h-0 overflow-hidden">
      <div className="relative grid grid-cols-7 px-2 pb-4 pt-3.5" data-week-desktop>
        <span className="absolute inset-x-[18px] top-[66px] h-px bg-card-line" aria-hidden />
        {days.map((d) => {
          const evs = events.filter((e) => e.day === d);
          const isToday = d === today;
          return (
            <div key={d} className="relative flex min-h-[112px] min-w-0 flex-col gap-[5px] px-2.5" data-week-day={d}>
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{fm.wd(d)}</span>
              <span className="flex items-center gap-1.5 text-[20px] font-bold leading-none">
                {Number(d.slice(8))}
                {isToday && <span className="rounded-full bg-ink px-[7px] py-px text-[10.5px] font-bold text-bg">{t.dash.today}</span>}
              </span>
              <i className={cn("absolute start-2.5 top-[48px] size-[9px] rounded-full border-2", isToday ? "border-ink bg-ink shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink)_12%,transparent)]" : "border-card-line bg-surface")} aria-hidden />
              <div className="mt-[22px] flex flex-col gap-[7px]">
                {evs.slice(0, evs.length > 2 ? 1 : 2).map((e, k) => {
                  const x = evText(e, t, fm, tz);
                  return (
                    <button key={k} type="button" onClick={() => onEv(e)} className="flex min-w-0 gap-1.5 text-start text-[12px] leading-tight" data-week-ev={e.kind}>
                      <span className={cn("mt-px shrink-0 [&_svg]:size-3.5", EV_TONE[e.kind].text)}>{EV_TONE[e.kind].icon}</span>
                      <span className="min-w-0">
                        <b className="line-clamp-2 font-semibold text-ink">{x.title}</b>
                        <span className={cn("block truncate", EV_TONE[e.kind].text)}>{x.sub}</span>
                      </span>
                    </button>
                  );
                })}
                {evs.length > 2 && <span className="ps-5 text-[12px] font-semibold text-muted">{f(t.dash.moreDay, { n: evs.length - 1 })}</span>}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      </div>
      {/* Phone: a day strip with coloured dots, the next 3 events, "+N more" expands in place. */}
      <div className="lg:hidden" data-week-phone>
        <div className="grid grid-cols-7 px-2 pb-2 pt-2.5">
          {days.map((d) => {
            const kinds = [...new Set(events.filter((e) => e.day === d).map((e) => e.kind))].slice(0, 3);
            const isToday = d === today;
            return (
              <div key={d} className="flex flex-col items-center gap-1">
                <span className="text-[10.5px] font-bold uppercase text-muted">{fm.wd(d)}</span>
                <span className={cn("grid size-7 place-items-center rounded-full text-[14px] font-bold", isToday && "bg-ink text-bg")}>{Number(d.slice(8))}</span>
                <span className="flex h-1.5 gap-0.5" aria-hidden>
                  {kinds.map((k) => (
                    <i key={k} className={cn("size-1.5 rounded-full", EV_TONE[k].dot)} />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        <div className="r13-rows border-t border-line-in">
          {list.map((e, k) => {
            const x = evText(e, t, fm, tz);
            return (
              <button key={k} type="button" onClick={() => onEv(e)} className="flex min-h-[40px] w-full items-center gap-2.5 px-4 text-start text-[13px]" data-week-ev={e.kind}>
                <span className={cn("shrink-0 [&_svg]:size-4", EV_TONE[e.kind].text)}>{EV_TONE[e.kind].icon}</span>
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-semibold">{x.title}</b> <span className="text-muted">{x.sub}</span>
                </span>
                <span className="shrink-0 text-[12px] font-medium text-muted">{e.day === today ? t.dash.today : fm.wd(e.day)}</span>
              </button>
            );
          })}
          {upcoming.length > 3 && (
            <button type="button" onClick={() => setOpen(!open)} className="flex min-h-[40px] w-full items-center gap-1 px-4 text-start text-[12.5px] font-semibold text-muted" aria-expanded={open} data-week-more>
              {open ? t.dash.lessWeek : f(t.dash.moreWeek, { n: upcoming.length - 3 })}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * R14 C1: a month calendar — ‹ › between months, coloured dots per event type on each day (as the week strip), a
 * tapped day lists its events, each opens its item. Same events as This week (arrivals, late, reorder due, price
 * drops, budget close).
 */
function MonthCalendar({ model, onEv }: { model: HomeModel; onEv: (e: WeekEvent) => void }) {
  const s = useStore();
  const { t } = useI18n();
  const fm = useFmt();
  const [month, setMonth] = useState(model.month);
  const [sel, setSel] = useState(model.today);
  const grid = useMemo(() => monthGrid(month, s.clock.weekStartsOn ?? 0), [month, s.clock.weekStartsOn]);
  const byDay = useMemo(() => {
    const m = new Map<string, WeekEvent[]>();
    for (const e of model.events) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return m;
  }, [model.events]);
  const go = (n: number) => {
    const next = shiftMonth(month, n);
    setMonth(next);
    setSel(next === model.month ? model.today : `${next}-01`);
  };
  const evs = byDay.get(sel) ?? [];
  // R14 C2: one-off "Add to Google Calendar" per event — only until the feed is subscribed (no duplicates).
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    calendarSubscribed()
      .then((v) => alive && setSubscribed(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const gcal = (e: WeekEvent) => {
    if (subscribed !== false || (e.kind !== "arrive" && e.kind !== "late" && e.kind !== "reorder")) return null;
    const title = (e.kind === "reorder" ? t.cal.reorder : e.kind === "late" ? t.cal.late : t.cal.arrives).replace("{item}", e.item.title);
    const day = e.kind === "late" && e.item.eta != null ? dayKeyIn(e.item.eta, model.ctx.tz) : e.day;
    return googleTemplateUrl({ title, day, details: `${t.cal.open}: ${window.location.origin}/?item=${encodeURIComponent(e.item.id)}` });
  };
  const nav = "grid size-9 place-items-center rounded-full border border-card-line bg-surface text-ink transition hover:bg-surface-2 active:scale-95";
  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-3 lg:px-[18px]" data-month={month}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => go(-1)} className={nav} aria-label={t.dash.monthPrev} data-month-prev>
          <ChevronLeft className="size-4 rtl:-scale-x-100" />
        </button>
        <b className="flex-1 text-center text-[15px] font-bold" aria-live="polite" data-month-label>
          {fm.month(month)} {month.slice(0, 4)}
        </b>
        <button type="button" onClick={() => go(1)} className={nav} aria-label={t.dash.monthNext} data-month-next>
          <ChevronRight className="size-4 rtl:-scale-x-100" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center" role="grid">
        {grid.slice(0, 7).map((d) => (
          <span key={d} className="pb-1 text-[10.5px] font-bold uppercase tracking-[0.04em] text-muted">
            {fm.wd(d)}
          </span>
        ))}
        {grid.map((d) => {
          const kinds = [...new Set((byDay.get(d) ?? []).map((e) => e.kind))].slice(0, 3);
          const inMonth = d.startsWith(month);
          const on = d === sel;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSel(d)}
              aria-pressed={on}
              aria-label={`${fm.dateLong(d)}${kinds.length ? ` · ${(byDay.get(d) ?? []).length}` : ""}`}
              className={cn("mx-auto flex h-11 w-full max-w-[52px] flex-col items-center justify-center gap-1 rounded-xl transition", on ? "bg-[var(--nav-active)]" : "hover:bg-surface-2", !inMonth && "opacity-40")}
              data-month-day={d}
              data-month-kinds={kinds.join(" ") || undefined}
            >
              <span className={cn("grid size-6 place-items-center rounded-full text-[13px] font-semibold tabular", d === model.today && "bg-ink text-bg")}>{Number(d.slice(8))}</span>
              <span className="flex h-1.5 gap-0.5" aria-hidden>
                {kinds.map((k) => (
                  <i key={k} className={cn("size-1.5 rounded-full", EV_TONE[k].dot)} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col border-t border-line-in pt-2" data-month-list={sel}>
        <span className="pb-1 text-[12px] font-semibold text-muted">{fm.dateLong(sel)}</span>
        {evs.length === 0 && <p className="py-2 text-[13px] text-muted">{t.dash.monthNone}</p>}
        {evs.map((e, k) => {
          const x = evText(e, t, fm, model.ctx.tz);
          const add = gcal(e);
          return (
            <div key={k} className="flex min-h-[40px] items-center gap-2" data-month-row={e.kind}>
              <button type="button" onClick={() => onEv(e)} className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2.5 text-start text-[13px]" data-month-ev={e.kind}>
                <span className={cn("shrink-0 [&_svg]:size-4", EV_TONE[e.kind].text)}>{EV_TONE[e.kind].icon}</span>
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-semibold">{x.title}</b> <span className="text-muted">{x.sub}</span>
                </span>
              </button>
              {add && (
                <a
                  href={add}
                  target="_blank"
                  rel="noreferrer"
                  title={t.cal.addGoogleHint}
                  aria-label={`${t.cal.addGoogle} · ${t.cal.addGoogleHint}`}
                  className="relative grid size-9 shrink-0 place-items-center rounded-full border border-card-line bg-surface text-muted transition hover:text-ink after:absolute after:-inset-0.5 after:content-['']"
                  data-month-gcal
                >
                  <CalendarPlus className="size-4" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Needs you ----------

function NeedsCard({ model, rows = 4, className, style }: { model: HomeModel; rows?: number; className?: string; style?: React.CSSProperties }) {
  const s = useStore();
  const { t } = useI18n();
  return (
    <Card id="needs" title={t.dash.needsYou} count={model.needs.length} badge link={t.dash.all} onLink={() => s.setPanel("alerts")} className={className} style={style}>
      <div className="r13-rows px-4 pb-1 lg:px-[18px]">
        {model.needs.slice(0, rows).map((n) => (
          <NeedRowView key={n.key} n={n} model={model} />
        ))}
      </div>
    </Card>
  );
}

function NeedRowView({ n, model, className }: { n: NeedRow; model: HomeModel; className?: string }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const fm = useFmt();
  const ro = useReadOnly();
  const flow = useStatusFlow();
  const exact = (v: number, cur?: string | null) => formatMoney(v, cur ?? s.currency, locale);
  const dismiss = useDismiss();
  const row = useSwipeAway(() => dismiss(n.key));
  const tz = model.ctx.tz;
  let icon: React.ReactNode, tone: keyof typeof TONE_CHIP, title: string, sub: string, act: string, actShort: string, run: () => void;
  switch (n.kind) {
    case "alert": {
      const price = n.alert.newPrice != null ? exact(n.alert.newPrice, n.alert.currency) : "";
      icon = <Tag />;
      tone = "ok";
      title = n.alert.kind === "back_in_stock" ? f(t.dash.need.alertBack, { name: n.item.title }) : f(n.alert.kind === "target" ? t.dash.need.alertTarget : t.dash.need.alertDrop, { name: n.item.title, price });
      sub = n.alert.oldPrice != null && n.alert.newPrice != null && n.alert.oldPrice > n.alert.newPrice ? f(t.dash.need.alertSub, { diff: `−${exact(n.alert.oldPrice - n.alert.newPrice, n.alert.currency)}` }) : t.dash.need.alertSubPlain;
      act = t.dash.need.buy;
      actShort = t.dash.need.buyShort;
      run = () => {
        const url = activeSource(n.item, s.rates)?.url;
        if (url) window.open(url, "_blank", "noopener");
        else s.openItem(n.item.id);
      };
      break;
    }
    case "late": {
      const src = activeSource(n.item, s.rates);
      const day = fm.dayShort(dayKeyIn(n.item.eta!, tz));
      icon = <Truck />;
      tone = "warn";
      title = f(t.dash.need.late, { name: n.item.title });
      sub = src ? f(t.dash.need.lateSub, { day, store: src.store }) : f(t.dash.need.lateSubNoStore, { day });
      act = t.dash.need.received;
      actShort = t.dash.need.receivedShort;
      run = () => void flow.setTo(n.item, "purchased");
      break;
    }
    case "ship": {
      icon = <Package />;
      tone = "info";
      title = f(t.dash.need.ship, { amount: exact(n.remaining), store: n.store });
      sub = f(t.dash.need.shipSub, { name: n.add.title, price: fm.money(n.adds) });
      act = f(t.dash.need.add, { name: shortName(n.add.title) });
      actShort = t.dash.need.addShort;
      run = async () => {
        const before = n.add;
        s.upsertItem({ ...before, ...n.apply });
        try {
          s.upsertItem(await updateItem(before.id, n.apply));
          toast.success(t.dash.addedOrder, { description: before.title });
        } catch {
          s.upsertItem(before);
          toast.error(t.errors.generic);
        }
      };
      break;
    }
    case "reorder": {
      icon = <RefreshCw />;
      tone = "info";
      const c = n.item;
      title = f(t.dash.need.reorder, { name: c.title });
      const days = Math.round((n.due - (c.purchasedAt ?? n.due)) / 86_400_000);
      sub = f(t.dash.need.reorderSub, { days: Math.max(1, days) });
      act = t.dash.need.addList;
      actShort = t.dash.need.addListShort;
      run = async () => {
        try {
          const it = await buyAgain(c.id);
          s.upsertItem(it);
          s.markFresh(it.id);
          toast.success(t.dash.added, { description: it.title });
        } catch {
          toast.error(t.errors.generic);
        }
      };
      break;
    }
  }
  return (
    <div className={cn("relative overflow-hidden", className)} data-need={n.kind} data-need-key={n.key}>
      <div {...row.bind} className="group flex touch-pan-y items-center gap-3 bg-surface py-2.5 transition-transform lg:py-[11px]" style={row.style}>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4", TONE_CHIP[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13.5px] font-semibold">{title}</b>
          <span className="block truncate text-[12.5px] text-muted">{sub}</span>
        </div>
        <button type="button" disabled={ro.ro && n.kind !== "alert"} onClick={run} className="h-8 shrink-0 rounded-full border border-card-line bg-surface px-3 text-[12.5px] font-semibold transition hover:border-ink/40 disabled:opacity-50" data-need-act>
          <span className="max-lg:hidden">{act}</span>
          <span className="lg:hidden">{actShort}</span>
        </button>
        <button
          type="button"
          onClick={() => dismiss(n.key, title)}
          className="grid size-7 shrink-0 place-items-center rounded-full text-muted opacity-0 transition hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 max-lg:hidden"
          aria-label={t.dash.dismiss}
          title={t.dash.dismiss}
          data-need-dismiss
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

const shortName = (s: string) => (s.length > 18 ? `${s.slice(0, 16).trimEnd()}…` : s);

/** Phone: swipe a row sideways past 80 px to dismiss it (follows the finger; springs back below the threshold). */
function useSwipeAway(onAway: () => void) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const [held, setHeld] = useState(false);
  const st = useRef<{ x: number; y: number; id: number; lock: "x" | "y" | null } | null>(null);
  return {
    style: { transform: gone ? `translateX(${dx > 0 ? 110 : -110}%)` : dx ? `translateX(${dx}px)` : undefined, transitionDuration: held ? "0ms" : "250ms" } as React.CSSProperties,
    bind: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("button")) return;
        st.current = { x: e.clientX, y: e.clientY, id: e.pointerId, lock: null };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const c = st.current;
        if (!c || c.id !== e.pointerId) return;
        const x = e.clientX - c.x;
        const y = e.clientY - c.y;
        if (!c.lock && Math.hypot(x, y) > 8) {
          c.lock = Math.abs(x) > Math.abs(y) ? "x" : "y";
          if (c.lock === "x") setHeld(true);
        }
        if (c.lock === "x") setDx(x);
      },
      onPointerUp: () => {
        const away = Math.abs(dx) > 80;
        st.current = null;
        setHeld(false);
        if (away) {
          setGone(true);
          window.setTimeout(onAway, 200);
        } else setDx(0);
      },
      onPointerCancel: () => {
        st.current = null;
        setHeld(false);
        setDx(0);
      },
    },
  };
}

// ---------- On the way ----------

function OnTheWayCard({ model, rows = 4, className, style }: { model: HomeModel; rows?: number; className?: string; style?: React.CSSProperties }) {
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  const tz = model.ctx.tz;
  return (
    <Card id="ontheway" title={t.dash.onTheWay} count={model.packages.length} link={t.dash.trackAll} onLink={() => s.setView({ type: "ordered" })} className={className} style={style}>
      <div className="r13-rows px-4 pb-1 lg:px-[18px]">
        {model.packages.slice(0, rows).map((p) => {
          const late = p.track.late;
          const d = p.item.eta != null ? dayKeyIn(p.item.eta, tz) : null;
          const lateDays = late && d ? Math.round((utc(model.today).getTime() - utc(d).getTime()) / 86_400_000) : 0;
          return (
            <button key={p.item.id} type="button" onClick={() => s.openItem(p.item.id)} className="block w-full py-2.5 text-start lg:py-[11px]" data-package={p.item.id}>
              <span className="flex items-center gap-3">
                <ProductImage src={p.item.imageUrl} alt="" className="size-9 shrink-0 rounded-lg border border-line-in lg:size-10" iconClass="size-5" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] font-semibold">{p.item.quantity > 1 && !/[×x]\s*\d+\s*$/i.test(p.item.title) ? `${p.item.title} ×${p.item.quantity}` : p.item.title}</b>
                  <span className="block truncate text-[12.5px] text-muted">{[p.store, p.price != null ? fm.money(p.price) : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={cn("shrink-0 text-[12.5px] font-bold", late ? "text-warn" : d ? "text-info" : "text-muted")}>
                  {late ? (
                    <>
                      <span className="max-lg:hidden">{lateDays === 1 ? t.dash.dayLate : f(t.dash.daysLate, { n: lateDays })}</span>
                      <span className="lg:hidden">{t.dash.lateShort}</span>
                    </>
                  ) : d ? (
                    <>
                      <span className="max-lg:hidden">{fm.dayShort(d)}</span>
                      <span className="lg:hidden">{whenLabel(d, model.today, fm)}</span>
                    </>
                  ) : (
                    t.dash.noDate
                  )}
                </span>
              </span>
              <DeliveryTrack track={p.track} className="mt-1.5 lg:mt-2" />
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Pace + projects (+ the phone's merged card) ----------

function PaceChart({ model }: { model: HomeModel }) {
  const { t } = useI18n();
  const p = model.pace;
  const W = 400;
  const H = 110;
  const last = p.spent[p.spent.length - 1] ?? 0;
  const top = Math.max(p.cap ?? 0, p.usual?.[p.dim - 1] ?? 0, p.projected, last, 1) * 1.12;
  const x = (d: number) => (d / Math.max(1, p.dim - 1)) * W;
  const y = (v: number) => H - (v / top) * H;
  const line = (vals: number[]) => vals.map((v, d) => `${d ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const tx = x(p.dayOfMonth - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H + 6}`} preserveAspectRatio="none" className="h-[110px] w-full overflow-visible" role="img" aria-label={t.dash.pace.replace("{month}", "")} data-pace-chart>
      {p.cap != null && <line x1="0" x2={W} y1={y(p.cap)} y2={y(p.cap)} stroke="var(--warn)" strokeOpacity=".55" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
      {p.usual && <path d={line(p.usual)} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      <path d={line(p.spent)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {p.dayOfMonth < p.dim && <path d={`M${tx},${y(last)}L${W},${y(p.projected)}`} fill="none" stroke="var(--ink)" strokeOpacity=".5" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      <circle cx={tx} cy={y(last)} r="4" fill="var(--ink)" />
    </svg>
  );
}

function paceSentence(model: HomeModel, t: T, fm: Fmt) {
  const p = model.pace;
  const speed = p.speed === "slower" ? t.dash.paceSlower : p.speed === "faster" ? t.dash.paceFaster : p.speed === "usual" ? t.dash.paceUsual : null;
  if (p.delta == null) return { lead: speed, tail: null as null | { text: string; ok: boolean }, none: fm.f(t.dash.paceNoCap, { month: fm.month(model.month) }) };
  const ok = p.delta >= 0;
  return { lead: speed, tail: { text: fm.f(ok ? t.dash.paceUnder : t.dash.paceOver, { amount: fm.money(Math.abs(p.delta)) }), ok }, none: null };
}

function Sentence({ model }: { model: HomeModel }) {
  const { t } = useI18n();
  const fm = useFmt();
  const x = paceSentence(model, t, fm);
  return (
    <p className="text-[13px] leading-snug text-muted">
      {x.lead && <>{x.lead}{x.tail ? " — " : ". "}</>}
      {x.tail ? <b className={cn("font-semibold", x.tail.ok ? "text-ok" : "text-danger")}>{x.tail.text}</b> : x.none}
      {"."}
    </p>
  );
}

function PaceCard({ model, className, style }: { model: HomeModel; className?: string; style?: React.CSSProperties }) {
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  const p = model.pace;
  return (
    <Card id="pace" title={f(t.dash.pace, { month: fm.month(model.month) })} link={t.dash.paceLink} onLink={() => s.setView({ type: "spending" })} className={className} style={style}>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3 lg:px-[18px]">
        <span className="tabular text-[24px] font-extrabold tracking-[-0.03em]">
          {fm.money(model.stats.budget.spent)}
          {p.cap != null && <small className="ms-1 text-[12.5px] font-medium tracking-normal text-muted">{f(t.dash.ofCap, { amount: fm.money(p.cap) })}</small>}
        </span>
        <PaceChart model={model} />
        <Sentence model={model} />
      </div>
    </Card>
  );
}

function ProjectRows({ model, compact, rows = 99 }: { model: HomeModel; compact?: boolean; rows?: number }) {
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  return (
    <div className="r13-rows px-4 lg:px-[18px]">
      {model.projects.slice(0, rows).map((p) => {
        const color = COLLECTION_COLORS[p.collection.color] ?? COLLECTION_COLORS.slate;
        return (
          <button key={p.collection.id} type="button" onClick={() => s.setView({ type: "collection", id: p.collection.id })} className={cn("block w-full text-start", compact ? "py-2.5" : "py-3")} data-home-project={p.collection.id}>
            <span className="flex items-center gap-3">
              <span className={cn("flex min-w-0 shrink-0 items-center gap-2", compact ? "w-[30%]" : "w-[28%]")}>
                <i className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                <b className="truncate text-[13.5px] font-semibold">{p.collection.name}</b>
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <i className="grow-x block h-full rounded-full" style={{ width: `${Math.round(p.pctBought * 100)}%`, background: color }} />
              </span>
              <span className="tabular shrink-0 text-[12.5px] font-semibold">{f(t.dash.leftShort, { amount: compact ? fm.compact(p.left) : fm.money(p.left) })}</span>
            </span>
            {!compact && (
              <span className="mt-1 block truncate ps-[calc(28%+12px)] text-[12px] text-muted">
                {p.next && (
                  <>
                    {t.dash.nextItem.split("{name}")[0]}
                    <bdi>{p.next.title}</bdi>
                    {t.dash.nextItem.split("{name}")[1]} ·{" "}
                  </>
                )}
                <bdi>{f(t.dash.bought, { pct: Math.round(p.pctBought * 100) })}</bdi>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ProjectsCard({ model, rows, className, style }: { model: HomeModel; rows?: number; className?: string; style?: React.CSSProperties }) {
  const s = useStore();
  const { t } = useI18n();
  return (
    <Card id="projects" title={t.dash.projects} link={t.dash.allProjects} onLink={() => s.setView({ type: "projects" })} className={className} style={style}>
      <ProjectRows model={model} rows={rows} />
    </Card>
  );
}

function insightText(x: Insight, t: T, fm: Fmt) {
  switch (x.kind) {
    case "batch":
      return { text: fm.f(t.dash.ins.batch, { n: x.count, store: x.store, amount: fm.money(x.saved) }), link: t.dash.ins.batchLink };
    case "weekday": {
      const cats = t.categories as Record<string, string>;
      return { text: fm.f(t.dash.ins.weekday, { category: cats[x.category] ?? x.category, pct: Math.round(x.pct * 100), day: fm.weekday(x.day) }), link: t.dash.ins.weekdayLink };
    }
    case "no_budget":
      return { text: fm.f(t.dash.ins.noBudget, { project: x.collection.name, min: fm.money(x.min), max: fm.money(x.max) }), link: t.dash.ins.noBudgetLink };
    case "ai":
      return { text: x.text, link: x.action ? t.dash.ins.aiLink : null };
    case "top_store":
      return { text: fm.f(t.dash.ins.topStore, { store: x.store, amount: fm.money(x.amount), total: fm.money(x.total) }), link: t.dash.ins.topLink };
    case "top_category": {
      const cats = t.categories as Record<string, string>;
      return { text: fm.f(t.dash.ins.topCategory, { category: cats[x.category] ?? x.category, amount: fm.money(x.amount), total: fm.money(x.total) }), link: t.dash.ins.topLink };
    }
    case "big_project":
      return { text: fm.f(t.dash.ins.bigProject, { project: x.collection.name, amount: fm.money(x.left) }), link: t.dash.ins.bigProjectLink };
    case "waiting":
      return { text: fm.f(x.count === 1 ? t.dash.ins.waitingOne : t.dash.ins.waiting, { n: x.count, amount: fm.money(x.amount) }), link: t.dash.ins.waitingLink };
  }
}

function NoticedCard({ list, className, style }: { list: Insight[]; className?: string; style?: React.CSSProperties }) {
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  const [idx, setIdx] = useState(0);

  const i = Math.min(idx, list.length - 1);
  const act = (x: Insight) => {
    if (x.kind === "batch") s.setView({ type: "history" });
    else if (x.kind === "weekday") {
      s.setView({ type: "to_buy" });
      s.setCategoryFilter(x.category);
    } else if (x.kind === "no_budget") s.setEditor({ mode: "edit", collection: x.collection });
    else if (x.kind === "top_store" || x.kind === "top_category") s.setView({ type: "spending" });
    else if (x.kind === "big_project") s.setView({ type: "collection", id: x.collection.id });
    else if (x.kind === "waiting") s.setView({ type: "to_buy" });
    else if (x.action?.type === "budget") {
      const c = s.collections.find((c) => c.id === x.action!.collectionId);
      if (c) s.setEditor({ mode: "edit", collection: c });
    } else if (x.action?.itemId) s.openItem(x.action.itemId);
  };
  const swipe = useRef<{ x: number; id: number } | null>(null);
  const dots = list.length > 1 && (
    <span className="-me-3 ms-auto flex lg:hidden" role="tablist">
      {list.map((x, k) => (
        <button key={x.key} type="button" role="tab" aria-selected={k === i} aria-label={f(t.dash.insightN, { i: k + 1, n: list.length })} onClick={() => setIdx(k)} className="relative grid h-6 w-8 place-items-center after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']">
          <i className={cn("block h-1.5 rounded-full transition-[width,background-color] duration-300", k === i ? "w-4 bg-ai" : "w-1.5 bg-card-line")} />
        </button>
      ))}
    </span>
  );
  return (
    <section className={cn("r13-card r13-section flex min-w-0 flex-col", className)} style={style} data-home-section="noticed" data-noticed-count={list.length} data-noticed-kinds={list.map((y) => y.kind).join(" ")}>
      <div className="flex min-h-[42px] items-center gap-2 border-b border-line-in px-4 py-2 lg:min-h-[46px] lg:px-[18px] lg:py-2.5">
        <Sparkles className="size-4 text-ai" />
        <h2 className="text-[12px] font-bold uppercase tracking-[0.05em] text-ai">{t.dash.noticed}</h2>
        {dots}
      </div>
      {/* Desktop: all insights side by side. */}
      <div className="grid max-lg:hidden" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
        {list.map((x, k) => {
          const it = insightText(x, t, fm);
          return (
            <div key={x.key} className={cn("flex flex-col gap-2 px-[18px] pb-4 pt-3.5", k > 0 && "border-s border-line-in")} data-insight={x.kind}>
              <span className="text-[11.5px] font-bold text-ai">{String(k + 1).padStart(2, "0")}</span>
              <p className="flex-1 text-[13.5px] leading-relaxed">{it.text}</p>
              {it.link && (<button type="button" onClick={() => act(x)} className="self-start text-[13px] font-semibold underline underline-offset-4">
                {it.link}
              </button>)}
            </div>
          );
        })}
      </div>
      {/* Phone: one at a time; swipe or tap the dots. */}
      <div
        className="touch-pan-y px-4 pb-3 pt-2.5 lg:hidden"
        onPointerDown={(e) => (swipe.current = { x: e.clientX, id: e.pointerId })}
        onPointerUp={(e) => {
          const st = swipe.current;
          swipe.current = null;
          if (!st || st.id !== e.pointerId || list.length < 2) return;
          const dx = e.clientX - st.x;
          if (Math.abs(dx) < 40) return;
          const rtl = document.documentElement.dir === "rtl";
          const fwd = rtl ? dx > 0 : dx < 0;
          setIdx((i + (fwd ? 1 : -1) + list.length) % list.length);
        }}
        data-noticed-phone
      >
        {(() => {
          const x = list[i];
          const it = insightText(x, t, fm);
          return (
            <div key={x.key} className="r13-swap flex flex-col gap-2" data-insight={x.kind}>
              <p className="text-[13.5px] leading-relaxed">{it.text}</p>
              {it.link && (<button type="button" onClick={() => act(x)} className="self-start py-1 text-[13px] font-semibold underline underline-offset-4">
                {it.link}
              </button>)}
            </div>
          );
        })()}
      </div>
    </section>
  );
}

// ---------- A7: empty account ----------

function HomeEmpty({ model }: { model: HomeModel }) {
  const meName = useMeName();
  const s = useStore();
  const { t, f } = useI18n();
  const fm = useFmt();
  // The shared add list (R16 A3), big cards only: paste first here (it's the first thing to try on an empty space).
  const all = useAddActions().filter((a) => a.primary && (a.key !== "plan" || s.aiEnabled));
  const actions = [...all.filter((a) => a.key === "paste"), ...all.filter((a) => a.key !== "paste")];
  return (
    <div className="flex flex-col gap-4 pb-6 lg:pt-2" data-home data-home-empty>
      <div className="px-1">
        <div className="text-[12.5px] font-medium text-muted" suppressHydrationWarning>
          {fm.dateLong(model.today)}
        </div>
        <h1 className="mt-0.5 text-[26px] font-extrabold tracking-[-0.03em] lg:text-[30px]" suppressHydrationWarning>
          {f(greeting(s.clock.now, s.clock.tz, t), { name: meName })}
        </h1>
        <p className="mt-2 text-[15px] font-semibold">{t.dash.emptyTitle}</p>
        <p className="mt-0.5 max-w-[52ch] text-[13.5px] text-muted">{t.dash.emptyHint}</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3.5">
        {actions.map((a, k) => (
          <button
            key={a.key}
            type="button"
            disabled={a.disabled}
            onClick={a.run}
            data-home-empty-action={a.key}
            style={{ backgroundColor: "var(--surface)", backgroundImage: `var(--act-${a.tone})`, "--d": `${k * 60}ms` } as React.CSSProperties}
            className="r13-rise flex min-h-[124px] flex-col items-start justify-between rounded-[18px] border border-card-line p-3.5 text-start transition active:scale-[0.98] disabled:opacity-50 lg:min-h-[150px] lg:p-4"
          >
            <span className="block h-11 w-14" style={{ color: `var(--act-${a.tone}-ink)` }} aria-hidden>
              {a.art}
            </span>
            <span className="min-w-0">
              <b className="block text-[15px] font-extrabold leading-tight" style={{ color: `var(--act-${a.tone}-ink)` }}>
                {a.title}
              </b>
              <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted">{a.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="skeleton-in flex flex-col gap-3 lg:grid lg:grid-cols-12 lg:gap-[14px]" aria-hidden data-home-skeleton>
      <div className="h-[86px] rounded-xl bg-surface-2 lg:col-span-12 lg:h-[300px]" />
      <div className="h-[110px] rounded-xl bg-surface-2 lg:col-span-12 lg:h-[96px]" />
      <div className="h-[180px] rounded-xl bg-surface-2 lg:col-span-12" />
    </div>
  );
}
