import "server-only";
import { cookies } from "next/headers";
import { CURRENCIES, CURRENCY_COOKIE, type Currency } from "./money";

export async function getCurrencyPref(): Promise<Currency> {
  const v = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return (CURRENCIES as readonly string[]).includes(v ?? "") ? (v as Currency) : "ILS";
}

export const LAYOUT_COOKIE = "nexus_layout";
export const SORT_COOKIE = "nexus_sort";
export const SIDEBAR_COOKIE = "nexus_sidebar";
export const PHONE_LAYOUT_COOKIE = "nexus_phone_layout";
const LAYOUTS = ["cards", "table"] as const;
const PHONE_LAYOUTS = ["cards", "rows"] as const;
const SORTS = ["newest", "price", "priority", "name"] as const;

/** Per-device view prefs, read on the server so the first paint already uses them (no cards → table swap). */
export async function getUiPrefs() {
  const jar = await cookies();
  const l = jar.get(LAYOUT_COOKIE)?.value;
  const s = jar.get(SORT_COOKIE)?.value;
  const pl = jar.get(PHONE_LAYOUT_COOKIE)?.value;
  return {
    sidebarCollapsed: jar.get(SIDEBAR_COOKIE)?.value === "collapsed",
    layout: (LAYOUTS as readonly string[]).includes(l ?? "") ? (l as (typeof LAYOUTS)[number]) : null,
    sort: (SORTS as readonly string[]).includes(s ?? "") ? (s as (typeof SORTS)[number]) : null,
    phoneLayout: (PHONE_LAYOUTS as readonly string[]).includes(pl ?? "") ? (pl as (typeof PHONE_LAYOUTS)[number]) : null,
  };
}
