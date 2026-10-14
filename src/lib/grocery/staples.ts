// R18 — learn from what the household bought, and suggest (pure; the server feeds it rows from trip_check, purchased
// supermarket items and receipts). R18 S2 C1 (Tal 2026-10-13, "Supermarket simplified"): the person never sees staple
// states and Nexus only *suggests* — nothing is ever added to the list by itself.
//   regular    — ≥ 3 purchases with a steady gap (low variance) → suggested when due: "every ~9 days"
//   occasional — anything else → only in context: Shabbat, a holiday, "usually with X"
//   skips      — × = "not this time" (quiet for this cycle); 3 skips in a row → suggested at half the rate (twice the gap);
//                5 → not suggested until bought again. A purchase starts the count over.
//   hidden     — "Don't suggest this again": never suggested (undone in Settings → Supermarket → Products you hid)
//   cold start — until the home has 4 trips, the basic household basket (lib/grocery/basket.ts) fills in; after that the
//                home's own history takes over and basket items it never bought fade out.
// Reason precedence when several fit: Shabbat → holiday → "usually with X" → due → basket.

import { local } from "../notify/schedule";
import type { BasketItem } from "./basket";
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
  /** R18 S2 B1: pieces (with the weight when both were known). */
  count?: number | null;
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
  /** Median gap in days between purchase days (≥ 3 days bought), else null. */
  intervalDays: number | null;
  /** C1: a steady rhythm — ≥ 3 purchase days and the gaps vary little (coefficient of variation ≤ 0.5). */
  regular: boolean;
  /** Purchase days (local "YYYY-MM-DD"), oldest first — the item sheet's timeline. */
  days: string[];
  last: { at: number; chain: string | null; branch: string | null; price: number | null };
  /** Chains, most used first. */
  stores: string[];
  /** Share of purchase days that were Thursday or Friday. */
  thuFri: number;
};

export type History = { products: Map<string, ProductHistory>; usualDay: { weekday: number; hour: number } | null };

/** What the space told Nexus about one product (suggest_dismiss): quiet until, skips in a row, hidden. */
export type ProductPref = { until?: number | null; skips?: number | null; skippedAt?: number | null; hiddenAt?: number | null };

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

/** Gaps (days) between distinct purchase days. */
function gapsOf(ats: number[], tz: string) {
  const days = [...new Set(ats.map((a) => ymd(a, tz)))].sort();
  return { days, gaps: days.slice(1).map((d, i) => dayNo(d) - dayNo(days[i])) };
}

/** Median gap (days) between distinct purchase days; needs ≥ `min` days. */
export function intervalOf(ats: number[], tz: string, min = 3) {
  const { days, gaps } = gapsOf(ats, tz);
  if (days.length < min) return null;
  const m = median(gaps);
  return m == null ? null : Math.max(1, Math.round(m));
}

/** Steady: ≥ 2 gaps whose spread is small next to their mean (stdev / mean ≤ 0.5). */
export function isSteady(gaps: number[]) {
  if (gaps.length < 2) return false;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return false;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  return sd / mean <= 0.5;
}

export function learnHistory(purchases: Purchase[], trips: { startedAt: number }[], o: { tz: string } = { tz: "Asia/Jerusalem" }): History {
  const by = new Map<string, Purchase[]>();
  for (const p of purchases) if (p.productKey) by.set(p.productKey, [...(by.get(p.productKey) ?? []), p]);
  const products = new Map<string, ProductHistory>();
  for (const [key, ps] of by) {
    ps.sort((a, b) => a.at - b.at);
    const last = ps[ps.length - 1];
    const chains = new Map<string, number>();
    for (const p of ps) if (p.chain) chains.set(p.chain, (chains.get(p.chain) ?? 0) + 1);
    const { days, gaps } = gapsOf(ps.map((p) => p.at), o.tz);
    const tf = days.filter((d) => [4, 5].includes(new Date(`${d}T12:00:00Z`).getUTCDay())).length;
    const amounts = ps.map((p) => p.amount).filter((x): x is number => x != null && x > 0);
    const interval = days.length >= 3 ? Math.max(1, Math.round(median(gaps)!)) : null;
    products.set(key, {
      productKey: key,
      title: last.title,
      section: String(last.section ?? "other"),
      art: last.art ?? null,
      count: ps.length,
      usualQty: Math.max(1, Math.round(median(ps.map((p) => p.qty ?? 1)) ?? 1)),
      usualAmount: median(amounts),
      unit: last.unit ?? null,
      intervalDays: interval,
      regular: interval != null && isSteady(gaps),
      days,
      last: { at: last.at, chain: last.chain ?? null, branch: last.branch ?? null, price: [...ps].reverse().find((p) => p.price != null)?.price ?? null },
      stores: [...chains.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
      thuFri: days.length ? tf / days.length : 0,
    });
  }
  return { products, usualDay: usualDay(trips, o.tz) };
}

/** The usual shopping weekday + hour: a weekday with ≥ 3 trips (the most common one; the median hour on that day). */
export function usualDay(trips: { startedAt: number }[], tz: string) {
  if (trips.length < 3) return null;
  const ls = trips.map((t) => local(t.startedAt, tz));
  const counts = new Map<number, number>();
  for (const l of ls) counts.set(l.weekday, (counts.get(l.weekday) ?? 0) + 1);
  const [weekday, n] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (n < 3) return null;
  const hour = Math.round(median(ls.filter((l) => l.weekday === weekday).map((l) => l.hour)) ?? 10);
  return { weekday, hour };
}

export type ReasonKey = "due" | "shabbat" | "holiday" | "with" | "basket";
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
  /** Until when a "Not this time" keeps it quiet (end of this cycle). */
  quietUntil: number;
};

export type SuggestInput = {
  history: History;
  /** Product keys on the supermarket list now (to buy, any quantity). */
  onList: Set<string>;
  /** Their titles (for "usually with pasta"). */
  listTitles?: Map<string, string>;
  /** productKey → what the space said (quiet until, skips, hidden). */
  prefs: Map<string, ProductPref>;
  /** Each past trip's bought product keys (companions). */
  baskets: Set<string>[];
  now: number;
  tz: string;
  locale?: string;
  limit?: number;
  /** Cold start: the basic basket for this home and how many trips it has had. */
  basket?: BasketItem[];
  trips?: number;
};

/** Trips before the home's own history takes over from the basic basket. */
export const COLD_TRIPS = 4;
export const HALF_RATE_SKIPS = 3;
export const STOP_SKIPS = 5;

/** Skips in a row that still count: a purchase after the last skip starts over. */
export function activeSkips(pref: ProductPref | undefined, lastBought: number | null) {
  if (!pref?.skips || !pref.skippedAt) return 0;
  return lastBought != null && lastBought > pref.skippedAt ? 0 : pref.skips;
}

/** Due by tomorrow? Regular products only; after 3 skips in a row the gap counts double. */
export const isDue = (p: ProductHistory, now: number, skips = 0) => p.regular && p.intervalDays != null && (now - p.last.at) / DAY >= p.intervalDays * (skips >= HALF_RATE_SKIPS ? 2 : 1) - 1;

export function suggest(i: SuggestInput): Suggestion[] {
  const out = new Map<string, Suggestion>();
  const last = (key: string) => i.history.products.get(key)?.last.at ?? null;
  const ok = (key: string) => {
    if (i.onList.has(key) || out.has(key)) return false;
    const pref = i.prefs.get(key);
    if (pref?.hiddenAt) return false;
    if ((pref?.until ?? 0) > i.now) return false;
    return activeSkips(pref, last(key)) < STOP_SKIPS;
  };
  const l = local(i.now, i.tz);
  const add = (p: Pick<ProductHistory, "productKey" | "title" | "usualQty" | "usualAmount" | "unit" | "section" | "art">, reasonKey: ReasonKey, reasonArgs: Record<string, string | number>, quietUntil: number) => {
    if (!ok(p.productKey)) return;
    out.set(p.productKey, { productKey: p.productKey, title: p.title, qty: p.usualQty, amount: p.usualAmount, unit: p.unit, section: p.section, art: p.art, reasonKey, reasonArgs, quietUntil });
  };
  // 1. Shabbat (the more specific reason wins over "due"): Wednesday from noon until Friday 14:00, unless bought since Sunday.
  const shabbatWindow = (l.weekday === 3 && l.hour >= 12) || l.weekday === 4 || (l.weekday === 5 && l.hour < 14);
  if (shabbatWindow) {
    const sinceSunday = i.now - (l.weekday * 24 + l.hour) * 3_600_000;
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
  // 4. Regular products, due by their usual gap (twice the gap after 3 skips in a row).
  for (const p of [...i.history.products.values()].sort((a, b) => b.count - a.count)) {
    if (isDue(p, i.now, activeSkips(i.prefs.get(p.productKey), p.last.at))) add(p, "due", { days: p.intervalDays! }, i.now + Math.max(1, p.intervalDays! - 1) * DAY);
  }
  // 5. Cold start: the basic basket fills in until the home has its own rhythm; never-bought basket items then fade out.
  if (i.basket && (i.trips ?? 0) < COLD_TRIPS)
    for (const b of i.basket) {
      if (i.history.products.has(b.productKey)) continue;
      add({ productKey: b.productKey, title: b.title, usualQty: b.qty, usualAmount: b.amount, unit: b.unit, section: b.section, art: b.art }, "basket", {}, i.now + 7 * DAY);
    }
  return [...out.values()].slice(0, i.limit ?? 12);
}

/** "What Nexus learned" about one product (the item sheet, Settings): never a staple state, only what was seen. */
export type Knowledge =
  | { state: "hidden" }
  | { state: "new"; count: number }
  | { state: "learning"; count: number; of: number }
  | { state: "regular"; count: number; intervalDays: number; days: string[]; next: number; since: string | null }
  | { state: "occasional"; count: number; days: string[]; contexts: ("shabbat" | "with")[]; withTitle: string | null };

export function knowledgeOf(p: ProductHistory | undefined, pref: ProductPref | undefined, o: { baskets?: Set<string>[]; titleOf?: (k: string) => string | null } = {}): Knowledge {
  if (pref?.hiddenAt) return { state: "hidden" };
  if (!p || p.days.length <= 1) return { state: "new", count: p?.count ?? 0 };
  if (p.days.length < 3) return { state: "learning", count: p.days.length, of: 3 };
  if (p.regular && p.intervalDays) {
    const skips = activeSkips(pref, p.last.at);
    return { state: "regular", count: p.count, intervalDays: p.intervalDays, days: p.days, next: p.last.at + p.intervalDays * (skips >= HALF_RATE_SKIPS ? 2 : 1) * DAY, since: p.days[0] ?? null };
  }
  const { contexts, withTitle } = contextsOf(p, o);
  return { state: "occasional", count: p.count, days: p.days, contexts, withTitle };
}

/** When a product is bought: before Shabbat, and / or with another product (≥ 60 % of its trips, ≥ 3 trips). */
export function contextsOf(p: ProductHistory, o: { baskets?: Set<string>[]; titleOf?: (k: string) => string | null } = {}) {
  const contexts: ("shabbat" | "with")[] = [];
  if (SHABBAT_TYPES.includes(p.productKey.split(" ")[0]) || (p.count >= 2 && p.thuFri >= 0.6)) contexts.push("shabbat");
  let withTitle: string | null = null;
  const mine = (o.baskets ?? []).filter((b) => b.has(p.productKey));
  if (mine.length >= 3) {
    const counts = new Map<string, number>();
    for (const b of mine) for (const k of b) if (k !== p.productKey) counts.set(k, (counts.get(k) ?? 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] / mine.length >= 0.6) {
      contexts.push("with");
      withTitle = o.titleOf?.(best[0]) ?? best[0];
    }
  }
  return { contexts, withTitle };
}

/** "Accept" merges into the list: an existing quantity stays the user's unless it was empty (B4 / C2 rule). */
export function mergeQty(existing: { quantity: number | null; amount: number | null } | null, add: { qty: number; amount: number | null }) {
  if (!existing) return { quantity: add.qty, amount: add.amount, merged: false };
  const emptyQty = !existing.quantity || existing.quantity < 1;
  return { quantity: emptyQty ? add.qty : existing.quantity!, amount: existing.amount ?? add.amount, merged: true };
}

// ---------- the evening draft's gate (no setting: only the global notifications switch) ----------

export type DraftGate = {
  usualWeekday: number | null;
  tomorrowWeekday: number;
  suggestions: number;
  listItems: number;
  /** Rows added to the list since the last trip finished. */
  addedSinceTrip: number;
  /** Drafts sent since the last trip that were never opened. */
  unopenedDrafts: number;
};

/** Send the evening draft? A usual shopping day (≥ 3 trips on that weekday) is tomorrow, there's something to suggest, the
 *  list isn't empty-and-unused, and fewer than 3 drafts in a row went unopened (then quiet until the next trip). */
export function draftAllowed(g: DraftGate) {
  if (g.usualWeekday == null || g.usualWeekday !== g.tomorrowWeekday) return false;
  if (!g.suggestions) return false;
  if (!g.listItems && !g.addedSinceTrip) return false;
  return g.unopenedDrafts < 3;
}
