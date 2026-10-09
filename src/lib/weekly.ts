// Weekly Telegram summary (sent by the daily cron on Sundays). Pure: builds the message from data; see
// scripts/test-weekly.ts. Returns null when nothing is worth sending.
import { activeSource, countable, lineTotal } from "./calc";
import type { MonthForecast } from "./budget";
import { dictionaries, fmt, type Locale } from "./i18n";
import { formatMoney, type Rates } from "./money";
import { shippingGap, shippingRule } from "./shipping";
import { overLimitStores } from "./import-vat";
import type { Alert, AltGroup, ItemWithSources, StoreSetting } from "./types";

const DAY = 86_400_000;
const MAX = 5;
/** A store is "close" to free shipping when the gap is at most this share of the threshold. */
export const CLOSE_SHARE = 0.25;

export type WeeklyInput = {
  items: ItemWithSources[];
  altGroups: AltGroup[];
  storeSettings: StoreSetting[];
  /** Alerts created in the last 7 days. */
  alerts: Alert[];
  rates: Rates;
  currency: string;
  locale: Locale;
  now: number;
  origin: string;
  timeZone: string;
  /** This month against the cap (null = no data). */
  month: MonthForecast | null;
  /** VAT-free import limit (USD); foreign-store orders above it get a line. */
  importLimitUsd?: number;
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function weeklySummary(input: WeeklyInput): string | null {
  const { items, rates, currency, locale, now, origin } = input;
  const t = dictionaries[locale].weekly;
  const m = (n: number | null | undefined, cur = currency) => formatMoney(n ?? null, cur, locale);
  const link = (i: { id: string; title: string }) => `<a href="${origin}/?item=${encodeURIComponent(i.id)}">${esc(i.title.slice(0, 70))}</a>`;
  const date = (ms: number) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", timeZone: input.timeZone }).format(ms);
  const byId = new Map(items.map((i) => [i.id, i]));
  const sections: string[] = [];
  const section = (title: string, rows: string[]) => {
    if (!rows.length) return;
    const shown = rows.slice(0, MAX);
    if (rows.length > MAX) shown.push(fmt(t.more, { n: rows.length - MAX }));
    sections.push(`<b>${title}</b>\n${shown.map((r) => `• ${r}`).join("\n")}`);
  };

  // 1. Price drops and targets hit this week, newest per item, only for items still to buy.
  const seen = new Set<string>();
  const drops: string[] = [];
  for (const a of [...input.alerts].sort((x, y) => y.createdAt - x.createdAt)) {
    if ((a.kind !== "drop" && a.kind !== "target") || a.createdAt < now - 7 * DAY || seen.has(a.itemId)) continue;
    const it = byId.get(a.itemId);
    if (!it || it.status !== "to_buy") continue;
    seen.add(a.itemId);
    const cur = a.currency ?? currency;
    drops.push(a.kind === "target" ? fmt(t.target, { title: link(it), new: m(a.newPrice, cur) }) : fmt(t.drop, { title: link(it), old: m(a.oldPrice, cur), new: m(a.newPrice, cur) }));
  }
  section(t.drops, drops);

  // 2. Urgent, not ordered yet (one per group of alternatives).
  const urgent = countable(items.filter((i) => i.status === "to_buy" && i.priority === "urgent"), input.altGroups, rates);
  section(t.urgent, urgent.map((i) => link(i)));

  // 3. Orders: overdue, and arriving in the next 7 days.
  const ordered = items.filter((i) => i.status === "ordered" && i.eta != null).sort((a, b) => a.eta! - b.eta!);
  section(t.overdue, ordered.filter((i) => i.eta! < now - DAY / 2).map((i) => fmt(t.due, { title: link(i), date: date(i.eta!) })));
  section(t.arriving, ordered.filter((i) => i.eta! >= now - DAY / 2 && i.eta! < now + 7 * DAY).map((i) => fmt(t.due, { title: link(i), date: date(i.eta!) })));

  // 4. Stores close to free shipping (same grouping as "Order by store": someday items left out).
  const stores = new Map<string, { name: string; total: number }>();
  for (const i of countable(items.filter((x) => x.status === "to_buy" && x.priority !== "someday"), input.altGroups, rates)) {
    const src = activeSource(i, rates);
    if (!src?.url) continue;
    const g = stores.get(src.storeKey) ?? { name: src.store, total: 0 };
    g.total += lineTotal(i, rates, currency) ?? 0;
    stores.set(src.storeKey, g);
  }
  const close: { name: string; remaining: number }[] = [];
  for (const [key, g] of stores) {
    const gap = shippingGap(g.total, shippingRule(key, input.storeSettings), rates, currency);
    if (g.total > 0 && gap.threshold && !gap.free && gap.remaining <= gap.threshold * CLOSE_SHARE) close.push({ name: g.name, remaining: gap.remaining });
  }
  section(
    t.shipping,
    close.sort((a, b) => a.remaining - b.remaining).map((c) => fmt(t.shipGap, { store: esc(c.name), amount: m(Math.ceil(c.remaining)) })),
  );

  // 4b. Orders from abroad over the VAT-free import limit.
  if (input.importLimitUsd) {
    const over = overLimitStores(items, { rates, currency, limitUsd: input.importLimitUsd });
    section(t.importVat, over.map((g) => fmt(t.importLine, { store: esc(g.store), total: `$${Math.round(g.check.totalUsd)}`, vat: m(Math.round(g.check.vat)), remove: `$${Math.ceil(g.check.removeUsd)}` })));
  }

  // Worth sending only with something above, or a month that is near/over its cap.
  const month = input.month;
  const budgetAlarm = month?.state === "near" || month?.state === "over";
  if (!sections.length && !budgetAlarm) return null;
  // 5. Month vs budget (always shown when there's a cap or any spending).
  let budget = "";
  if (month && month.cap != null) budget = fmt(t.budget, { total: m(Math.round(month.total)), cap: m(Math.round(month.cap)), pct: Math.round(month.pct ?? 0) });
  else if (month && month.total > 0) budget = fmt(t.budgetNoCap, { total: m(Math.round(month.total)) });

  return [`<b>${t.title}</b>`, ...sections, budget, `<a href="${origin}/">${t.open}</a>`].filter(Boolean).join("\n\n");
}

/** R17 S3 M4: the Thursday notification's numbers — bought and spent over the last 7 days, price drops / targets hit. */
export function weekNumbers(input: { items: ItemWithSources[]; alerts: Alert[]; rates: Rates; currency: string; now: number }) {
  const { items, rates, currency, now } = input;
  const bought = items.filter((i) => i.status === "purchased" && i.purchasedAt != null && i.purchasedAt >= now - 7 * DAY && i.purchasedAt <= now);
  const spent = bought.reduce((n, i) => n + (lineTotal(i, rates, currency) ?? 0), 0);
  const drops = new Set(input.alerts.filter((a) => (a.kind === "drop" || a.kind === "target") && a.createdAt >= now - 7 * DAY).map((a) => a.itemId)).size;
  return { bought: bought.length, spent, drops };
}
