import "server-only";
import { cookies } from "next/headers";
import { CURRENCIES, CURRENCY_COOKIE, type Currency } from "./money";

export async function getCurrencyPref(): Promise<Currency> {
  const v = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return (CURRENCIES as readonly string[]).includes(v ?? "") ? (v as Currency) : "ILS";
}
