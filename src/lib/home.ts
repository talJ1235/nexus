// Home (the dashboard, Round 13): every number on the page comes from one pure function, `homeModel`.
// No network, no strings that depend on the language (the UI words them), so scripts/test-home.ts can check it all.
import { capFor, monthForecast, monthKeyIn, monthStartIn, nextMonthKey, type BudgetHistory } from "./budget";
import { activeSource, countable, lineTotal, PRIORITY_RANK, sourceTotal, spendDate } from "./calc";
import { convert, type Rates } from "./money";
import { gapSuggestions, shippingGap, shippingRule } from "./shipping";
import type { Alert, AltGroup, Collection, ItemWithSources, StoreSetting } from "./types";

const DAY = 86_400_000;

// ---------- Calendar days in the user's time zone ("YYYY-MM-DD" keys; arithmetic on UTC dates, so no DST drift) ----------

const fmts = new Map<string, Intl.DateTimeFormat>();
export function dayKeyIn(ms: number, tz: string) {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f.format(new Date(ms));
}
const utcOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const keyOfUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => keyOfUtc(utcOf(key) + n * DAY);
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (key: string) => new Date(utcOf(key)).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((utcOf(b) - utcOf(a)) / DAY);
const daysInMonth = (monthKey: string) => {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** The 7 day keys of the week holding `today` (Sunday-first, or Monday-first when the locale says so). */
export function weekDays(today: string, weekStartsOn: 0 | 1 = 0) {
  const start = addDays(today, -((weekdayOf(today) - weekStartsOn + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Same product bought again: case/punctuation-insensitive title. */
export const normName = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---------- B4: the 4-segment delivery track (Ordered · Shipped · In country · Delivered) ----------

export type Track = { filled: 0 | 1 | 2 | 3 | 4; tone: "info" | "warn" | "ok" | "faint"; late: boolean; noDate: boolean };

/**
 * We have no carrier stages, so the fill is time-based: elapsed / (eta − orderedAt) over the first three segments
 * (Ordered → Shipped → In country); only a received item fills the fourth. Late (eta day before today) fills all
 * four in the warn colour. No eta → "No date" and one segment.
 */
export function deliveryTrack(i: Pick<ItemWithSources, "status" | "orderedAt" | "eta" | "updatedAt" | "createdAt">, now: number, tz: string): Track {
  if (i.status === "purchased") return { filled: 4, tone: "ok", late: false, noDate: false };
  if (i.status !== "ordered") return { filled: 0, tone: "faint", late: false, noDate: i.eta == null };
  if (i.eta == null) return { filled: 1, tone: "faint", late: false, noDate: true };
  if (dayKeyIn(i.eta, tz) < dayKeyIn(now, tz)) return { filled: 4, tone: "warn", late: true, noDate: false };
  const start = i.orderedAt ?? i.updatedAt ?? i.createdAt;
  const span = i.eta - start;
  const frac = span > 0 ? (now - start) / span : 1;
  const filled = Math.max(1, Math.min(3, 1 + Math.floor(Math.max(0, frac) * 3))) as 1 | 2 | 3;
  return { filled, tone: "info", late: false, noDate: false };
}

// ---------- A2: reorder cadence ----------

export type Cadence = { interval: number; last: number; due: number; count: number };

/** Purchases (ms) → the median gap; needs ≥ 3 buys (2 buys = one gap, not a habit). */
export function cadenceOf(buys: number[]): Cadence | null {
  const s = [...new Set(buys)].sort((a, b) => a - b);
  if (s.length < 3) return null;
  const gaps = s.slice(1).map((t, k) => t - s[k]);
  const interval = median(gaps)!;
  if (interval < DAY) return null;
  const last = s[s.length - 1];
  return { interval, last, due: last + interval, count: s.length };
}

export type ReorderDue = { key: string; name: string; item: ItemWithSources; cadence: Cadence };

/** Things bought ≥ 3 times whose next buy is due within ±3 days of now, and that aren't on the list already. */
export function reorderDue(items: ItemWithSources[], now: number): ReorderDue[] {
  const groups = new Map<string, ItemWithSources[]>();
  const open = new Set<string>();
  for (const i of items) {
    const k = normName(i.title);
    if (!k) continue;
    if (i.status !== "purchased") {
      open.add(k);
      continue;
    }
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: ReorderDue[] = [];
  for (const [k, list] of groups) {
    if (open.has(k)) continue;
    const cadence = cadenceOf(list.map((i) => i.purchasedAt ?? spendDate(i) ?? i.updatedAt));
    if (!cadence || Math.abs(now - cadence.due) > 3 * DAY) continue;
    const item = [...list].sort((a, b) => (b.purchasedAt ?? 0) - (a.purchasedAt ?? 0))[0];
    out.push({ key: `reorder:${k}`, name: k, item, cadence });
  }
  return out.sort((a, b) => a.cadence.due - b.cadence.due);
}

// ---------- Savings: price drops on what you bought + free shipping reached ----------

type Savings = { drops: number; freeShipping: number; total: number; best: { storeKey: string; store: string; saved: number; count: number } | null };

function savingsBetween(items: ItemWithSources[], from: number, to: number, input: Pick<HomeInput, "rates" | "currency" | "storeSettings" | "tz">): Savings {
  const { rates, currency, storeSettings, tz } = input;
  let drops = 0;
  const orders = new Map<string, { storeKey: string; store: string; total: number; count: number }>();
  for (const i of items) {
    if (i.status === "to_buy") continue;
    const at = spendDate(i);
    if (at == null || at < from || at >= to) continue;
    const src = (i.chosenSourceId && i.sources.find((s) => s.id === i.chosenSourceId)) || activeSource(i, rates);
    if (!src) continue;
    if (i.purchasedPrice != null) {
      const first = i.points.filter((p) => p.sourceId === src.id).sort((a, b) => a.recordedAt - b.recordedAt)[0];
      if (first) {
        const was = convert(first.price + (src.shipping ?? 0), first.currency, currency, rates);
        const paid = convert(i.purchasedPrice, i.purchasedCurrency ?? first.currency, currency, rates);
        if (was - paid > 0.005) drops += (was - paid) * i.quantity;
      }
    }
    // One order = same store, same order number (else the same day).
    const key = `${src.storeKey}|${i.orderNumber ?? dayKeyIn(at, tz)}`;
    const o = orders.get(key) ?? { storeKey: src.storeKey, store: src.store, total: 0, count: 0 };
    o.total += lineTotal(i, rates, currency) ?? 0;
    o.count++;
    orders.set(key, o);
  }
  let freeShipping = 0;
  let best: Savings["best"] = null;
  for (const o of orders.values()) {
    const rule = shippingRule(o.storeKey, storeSettings);
    // Counted only when the fee is known: without it we'd be inventing the saving.
    if (!rule || rule.shippingFee == null || rule.shippingFee <= 0 || rule.freeShippingMin == null) continue;
    if (!shippingGap(o.total, rule, rates, currency).free) continue;
    const fee = convert(rule.shippingFee, rule.currency, currency, rates);
    freeShipping += fee;
    if (!best || fee > best.saved) best = { storeKey: o.storeKey, store: o.store, saved: fee, count: o.count };
  }
  return { drops, freeShipping, total: drops + freeShipping, best };
}

// ---------- Prices by weekday ----------

/** Average price relative to each link's own median, per weekday (0 = Sun). Null below `min` points. */
function weekdayLows(points: { price: number; at: number; sourceId: string }[], tz: string, min = 8) {
  if (points.length < min) return null;
  const bySource = new Map<string, number[]>();
  for (const p of points) bySource.set(p.sourceId, [...(bySource.get(p.sourceId) ?? []), p.price]);
  const med = new Map([...bySource].map(([k, v]) => [k, median(v)!]));
  const sum = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  for (const p of points) {
    const m = med.get(p.sourceId)!;
    if (!(m > 0)) continue;
    const d = weekdayOf(dayKeyIn(p.at, tz));
    sum[d] += p.price / m;
    cnt[d]++;
  }
  const days = sum.map((s, d) => (cnt[d] ? { day: d, avg: s / cnt[d], n: cnt[d] } : null)).filter((x): x is { day: number; avg: number; n: number } => !!x);
  if (days.length < 2) return null;
  const overall = days.reduce((a, b) => a + b.avg * b.n, 0) / days.reduce((a, b) => a + b.n, 0);
  const low = days.reduce((a, b) => (b.avg < a.avg ? b : a));
  return { day: low.day, pct: overall > 0 ? (overall - low.avg) / overall : 0 };
}

// ---------- The model ----------

export type HomeInput = {
  items: ItemWithSources[];
  alerts: Alert[];
  budget: BudgetHistory;
  storeSettings: StoreSetting[];
  rates: Rates;
  now: number;
  tz: string;
  collections: Collection[];
  altGroups: AltGroup[];
  currency: string;
  weekStartsOn?: 0 | 1;
  /** Row/suggestion key → hidden until (ms): "✕" on a Needs-you row, "Not now" on a suggestion. */
  dismissed?: Record<string, number>;
};

export type Segment = { key: string; value: number; collectionId: string | null };

export type NeedRow =
  | { key: string; kind: "alert"; alert: Alert; item: ItemWithSources }
  | { key: string; kind: "late"; item: ItemWithSources; daysLate: number }
  | { key: string; kind: "ship"; storeKey: string; store: string; remaining: number; add: ItemWithSources; adds: number; apply: { chosenSourceId: string } | { priority: "normal" } }
  | { key: string; kind: "reorder"; item: ItemWithSources; due: number };

export type WeekEvent =
  | { kind: "late"; item: ItemWithSources; day: string }
  | { kind: "arrive"; item: ItemWithSources; day: string }
  | { kind: "reorder"; item: ItemWithSources; day: string }
  | { kind: "deal"; item: ItemWithSources; alert: Alert; day: string }
  | { kind: "budget"; left: number; day: string };

export type Package = { item: ItemWithSources; track: Track; store: string | null; price: number | null };

export type ProjectRow = { collection: Collection; pctBought: number; left: number; spent: number; next: ItemWithSources | null; activity: number };

export type Insight =
  | { key: string; kind: "batch"; store: string; storeKey: string; saved: number; count: number }
  | { key: string; kind: "weekday"; category: string; day: number; pct: number }
  | { key: string; kind: "no_budget"; collection: Collection; min: number; max: number }
  // Round 14 A2: the AI's own observations, then the broad rule fallbacks.
  | { key: string; kind: "ai"; text: string; action?: { type: "open" | "add" | "budget"; itemId?: string; collectionId?: string } }
  | { key: string; kind: "top_store"; store: string; amount: number; total: number }
  | { key: string; kind: "top_category"; category: string; amount: number; total: number }
  | { key: string; kind: "big_project"; collection: Collection; left: number }
  | { key: string; kind: "waiting"; count: number; amount: number };

export type HomeModel = ReturnType<typeof homeModel>;

export function homeModel(input: HomeInput) {
  const { items, alerts, budget, storeSettings, rates, now, tz, collections, altGroups, currency } = input;
  const dismissed = input.dismissed ?? {};
  const hidden = (key: string) => (dismissed[key] ?? 0) > now;
  const today = dayKeyIn(now, tz);
  const days = weekDays(today, input.weekStartsOn ?? 0);
  const inWeek = (key: string) => key >= days[0] && key <= days[6];
  const month = monthKeyIn(now, tz);
  const monthFrom = monthStartIn(month, tz);
  const monthTo = monthStartIn(nextMonthKey(month), tz);
  const year = month.slice(0, 4);
  const yearFrom = monthStartIn(`${year}-01`, tz);
  const yearTo = monthStartIn(`${Number(year) + 1}-01`, tz);
  const empty = items.length === 0;

  const toBuyAll = items.filter((i) => i.status === "to_buy");
  const toBuy = countable(toBuyAll, altGroups, rates);
  const ordered = items.filter((i) => i.status === "ordered");

  // ----- Stat 1: left to buy, split by project (top 3 + other).
  let leftTotal = 0;
  const byColl = new Map<string, number>();
  for (const i of toBuy) {
    const v = lineTotal(i, rates, currency);
    if (v == null) continue;
    leftTotal += v;
    byColl.set(i.collectionId ?? "", (byColl.get(i.collectionId ?? "") ?? 0) + v);
  }
  const ranked = [...byColl].filter(([k]) => k && collections.some((c) => c.id === k)).sort((a, b) => b[1] - a[1]);
  const segments: Segment[] = ranked.slice(0, 3).map(([k, v]) => ({ key: k, value: v, collectionId: k }));
  const other = leftTotal - segments.reduce((a, b) => a + b.value, 0);
  if (other > 0.005) segments.push({ key: "other", value: other, collectionId: null });
  const leftToBuy = { total: leftTotal, count: toBuy.length, urgent: toBuy.filter((i) => i.priority === "urgent").length, segments };

  // ----- Stat 2 + pace: this month against the cap (monthForecast) and against a usual month.
  const cap = capFor(month, budget);
  const fc = monthForecast({ items, altGroups, rates, currency, from: monthFrom, to: monthTo, cap, includeNormal: false });
  const spentMonth = fc.spent + fc.committed;
  const dim = daysInMonth(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysToGo = dim - dayOfMonth;
  // Cumulative spend per day of month, for this month and each of the 6 before (only months since the first spend).
  const spends = items
    .filter((i) => i.status !== "to_buy")
    .map((i) => ({ at: spendDate(i) ?? i.updatedAt, v: lineTotal(i, rates, currency) ?? 0 }))
    .filter((x) => x.v > 0);
  const firstSpend = spends.reduce((a, b) => Math.min(a, b.at), Infinity);
  const curve = (key: string) => {
    const from = monthStartIn(key, tz);
    const to = monthStartIn(nextMonthKey(key), tz);
    const n = daysInMonth(key);
    const perDay = Array(n).fill(0);
    for (const x of spends) if (x.at >= from && x.at < to) perDay[Number(dayKeyIn(x.at, tz).slice(8, 10)) - 1] += x.v;
    let acc = 0;
    return { to, cum: perDay.map((v) => (acc += v)) };
  };
  const prevMonths: string[] = [];
  for (let k = month, n = 0; n < 6; n++) {
    const [y, m] = k.split("-").map(Number);
    k = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    prevMonths.push(k);
  }
  const history = prevMonths.map(curve).filter((c) => c.to > firstSpend);
  // Usual month: per day of month, the median of the earlier months' running totals (a shorter month carries its end).
  const usualCurve = history.length ? Array.from({ length: dim }, (_, d) => median(history.map((h) => h.cum[Math.min(d, h.cum.length - 1)]))!) : null;
  const usualMonth = usualCurve ? usualCurve[dim - 1] : null;
  const usualToDate = usualCurve ? usualCurve[dayOfMonth - 1] : null;
  const thisCurve = curve(month).cum.slice(0, dayOfMonth);
  const spentToDate = thisCurve[thisCurve.length - 1] ?? 0;
  const speed: "slower" | "faster" | "usual" | null =
    usualToDate == null || usualToDate <= 0 ? null : spentToDate < usualToDate * 0.9 ? "slower" : spentToDate > usualToDate * 1.1 ? "faster" : "usual";
  const budgetStat = {
    cap: fc.cap,
    spent: spentMonth,
    left: fc.cap != null ? fc.cap - spentMonth : null,
    daysToGo,
    todayFrac: dayOfMonth / dim,
    usual: usualMonth,
    vsUsualPct: usualMonth && usualMonth > 0 ? (spentMonth - usualMonth) / usualMonth : null,
  };
  const pace = {
    month,
    dim,
    dayOfMonth,
    spent: thisCurve,
    usual: usualCurve,
    cap: fc.cap,
    projected: fc.total,
    /** cap − projected month total (+ = under budget). Null without a cap. */
    delta: fc.cap != null ? fc.cap - fc.total : null,
    speed,
    state: fc.state,
  };

  // ----- Stat 3 + On the way: packages, late first, then by eta; no eta last.
  const packages: Package[] = ordered
    .map((item) => {
      const src = activeSource(item, rates);
      return { item, track: deliveryTrack(item, now, tz), store: src?.store ?? null, price: lineTotal(item, rates, currency) };
    })
    .sort((a, b) => Number(b.track.late) - Number(a.track.late) || (a.item.eta ?? Infinity) - (b.item.eta ?? Infinity));
  const late = packages.filter((p) => p.track.late);
  const upcoming = packages.filter((p) => !p.track.late && p.item.eta != null);
  const thisWeekPkgs = packages.filter((p) => p.item.eta != null && inWeek(dayKeyIn(p.item.eta, tz)));
  const onTheWay = {
    count: packages.length,
    next: upcoming[0]?.item.eta ?? null,
    late: late.length,
    pips: packages.map((p) => (p.track.late ? "late" : p.item.eta != null && inWeek(dayKeyIn(p.item.eta, tz)) ? "week" : "later") as "late" | "week" | "later"),
  };

  // ----- Stat 4: saved this year (and this month).
  const savedYear = savingsBetween(items, yearFrom, yearTo, input);
  const savedMonth = savingsBetween(items, monthFrom, monthTo, input);
  const saved = { total: savedYear.total, drops: savedYear.drops, freeShipping: savedYear.freeShipping, month: savedMonth.total };

  // ----- Needs you (ranked): price alerts → late deliveries → a small free-shipping gap → reorder due.
  const byId = new Map(items.map((i) => [i.id, i]));
  const needs: NeedRow[] = [];
  const alertSeen = new Set<string>();
  for (const a of [...alerts].sort((x, y) => y.createdAt - x.createdAt)) {
    if (a.readAt || !["drop", "target", "back_in_stock"].includes(a.kind) || alertSeen.has(a.itemId)) continue;
    const item = byId.get(a.itemId);
    if (!item || item.status !== "to_buy") continue;
    alertSeen.add(a.itemId);
    needs.push({ key: `alert:${a.id}`, kind: "alert", alert: a, item });
  }
  for (const p of late) needs.push({ key: `late:${p.item.id}`, kind: "late", item: p.item, daysLate: daysBetween(dayKeyIn(p.item.eta!, tz), today) });
  {
    const order = toBuyAll.filter((i) => i.priority !== "someday");
    const leftOut = toBuyAll.filter((i) => i.priority === "someday");
    const stores = new Map<string, { store: string; total: number }>();
    for (const i of countable(order, altGroups, rates)) {
      const src = activeSource(i, rates);
      if (!src?.url) continue;
      const g = stores.get(src.storeKey) ?? { store: src.store, total: 0 };
      g.total += lineTotal(i, rates, currency) ?? 0;
      stores.set(src.storeKey, g);
    }
    for (const [storeKey, g] of stores) {
      const gap = shippingGap(g.total, shippingRule(storeKey, storeSettings), rates, currency);
      if (gap.threshold == null || gap.free || gap.remaining > gap.threshold * 0.3) continue;
      const sug = gapSuggestions(storeKey, gap, order, leftOut, rates, currency).find((x) => x.closes);
      if (!sug) continue;
      needs.push({
        key: `ship:${storeKey}:${sug.item.id}`,
        kind: "ship",
        storeKey,
        store: g.store,
        remaining: gap.remaining,
        add: sug.item,
        adds: sug.adds,
        apply: sug.kind === "switch" ? { chosenSourceId: sug.sourceId } : { priority: "normal" },
      });
    }
  }
  const reorders = reorderDue(items, now);
  for (const r of reorders) needs.push({ key: r.key, kind: "reorder", item: r.item, due: r.cadence.due });
  const queue = needs.filter((n) => !hidden(n.key));

  // ----- This week: arrivals, late (on today), reorder, open price drops, the budget week close.
  const events: WeekEvent[] = [];
  for (const p of packages) {
    if (p.item.eta == null) continue;
    if (p.track.late) events.push({ kind: "late", item: p.item, day: today });
    else {
      const d = dayKeyIn(p.item.eta, tz);
      if (inWeek(d)) events.push({ kind: "arrive", item: p.item, day: d });
    }
  }
  for (const r of reorders) {
    const d = dayKeyIn(r.cadence.due, tz);
    events.push({ kind: "reorder", item: r.item, day: d < today ? today : d });
  }
  for (const n of needs) {
    if (n.kind !== "alert" || n.alert.kind === "back_in_stock") continue;
    // Still open: the price is at or under the alert's new price.
    const src = activeSource(n.item, rates);
    const t = src ? sourceTotal(src) : null;
    if (n.alert.newPrice != null && src?.price != null && src.price > n.alert.newPrice + 0.005) continue;
    if (t == null && n.alert.newPrice == null) continue;
    const d = dayKeyIn(n.alert.createdAt, tz);
    events.push({ kind: "deal", item: n.item, alert: n.alert, day: inWeek(d) && d >= today ? d : today });
  }
  if (fc.cap != null) events.push({ kind: "budget", left: fc.cap - spentMonth, day: days[6] });
  const order = { late: 0, deal: 1, arrive: 2, reorder: 3, budget: 4 } as const;
  events.sort((a, b) => a.day.localeCompare(b.day) || order[a.kind] - order[b.kind]);
  const week = { days, today, events: events.filter((e) => inWeek(e.day)) };

  // ----- Projects: % bought by money, money left, next item; top 3 by recent activity.
  const projects: ProjectRow[] = collections
    .filter((c) => !c.archived)
    .map((c) => {
      const mine = items.filter((i) => i.collectionId === c.id);
      const open = countable(mine.filter((i) => i.status === "to_buy"), altGroups, rates);
      const left = open.reduce((a, i) => a + (lineTotal(i, rates, currency) ?? 0), 0);
      const spent = mine.filter((i) => i.status !== "to_buy").reduce((a, i) => a + (lineTotal(i, rates, currency) ?? 0), 0);
      const next =
        [...open].sort(
          (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (lineTotal(a, rates, currency) ?? Infinity) - (lineTotal(b, rates, currency) ?? Infinity),
        )[0] ?? null;
      const activity = Math.max(c.createdAt, ...mine.map((i) => i.updatedAt));
      return { collection: c, pctBought: left + spent > 0 ? spent / (left + spent) : 0, left, spent, next, activity, count: mine.length };
    })
    .filter((p) => p.count > 0)
    .sort((a, b) => b.activity - a.activity)
    .slice(0, 3)
    .map(({ count: _, ...p }) => p);

  // ----- Nexus noticed (A4): only insights whose facts exist.
  const noticed: Insight[] = [];
  if (savedMonth.best) noticed.push({ key: `batch:${month}:${savedMonth.best.storeKey}`, kind: "batch", ...savedMonth.best });
  {
    const byCat = new Map<string, { price: number; at: number; sourceId: string }[]>();
    for (const i of items) {
      if (!i.category || !i.watch) continue;
      const arr = byCat.get(i.category) ?? [];
      for (const p of i.points) arr.push({ price: p.price, at: p.recordedAt, sourceId: p.sourceId });
      byCat.set(i.category, arr);
    }
    let best: Insight | null = null;
    for (const [category, pts] of byCat) {
      const low = weekdayLows(pts, tz);
      if (low && low.pct >= 0.03 && (!best || (best.kind === "weekday" && low.pct > best.pct))) best = { key: `weekday:${category}`, kind: "weekday", category, day: low.day, pct: low.pct };
    }
    if (best) noticed.push(best);
  }
  const noBudget = noBudgetProject(collections, items, altGroups, rates, currency);
  if (noBudget) noticed.push({ key: `nobudget:${noBudget.collection.id}`, kind: "no_budget", ...noBudget });

  const status = {
    needYou: queue.length ? { count: queue.length, kinds: [...new Set(queue.map((q) => q.kind))] } : null,
    packages: thisWeekPkgs.length || late.length ? { count: thisWeekPkgs.length, next: upcoming.find((p) => inWeek(dayKeyIn(p.item.eta!, tz)))?.item.eta ?? null, late: late.length, lateName: late[0]?.item.title ?? null } : null,
    pace: pace.delta != null ? { delta: pace.delta, state: fc.state } : null,
  };

  return {
    empty,
    today,
    month,
    status,
    stats: { leftToBuy, budget: budgetStat, onTheWay, saved },
    week,
    needs: queue,
    packages,
    pace,
    projects,
    noticed,
    /** Inputs the suggestions need (kept here so homeSuggestions(model) stays pure). */
    ctx: { items, toBuy, collections, altGroups, rates, currency, tz, now, storeSettings, needsAll: needs, dismissed },
  };
}

/** A project with things to buy and no budget, while ≥ 2 other projects show what similar ones cost. */
function noBudgetProject(collections: Collection[], items: ItemWithSources[], altGroups: AltGroup[], rates: Rates, currency: string) {
  const projects = collections.filter((c) => c.kind === "project" && !c.archived);
  const cost = (c: Collection) => {
    const mine = items.filter((i) => i.collectionId === c.id);
    const open = countable(mine.filter((i) => i.status === "to_buy"), altGroups, rates);
    return [...open, ...mine.filter((i) => i.status !== "to_buy")].reduce((a, i) => a + (lineTotal(i, rates, currency) ?? 0), 0);
  };
  const target = projects.find((c) => c.budget == null && items.some((i) => i.collectionId === c.id && i.status === "to_buy"));
  if (!target) return null;
  const others = projects
    .filter((c) => c.id !== target.id)
    .map((c) => (c.budget != null ? convert(c.budget, c.budgetCurrency, currency, rates) : cost(c)))
    .filter((v) => v > 0);
  if (others.length < 2) return null;
  return { collection: target, min: Math.min(...others), max: Math.max(...others) };
}

// ---------- A3: "Nexus suggests" — rules find, AI phrases ----------

export type SuggestionKind = "deal" | "reorder" | "wait" | "budget" | "ai" | "set_budget" | "target" | "eta" | "stale" | "extension" | "receipt";
export type Suggestion = {
  key: string;
  kind: SuggestionKind;
  score: number;
  /** Plain facts for the AI phrasing (no wording) and the template. */
  facts: Record<string, string | number | null>;
  /** What the primary button does. */
  action:
    | { type: "order"; itemId: string; partner: { itemId: string; apply: { chosenSourceId: string } | { priority: "normal" } } | null }
    | { type: "add"; itemId: string }
    | { type: "open"; itemId: string }
    | { type: "budget"; collectionId: string }
    | { type: "cmd"; cmd: "monthly_budget" | "extension" | "receipt" }
    | { type: "none" };
};

/** Usual price of an item's active link: the median of its recorded prices (needs ≥ 3 readings). */
function usualPrice(i: ItemWithSources, rates: Rates) {
  const src = activeSource(i, rates);
  if (!src || src.price == null) return null;
  const pts = i.points.filter((p) => p.sourceId === src.id);
  if (pts.length < 3) return null;
  return { src, usual: median(pts.map((p) => p.price))!, now: src.price };
}

/** Ranked candidates (at most 4), each with a stable key; snoozed keys ("Not now", 7 days) are left out. */
export function homeSuggestions(model: HomeModel): Suggestion[] {
  const { toBuy, rates, currency, tz, now, needsAll, dismissed, items, collections, altGroups } = model.ctx;
  const out: Suggestion[] = [];
  const shipByStore = new Map(needsAll.filter((n) => n.kind === "ship").map((n) => [(n as Extract<NeedRow, { kind: "ship" }>).storeKey, n as Extract<NeedRow, { kind: "ship" }>]));
  for (const i of toBuy) {
    const u = usualPrice(i, rates);
    if (!u || !(u.usual > 0)) continue;
    const pct = (u.usual - u.now) / u.usual;
    if (pct < 0.1) continue;
    const ship = shipByStore.get(u.src.storeKey);
    const partner = ship && ship.add.id !== i.id ? ship : null;
    out.push({
      key: `deal:${i.id}:${Math.round(u.now * 100)}`,
      kind: "deal",
      score: 300 + pct * 100 + (partner ? 50 : 0),
      facts: { item: i.title, pct: Math.round(pct * 100), store: u.src.store, partner: partner?.add.title ?? null, freeShipping: partner ? 1 : 0, saving: Math.round(convert(u.usual - u.now, u.src.currency, currency, rates) * i.quantity) },
      action: { type: "order", itemId: i.id, partner: partner ? { itemId: partner.add.id, apply: partner.apply } : null },
    });
  }
  for (const r of reorderDue(items, now)) {
    out.push({
      key: r.key,
      kind: "reorder",
      score: 200 - Math.abs(now - r.cadence.due) / DAY,
      facts: { item: r.item.title, everyDays: Math.round(r.cadence.interval / DAY), times: r.cadence.count },
      action: { type: "add", itemId: r.item.id },
    });
  }
  const todayDay = weekdayOf(dayKeyIn(now, tz));
  for (const i of toBuy) {
    const src = activeSource(i, rates);
    if (!src) continue;
    const pts = i.points.filter((p) => p.sourceId === src.id).map((p) => ({ price: p.price, at: p.recordedAt, sourceId: p.sourceId }));
    const low = weekdayLows(pts, tz);
    if (!low || low.pct < 0.05 || low.day === todayDay) continue;
    out.push({ key: `wait:${i.id}:${low.day}`, kind: "wait", score: 100 + low.pct * 100, facts: { item: i.title, day: low.day, pct: Math.round(low.pct * 100) }, action: { type: "open", itemId: i.id } });
  }
  const nb = noBudgetProject(collections, items, altGroups, rates, currency);
  if (nb) out.push({ key: `budget:${nb.collection.id}`, kind: "budget", score: 50, facts: { project: nb.collection.name, min: Math.round(nb.min), max: Math.round(nb.max) }, action: { type: "budget", collectionId: nb.collection.id } });
  return out.filter((x) => !((dismissed[`sug:${x.key}`] ?? 0) > now)).sort((a, b) => b.score - a.score).slice(0, 4);
}

// ---------- Round 14 A2: Home always has a voice — broad rule fallbacks, merged with the AI's look ----------

export const WAITING_MS = 30 * DAY;

/** Things the model doesn't hold: is the extension connected (null = not applicable, e.g. phones), receipts so far. */
export type HomeEnv = { extension: boolean | null; receipts: number | null };

/** Broad suggestions, each only when its facts exist (shown after the exact rules and the AI). */
export function fallbackSuggestions(model: HomeModel, env: HomeEnv): Suggestion[] {
  const { items, toBuy, rates, currency, now, dismissed } = model.ctx;
  const out: Suggestion[] = [];
  if (model.stats.budget.cap == null) out.push({ key: `fb:budget:${model.month}`, kind: "set_budget", score: 0, facts: {}, action: { type: "cmd", cmd: "monthly_budget" } });
  const priciest = [...toBuy].filter((i) => i.targetPrice == null).sort((a, b) => (lineTotal(b, rates, currency) ?? 0) - (lineTotal(a, rates, currency) ?? 0))[0];
  if (priciest && (lineTotal(priciest, rates, currency) ?? 0) > 0)
    out.push({ key: `fb:target:${priciest.id}`, kind: "target", score: 0, facts: { item: priciest.title }, action: { type: "open", itemId: priciest.id } });
  const noEta = items.filter((i) => i.status === "ordered" && i.eta == null).sort((a, b) => (a.orderedAt ?? a.updatedAt) - (b.orderedAt ?? b.updatedAt));
  if (noEta.length) out.push({ key: `fb:eta:${noEta[0].id}`, kind: "eta", score: 0, facts: { item: noEta[0].title, n: noEta.length }, action: { type: "open", itemId: noEta[0].id } });
  const stale = toBuy.filter((i) => now - i.createdAt > WAITING_MS).sort((a, b) => a.createdAt - b.createdAt);
  if (stale.length) out.push({ key: `fb:stale:${stale[0].id}`, kind: "stale", score: 0, facts: { item: stale[0].title, days: Math.floor((now - stale[0].createdAt) / DAY) }, action: { type: "open", itemId: stale[0].id } });
  if (env.extension === false) out.push({ key: "fb:extension", kind: "extension", score: 0, facts: {}, action: { type: "cmd", cmd: "extension" } });
  if (env.receipts === 0) out.push({ key: "fb:receipt", kind: "receipt", score: 0, facts: {}, action: { type: "cmd", cmd: "receipt" } });
  return out.filter((x) => !((dismissed[`sug:${x.key}`] ?? 0) > now));
}

/** Broad insights: this month's top store (else category) by spend, the most expensive open project, long waits. */
export function fallbackInsights(model: HomeModel): Insight[] {
  const { items, toBuy, collections, rates, currency, tz, now } = model.ctx;
  const out: Insight[] = [];
  const byStore = new Map<string, number>();
  const byCat = new Map<string, number>();
  let total = 0;
  for (const i of items) {
    if (i.status === "to_buy") continue;
    const at = spendDate(i);
    if (at == null || monthKeyIn(at, tz) !== model.month) continue;
    const v = lineTotal(i, rates, currency) ?? 0;
    if (v <= 0) continue;
    total += v;
    const store = activeSource(i, rates)?.store;
    if (store) byStore.set(store, (byStore.get(store) ?? 0) + v);
    if (i.category) byCat.set(i.category, (byCat.get(i.category) ?? 0) + v);
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0];
  const store = top(byStore);
  const cat = top(byCat);
  if (store) out.push({ key: `top:${model.month}:${store[0]}`, kind: "top_store", store: store[0], amount: store[1], total });
  else if (cat) out.push({ key: `topcat:${model.month}:${cat[0]}`, kind: "top_category", category: cat[0], amount: cat[1], total });
  let big: { collection: Collection; left: number } | null = null;
  for (const c of collections) {
    if (c.archived) continue;
    const left = countable(toBuy.filter((i) => i.collectionId === c.id), model.ctx.altGroups, rates).reduce((a, i) => a + (lineTotal(i, rates, currency) ?? 0), 0);
    if (left > 0 && (!big || left > big.left)) big = { collection: c, left };
  }
  if (big) out.push({ key: `big:${big.collection.id}`, kind: "big_project", ...big });
  const waiting = toBuy.filter((i) => now - i.createdAt > WAITING_MS);
  if (waiting.length) out.push({ key: "waiting", kind: "waiting", count: waiting.length, amount: waiting.reduce((a, i) => a + (lineTotal(i, rates, currency) ?? 0), 0) });
  return out;
}

/** The order inside each section: exact rules, then the AI, then the fallbacks; at most 4 suggestions and 3 insights. */
export function mergeHome<T extends { key: string }>(rules: T[], ai: T[], fallbacks: T[], max: number): T[] {
  const seen = new Set<string>();
  return [...rules, ...ai, ...fallbacks].filter((x) => !seen.has(x.key) && !!seen.add(x.key)).slice(0, max);
}

/** "✕" on a row / "Not now" on a suggestion hides it this long. */
export const HIDE_MS = 7 * DAY;

export type HomePrefs = {
  /** Row / suggestion key ("sug:…") → hidden until (ms). kv `pref:home:dismissed`. */
  dismissed: Record<string, number>;
  /** Phrase "Nexus suggests" with the AI once a day (on by default); off = templates only. kv `pref:home:ai`. */
  aiSuggestions: boolean;
};
export const DEFAULT_HOME_PREFS: HomePrefs = { dismissed: {}, aiSuggestions: true };
