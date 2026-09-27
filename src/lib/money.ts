// Currency helpers shared by server and client.
export const CURRENCIES = ["ILS", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_COOKIE = "nexus_currency";

/** Rates expressed as: 1 USD = rates[X] X. Always includes USD: 1. */
export type Rates = { base: "USD"; rates: Record<string, number>; fetchedAt: number };

export const FALLBACK_RATES: Rates = {
  base: "USD",
  rates: { USD: 1, ILS: 3.7, EUR: 0.9, GBP: 0.78, CNY: 7.2 },
  fetchedAt: 0,
};

export function convert(amount: number, from: string, to: string, r: Rates) {
  if (from === to) return amount;
  const f = r.rates[from];
  const t = r.rates[to];
  if (!f || !t) return amount;
  return (amount / f) * t;
}

export function formatMoney(amount: number | null | undefined, currency: string, locale: string) {
  if (amount == null || Number.isNaN(amount)) return "—";
  const digits = Math.abs(amount) >= 1000 ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** Parse "₪1,299.90", "US $12.50", "12,50 €" → { amount, currency }. */
export function parsePrice(raw: unknown, fallbackCurrency?: string): { amount: number; currency?: string } | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? { amount: raw, currency: fallbackCurrency } : null;
  const s = String(raw).trim();
  if (!s) return null;
  let currency = fallbackCurrency;
  if (/₪|ILS|NIS|ש"ח|ש״ח/i.test(s)) currency = "ILS";
  else if (/€|EUR/i.test(s)) currency = "EUR";
  else if (/£|GBP/i.test(s)) currency = "GBP";
  else if (/\$|USD/i.test(s)) currency = "USD";
  const num = s.replace(/[^\d.,]/g, "");
  if (!num) return null;
  let normalized = num;
  const lastComma = num.lastIndexOf(",");
  const lastDot = num.lastIndexOf(".");
  if (lastComma > lastDot) {
    // "1.299,90" or "12,50" → comma is decimal if followed by exactly 1-2 digits
    normalized = /,\d{1,2}$/.test(num) ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  } else {
    normalized = num.replace(/,/g, "");
  }
  const amount = parseFloat(normalized);
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
}
