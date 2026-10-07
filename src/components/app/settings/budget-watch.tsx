"use client";

import { useEffect, useMemo } from "react";
import { useI18n } from "@/components/providers";
import { capFor, monthForecast, monthKeyIn, monthStartIn, nextMonthKey } from "@/lib/budget";
import { DEFAULT_NOTIFY } from "@/lib/home";
import { toast } from "@/lib/toast";
import { useStore } from "../store";

/**
 * R16 D1/D2: "Budget reaches 80%" — one toast per space per month on each device, when this month's spending (paid +
 * on the way) reaches 80 % of the cap. Off when the person turned it off (Settings → Notifications) or the space did
 * (Space settings → Budget → "Warn everyone at 80%").
 */
export function BudgetWatch() {
  const s = useStore();
  const { t, f } = useI18n();
  const on = (s.homePrefs.notify ?? DEFAULT_NOTIFY).budget && s.budgetWarn;
  const key = monthKeyIn(s.clock.now, s.clock.tz);
  const pct = useMemo(() => {
    if (!on || s.loading) return null;
    const fc = monthForecast({ items: s.items, altGroups: s.altGroups, rates: s.rates, currency: s.currency, from: monthStartIn(key, s.clock.tz), to: monthStartIn(nextMonthKey(key), s.clock.tz), cap: capFor(key, s.budget), includeNormal: false });
    return fc.cap ? ((fc.spent + fc.committed) / fc.cap) * 100 : null;
  }, [on, s.loading, s.items, s.altGroups, s.rates, s.currency, s.budget, s.clock.tz, key]);
  const space = s.space;
  useEffect(() => {
    if (pct == null || pct < 80 || !space) return;
    const mark = `nexus.budget80:${space.id}:${key}`;
    try {
      if (localStorage.getItem(mark)) return;
      localStorage.setItem(mark, "1");
    } catch {
      return;
    }
    toast(f(t.sx.budget80Toast, { space: space.name, pct: Math.round(pct) }), { duration: 6000 });
  }, [pct, space, key, f, t]);
  return null;
}
