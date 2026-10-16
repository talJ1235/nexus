// R17 H — onboarding (board Onboarding-phone / -desktop, direction A): the steps, the answers and what they set. Pure.
import type { PresetId } from "./home-layout";

export const ONBOARDING_KEY = "pref:onboarding";
/** R18 S5 F1: 1 why · 2 your home · 3 stores · 4 how you shop · 5 food at home · 6 budget · 7 install · 8 notifications ·
 *  9 done (R17 had 7: why · stores · budget · who · install · notifications · done — old saved steps are mapped). */
export const STEPS = 9;
/** The steps the Home card's "3 quick questions" asks people who finished onboarding before S5. */
export const QUICK_STEPS = [2, 4, 5, 6] as const;
/** An R17 step number → its S5 place. */
const OLD_STEP = [1, 1, 3, 6, 2, 7, 8, 9];

export const FREQ = ["weekly", "twice", "few", "biweekly"] as const;
export type Freq = (typeof FREQ)[number];
export const MODES = ["store", "online", "both"] as const;
export type Mode = (typeof MODES)[number];
export const DIETS = ["kosher", "mehadrin", "vegetarian", "vegan", "gluten", "lactose", "nuts", "organic"] as const;
export type Diet = (typeof DIETS)[number];
/** Days a shop happens (FREQ) → days between shops, for staples' timing and the evening-before reminder. */
export const FREQ_DAYS: Record<Freq, number> = { weekly: 7, twice: 3.5, few: 3, biweekly: 14 };

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
  /** R18 S2 F2: supermarket chains (lib/grocery/chains ids; the first = the main store), its branch, "several branches". */
  chains?: string[];
  branch?: string | null;
  several?: boolean;
  // ---- R18 S5 F2–F5 (all optional: older answers keep working) ----
  /** Steps numbered the S5 way (9 steps). */
  s9?: boolean;
  adults?: number;
  kids?: number;
  babies?: number;
  pets?: number;
  freq?: Freq | null;
  /** Usual shopping days, 0 = Sunday. */
  days?: number[];
  mode?: Mode | null;
  diet?: Diet[];
  /** Shabbat and holidays at home (the Friday / holiday nudges). */
  shabbat?: boolean;
  /** Of the household budget, the supermarket's part. */
  smShare?: number | null;
  /** The budget month starts on this day (1–28). */
  startDay?: number;
  /** "Not sure yet — learn it from my first month": no budget until the first month closes. */
  learnBudget?: boolean;
  /** The Home card for people who finished before S5: "pending" (offer it), "done", "dismissed". */
  quick?: "done" | "dismissed";
  at: number;
};

export const freshOnboarding = (now = Date.now()): Onboarding => ({ v: 1, status: "active", step: 1, why: [], stores: [], custom: [], budget: null, currency: "ILS", who: null, sharedSpaceId: null, notif: null, installed: false, s9: true, at: now });

export function parseOnboarding(raw: string | null | undefined): Onboarding | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Onboarding>;
    if (v?.v !== 1) return null;
    const o = { ...freshOnboarding(v.at ?? 0), ...v } as Onboarding;
    // R18 S5: an R17 answer set resumes at the same question in the 9-step flow.
    if (!v.s9) o.step = OLD_STEP[Math.max(1, Math.min(7, Math.round(o.step) || 1))];
    o.s9 = true;
    return sanitize(o);
  } catch {
    return null;
  }
}

const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);
/** Stored answers within their ranges (junk dropped, never thrown). */
function sanitize(o: Onboarding): Onboarding {
  const out: Onboarding = { ...o, step: int(o.step, 1, STEPS) ?? 1 };
  for (const k of ["adults", "kids", "babies", "pets"] as const) {
    const n = int(o[k], k === "adults" ? 1 : 0, 12);
    if (n === undefined) delete out[k];
    else out[k] = n;
  }
  out.freq = FREQ.includes(o.freq as Freq) ? o.freq : null;
  out.mode = MODES.includes(o.mode as Mode) ? o.mode : null;
  out.days = Array.isArray(o.days) ? [...new Set(o.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  out.diet = Array.isArray(o.diet) ? o.diet.filter((d): d is Diet => DIETS.includes(d)) : [];
  out.startDay = int(o.startDay, 1, 28) ?? 1;
  out.smShare = o.smShare == null ? null : int(o.smShare, 0, 1_000_000) ?? null;
  return out;
}

/** People at home: the counts when given, else what "who" says (me 1, couple 2, family 4). */
export function people(o: Pick<Onboarding, "who" | "adults" | "kids" | "babies">) {
  if (o.adults != null) return o.adults + (o.kids ?? 0) + (o.babies ?? 0);
  return o.who === "family" ? 4 : o.who === "partner" ? 2 : 1;
}

/** F5: the supermarket's share of a household budget to start from, by the home's size (a starting point, labelled so). */
export function smShareStart(size: number) {
  return size <= 1 ? 0.35 : size === 2 ? 0.4 : size <= 4 ? 0.45 : 0.5;
}

/** F2: "who you shop for" → the counts it starts from. */
export function countsFor(who: Who | null): { adults: number; kids: number } {
  return who === "family" ? { adults: 2, kids: 2 } : who === "partner" ? { adults: 2, kids: 0 } : { adults: 1, kids: 0 };
}

/** F3: the next usual shopping day from `weekday` (today included), or null without days. */
export function nextShopDay(days: number[] | undefined, weekday: number) {
  if (!days?.length) return null;
  for (let k = 0; k < 7; k++) if (days.includes((weekday + k) % 7)) return (weekday + k) % 7;
  return null;
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
