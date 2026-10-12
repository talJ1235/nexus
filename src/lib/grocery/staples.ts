// R18 B1 + B2 — learn from what the household bought, and suggest (pure; the server feeds it rows from trip_check,
// purchased supermarket items and receipts). Rules from R18-SCREENS §3: suggestions never change the list; never what is
// already on it (any quantity) or was dismissed this cycle; each carries a short reason.
//   (first reason wins: shabbat, holiday, with, due)
//   due      — bought ≥ 3 times (≥ 2 for a `suggest` / `auto` staple) and the usual gap has (almost) passed: "every ~9 days"
//   shabbat  — Wednesday afternoon → Friday 14:00: challah / wine, or what this home buys mostly on Thursday / Friday
//   holiday  — the 3 days before a holiday's eve: its typical products (lib/grocery/holidays.ts)
//   with     — bought together with something on the list in ≥ 60 % of the trips that had it (≥ 3 such trips)

import { local } from "../notify/schedule";
import { TYPE_BY_KEY } from "./dictionary";
import { holidayAhead, SHABBAT_TYPES } from "./holidays";
import type { SectionOrOther } from "./sections";

const DAY = 86_400_000;

export type Purchase = {
  productKey: string;
  title: string;
  at: number;
  qty?: number | null;
  amount?: number | null;
  unit?: string | null;
  price?: number | null;
  chain?: string | null;
  branch?: string | null;
  section?: SectionOrOther | string | null;
  art?: string | null;
  /** Which trip it was bought in (companions); null = outside a trip (a purchased item, a receipt). */
  tripId?: string | null;
};

export type ProductHistory = {
  productKey: string;
  title: string;
  section: string;
  art: string | null;
  count: number;
  usualQty: number;
  usualAmount: number | null;
  unit: string | null;
  /** Median gap in days between purchases (≥ 3 purchase days; ≥ 2 when `minDays` says so), else null. */
  intervalDays: number | null;
  last: { at: number; chain: string | null; branch: string | null; price: number | null };
  /** Chains, most used first. */
  stores: string[];
  /** Share of purchase days that were Thursday or Friday. */
  thuFri: number;
};

export type History = { products: Map<string, ProductHistory>; usualDay: { weekday: number; hour: number } | null };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ymd = (ts: number, tz: string) => {
  const l = local(ts, tz);
  return `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
};
const dayNo = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / DAY);

/** Median gap (days) between distinct purchase days; needs ≥ `min` days. */
export function intervalOf(ats: number[], tz: string, min = 3) {
  const days = [...new Set(ats.map((a) => ymd(a, tz)))].sort();
  if (days.length < min) return null;
  const gaps = days.slice(1).map((d, i) => dayNo(d) - dayNo(days[i]));
  const m = median(gaps);
  return m == null ? null : Math.max(1, Math.round(m));
}

export function learnHistory(purchases: Purchase[], trips: { startedAt: number }[], o: { tz: string; staples?: Map<string, string> } = { tz: "Asia/Jerusalem" }): History {
  const by = new Map<string, Purchase[]>();
  for (const p of purchases) if (p.productKey) by.set(p.productKey, [...(by.get(p.productKey) ?? []), p]);
  const products = new Map<string, ProductHistory>();
  for (const [key, ps] of by) {
    ps.sort((a, b) => a.at - b.at);
    const last = ps[ps.length - 1];
    const staple = o.staples?.get(key);
    const chains = new Map<string, number>();
    for (const p of ps) if (p.chain) chains.set(p.chain, (chains.get(p.chain) ?? 0) + 1);
    const days = [...new Set(ps.map((p) => ymd(p.at, o.tz)))];
    const tf = days.filter((d) => [4, 5].includes(new Date(`${d}T12:00:00Z`).getUTCDay())).length;
    const amounts = ps.map((p) => p.amount).filter((x): x is number => x != null && x > 0);
    products.set(key, {
      productKey: key,
      title: last.title,
      section: String(last.section ?? "other"),
      art: last.art ?? null,
      count: ps.length,
      usualQty: Math.max(1, Math.round(median(ps.map((p) => p.qty ?? 1)) ?? 1)),
      usualAmount: median(amounts),
      unit: last.unit ?? null,
      intervalDays: intervalOf(ps.map((p) => p.at), o.tz, staple === "suggest" || staple === "auto" ? 2 : 3),
      last: { at: last.at, chain: last.chain ?? null, branch: last.branch ?? null, price: [...ps].reverse().find((p) => p.price != null)?.price ?? null },
      stores: [...chains.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
      thuFri: days.length ? tf / days.length : 0,
    });
  }
  return { products, usualDay: usualDay(trips, o.tz) };
}

/** The usual shopping weekday + hour from ≥ 3 trips (the most common weekday; the median hour on that day). */
export function usualDay(trips: { startedAt: number }[], tz: string) {
  if (trips.length < 3) return null;
  const ls = trips.map((t) => local(t.startedAt, tz));
  const counts = new Map<number, number>();
  for (const l of ls) counts.set(l.weekday, (counts.get(l.weekday) ?? 0) + 1);
  const [weekday] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const hour = Math.round(median(ls.filter((l) => l.weekday === weekday).map((l) => l.hour)) ?? 10);
  return { weekday, hour };
}

export type ReasonKey = "due" | "shabbat" | "holiday" | "with";
export type Suggestion = {
  productKey: string;
  title: string;
  qty: number;
  amount: number | null;
  unit: string | null;
  section: string;
  art: string | null;
  reasonKey: ReasonKey;
  reasonArgs: Record<string, string | number>;
  /** Until when a "Not now" keeps it quiet (end of this cycle). */
  quietUntil: number;
};

export type SuggestInput = {
  history: History;
  /** Product keys on the supermarket list now (to buy, any quantity). */
  onList: Set<string>;
  /** Their titles (for "usually with pasta"). */
  listTitles?: Map<string, string>;
  /** productKey → until (ms). */
  dismissed: Map<string, number>;
  /** productKey → staple behaviour. */
  staples?: Map<string, string>;
  /** Each past trip's bought product keys (companions). */
  baskets: Set<string>[];
  now: number;
  tz: string;
  locale?: string;
  limit?: number;
};

/** Is the product due by tomorrow (its usual gap has passed, minus a day)? */
export const isDue = (p: ProductHistory, now: number) => p.intervalDays != null && (now - p.last.at) / DAY >= p.intervalDays - 1;

export function suggest(i: SuggestInput): Suggestion[] {
  const out = new Map<string, Suggestion>();
  const ok = (key: string) => !i.onList.has(key) && !out.has(key) && !((i.dismissed.get(key) ?? 0) > i.now);
  const l = local(i.now, i.tz);
  const add = (p: Pick<ProductHistory, "productKey" | "title" | "usualQty" | "usualAmount" | "unit" | "section" | "art">, reasonKey: ReasonKey, reasonArgs: Record<string, string | number>, quietUntil: number) => {
    if (!ok(p.productKey)) return;
    out.set(p.productKey, { productKey: p.productKey, title: p.title, qty: p.usualQty, amount: p.usualAmount, unit: p.unit, section: p.section, art: p.art, reasonKey, reasonArgs, quietUntil });
  };
  // 1. Shabbat (the more specific reason wins over "due"): Wednesday from noon until Friday 14:00, unless bought since Sunday.
  const shabbatWindow = (l.weekday === 3 && l.hour >= 12) || l.weekday === 4 || (l.weekday === 5 && l.hour < 14);
  if (shabbatWindow) {
    const sinceSunday = i.now - ((l.weekday * 24 + l.hour) * 3_600_000);
    const untilSat = i.now + ((6 - l.weekday) * 24 + (21 - l.hour)) * 3_600_000;
    for (const p of i.history.products.values()) {
      const type = p.productKey.split(" ")[0];
      const shabbatItem = SHABBAT_TYPES.includes(type) || (p.count >= 2 && p.thuFri >= 0.6);
      if (shabbatItem && p.last.at < sinceSunday) add(p, "shabbat", {}, untilSat);
    }
  }
  // 2. A holiday in the next 3 days: its typical products (the household's own version when it has one).
  const today = `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
  const hol = holidayAhead(today, 3);
  if (hol) {
    const after = Date.parse(`${hol.eve}T21:00:00Z`) + 2 * DAY;
    for (const type of hol.types) {
      const own = [...i.history.products.values()].find((p) => p.productKey === type || p.productKey.startsWith(`${type} `));
      const t = TYPE_BY_KEY.get(type);
      if (own) add(own, "holiday", { holiday: hol.key }, after);
      else if (t) add({ productKey: t.key, title: i.locale === "he" ? t.he : t.en, usualQty: 1, usualAmount: null, unit: null, section: t.section, art: t.art }, "holiday", { holiday: hol.key }, after);
    }
  }
  // 3. Usually bought with something on the list.
  for (const a of i.onList) {
    const withA = i.baskets.filter((b) => b.has(a));
    if (withA.length < 3) continue;
    const counts = new Map<string, number>();
    for (const b of withA) for (const k of b) if (k !== a) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const [k, n] of counts) {
      const p = i.history.products.get(k);
      if (p && n / withA.length >= 0.6) add(p, "with", { title: i.listTitles?.get(a) ?? i.history.products.get(a)?.title ?? a }, i.now + 7 * DAY);
    }
  }
  // 4. Due by the usual gap.
  for (const p of [...i.history.products.values()].sort((a, b) => b.count - a.count)) {
    if (i.staples?.get(p.productKey) === "auto") continue; // the engine adds those itself (dueStaples)
    if (isDue(p, i.now)) add(p, "due", { days: p.intervalDays! }, i.now + Math.max(1, p.intervalDays! - 1) * DAY);
  }
  return [...out.values()].slice(0, i.limit ?? 12);
}

/** `auto` staples that are due: the engine adds each once on its due day (`dueDay` = local date the gap ends). */
export function dueStaples(h: History, staples: Map<string, string>, onList: Set<string>, now: number, tz: string) {
  const out: { product: ProductHistory; dueDay: string }[] = [];
  for (const [key, mode] of staples) {
    if (mode !== "auto" || onList.has(key)) continue;
    const p = h.products.get(key);
    if (!p || p.intervalDays == null || now < p.last.at + p.intervalDays * DAY - DAY / 2) continue;
    out.push({ product: p, dueDay: ymd(p.last.at + p.intervalDays * DAY, tz) });
  }
  return out;
}

/** "Accept" merges into the list: an existing quantity stays the user's unless it was empty (B4 / C2 rule). */
export function mergeQty(existing: { quantity: number | null; amount: number | null } | null, add: { qty: number; amount: number | null }) {
  if (!existing) return { quantity: add.qty, amount: add.amount, merged: false };
  const emptyQty = !existing.quantity || existing.quantity < 1;
  return { quantity: emptyQty ? add.qty : existing.quantity!, amount: existing.amount ?? add.amount, merged: true };
}
