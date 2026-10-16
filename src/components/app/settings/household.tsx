"use client";

import { useEffect, useRef, useState } from "react";
import { budgetShape, getOnboarding, saveBudgetShape, saveOnboarding } from "@/app/onboarding-actions";
import { useI18n } from "@/components/providers";
import { DIETS, FREQ, MODES, type Onboarding } from "@/lib/onboarding";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import type { PageProps } from "./shell";
import { capFor, monthKeyIn } from "@/lib/budget";
import { Li, P, SectionHead, Sel, Toggle } from "./ui";

// R18 S5 F6 — the onboarding answers, editable where they act: Settings → Household (who, people at home, food),
// Supermarket → shopping habits (how often, days, store / online), Space → Budget (supermarket share, month start day,
// "learn it from my first month"). Each change is saved at once; the server reads the answers on every suggestion,
// reminder and Spending month, so it takes effect immediately.

type Answers = Onboarding;
type Patch = Parameters<typeof saveOnboarding>[0];

/** The person's answers, loaded once per mount; `save` updates the screen first and rolls back on failure. */
function useAnswers() {
  const { t } = useI18n();
  const [o, setO] = useState<Answers | null>(null);
  const cur = useRef<Answers | null>(null);
  useEffect(() => {
    let live = true;
    getOnboarding().then(
      (x) => {
        if (!live) return;
        cur.current = x;
        setO(x);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  const save = (p: Patch) => {
    const before = cur.current;
    if (!before) return;
    const next = { ...before, ...p } as Answers;
    cur.current = next;
    setO(next);
    saveOnboarding(p).catch(() => {
      cur.current = before;
      setO(before);
      toast.error(t.errors.generic);
    });
  };
  return { o, save };
}

function Chip({ on, onClick, children, ...rest }: { on: boolean; onClick: () => void; children: React.ReactNode } & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-full border px-3.5 text-[14px] font-semibold transition-[background-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
        on ? "border-ink bg-ink text-bg" : "border-line-strong text-ink hover:bg-surface-2",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function Group({ title, sub, children, ...rest }: { title: string; sub?: string; children: React.ReactNode } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div className="flex flex-col gap-2.5" {...rest}>
      <div>
        <b className="block text-[15px]">{title}</b>
        {sub && <span className="tiny">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

/** Settings → Household: who you shop for, how many at home, food choices. */
export function HouseholdPage({ phone }: PageProps) {
  const { t, f } = useI18n();
  const O = t.ob;
  const H = t.sx.hh;
  const { o, save } = useAnswers();
  if (!o) return <div className="card" style={{ height: 240 }} aria-busy="true" data-settings-household />;
  const n = { adults: o.adults ?? (o.who === "me" ? 1 : 2), kids: o.kids ?? 0, babies: o.babies ?? 0, pets: o.pets ?? 0 };
  const rows = [
    ["adults", O.home5.adults, O.home5.adultsSub, 1],
    ["kids", O.home5.kids, O.home5.kidsSub, 0],
    ["babies", O.home5.babies, O.home5.babiesSub, 0],
    ["pets", O.home5.pets, O.home5.petsSub, 0],
  ] as const;
  return (
    <div className="flex flex-col gap-5" data-settings-household>
      {!phone && (
        <SectionHead title={t.sx.sections.household}>
          <span className="sub">{H.sub}</span>
        </SectionHead>
      )}
      {phone && <p className="sub" style={{ margin: "-4px 4px 0" }}>{H.sub}</p>}
      <Group title={H.who}>
        <div className="seg" role="radiogroup" aria-label={H.who} style={{ width: "100%" }}>
          {(["me", "partner", "family"] as const).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={o.who === w} className={o.who === w ? "on" : ""} style={{ flex: 1, justifyContent: "center", height: 40 }} onClick={() => save({ who: w })} data-hh-who={w}>
              {w === "me" ? O.home5.just : w === "partner" ? O.home5.couple : O.home5.family}
            </button>
          ))}
        </div>
      </Group>
      <Group title={H.people}>
        <div className="card" style={{ padding: 0 }}>
          {rows.map(([k, label, sub, min]) => (
            <Li key={k} title={label} sub={sub} data-hh-count={k}>
              <span className="flex items-center gap-1.5">
                <button type="button" className="btn icon" style={{ width: 40, height: 40, borderRadius: 20 }} disabled={n[k] <= min} onClick={() => save({ [k]: n[k] - 1 })} aria-label={f(O.home5.less, { what: label })} data-hh-less={k}>
                  −
                </button>
                <b className="num" style={{ minWidth: 26, textAlign: "center", fontSize: 17 }} data-hh-n={k}>
                  {n[k]}
                </b>
                <button type="button" className="btn icon" style={{ width: 40, height: 40, borderRadius: 20 }} disabled={n[k] >= 12} onClick={() => save({ [k]: n[k] + 1 })} aria-label={f(O.home5.more, { what: label })} data-hh-more={k}>
                  +
                </button>
              </span>
            </Li>
          ))}
        </div>
      </Group>
      <Group title={H.food} sub={H.foodSub}>
        <div className="flex flex-wrap gap-2">
          {DIETS.map((k) => {
            const on = (o.diet ?? []).includes(k);
            return (
              <Chip key={k} on={on} onClick={() => save({ diet: on ? (o.diet ?? []).filter((x) => x !== k) : [...(o.diet ?? []), k] })} data-hh-diet={k}>
                {O.food[k]}
              </Chip>
            );
          })}
        </div>
        <div className="card">
          <Li title={O.food.shabbat} sub={O.food.shabbatSub}>
            <Toggle on={!!o.shabbat} label={O.food.shabbat} onChange={(v) => save({ shabbat: v })} data-hh-shabbat />
          </Li>
        </div>
      </Group>
    </div>
  );
}

/** Settings → Supermarket: how often, the usual days, in the store / online. */
export function SmHabits() {
  const { t } = useI18n();
  const O = t.ob.habits;
  const { o, save } = useAnswers();
  if (!o) return null;
  const days = o.days ?? [];
  return (
    <div className="flex flex-col gap-4" data-sm-habits>
      <Group title={O.often}>
        <div className="flex flex-wrap gap-2">
          {FREQ.map((k) => (
            <Chip key={k} on={o.freq === k} onClick={() => save({ freq: o.freq === k ? null : k })} data-hh-freq={k}>
              {O[k]}
            </Chip>
          ))}
        </div>
      </Group>
      <Group title={O.days} sub={days.length ? t.sx.hh.daysSub : undefined}>
        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={O.days}>
          {O.wd.map((d, k) => {
            const on = days.includes(k);
            return (
              <Chip key={k} on={on} onClick={() => save({ days: on ? days.filter((x) => x !== k) : [...days, k].sort() })} data-hh-day={k}>
                {d}
              </Chip>
            );
          })}
        </div>
      </Group>
      <Group title={O.how}>
        <div className="flex flex-wrap gap-2">
          {MODES.map((k) => (
            <Chip key={k} on={o.mode === k} onClick={() => save({ mode: o.mode === k ? null : k })} data-hh-mode={k}>
              {O[k]}
            </Chip>
          ))}
        </div>
      </Group>
    </div>
  );
}

/** Space → Budget: the supermarket's share, the month's start day, and (personal space) "learn it from my first month". */
export function BudgetShape({ ro }: { ro: boolean }) {
  const s = useStore();
  const { t, f } = useI18n();
  const B = t.ob.bud5;
  const H = t.sx.hh;
  const [shape, setShape] = useState<{ startDay: number; smShare: number | null } | null>(null);
  const personal = s.space?.kind !== "shared";
  const { o, save } = useAnswers();
  useEffect(() => {
    let live = true;
    budgetShape().then((x) => live && setShape(x), () => {});
    return () => {
      live = false;
    };
  }, [s.spaceId]);
  if (!shape) return null;
  const put = (p: Partial<typeof shape>) => {
    const before = shape;
    setShape({ ...shape, ...p });
    saveBudgetShape(p).catch(() => {
      setShape(before);
      toast.error(t.errors.generic);
    });
  };
  const cur = s.currency === "ILS" ? "₪" : s.currency === "USD" ? "$" : s.currency === "EUR" ? "€" : "";
  return (
    <div className="card" data-budget-shape>
      <Li icon={P.supermarket} title={B.sm} sub={H.smSub}>
        <label className="input" style={{ height: 40, width: 130 }}>
          <span className="sub">{cur}</span>
          <input
            key={shape.smShare ?? "none"}
            inputMode="numeric"
            dir="ltr"
            disabled={ro}
            defaultValue={shape.smShare ?? ""}
            placeholder={H.none}
            aria-label={B.sm}
            style={{ textAlign: "end", width: "100%" }}
            onBlur={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, "");
              const v = raw ? Math.min(1_000_000, Number(raw)) : null;
              if (v !== shape.smShare) put({ smShare: v });
            }}
            data-budget-sm-share
          />
        </label>
      </Li>
      <Li icon={P.calendar} title={B.monthStarts} sub={shape.startDay === 1 ? B.d1 : f(B.dayN, { n: shape.startDay })}>
        <Sel value={String(shape.startDay)} disabled={ro} label={B.monthStarts} options={Array.from({ length: 28 }, (_, k) => ({ value: String(k + 1), label: String(k + 1) }))} onChange={(v) => put({ startDay: Number(v) })} data-budget-start />
      </Li>
      {/* Only while there's no budget this month — turning it on never clears a budget that's set. */}
      {personal && o && (o.learnBudget || !capFor(monthKeyIn(s.clock.now, s.clock.tz), s.budget)?.cap) && (
        <Li icon={P.ai} title={B.learn} sub={B.learnOn}>
          <Toggle on={!!o.learnBudget} disabled={ro} label={B.learn} onChange={(v) => save({ learnBudget: v })} data-budget-learn />
        </Li>
      )}
    </div>
  );
}
