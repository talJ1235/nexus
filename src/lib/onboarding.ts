// R17 H — onboarding (board Onboarding-phone / -desktop, direction A): the steps, the answers and what they set. Pure.
import type { PresetId } from "./home-layout";

export const ONBOARDING_KEY = "pref:onboarding";
/** 1 why · 2 stores · 3 budget · 4 who · 5 install · 6 notifications · 7 done. */
export const STEPS = 7;

export const WHY = ["home", "super", "proj", "price"] as const;
export type Why = (typeof WHY)[number];
export const WHO = ["me", "partner", "family"] as const;
export type Who = (typeof WHO)[number];
export const CURRENCIES = { "₪": "ILS", $: "USD", "€": "EUR" } as const;

export type Onboarding = {
  v: 1;
  status: "active" | "done" | "skipped";
  step: number;
  why: Why[];
  stores: string[];
  /** Free-text stores the person added (monogram tiles). */
  custom: string[];
  budget: number | null;
  currency: "ILS" | "USD" | "EUR";
  who: Who | null;
  sharedSpaceId: string | null;
  /** Notification permission as the browser answered (stored for Session 3's push). */
  notif: "granted" | "denied" | "default" | null;
  installed: boolean;
  at: number;
};

export const freshOnboarding = (now = Date.now()): Onboarding => ({ v: 1, status: "active", step: 1, why: [], stores: [], custom: [], budget: null, currency: "ILS", who: null, sharedSpaceId: null, notif: null, installed: false, at: now });

export function parseOnboarding(raw: string | null | undefined): Onboarding | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Onboarding>;
    if (v?.v !== 1) return null;
    return { ...freshOnboarding(v.at ?? 0), ...v } as Onboarding;
  } catch {
    return null;
  }
}

/** Home starts with: supermarket → the shopping-first preset (Minimal: left to buy + budget + suggestions), projects &
 *  hobbies → Maker, price tracking → Deal watcher, home shopping (or nothing) → Household. First match in that order
 *  of specificity when several are picked: home beats the rest (it's the broadest), then supermarket, projects, price. */
export function presetFor(why: Why[]): PresetId {
  if (why.includes("home")) return "household";
  if (why.includes("super")) return "minimal";
  if (why.includes("proj")) return "maker";
  if (why.includes("price")) return "deals";
  return "household";
}

export type StoreDef = { id: string; en: string; he: string; mono: string; monoHe: string; color: string; search?: string };

/** Israeli supermarkets and common online stores as monogram tiles (no third-party logos). `search`: the store's own
 *  search page with `{q}` — used to suggest where to look for an item (only where the address is a plain search URL). */
export const STORES: StoreDef[] = [
  { id: "shufersal", en: "Shufersal", he: "שופרסל", mono: "SH", monoHe: "שפ", color: "m2", search: "https://www.shufersal.co.il/online/he/search?text={q}" },
  { id: "rami-levy", en: "Rami Levy", he: "רמי לוי", mono: "RL", monoHe: "רל", color: "m1" },
  { id: "victory", en: "Victory", he: "ויקטורי", mono: "VI", monoHe: "וי", color: "m4" },
  { id: "yochananof", en: "Yochananof", he: "יוחננוף", mono: "YO", monoHe: "יו", color: "m7" },
  { id: "ikea", en: "IKEA", he: "איקאה", mono: "IK", monoHe: "אי", color: "m3", search: "https://www.ikea.com/il/he/search/?q={q}" },
  { id: "ksp", en: "KSP", he: "KSP", mono: "KS", monoHe: "KS", color: "m9" },
  { id: "aliexpress", en: "AliExpress", he: "AliExpress", mono: "AE", monoHe: "AE", color: "m6" },
  { id: "amazon", en: "Amazon", he: "Amazon", mono: "AZ", monoHe: "AZ", color: "m8" },
  { id: "osher-ad", en: "Osher Ad", he: "אושר עד", mono: "OA", monoHe: "אע", color: "m5" },
  { id: "tiv-taam", en: "Tiv Taam", he: "טיב טעם", mono: "TT", monoHe: "טט", color: "m2" },
  { id: "carrefour", en: "Carrefour", he: "קרפור", mono: "CF", monoHe: "קר", color: "m3" },
  { id: "super-pharm", en: "Super-Pharm", he: "סופר-פארם", mono: "SP", monoHe: "ספ", color: "m1" },
  { id: "home-center", en: "Home Center", he: "הום סנטר", mono: "HC", monoHe: "הס", color: "m9" },
  { id: "ace", en: "ACE", he: "ACE", mono: "AC", monoHe: "AC", color: "m4" },
  { id: "ivory", en: "Ivory", he: "אייבורי", mono: "IV", monoHe: "אב", color: "m7" },
  { id: "bug", en: "Bug", he: "באג", mono: "BG", monoHe: "בג", color: "m5" },
  { id: "temu", en: "Temu", he: "Temu", mono: "TM", monoHe: "TM", color: "m9" },
  { id: "shein", en: "SHEIN", he: "SHEIN", mono: "SN", monoHe: "SN", color: "m8" },
];

/** A monogram for a typed store name: the first letters of its first two words (Hebrew letters stay Hebrew). */
export function monogram(name: string) {
  const words = name.trim().split(/[\s\-–]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function storeName(id: string, he: boolean) {
  const s = STORES.find((x) => x.id === id);
  return s ? (he ? s.he : s.en) : id;
}
