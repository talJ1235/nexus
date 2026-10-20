// R18 S2 D2 — Israeli supermarket chains for the store picker (client-safe): names in both languages + the monogram
// colour (the onboarding tiles' m1–m9). Branches aren't a directory here (the chains' own branch files arrive with the
// price-transparency work, R19): a branch is what the home typed, kept per space in `space_store`.
import { normalize } from "./normalize";

/**
 * R19: `scraper` = the chain's name in the pinned OpenIsraeliSupermarkets scrapers (scripts/prices) — every chain of the
 * price-transparency list is here; `pharm` = a drugstore chain (listed after the food chains); its logo is
 * `public/chains/<id>.webp` (A10). `food: false` hides it from the onboarding tiles (they keep the 12 big chains).
 */
export type Chain = { id: string; en: string; he: string; color: string; also?: string[]; scraper?: string; pharm?: boolean; big?: boolean };

/** The monogram colours m1–m9 (also the start-shopping screen's Auto colour, R18 S5 B2). */
export const MONO_HEX: Record<string, string> = { m1: "#c0392b", m2: "#1f7a4d", m3: "#1d5fa8", m4: "#b8860b", m5: "#6c3fb5", m6: "#d1495b", m7: "#2a7f8f", m8: "#5b5a56", m9: "#e07a24" };

export const CHAINS: Chain[] = [
  { id: "shufersal", en: "Shufersal", he: "שופרסל", color: "m2", also: ["shufersal deal", "שופרסל דיל", "shufersal sheli", "שופרסל שלי", "be", "יש חסד"], scraper: "SHUFERSAL", big: true },
  { id: "rami-levy", en: "Rami Levy", he: "רמי לוי", color: "m1", scraper: "RAMI_LEVY", big: true },
  { id: "victory", en: "Victory", he: "ויקטורי", color: "m4", scraper: "VICTORY_NEW_SOURCE", big: true },
  { id: "yochananof", en: "Yochananof", he: "יוחננוף", color: "m7", scraper: "YOHANANOF", big: true },
  { id: "osher-ad", en: "Osher Ad", he: "אושר עד", color: "m5", scraper: "OSHER_AD", big: true },
  { id: "tiv-taam", en: "Tiv Taam", he: "טיב טעם", color: "m2", scraper: "TIV_TAAM", big: true },
  { id: "carrefour", en: "Carrefour", he: "קרפור", color: "m3", also: ["yeinot bitan", "יינות ביתן"], scraper: "YAYNO_BITAN_AND_CARREFOUR", big: true },
  { id: "hatzi-hinam", en: "Hatzi Hinam", he: "חצי חינם", color: "m6", scraper: "HAZI_HINAM", big: true },
  { id: "am-pm", en: "AM:PM", he: "AM:PM", color: "m9", also: ["ampm", "am pm", "dor alon", "דור אלון", "alonit", "אלונית"], scraper: "DOR_ALON", big: true },
  { id: "keshet-teamim", en: "Keshet Teamim", he: "קשת טעמים", color: "m8", scraper: "KESHET", big: true },
  { id: "super-yuda", en: "Super Yuda", he: "סופר יודה", color: "m4", scraper: "SUPER_YUDA", big: true },
  { id: "mahsanei-hashuk", en: "Mahsanei HaShuk", he: "מחסני השוק", color: "m7", scraper: "MAHSANI_ASHUK_NEW_SOURCE", big: true },
  // R19 A10: the rest of the transparency list (every chain that publishes its prices).
  { id: "king-store", en: "King Store", he: "קינג סטור", color: "m3", scraper: "KING_STORE" },
  { id: "freshmarket", en: "Freshmarket", he: "פרשמרקט", color: "m2", also: ["super dosh", "סופר דוש"], scraper: "FRESH_MARKET_AND_SUPER_DOSH" },
  { id: "netiv-hahesed", en: "Netiv HaHesed", he: "נתיב החסד", color: "m5", also: ["super hesed", "סופר חסד", "barkal", "ברכל"], scraper: "NETIV_HASED" },
  { id: "zol-vebegadol", en: "Zol VeBegadol", he: "זול ובגדול", color: "m6", scraper: "ZOL_VEBEGADOL" },
  { id: "shuk-hair", en: "Shuk HaIr", he: "שוק העיר", color: "m9", scraper: "SHUK_AHIR" },
  { id: "city-market", en: "City Market", he: "סיטי מרקט", color: "m1", scraper: "CITY_MARKET_SHOPS" },
  { id: "city-market-kg", en: "City Market Kiryat Gat", he: "סיטי מרקט קריית גת", color: "m1", scraper: "CITY_MARKET_KIRYATGAT" },
  { id: "stop-market", en: "Stop Market", he: "סטופ מרקט", color: "m4", scraper: "STOP_MARKET" },
  { id: "maayan-2000", en: "Maayan 2000", he: "מעיין אלפיים", color: "m7", scraper: "MAAYAN_2000" },
  { id: "shefa-birkat-hashem", en: "Shefa Birkat HaShem", he: "שפע ברכת השם", color: "m8", scraper: "SHEFA_BARCART_ASHEM" },
  { id: "mishnat-yosef", en: "Mishnat Yosef", he: "משנת יוסף", color: "m3", scraper: "MESHMAT_YOSEF_2" },
  { id: "mishnat-yosef-online", en: "Mishnat Yosef Online", he: "משנת יוסף אונליין", color: "m3", scraper: "MESHMAT_YOSEF_1" },
  { id: "bareket", en: "Bareket", he: "ברקת", color: "m6", scraper: "BAREKET" },
  { id: "polizer", en: "Polizer", he: "פוליצר", color: "m5", scraper: "POLIZER" },
  { id: "salach-dabach", en: "Salach Dabach", he: "סאלח דבאח", color: "m9", scraper: "SALACH_DABACH" },
  { id: "super-sapir", en: "Super Sapir", he: "סופר ספיר", color: "m2", scraper: "SUPER_SAPIR" },
  { id: "het-cohen", en: "H. Cohen", he: "ח. כהן", color: "m8", scraper: "HET_COHEN_NEW_SOURCE" },
  { id: "yellow", en: "Yellow", he: "יילו", color: "m4", scraper: "YELLOW" },
  { id: "wolt-market", en: "Wolt Market", he: "וולט מרקט", color: "m3", scraper: "WOLT" },
  { id: "super-pharm", en: "Super-Pharm", he: "סופר-פארם", color: "m1", scraper: "SUPER_PHARM", pharm: true },
  { id: "good-pharm", en: "Good Pharm", he: "גוד פארם", color: "m7", scraper: "GOOD_PHARM", pharm: true },
];

/** R19 A10: the chains a scraper name stands for (scripts/prices folders are named by scraper). */
export const chainByScraper = (scraper: string) => CHAINS.find((c) => c.scraper === scraper) ?? null;
/** The logo file of a chain (A10; every chain has one — `test:prices` checks). */
export const chainLogo = (id: string) => `/chains/${id}.webp`;

const names = (c: Chain) => [c.en, c.he, ...(c.also ?? [])].map((n) => normalize(n));

export const chainById = (id: string | null | undefined) => (id ? CHAINS.find((c) => c.id === id || c.en === id || c.he === id) ?? null : null);

/**
 * "rami levy modiin" → { chain: Rami Levy, branch: "modiin" }; "רמי" → { partial: [Rami Levy] }. The longest chain name
 * the text starts with wins; text that only starts a chain's name lists the chains it could be.
 */
export function parseStoreQuery(q: string): { chain: Chain | null; branch: string; partial: Chain[] } {
  const text = normalize(q);
  if (!text) return { chain: null, branch: "", partial: [] };
  let best: { c: Chain; n: string } | null = null;
  for (const c of CHAINS) for (const n of names(c)) if ((text === n || text.startsWith(`${n} `)) && (!best || n.length > best.n.length)) best = { c, n };
  if (best) {
    // The branch keeps what was typed (case, spelling), minus the chain's words.
    const words = q.trim().split(/\s+/);
    const drop = best.n.split(" ").length;
    return { chain: best.c, branch: words.slice(drop).join(" "), partial: [] };
  }
  return { chain: null, branch: "", partial: CHAINS.filter((c) => names(c).some((n) => n.startsWith(text) || n.split(" ").some((w) => w.startsWith(text)))) };
}
