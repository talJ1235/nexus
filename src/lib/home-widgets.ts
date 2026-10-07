// R16 E2 — the new Home indicators, all from data the space already has. Pure (scripts/test-home.ts):
// price drops this week, spending vs last month (same days), the next delivery, this month by category,
// most bought, and who did what in the space today.
import { lineTotal, spendDate } from "./calc";
import { dayKeyIn, normName } from "./home";
import type { Rates } from "./money";
import type { Alert, ItemWithSources } from "./types";

const DAY = 86_400_000;

export type Extras = {
  drops: { itemId: string; title: string; pct: number; at: number }[];
  vsLast: { now: number; last: number; pct: number | null; lastMonthKey: string };
  nextDelivery: { itemId: string; title: string; eta: number; late: boolean; store: string | null } | null;
  byCategory: { category: string; total: number }[];
  mostBought: { key: string; title: string; count: number; itemId: string }[];
  activity: { userId: string; added: number; bought: number; last: number }[];
};

export function homeExtras(input: { items: ItemWithSources[]; alerts: Alert[]; rates: Rates; currency: string; now: number; tz: string; monthFrom: number; monthTo: number; lastMonthFrom: number; lastMonthKey: string; me?: string | null }): Extras {
  const { items, alerts, rates, currency, now, tz, monthFrom, monthTo, lastMonthFrom } = input;
  const byId = new Map(items.map((i) => [i.id, i]));

  // Price drops in the last 7 days: the biggest drop per item.
  const best = new Map<string, Extras["drops"][number]>();
  for (const a of alerts) {
    if ((a.kind !== "drop" && a.kind !== "target") || a.createdAt < now - 7 * DAY || a.oldPrice == null || a.newPrice == null || a.oldPrice <= 0) continue;
    const item = byId.get(a.itemId);
    if (!item) continue;
    const pct = Math.round(((a.oldPrice - a.newPrice) / a.oldPrice) * 100);
    if (pct <= 0) continue;
    const prev = best.get(a.itemId);
    if (!prev || pct > prev.pct) best.set(a.itemId, { itemId: a.itemId, title: item.title, pct, at: a.createdAt });
  }
  const drops = [...best.values()].sort((a, b) => b.pct - a.pct || b.at - a.at);

  // This month so far vs the same number of days last month.
  const elapsed = Math.max(0, Math.min(now, monthTo) - monthFrom);
  const spentIn = (from: number, to: number) => {
    let sum = 0;
    for (const i of items) {
      if (i.status === "to_buy") continue;
      const at = spendDate(i) ?? i.updatedAt;
      if (at >= from && at < to) sum += lineTotal(i, rates, currency) ?? 0;
    }
    return sum;
  };
  const nowSpent = spentIn(monthFrom, monthFrom + elapsed);
  const lastSpent = spentIn(lastMonthFrom, Math.min(monthFrom, lastMonthFrom + elapsed));
  const vsLast = { now: nowSpent, last: lastSpent, pct: lastSpent > 0.5 ? Math.round(((nowSpent - lastSpent) / lastSpent) * 100) : null, lastMonthKey: input.lastMonthKey };

  // The next delivery: a late one first, else the soonest eta.
  const today = dayKeyIn(now, tz);
  const ordered = items.filter((i) => i.status === "ordered" && i.eta != null).sort((a, b) => a.eta! - b.eta!);
  const late = ordered.find((i) => dayKeyIn(i.eta!, tz) < today);
  const next = late ?? ordered.find((i) => dayKeyIn(i.eta!, tz) >= today) ?? null;
  const store = (i: ItemWithSources) => (i.sources.find((s) => s.id === i.chosenSourceId) ?? i.sources[0])?.store ?? null;
  const nextDelivery = next ? { itemId: next.id, title: next.title, eta: next.eta!, late: next === late, store: store(next) } : null;

  // This month by category (paid + on the way).
  const cat = new Map<string, number>();
  for (const i of items) {
    if (i.status === "to_buy") continue;
    const at = spendDate(i) ?? i.updatedAt;
    if (at < monthFrom || at >= monthTo) continue;
    const v = lineTotal(i, rates, currency) ?? 0;
    if (v > 0) cat.set(i.category ?? "other", (cat.get(i.category ?? "other") ?? 0) + v);
  }
  const byCategory = [...cat].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);

  // Most bought: the same thing bought again and again (by name), times bought.
  const most = new Map<string, { key: string; title: string; count: number; itemId: string; last: number }>();
  for (const i of items) {
    if (i.status !== "purchased") continue;
    const key = normName(i.title);
    if (!key) continue;
    const at = i.purchasedAt ?? i.updatedAt;
    const m = most.get(key);
    if (m) {
      m.count += 1;
      if (at > m.last) Object.assign(m, { title: i.title, itemId: i.id, last: at });
    } else most.set(key, { key, title: i.title, count: 1, itemId: i.id, last: at });
  }
  const mostBought = [...most.values()].filter((m) => m.count >= 2).sort((a, b) => b.count - a.count || b.last - a.last).map(({ key, title, count, itemId }) => ({ key, title, count, itemId }));

  // Today in the space: who added and who bought (yourself and the cron left out).
  const act = new Map<string, Extras["activity"][number]>();
  const bump = (uid: string | null | undefined, k: "added" | "bought", at: number) => {
    if (!uid || uid === "system" || uid === input.me) return;
    const a = act.get(uid) ?? { userId: uid, added: 0, bought: 0, last: 0 };
    a[k] += 1;
    a.last = Math.max(a.last, at);
    act.set(uid, a);
  };
  for (const i of items) {
    if (dayKeyIn(i.createdAt, tz) === today) bump(i.addedByUserId, "added", i.createdAt);
    if (i.status === "purchased" && i.purchasedAt != null && dayKeyIn(i.purchasedAt, tz) === today && i.createdAt < i.purchasedAt - 1000) bump(i.revBy, "bought", i.purchasedAt);
  }
  const activity = [...act.values()].sort((a, b) => b.last - a.last);

  return { drops, vsLast, nextDelivery, byCategory, mostBought, activity };
}
