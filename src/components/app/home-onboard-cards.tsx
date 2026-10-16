"use client";

import { useState } from "react";
import { Sparkles, Wallet, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { saveMonthlyBudget } from "@/app/money-actions";
import { saveOnboarding } from "@/app/onboarding-actions";
import { capFor, monthKeyIn } from "@/lib/budget";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { useStore } from "./store";
import { useLastMonthTotal } from "./spending-month";

// R18 S5 F1 / F5 — two Home cards from the onboarding answers: "3 quick questions so Nexus fits your home" for people who
// finished onboarding before S5 (opens steps 2, 4, 5, 6 once; dismissible), and — when the person chose "learn it from my
// first month" — once that month has closed, Nexus proposes its total (rounded up) as the monthly budget.

const card = "flex items-center gap-3 rounded-[22px] bg-surface p-4 shadow-[inset_0_0_0_1px_var(--line-in)] desk:col-span-12";

export function HomeOnboardCards() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [quick, setQuick] = useState(s.obQuick);
  const [learnGone, setLearnGone] = useState(false);
  const capNow = capFor(monthKeyIn(s.clock.now, s.clock.tz), s.budget);
  const last = useLastMonthTotal(s.obLearnBudget && !capNow?.cap && !learnGone);
  const propose = last != null && last > 0 ? Math.ceil(last / 100) * 100 : null;
  return (
    <>
      {quick && (
        <section className={card} data-home-quick>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--spark)_16%,var(--surface))] text-spark">
            <Sparkles className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] font-extrabold leading-snug">{t.ob.quick.title}</b>
            <span className="block text-[13px] text-muted">{t.ob.quick.sub}</span>
          </span>
          <a href="/welcome?quick=1" className="inline-flex h-10 shrink-0 items-center rounded-full bg-ink px-4 text-[14px] font-bold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.96]" data-home-quick-go>
            {t.ob.quick.go}
          </a>
          <button
            type="button"
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
            aria-label={t.ob.quick.dismiss}
            onClick={() => {
              setQuick(false);
              void saveOnboarding({ quick: "dismissed" }).catch(() => {});
            }}
            data-home-quick-dismiss
          >
            <X className="size-4" />
          </button>
        </section>
      )}
      {propose != null && (
        <section className={card} data-home-learned-budget={propose}>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,#2f6fd1_14%,var(--surface))] text-[#2f6fd1]">
            <Wallet className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] font-extrabold leading-snug">{f(t.ob.learned.title, { amount: formatMoney(Math.round(last!), s.currency, locale) })}</b>
            <span className="block text-[13px] text-muted">{f(t.ob.learned.sub, { amount: formatMoney(propose, s.currency, locale) })}</span>
          </span>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center rounded-full bg-ink px-4 text-[14px] font-bold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.96]"
            onClick={async () => {
              try {
                const h = await saveMonthlyBudget(propose, s.currency);
                s.setBudget(h);
                await saveOnboarding({ learnBudget: false }).catch(() => {});
                setLearnGone(true);
                toast.success(f(t.ob.learned.set, { amount: formatMoney(propose, s.currency, locale) }));
              } catch {
                toast.error(t.errors.generic);
              }
            }}
            data-home-learned-set
          >
            {t.ob.learned.use}
          </button>
        </section>
      )}
    </>
  );
}
