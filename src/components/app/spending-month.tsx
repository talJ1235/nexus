"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CloudOff, Tag } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useDevice } from "@/components/ui/use-device";
import { smSpending } from "@/app/supermarket-actions";
import { capFor } from "@/lib/budget";
import { activeSource, lineTotal, spendDate } from "@/lib/calc";
import { sectionName } from "@/lib/grocery/sections";
import { convert, formatMoney } from "@/lib/money";
import { monthOf, shiftKey, spendingMonth, type MonthSpend, type ProductIn, type TripIn } from "@/lib/spending-month";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { SectionIcon, sectionColor } from "./supermarket/art";
import { chainDef, monoColor } from "./supermarket/numbers";

// R18 S5 E1 + E2 (boards Spending-month-phone / -desktop) — Insights → Spending, one month at a time: the month switcher
// (no future months), the hero (spent, of the budget · left for N days / over-under for a closed month, the pace chip,
// the delta vs the same day last month — or vs last month once it's closed), the cumulative chart (line + area, dashed
// budget, dotted pace, today's dot; time runs left → right in both languages), the split Supermarket / Products /
// Delivery & other; then the breakdowns — phone: a Sections · Stores · Products segment, computer: all at once — and
// "Against last month". Space-level (every member), the space's currency, the month from the budget's start day.

type Data = { startDay: number; trips: TripIn[] };
const cache = new Map<string, Data>();
const KEY = (space: string) => `nexus.spending:${space}`;
const SEG = { sm: "#2f9a58", prod: "#2f6fd1", deliv: "#8a8984" };

function useSpendingData() {
  const s = useStore();
  const space = s.spaceId || "-";
  const [data, setData] = useState<Data | null>(() => cache.get(space) ?? null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let live = true;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY(space)) ?? "null") as Data | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the last numbers this device saw (offline)
      if (saved && !cache.has(space)) setData(saved);
    } catch {}
    if (s.offlineAt != null) {
      setStale(true);
      return;
    }
    void smSpending().then(
      (d) => {
        if (!live) return;
        cache.set(space, d);
        setData(d);
        setStale(false);
        try {
          localStorage.setItem(KEY(space), JSON.stringify(d));
        } catch {}
      },
      () => live && setStale(true),
    );
    return () => {
      live = false;
    };
  }, [space, s.offlineAt, s.sm.length]);
  return { data, stale };
}

export function SpendingMonth() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const desk = useDevice() === "computer";
  const { data, stale } = useSpendingData();
  const startDay = data?.startDay ?? 1;
  const current = monthOf(s.clock.now, startDay, s.clock.tz);
  const [picked, setPicked] = useState<string | null>(null);
  const key = picked && picked <= current ? picked : current;
  const [seg, setSeg] = useState<"sections" | "stores" | "products">("sections");
  const money = (n: number) => formatMoney(Math.round(n), s.currency, locale);
  const products: ProductIn[] = useMemo(
    () =>
      s.items
        .filter((i) => i.status !== "to_buy")
        .map((i) => {
          const value = lineTotal(i, s.rates, s.currency) ?? 0;
          const src = activeSource(i, s.rates);
          const shipping = i.purchasedPrice == null && src?.shipping ? convert(src.shipping, src.currency, s.currency, s.rates) * i.quantity : 0;
          return { id: i.id, title: i.title, at: spendDate(i) ?? i.updatedAt, value, shipping: Math.min(shipping, value), store: src?.store ?? null };
        }),
    [s.items, s.rates, s.currency],
  );
  const m: MonthSpend | null = useMemo(() => {
    if (!data) return null;
    const cap = capFor(key, s.budget);
    return spendingMonth({ key, startDay, tz: s.clock.tz, now: s.clock.now, trips: data.trips, products, cap: cap?.cap ? convert(cap.cap, cap.currency, s.currency, s.rates) : null, toCur: (v, cur) => convert(v, cur, s.currency, s.rates) });
  }, [data, key, startDay, s.clock, s.budget, s.currency, s.rates, products]);
  const [y, mo] = key.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 15)));
  const monthShort = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 15)));
  const switcher = (
    <div className="flex items-center gap-1" data-spm-switch>
      <button type="button" className="grid size-10 place-items-center rounded-full text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.92] hover:bg-surface-2" onClick={() => setPicked(shiftKey(key, -1))} aria-label={t.spm.prev} data-spm-prev>
        <ChevronLeft className="size-5 rtl:-scale-x-100" />
      </button>
      <b className="tabular min-w-0 flex-1 truncate text-center text-[15.5px] font-extrabold desk:min-w-[150px]" data-spm-month={key}>
        {monthName}
      </b>
      <button type="button" className="grid size-10 place-items-center rounded-full text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.92] hover:bg-surface-2 disabled:opacity-30" onClick={() => setPicked(shiftKey(key, 1))} disabled={key >= current} aria-label={t.spm.next} data-spm-next>
        <ChevronRight className="size-5 rtl:-scale-x-100" />
      </button>
    </div>
  );
  if (!m)
    return (
      <div className="flex flex-col gap-3" data-spm="loading">
        {switcher}
        <div className="h-[340px] rounded-[26px] bg-surface-2" />
      </div>
    );
  const hero = <Hero m={m} monthShort={monthShort} money={money} desk={desk} stale={stale} />;
  const sections = <Sections m={m} money={money} />;
  const stores = <Stores m={m} money={money} />;
  const prods = <Products m={m} money={money} />;
  const against = <Against m={m} money={money} />;
  const first = m.empty && !m.hasHistory;
  return (
    <div className="flex flex-col gap-3" data-spm={key} data-spm-closed={m.closed || undefined}>
      {switcher}
      {first ? (
        <div className="rounded-[26px] bg-surface p-5 shadow-[inset_0_0_0_1px_var(--line-in)]" data-spm-first>
          <b className="block text-[17px] font-extrabold">{t.spm.first}</b>
          <p className="mt-1 text-[14px] text-muted">{t.spm.firstSub}</p>
        </div>
      ) : desk ? (
        <div className="grid grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-4">
            {hero}
            {sections}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {stores}
            {prods}
            {against}
          </div>
        </div>
      ) : (
        <>
          {hero}
          <div className="grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1" role="tablist" aria-label={t.spm.whereWent} data-spm-seg>
            {(["sections", "stores", "products"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={seg === k} onClick={() => setSeg(k)} className={cn("h-10 rounded-full text-[14px] font-bold transition-colors duration-150", seg === k ? "bg-surface text-ink shadow-card" : "text-muted")} data-spm-tab={k}>
                {t.spm[k]}
              </button>
            ))}
          </div>
          {seg === "sections" ? sections : seg === "stores" ? stores : prods}
          {against}
        </>
      )}
      {m.empty && !first && <p className="px-1 text-[13px] text-muted">{f(t.spm.nothing, { month: monthShort })}</p>}
    </div>
  );
}

const card = "rounded-[26px] bg-surface p-[18px] shadow-[inset_0_0_0_1px_var(--line-in),0_1px_2px_color-mix(in_srgb,var(--ink)_6%,transparent)]";

function Hero({ m, monthShort, money, desk, stale }: { m: MonthSpend; monthShort: string; money: (n: number) => string; desk: boolean; stale: boolean }) {
  const s = useStore();
  const { t, f } = useI18n();
  const pace = m.paceState === "ahead" ? t.spm.ahead : m.paceState === "under" ? t.spm.underPace : m.paceState === "on" ? t.spm.onPace : null;
  const sub =
    m.cap == null ? null : m.closed ? (m.left! < 0 ? f(t.spm.over, { amount: money(-m.left!) }) : f(t.spm.under, { amount: money(m.left!) })) : m.left! < 0 ? f(t.spm.ofOver, { cap: money(m.cap), amount: money(-m.left!) }) : f(m.daysLeft + 1 === 1 ? t.spm.ofLeftOne : t.spm.ofLeft, { cap: money(m.cap), left: money(m.left!), n: m.daysLeft + 1 });
  const split = [
    { k: "sm", v: m.supermarket, c: SEG.sm, label: t.spm.sm },
    { k: "prod", v: m.products, c: SEG.prod, label: t.spm.prod },
    { k: "deliv", v: m.delivery, c: SEG.deliv, label: t.spm.deliv },
  ];
  const splitBar = (
    <div>
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px] bg-surface-2" role="img" aria-label={split.map((x) => `${x.label} ${money(x.v)}`).join(", ")} data-spm-split>
        {split.filter((x) => x.v > 0).map((x) => (
          <i key={x.k} className="block h-full transition-[flex-grow] duration-500 ease-[var(--ease-out)]" style={{ flexGrow: x.v, background: x.c }} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] font-semibold text-muted">
        {split.map((x) => (
          <span key={x.k} className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-full" style={{ background: x.c }} />
            {x.label} <b className="tabular font-extrabold text-ink">{money(x.v)}</b>
          </span>
        ))}
      </div>
    </div>
  );
  const delta = Math.round(m.delta);
  return (
    <section className={card} data-spm-hero>
      <div className={cn("flex gap-6", !desk && "flex-col gap-0")}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted">{m.closed ? f(t.spm.spentIn, { month: monthShort }) : t.spm.spentThis}</span>
            {stale && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-warn-soft px-2 text-[11.5px] font-bold text-warn" title={t.spm.offline} data-spm-offline>
                <CloudOff className="size-3.5" />
              </span>
            )}
            {pace && <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold", m.paceState === "ahead" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")} data-spm-pace={m.paceState}>{pace}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5">
            <b className="tabular text-[38px] font-extrabold leading-[1.1] tracking-[-0.03em]" data-spm-total>
              {money(m.total)}
            </b>
            {(m.hasHistory || m.closed) && delta !== 0 && (
              <span className={cn("tabular rounded-full px-2 py-0.5 text-[12px] font-bold", delta > 0 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")} data-spm-delta={delta}>
                {delta > 0 ? "+" : "−"}
                {money(Math.abs(delta))} {m.closed ? t.spm.deltaLast : t.spm.deltaSame}
              </span>
            )}
          </div>
          {sub ? (
            <p className="tabular mt-0.5 text-[13px] text-muted" data-spm-sub>
              {sub}
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] text-muted" data-spm-nobudget>
              {t.spm.noBudget} ·{" "}
              <button type="button" className="font-bold text-ink underline underline-offset-2" onClick={() => s.openSettings("space")} data-spm-set-budget>
                {t.spm.setBudget}
              </button>
            </p>
          )}
        </div>
        {desk && (
          <div className="w-[44%] shrink-0">
            <span className="mb-2 block text-[13px] font-semibold text-muted">{t.spm.whereWent}</span>
            {splitBar}
          </div>
        )}
      </div>
      <Chart m={m} />
      {!desk && <div className="mt-3">{splitBar}</div>}
    </section>
  );
}

/** The cumulative line + area to today, the dashed budget line, the dotted pace line, today's dot. Always LTR. */
function Chart({ m }: { m: MonthSpend }) {
  const { t } = useI18n();
  const W = 300;
  const H = 110;
  const top = Math.max(m.cap ?? 0, m.total, ...m.cumulative, 1) * 1.08;
  const x = (k: number) => (m.days <= 1 ? 0 : (k / (m.days - 1)) * W);
  const yv = (v: number) => H - (v / top) * H;
  const pts = m.cumulative.map((v, k) => [x(k), yv(v)] as const);
  const line = pts.map(([a, b], k) => `${k ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L0 ${H} Z` : "";
  const last = pts[pts.length - 1];
  return (
    <div className="mt-3" dir="ltr">
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" className="h-[130px] w-full overflow-visible desk:h-[170px]" role="img" aria-label={t.spm.chart} data-spm-chart>
        {[0.33, 0.66].map((g) => (
          <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="var(--line-in)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {m.cap != null && (
          <>
            <line x1="0" x2={W} y1={yv(m.cap)} y2={yv(m.cap)} stroke="var(--danger, #c4321f)" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" data-spm-cap />
            <line x1="0" y1={H} x2={W} y2={yv(m.cap)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" data-spm-paceline />
          </>
        )}
        {area && <path d={area} fill="color-mix(in srgb, var(--ink) 8%, transparent)" />}
        {line && <path d={line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Today's dot as an element: the chart stretches (preserveAspectRatio none), a circle in it wouldn't stay round. */}
      {last && !m.closed && (
        <span className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-[0_0_0_2px_var(--surface)]" style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / (H + 4)) * 100}%` }} data-spm-today />
      )}
      </div>
      <div className="tabular mt-1 flex justify-between text-[11px] font-semibold text-faint" aria-hidden>
        <span>1</span>
        <span>{Math.ceil(m.days / 2)}</span>
        <span>{m.days}</span>
      </div>
    </div>
  );
}

const pct = (now: number, last: number) => (last > 0 ? Math.round(((now - last) / last) * 100) : null);

function Sections({ m, money }: { m: MonthSpend; money: (n: number) => string }) {
  const { t, f, locale } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...m.sections.map((x) => x.amount));
  return (
    <section className={card} data-spm-sections>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold">{t.spm.bySection}</h2>
        <span className="tabular text-[13px] text-muted">{money(m.supermarket)}</span>
      </div>
      {m.sections.length === 0 ? (
        <p className="py-3 text-[13px] text-muted">{t.spm.noTrips}</p>
      ) : (
        <ul className="flex flex-col">
          {m.sections.map((x) => {
            const p = pct(x.amount, x.last);
            const on = open === x.key;
            return (
              <li key={x.key} data-spm-section={x.key}>
                <button type="button" className="flex w-full items-center gap-3 py-2 text-start" onClick={() => setOpen(on ? null : x.key)} aria-expanded={on}>
                  <SectionIcon section={x.key} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <b className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{x.key === "other" ? t.sm.main.other : sectionName(x.key, locale)}</b>
                      <b className="tabular shrink-0 text-[14px] font-extrabold">{money(x.amount)}</b>
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <i className="block h-full rounded-full" style={{ width: `${(x.amount / max) * 100}%`, background: sectionColor(x.key) }} />
                      </span>
                      <span className="tabular w-[84px] shrink-0 text-end text-[11.5px] text-muted">{p == null ? t.spm.newThis : f(t.spm.vsLast, { pct: `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%` })}</span>
                    </span>
                  </span>
                  <ChevronDown className={cn("size-4 shrink-0 text-faint transition-transform duration-200", on && "rotate-180")} />
                </button>
                {on && (
                  <ul className="mb-2 ms-[46px] flex flex-col gap-1 border-s border-line-in ps-3" data-spm-items>
                    {x.items.map((i) => (
                      <li key={i.title} className="flex items-baseline gap-2 text-[13px]">
                        <span className="bidi min-w-0 flex-1 truncate">{i.title}</span>
                        <span className="tabular text-muted">{money(i.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Stores({ m, money }: { m: MonthSpend; money: (n: number) => string }) {
  const { t, f, locale } = useI18n();
  const max = Math.max(1, ...m.stores.map((x) => x.amount));
  return (
    <section className={card} data-spm-stores>
      <h2 className="mb-2 text-[15px] font-extrabold">{t.spm.byStore}</h2>
      {m.stores.length === 0 ? (
        <p className="py-3 text-[13px] text-muted">{t.spm.noTrips}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {m.stores.map((x) => {
            const def = chainDef(x.chain);
            const name = def ? (locale === "he" ? def.he : def.en) : x.chain ?? "—";
            const color = def ? monoColor(def.color) : "var(--muted)";
            return (
              <li key={`${x.chain}|${x.branch}`} className="flex items-center gap-3 py-1.5" data-spm-store={x.chain ?? ""}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-extrabold text-white" style={{ background: color }}>
                  {(locale === "he" ? def?.monoHe : def?.mono)?.slice(0, 2) ?? name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <b className="bidi min-w-0 flex-1 truncate text-[14px] font-bold">{x.branch ? `${name} · ${x.branch}` : name}</b>
                    <b className="tabular shrink-0 text-[14px] font-extrabold">{money(x.amount)}</b>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <i className="block h-full rounded-full" style={{ width: `${(x.amount / max) * 100}%`, background: color }} />
                    </span>
                    <span className="tabular shrink-0 text-[11.5px] text-muted">{x.trips === 1 ? t.spm.tripOne : f(t.spm.trips, { n: x.trips })}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Products({ m, money }: { m: MonthSpend; money: (n: number) => string }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const day = (at: number) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", timeZone: s.clock.tz }).format(new Date(at));
  return (
    <section className={card} data-spm-products>
      <h2 className="mb-2 text-[15px] font-extrabold">{t.spm.prodTitle}</h2>
      {m.productRows.length === 0 ? (
        <p className="py-3 text-[13px] text-muted">{t.spm.noProducts}</p>
      ) : (
        <ul className="flex flex-col">
          {m.productRows.slice(0, 12).map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => s.openItem(p.id)} className="flex w-full items-center gap-3 py-1.5 text-start" data-spm-product={p.id}>
                <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[color-mix(in_srgb,#2f6fd1_14%,var(--surface))] text-[#2f6fd1]">
                  <Tag className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="bidi block truncate text-[14px] font-bold">{p.title}</b>
                  <span className="bidi block truncate text-[12px] text-muted">{[p.store, day(p.at)].filter(Boolean).join(" · ")}</span>
                </span>
                <b className="tabular shrink-0 text-[14px] font-extrabold">{money(p.value)}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Against({ m, money }: { m: MonthSpend; money: (n: number) => string }) {
  const { t } = useI18n();
  const rows = [
    { k: "sm", label: t.spm.smSoFar, now: m.vsLast.supermarket.now, last: m.vsLast.supermarket.last },
    { k: "prod", label: t.spm.prodSoFar, now: m.vsLast.products.now, last: m.vsLast.products.last },
    { k: "avg", label: t.spm.avgShop, now: m.vsLast.avgShop.now, last: m.vsLast.avgShop.last },
  ];
  return (
    <section className={card} data-spm-against>
      <h2 className="mb-1.5 text-[15px] font-extrabold">{t.spm.against}</h2>
      <ul className="flex flex-col">
        {rows.map((r) => {
          const d = r.now != null && r.last != null ? Math.round(r.now - r.last) : null;
          return (
            <li key={r.k} className="flex min-h-11 items-center gap-2" data-spm-vs={r.k}>
              <span className="min-w-0 flex-1 text-[13.5px] leading-snug">{r.label}</span>
              <b className="tabular text-[14px] font-extrabold">{r.now != null ? money(r.now) : "—"}</b>
              {d != null && d !== 0 && (
                <span className={cn("tabular rounded-full px-2 py-0.5 text-[11.5px] font-bold", d > 0 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
                  {d > 0 ? "+" : "−"}
                  {money(Math.abs(d))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** R18 S5 F5: the last closed month's total (supermarket + products) — "learn the budget from my first month". `on` =
 *  only then is anything fetched; null until known or when there's no closed month with spending yet. */
export function useLastMonthTotal(on: boolean) {
  const s = useStore();
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    if (!on || s.offlineAt != null) return;
    let live = true;
    void smSpending().then((d) => live && setData(d), () => {});
    return () => {
      live = false;
    };
  }, [on, s.offlineAt]);
  return useMemo(() => {
    if (!on || !data) return null;
    const key = shiftKey(monthOf(s.clock.now, data.startDay, s.clock.tz), -1);
    const products: ProductIn[] = s.items
      .filter((i) => i.status !== "to_buy")
      .map((i) => ({ id: i.id, title: i.title, at: spendDate(i) ?? i.updatedAt, value: lineTotal(i, s.rates, s.currency) ?? 0, shipping: 0, store: null }));
    const m = spendingMonth({ key, startDay: data.startDay, tz: s.clock.tz, now: s.clock.now, trips: data.trips, products, cap: null, toCur: (v, cur) => convert(v, cur, s.currency, s.rates) });
    return m.total > 0 ? m.total : null;
  }, [on, data, s.clock, s.items, s.rates, s.currency]);
}
