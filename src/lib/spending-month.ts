// R18 S5 E1 + E2 — one month of the space's spending (Insights → Spending): the supermarket (finished trips, every
// member), Products (bought / ordered items) and delivery, cumulative per day, by section / store / product, against the
// month before. A month starts on the budget's start day (F5; 1 = calendar months). Pure + client-safe; amounts are
// converted with the caller's `toCur` (the space's currency). Unit test: scripts/test-spending.ts.

/** The space's budget month start day (F5; space pref, 1–28; missing = 1, calendar months). */
export const BUDGET_START_KEY = "pref:budget-start";

export type TripIn = { id: string; userId: string; chain: string | null; branch: string | null; finishedAt: number; total: number | null; currency: string; items: { productKey: string; title: string; section: string | null; price: number | null; qty: number; state: "bought" | "not_found" }[] };
export type ProductIn = { id: string; title: string; at: number; value: number; shipping: number; store: string | null };

const DAY = 86_400_000;
const parts = (ms: number, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return p as Record<"year" | "month" | "day" | "hour" | "minute", number>;
};
/** Local midnight of y-m-d in `tz` (days past the month's end roll over, like Date.UTC). */
export function localMidnight(y: number, m: number, d: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d);
  const p = parts(guess, tz);
  return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess);
}
const clampDay = (d: number | null | undefined) => Math.max(1, Math.min(28, Math.round(d ?? 1) || 1));
export const shiftKey = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/** The budget month a moment falls in: before the start day it still belongs to the previous month. */
export function monthOf(ms: number, startDay: number, tz: string) {
  const p = parts(ms, tz);
  const key = `${p.year}-${String(p.month).padStart(2, "0")}`;
  return p.day < clampDay(startDay) ? shiftKey(key, -1) : key;
}

/** [from, to) of a budget month and how many days it has. */
export function monthRange(key: string, startDay: number, tz: string) {
  const [y, m] = key.split("-").map(Number);
  const d = clampDay(startDay);
  const from = localMidnight(y, m, d, tz);
  const to = localMidnight(y, m + 1, d, tz);
  return { from, to, days: Math.round((to - from) / DAY) };
}

export type MonthSpend = ReturnType<typeof spendingMonth>;

export function spendingMonth(o: { key: string; startDay: number; tz: string; now: number; trips: TripIn[]; products: ProductIn[]; cap: number | null; toCur: (amount: number, cur: string) => number }) {
  const { from, to, days } = monthRange(o.key, o.startDay, o.tz);
  const closed = o.now >= to;
  const dayIdx = (at: number) => Math.max(0, Math.min(days - 1, Math.floor((at - from) / DAY)));
  const todayIdx = closed ? days - 1 : dayIdx(o.now);
  const prev = monthRange(shiftKey(o.key, -1), o.startDay, o.tz);
  // The same point of last month (in progress: as many days in), for the delta chip and "so far".
  const sameDay = closed ? prev.to : Math.min(prev.to, prev.from + (o.now - from));

  const tripValue = (t: TripIn) => {
    const sum = t.items.reduce((a, i) => a + (i.state === "bought" && i.price != null ? i.price : 0), 0);
    return o.toCur(t.total ?? sum, t.currency);
  };
  const inRange = <T extends { at: number }>(xs: T[], a: number, b: number) => xs.filter((x) => x.at >= a && x.at < b);
  const trips = o.trips.map((t) => ({ t, at: t.finishedAt, value: tripValue(t) }));
  const cur = inRange(trips, from, Math.min(to, closed ? to : o.now + 1));
  const last = inRange(trips, prev.from, prev.to);
  const lastSoFar = inRange(trips, prev.from, sameDay);
  const prods = o.products.map((p) => ({ ...p }));
  const pCur = inRange(prods, from, to);
  const pLastSoFar = inRange(prods, prev.from, sameDay);
  const pLast = inRange(prods, prev.from, prev.to);

  const supermarket = cur.reduce((a, x) => a + x.value, 0);
  const products = pCur.reduce((a, x) => a + x.value - x.shipping, 0);
  const delivery = pCur.reduce((a, x) => a + x.shipping, 0);
  const total = supermarket + products + delivery;
  const lastTotal = last.reduce((a, x) => a + x.value, 0) + pLast.reduce((a, x) => a + x.value, 0);
  const lastSoFarTotal = lastSoFar.reduce((a, x) => a + x.value, 0) + pLastSoFar.reduce((a, x) => a + x.value, 0);

  // Cumulative per day (up to today while the month runs).
  const daily = Array.from({ length: days }, () => 0);
  for (const x of cur) daily[dayIdx(x.at)] += x.value;
  for (const x of pCur) daily[dayIdx(x.at)] += x.value;
  const cumulative: number[] = [];
  let run = 0;
  for (let k = 0; k <= todayIdx; k++) cumulative.push((run += daily[k]));

  // By section (bought lines with a price), with last month's amount and the biggest items.
  const secOf = (xs: typeof cur) => {
    const m = new Map<string, { amount: number; items: Map<string, { title: string; amount: number }> }>();
    for (const { t } of xs)
      for (const i of t.items) {
        if (i.state !== "bought" || i.price == null) continue;
        const k = i.section ?? "other";
        const e = m.get(k) ?? { amount: 0, items: new Map() };
        const v = o.toCur(i.price, t.currency);
        e.amount += v;
        const it = e.items.get(i.productKey) ?? { title: i.title, amount: 0 };
        it.amount += v;
        e.items.set(i.productKey, it);
        m.set(k, e);
      }
    return m;
  };
  const sNow = secOf(cur);
  const sLast = secOf(last);
  const sections = [...sNow.entries()]
    .map(([key, e]) => ({ key, amount: e.amount, last: sLast.get(key)?.amount ?? 0, items: [...e.items.values()].sort((a, b) => b.amount - a.amount).slice(0, 5) }))
    .sort((a, b) => b.amount - a.amount);

  const stores = [...cur.reduce((m, x) => {
    const k = `${x.t.chain ?? ""}|${x.t.branch ?? ""}`;
    const e = m.get(k) ?? { chain: x.t.chain, branch: x.t.branch, amount: 0, trips: 0 };
    e.amount += x.value;
    e.trips += 1;
    return m.set(k, e);
  }, new Map<string, { chain: string | null; branch: string | null; amount: number; trips: number }>()).values()].sort((a, b) => b.amount - a.amount);

  const avg = (xs: { value: number }[]) => (xs.length ? xs.reduce((a, x) => a + x.value, 0) / xs.length : null);
  const pace = o.cap && !closed ? (todayIdx + 1) / days : null;
  return {
    key: o.key,
    from,
    to,
    days,
    closed,
    todayIdx,
    daysLeft: closed ? 0 : days - todayIdx - 1,
    total,
    supermarket,
    products,
    delivery,
    cap: o.cap,
    left: o.cap != null ? o.cap - total : null,
    // In progress: vs the same day last month; closed: vs all of last month.
    delta: closed ? total - lastTotal : total - lastSoFarTotal,
    paceState: pace == null || !o.cap ? null : total > o.cap * pace * 1.05 ? ("ahead" as const) : total < o.cap * pace * 0.85 ? ("under" as const) : ("on" as const),
    cumulative,
    sections,
    stores,
    productRows: pCur.sort((a, b) => b.at - a.at),
    vsLast: {
      supermarket: { now: supermarket, last: lastSoFar.reduce((a, x) => a + x.value, 0) },
      products: { now: products + delivery, last: pLastSoFar.reduce((a, x) => a + x.value, 0) },
      avgShop: { now: avg(cur), last: avg(last) },
    },
    hasHistory: o.trips.some((t) => t.finishedAt < from) || o.products.some((p) => p.at < from),
    empty: cur.length === 0 && pCur.length === 0,
  };
}
