"use client";

import { ArrowRight, Plus } from "lucide-react";
import { useI18n } from "@/components/providers";
import { acceptSuggestions } from "@/app/supermarket-actions";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Card } from "./home-card";
import { WIDGET_ICON } from "./home-grid";
import { useStore } from "./store";
import { ProductTile } from "./supermarket/art";
import { patchSmHome, useSmHome } from "./supermarket/data";
import { asItem, storeLabel, tripTotal, useEstimate, useMonthBudget, useOpenSm, useTrips } from "./supermarket/numbers";
import { announceAdded } from "./supermarket/added";

// R18 S5 D3 (Widgets-catalog) — the shopping widgets that earn a place: Next shop (with a live state while another
// member shops), Due soon, Budget. Each in the D1 card shell (home-card's Card, restyled under `.wv2`); `size` = the
// card's size (small / wide).

type Size = "small" | "wide";
const local = (now: number, tz: string) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(now));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p);
};

export function NextShopWidget({ size }: { size: Size }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const est = useEstimate(home);
  const open = useOpenSm();
  const { others } = useTrips(home);
  const other = others[0];
  const money = (n: number) => formatMoney(Math.round(n), s.currency, locale);
  // Live: another member's trip — who, where, how far, and "Add for them" (adds into the list they're shopping).
  if (other) {
    const who = (s.people.find((p) => p.id === other.userId)?.name ?? "").split(" ")[0];
    const total = tripTotal(other);
    const done = other.bought + other.notFound;
    const store = storeLabel(other.chain, other.branch, locale);
    return (
      <Card id="nextshop" title={t.hc.names.nextshop} icon={WIDGET_ICON.nextshop} className="h-full">
        <div className="flex min-h-0 flex-1 flex-col" data-next-shop="other" data-next-live={other.userId}>
          <p className="flex items-center gap-2 text-[16px] font-extrabold leading-tight">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#c94673] text-[12px] font-extrabold text-white">{who.slice(0, 1)}</span>
            <span className="bidi min-w-0">{f(t.hc.shoppingNow, { name: who })}</span>
            <i className="size-2.5 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_color-mix(in_srgb,var(--ok)_25%,transparent)]" aria-hidden />
          </p>
          <p className="bidi mt-1.5 truncate text-[12.5px] text-muted">
            {store ? `${store} · ` : ""}
            {f(t.hc.ofN, { a: done, b: total })}
          </p>
          <span className="mt-2 block h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--k)_18%,var(--surface-2))]" aria-hidden>
            <i className="block h-full rounded-full bg-[var(--k)] transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </span>
          {size === "wide" && s.space?.role !== "viewer" && (
            <button type="button" onClick={() => open("add")} className="mt-auto inline-flex h-10 w-fit items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--k)_14%,var(--surface))] px-4 text-[14px] font-bold text-[color-mix(in_srgb,var(--k)_80%,var(--ink))] transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.96]" data-next-add-for>
              <Plus className="size-4" />
              {t.hc.addFor}
            </button>
          )}
        </div>
      </Card>
    );
  }
  const n = s.sm.length;
  const usual = home?.usualDay ?? null;
  const today = local(s.clock.now, s.clock.tz);
  const day =
    usual == null ? null : usual.weekday === today ? t.hc.today : usual.weekday === (today + 1) % 7 ? t.hc.tomorrow : new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + usual.weekday)));
  const line = est != null ? f(t.hc.shopItems, { n, amount: money(est) }) : f(t.hc.shopItemsNoEst, { n });
  const start = () => open(n ? "shop" : undefined);
  return (
    <Card id="nextshop" title={t.hc.names.nextshop} icon={WIDGET_ICON.nextshop} className="h-full">
      <div className="flex min-h-0 flex-1 flex-col justify-end" data-next-shop="next" data-next-shop-w={size}>
        {size === "wide" && n > 0 && (
          <span className="mb-auto flex pt-1" aria-hidden>
            {s.sm.slice(0, 5).map((i, k) => (
              <span key={i.id} className={cn("rounded-[9px] shadow-[0_0_0_2px_var(--surface)]", k > 0 && "-ms-2")}>
                <ProductTile art={i.artKey} section={i.section} photo={i.imageUrl} size={30} />
              </span>
            ))}
          </span>
        )}
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[32px] font-extrabold leading-[1.05] tracking-[-0.03em]" data-big>
              {day ?? (n ? line.split(" · ")[0] : t.hc.names.nextshop)}
            </b>
            <span className="tabular mt-0.5 block truncate text-[13px] font-semibold text-muted">{day ? line : n && est != null ? `~${money(est)}` : ""}</span>
          </div>
          {s.space?.role !== "viewer" &&
            (size === "wide" ? (
              <button type="button" onClick={start} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-[var(--k)] px-4 text-[14.5px] font-bold text-white transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.96]" data-next-start>
                {t.hc.start}
                <ArrowRight className="size-4 rtl:-scale-x-100" />
              </button>
            ) : (
              <button type="button" onClick={start} className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--k)] text-white transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.94]" aria-label={t.hc.start} data-next-start>
                <ArrowRight className="size-5 rtl:-scale-x-100" />
              </button>
            ))}
        </div>
      </div>
    </Card>
  );
}

export function DueWidget({ size }: { size: Size }) {
  const s = useStore();
  const { t, f } = useI18n();
  const { home } = useSmHome();
  const due = (home?.suggestions ?? []).filter((x) => x.reasonKey === "due" && !s.sm.some((i) => i.productKey === x.productKey));
  const ro = s.space?.role === "viewer" || s.offlineAt != null;
  const add = async (xs: typeof due) => {
    if (!xs.length) return;
    patchSmHome(s.spaceId || "-", (h) => ({ ...h, suggestions: h.suggestions.filter((y) => !xs.some((x) => x.productKey === y.productKey)) }));
    try {
      const rows = await acceptSuggestions(xs.map((x) => ({ productKey: x.productKey, title: x.title, qty: x.qty, amount: x.amount, unit: x.unit, section: x.section, art: x.art })));
      s.upsertSm(rows.map(asItem));
      announceAdded(rows.map((r) => ({ id: r.id, title: r.title, qty: "", merged: false })), { line: rows.length === 1 ? f(t.hc.added, { title: rows[0].title }) : f(t.hc.addedN, { n: rows.length }) });
    } catch {
      toast.error(t.sm.main.failed);
    }
  };
  return (
    <Card id="due" title={t.hc.names.due} icon={WIDGET_ICON.due} className="h-full">
      {due.length === 0 ? (
        <p className="flex flex-1 items-center text-[13px] text-muted" data-widget-empty>
          {t.hc.dueEmpty}
        </p>
      ) : size === "small" ? (
        <div className="flex min-h-0 flex-1 flex-col justify-end" data-due-n={due.length}>
          <b className="tabular block text-[36px] font-extrabold leading-none tracking-[-0.03em] text-[var(--k)]" data-big>
            {due.length}
          </b>
          <span className="mt-1 text-[13px] text-muted">{due.length === 1 ? t.hc.dueOne : t.hc.dueN}</span>
          {!ro && (
            <button type="button" onClick={() => void add(due)} className="mt-2 inline-flex h-9 w-fit items-center rounded-full bg-[color-mix(in_srgb,var(--k)_14%,var(--surface))] px-3.5 text-[13.5px] font-bold text-[color-mix(in_srgb,var(--k)_80%,var(--ink))] transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.96]" data-due-all>
              {t.hc.addAll}
            </button>
          )}
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col justify-center" data-due-rows>
          {due.slice(0, 3).map((x) => (
            <li key={x.productKey} className="flex h-[38px] items-center gap-2.5" data-due-row={x.productKey}>
              <ProductTile art={x.art} section={x.section} size={30} />
              <span className="bidi min-w-0 flex-1 truncate text-[14px] font-bold">{x.title}</span>
              <span className="shrink-0 text-[12.5px] text-muted">{t.hc.dueAt.today}</span>
              {!ro && (
                <button type="button" onClick={() => void add([x])} className="grid size-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--k)_14%,var(--surface))] text-[var(--k)] transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.9]" aria-label={f(t.hc.add, { name: x.title })} data-due-add={x.productKey}>
                  <Plus className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Donut({ pct, size, label }: { pct: number; size: number; label: React.ReactNode }) {
  const w = size * 0.16;
  const r = size / 2 - w / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} data-budget-ring={Math.round(pct * 100)}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in srgb, var(--k) 16%, var(--line-in))" strokeWidth={w} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={pct > 1 ? "var(--warn)" : pct >= 0.8 ? "var(--warn)" : "var(--k)"} strokeWidth={w} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))} className="transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out)]" />
      </svg>
      <span className="relative tabular text-[17px] font-extrabold">{label}</span>
    </span>
  );
}

export function BudgetWidget({ size }: { size: Size }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const b = useMonthBudget(home);
  const money = (n: number) => formatMoney(Math.round(n), s.currency, locale);
  const month = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", timeZone: s.clock.tz }).format(new Date(s.clock.now));
  const goSpend = () => s.setView({ type: "spending" });
  const pace = b.pace === "ahead" ? t.hc.ahead : b.pace === "behind" ? t.hc.behind : t.hc.onPace;
  const title = f(t.hc.monthBudget, { month });
  if (b.cap == null || b.pct == null)
    return (
      <Card id="budget" title={title} icon={WIDGET_ICON.budget} className="h-full">
        <button type="button" onClick={() => s.openSettings("space")} className="flex flex-1 flex-col items-start justify-end gap-1 text-start" data-budget-none>
          <span className="text-[13px] text-muted">{t.hc.budgetNone}</span>
          <span className="text-[14px] font-bold text-[var(--k)]">{t.hc.setBudget}</span>
        </button>
      </Card>
    );
  const pct = b.pct;
  const label = `${Math.round(pct * 100)}%`;
  return (
    <Card id="budget" title={title} icon={WIDGET_ICON.budget} className={cn("h-full", pct >= 0.8 && "wv2-warn")}>
      <button type="button" onClick={goSpend} className="flex min-h-0 flex-1 items-center gap-4 text-start" aria-label={`${title}: ${label}`} data-budget-open data-budget-pct={Math.round(pct * 100)}>
        {size === "small" ? (
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <Donut pct={pct} size={84} label={label} />
            <span className="tabular block w-full truncate text-[12.5px] text-muted">
              <b className="font-extrabold text-ink">{money(b.used)}</b> {f(t.hc.budgetOf, { amount: money(b.cap), pace })}
            </span>
          </span>
        ) : (
          <>
            <Donut pct={pct} size={96} label={label} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <b className="tabular truncate text-[30px] font-extrabold leading-none tracking-[-0.03em]" data-big>
                {money(b.used)}
              </b>
              <span className="tabular truncate text-[12.5px] text-muted">{f(t.hc.budgetOf, { amount: money(b.cap), pace })}</span>
              <span className="mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold">
                <i className="size-2 rounded-[3px] bg-[var(--k)]" />
                <span className="tabular truncate">{f(t.hc.smShare, { amount: money(b.supermarket) })}</span>
              </span>
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                <i className="size-2 rounded-[3px] bg-[color-mix(in_srgb,var(--k)_40%,var(--line-strong))]" />
                <span className="tabular truncate">{f(t.hc.prodShare, { amount: money(b.products) })}</span>
              </span>
            </span>
          </>
        )}
      </button>
    </Card>
  );
}
