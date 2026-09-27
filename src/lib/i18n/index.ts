import { en, type Dict } from "./en";
import { he } from "./he";

export type Locale = "en" | "he";
export const LOCALE_COOKIE = "nexus_locale";
export const dictionaries: Record<Locale, Dict> = { en, he };

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "he";
}

export function fmt(template: string, vars: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export type { Dict };
