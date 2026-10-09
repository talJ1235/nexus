// R17 S3 — a notification row's words, built from its `data` + the reader's dictionary at read time (pure: used by the
// inbox on the client and by the push sender on the server, so Hebrew/English always follow the reader).

import { fmt, type Dict } from "../i18n";
import { formatMoney } from "../money";
import type { ActivityData, BudgetData, DeliveryData, NotifyKind, PriceData, ShopData, WeekData } from "./kinds";

type NT = Dict["nt"];
export type RowText = {
  title: string;
  sub: string;
  /** Where a tap goes: through /api/notify/open (marks read, switches space, then the thing itself). */
  action?: "open" | "received";
  price?: { now: string; was: string | null; chg: string };
  live?: string;
  meter?: number;
  done?: boolean;
};

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "Noa", "Noa and Yoav", "Noa and 2 others". */
export function namesText(names: string[], nt: NT) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] || nt.someone;
  if (n.length === 2) return fmt(nt.two, { a: n[0], b: n[1] });
  return fmt(nt.many, { a: n[0], k: n.length - 1 });
}

export function rowText(kind: NotifyKind, raw: unknown, nt: NT, locale: string): RowText {
  const money = (v: number, c: string) => formatMoney(v, c, locale);
  switch (kind) {
    case "shop": {
      const d = raw as ShopData;
      const who = d.who || nt.someone;
      if (d.done) {
        const left = d.left ?? 0;
        return { title: fmt(nt.shopDone, { who }), sub: fmt(left > 0 ? nt.shopDoneSub : nt.shopDoneSubAll, { space: d.space, bought: d.bought ?? 0, left }), done: true };
      }
      const live = d.left != null ? (d.total ? fmt(nt.shopLive, { left: d.left, total: d.total }) : fmt(nt.shopLiveLeft, { left: d.left })) : undefined;
      return { title: fmt(nt.shopNow, { who }), sub: d.list ? fmt(nt.shopSub, { space: d.space, list: d.list }) : d.space, live };
    }
    case "activity": {
      const d = raw as ActivityData;
      const who = namesText(d.names, nt);
      const pl = d.names.filter(Boolean).length > 1;
      const added = d.added ?? 0;
      const checked = d.checked ?? 0;
      const k = (base: "added" | "addedOne" | "checked" | "checkedOne" | "addedChecked") => nt[pl ? (`${base}Pl` as const) : base];
      const title =
        added && checked
          ? fmt(k("addedChecked"), { who, n: added, m: checked })
          : added
            ? fmt(added === 1 ? k("addedOne") : k("added"), { who, n: added })
            : fmt(checked === 1 ? k("checkedOne") : k("checked"), { who, n: checked });
      return { title, sub: d.list ? fmt(nt.actSub, { list: d.list, space: d.space }) : d.space };
    }
    case "price": {
      const d = raw as PriceData;
      const t = short(d.title);
      const pct = d.was && d.was > 0 ? Math.round(((d.was - d.now) / d.was) * 100) : 0;
      return {
        title: fmt(d.target ? nt.priceTarget : nt.priceDropped, { title: t }),
        sub: d.store ?? "",
        action: "open",
        price: { now: money(d.now, d.currency), was: d.was != null ? money(d.was, d.currency) : null, chg: d.target ? nt.target : `−${Math.max(1, pct)}%` },
      };
    }
    case "delivery": {
      const d = raw as DeliveryData;
      return { title: nt.delToday, sub: [short(d.title, 40), d.store].filter(Boolean).join(" · "), action: d.received ? undefined : "received", done: !!d.received };
    }
    case "budget": {
      const d = raw as BudgetData;
      const month = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { month: "long", timeZone: "UTC" }).format(Date.UTC(2026, Math.max(0, d.month - 1), 15));
      return { title: fmt(nt.budget, { pct: d.pct, month }), sub: fmt(nt.budgetSub, { space: d.space, spent: money(d.spent, d.currency), budget: money(d.budget, d.currency) }), meter: Math.min(1, d.budget > 0 ? d.spent / d.budget : 0) };
    }
    case "week": {
      const d = raw as WeekData;
      return { title: nt.week, sub: fmt(nt.weekSub, { bought: d.bought, spent: money(d.spent, d.currency), drops: d.drops }) };
    }
  }
}

/** The push for one row (system notification: title + one line). */
export function pushText(kind: NotifyKind, raw: unknown, nt: NT, locale: string) {
  const r = rowText(kind, raw, nt, locale);
  if (kind === "price") {
    const d = raw as PriceData;
    const t = short(d.title, 40);
    const now = formatMoney(d.now, d.currency, locale);
    const was = d.was != null ? formatMoney(d.was, d.currency, locale) : null;
    return { title: d.target ? fmt(nt.priceTarget, { title: t }) : fmt(nt.priceDroppedTo, { title: t, price: now }), body: was ? (d.store ? fmt(nt.priceWasAt, { was, store: d.store }) : fmt(nt.priceWas, { was })) : (d.store ?? "") };
  }
  if (kind === "shop" && (raw as ShopData).done) {
    const d = raw as ShopData;
    return { title: r.title, body: fmt((d.left ?? 0) > 0 ? nt.shopPushDone : nt.shopDoneSubAll, { space: d.space, bought: d.bought ?? 0, left: d.left ?? 0 }) };
  }
  return { title: r.title, body: [r.sub, r.live].filter(Boolean).join(" · ") };
}

/** Several rows due at once for one person → one push. All price rows of one check → "3 price drops". */
export function groupedPushText(kinds: NotifyKind[], nt: NT) {
  if (kinds.every((k) => k === "price")) return { title: fmt(nt.drops, { n: kinds.length }), body: nt.updatesBody };
  return { title: fmt(nt.updates, { n: kinds.length }), body: nt.updatesBody };
}

/** "now", "2 min", "09:00" (today), "Yesterday", "Tue" — in the reader's locale and zone. */
export function whenText(ts: number, now: number, nt: NT, locale: string) {
  const diff = now - ts;
  if (diff < 60_000) return nt.now;
  if (diff < 60 * 60_000) return fmt(nt.min, { n: Math.floor(diff / 60_000) });
  const loc = locale === "he" ? "he-IL" : "en-US";
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ts);
  if (day(ts) === day(now - 86_400_000)) return nt.yesterday;
  if (diff < 6 * 86_400_000) return new Intl.DateTimeFormat(loc, { weekday: "short" }).format(ts);
  return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }).format(ts);
}

export const isToday = (ts: number, now: number) => new Date(ts).toDateString() === new Date(now).toDateString();
