// Monthly spending cap + this month's forecast. Pure (spending view, Telegram digest, scripts/test-budget.ts).
import { countable, lineTotal, spendDate } from "./calc";
import { convert, type Rates } from "./money";
import type { AltGroup, ItemWithSources } from "./types";

/** The cap as set for a month; months without an entry carry the last earlier one forward. */
export type MonthCap = { cap: number | null; currency: string };
/** "YYYY-MM" → cap set during that month (kv `pref:budget:YYYY-MM`). */
export type BudgetHistory = Record<string, MonthCap>;
export const BUDGET_KV_PREFIX = "pref:budget:";

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Month key in a given IANA time zone (the server runs in UTC; months follow Israel time). */
export function monthKeyIn(ms: number, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date(ms));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

export function capFor(month: string, history: BudgetHistory): MonthCap | null {
  let best: string | null = null;
  for (const k of Object.keys(history)) if (k <= month && (best == null || k > best)) best = k;
  const hit = best ? history[best] : null;
  return hit && hit.cap != null && hit.cap > 0 ? hit : null;
}

export type BudgetState = "none" | "ok" | "near" | "over";

export function budgetState(total: number, cap: number | null): BudgetState {
  if (cap == null || cap <= 0) return "none";
  if (total > cap + 0.005) return "over";
  return total >= cap * 0.9 ? "near" : "ok";
}

export type MonthForecast = {
  /** Received items dated this month (price paid). */
  spent: number;
  /** Ordered (on the way) items dated this month. */
  committed: number;
  /** To-buy items expected this month: urgent, plus normal when `includeNormal`. */
  forecast: number;
  forecastCount: number;
  /** Forecast items without a price (not in the sum). */
  unpriced: number;
  total: number;
  /** Cap in the display currency (null = no cap). */
  cap: number | null;
  pct: number | null;
  state: BudgetState;
};

/**
 * This month against the cap. Spent/committed use each item's spend date (ordered, else received) inside
 * [from, to); the forecast counts to-buy items (one per group of alternatives), never "someday".
 */
export function monthForecast(opts: {
  items: ItemWithSources[];
  altGroups: AltGroup[];
  rates: Rates;
  currency: string;
  from: number;
  to: number;
  cap: MonthCap | null;
  includeNormal: boolean;
}): MonthForecast {
  const { items, rates, currency, from, to } = opts;
  let spent = 0;
  let committed = 0;
  for (const i of items) {
    if (i.status === "to_buy") continue;
    const at = spendDate(i) ?? i.updatedAt;
    if (at < from || at >= to) continue;
    const v = lineTotal(i, rates, currency) ?? 0;
    if (i.status === "purchased") spent += v;
    else committed += v;
  }
  let forecast = 0;
  let forecastCount = 0;
  let unpriced = 0;
  const toBuy = items.filter((i) => i.status === "to_buy" && (i.priority === "urgent" || (opts.includeNormal && i.priority === "normal")));
  for (const i of countable(toBuy, opts.altGroups, rates)) {
    const v = lineTotal(i, rates, currency);
    forecastCount++;
    if (v == null) unpriced++;
    else forecast += v;
  }
  const cap = opts.cap ? convert(opts.cap.cap!, opts.cap.currency, currency, rates) : null;
  const total = spent + committed + forecast;
  return { spent, committed, forecast, forecastCount, unpriced, total, cap, pct: cap ? (total / cap) * 100 : null, state: budgetState(total, cap) };
}

/**
 * Whether the digest should mention the budget: once per state per month, only for near/over, and never "near"
 * after "over" was already sent that month (spending doesn't go back down in a way worth a message).
 */
export function shouldNotifyBudget(state: BudgetState, alreadySent: string[]) {
  if (state !== "near" && state !== "over") return false;
  if (alreadySent.includes(state)) return false;
  return !(state === "near" && alreadySent.includes("over"));
}

/** UTC ms of the first instant of month `key` ("YYYY-MM") in `timeZone`. */
export function monthStartIn(key: string, timeZone: string) {
  const [y, m] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, 1);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((x) => [x.type, Number(x.value)]),
  );
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return guess - offset;
}

export function nextMonthKey(key: string) {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
