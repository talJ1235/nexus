"use client";

import { BarChart3, Star, TrendingDown, TrendingUp, Truck, Users } from "lucide-react";
import { useI18n } from "@/components/providers";
import { dayKeyIn } from "@/lib/home";
import type { Extras } from "@/lib/home-widgets";
import { rowsFor } from "@/lib/home-layout";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card } from "./home-card";
import { Avatar } from "./spaces/space-ui";
import { useStore } from "./store";

// R16 E2 — the new Home indicators (numbers from lib/home-widgets.ts). Each has an empty state; the skeleton is
// Home's own while the data loads. Taller (2×) list widgets show more rows.

type P = { x: Extras; h: 1 | 2; className?: string; style?: React.CSSProperties };

function useMoney() {
  const s = useStore();
  const { locale } = useI18n();
  return (v: number) => formatMoney(Math.round(v), s.currency, locale);
}
const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="flex flex-1 items-center px-4 py-3 text-[13px] text-muted lg:px-[18px]" data-widget-empty>
    {children}
  </p>
);
const Big = ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={cn("tabular block text-[26px] font-extrabold leading-[1.1] tracking-[-0.03em]", className)}>{children}</span>;

export function DropsWidget({ x, h, className, style }: P) {
  const s = useStore();
  const { t } = useI18n();
  const rows = x.drops.slice(0, rowsFor(h, 3, 8));
  return (
    <Card id="drops" title={t.hc.names.drops} icon={<TrendingDown />} count={x.drops.length || undefined} className={className} style={style}>
      {rows.length === 0 ? (
        <Empty>{t.hc.dropsEmpty}</Empty>
      ) : (
        <div className="r13-rows px-4 pb-1 lg:px-[18px]">
          {rows.map((d) => (
            <button key={d.itemId} type="button" onClick={() => s.openItem(d.itemId)} className="flex w-full items-center gap-2.5 py-2 text-start" data-drop-row={d.itemId}>
              <i className="size-2 shrink-0 rounded-full bg-ok" />
              <bdi className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{d.title}</bdi>
              <span className="tabular shrink-0 text-[12.5px] font-bold text-ok">−{d.pct}%</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export function VsLastWidget({ x, className, style }: P) {
  const { t, f, locale } = useI18n();
  const m = useMoney();
  const v = x.vsLast;
  const month = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${v.lastMonthKey}-15T12:00:00Z`));
  const less = v.now <= v.last;
  return (
    <Card id="vslast" title={t.hc.names.vslast} icon={less ? <TrendingDown /> : <TrendingUp />} className={className} style={style}>
      {v.pct == null ? (
        <Empty>{t.hc.vsNone}</Empty>
      ) : (
        <div className="flex flex-col gap-1 px-4 pb-3 pt-2.5 lg:px-[18px]" data-vslast={v.pct}>
          <Big className={less ? "text-ok" : "text-warn"}>
            {v.pct > 0 ? "+" : v.pct < 0 ? "−" : ""}
            {Math.abs(v.pct)}%
          </Big>
          <span className="truncate text-[12.5px] text-muted">{f(less ? t.hc.vsLess : t.hc.vsMore, { amount: m(Math.abs(v.now - v.last)), month })}</span>
          <span className="truncate text-[11.5px] text-faint">{t.hc.sameDays}</span>
        </div>
      )}
    </Card>
  );
}

export function NextDeliveryWidget({ x, className, style }: P) {
  const s = useStore();
  const { t, locale } = useI18n();
  const n = x.nextDelivery;
  const today = dayKeyIn(s.clock.now, s.clock.tz);
  const day = n ? dayKeyIn(n.eta, s.clock.tz) : null;
  const label = !n || !day ? "" : n.late ? t.hc.late : day === today ? t.hc.today : new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <Card id="nextdel" title={t.hc.names.nextdel} icon={<Truck />} className={className} style={style}>
      {!n ? (
        <Empty>{t.hc.nextEmpty}</Empty>
      ) : (
        <button type="button" onClick={() => s.openItem(n.itemId)} className="flex flex-col gap-1 px-4 pb-3 pt-2.5 text-start lg:px-[18px]" data-next-delivery={n.itemId}>
          <Big className={n.late ? "text-warn" : undefined}>{label}</Big>
          <bdi className="truncate text-[12.5px] text-muted">{[n.title, n.store].filter(Boolean).join(" · ")}</bdi>
        </button>
      )}
    </Card>
  );
}

export function ByCategoryWidget({ x, h, className, style }: P) {
  const s = useStore();
  const { t } = useI18n();
  const m = useMoney();
  const rows = x.byCategory.slice(0, rowsFor(h, 3, 7));
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card id="bycat" title={t.hc.names.bycat} icon={<BarChart3 />} link={t.dash.spending} onLink={() => s.setView({ type: "spending" })} className={className} style={style}>
      {rows.length === 0 ? (
        <Empty>{t.hc.bycatEmpty}</Empty>
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-3 pt-2.5 lg:px-[18px]">
          {rows.map((r) => (
            <div key={r.category} className="flex items-center gap-2.5 text-[12.5px]" data-bycat={r.category}>
              <span className="w-[34%] shrink-0 truncate font-medium">{t.categories[r.category as keyof typeof t.categories] ?? r.category}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <i className="grow-x block h-full rounded-full bg-ink" style={{ width: `${(r.total / max) * 100}%` }} />
              </span>
              <span className="tabular w-[22%] shrink-0 text-end text-muted">{m(r.total)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function MostBoughtWidget({ x, h, className, style }: P) {
  const s = useStore();
  const { t, f } = useI18n();
  const rows = x.mostBought.slice(0, rowsFor(h, 3, 8));
  return (
    <Card id="most" title={t.hc.names.most} icon={<Star />} className={className} style={style}>
      {rows.length === 0 ? (
        <Empty>{t.hc.mostEmpty}</Empty>
      ) : (
        <div className="r13-rows px-4 pb-1 lg:px-[18px]">
          {rows.map((r) => (
            <button key={r.key} type="button" onClick={() => s.openItem(r.itemId)} className="flex w-full items-center gap-2.5 py-2 text-start" data-most={r.key}>
              <i className="size-2 shrink-0 rounded-full bg-info" />
              <bdi className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{r.title}</bdi>
              <span className="tabular shrink-0 text-[12.5px] text-muted">{f(t.hc.times, { n: r.count })}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ActivityWidget({ x, h, className, style }: P) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const shared = s.space?.kind === "shared";
  const rows = x.activity.slice(0, rowsFor(h, 3, 7));
  const time = (ms: number) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(ms);
  return (
    <Card id="activity" title={t.hc.names.activity} icon={<Users />} className={className} style={style}>
      {!shared ? (
        <Empty>{t.hc.actPersonal}</Empty>
      ) : rows.length === 0 ? (
        <Empty>{t.hc.actEmpty}</Empty>
      ) : (
        <div className="r13-rows px-4 pb-1 lg:px-[18px]">
          {rows.map((a) => {
            const p = s.people.find((x) => x.id === a.userId);
            const name = (p?.name ?? t.spaces.someone).split(/\s+/)[0];
            const line = a.added && a.bought ? f(t.hc.actBoth, { name, a: a.added, b: a.bought }) : a.added ? f(t.hc.actAdded, { name, n: a.added }) : f(t.hc.actBought, { name, n: a.bought });
            return (
              <div key={a.userId} className="flex items-center gap-2.5 py-2" data-activity-row={a.userId}>
                {p ? <Avatar person={p} size={20} /> : <i className="size-2 rounded-full bg-info" />}
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{line}</span>
                <span className="tabular shrink-0 text-[12px] text-muted">{time(a.last)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
