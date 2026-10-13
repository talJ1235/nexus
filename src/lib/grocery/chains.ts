// R18 S2 D2 — Israeli supermarket chains for the store picker (client-safe): names in both languages + the monogram
// colour (the onboarding tiles' m1–m9). Branches aren't a directory here (the chains' own branch files arrive with the
// price-transparency work, R19): a branch is what the home typed, kept per space in `space_store`.
import { normalize } from "./normalize";

export type Chain = { id: string; en: string; he: string; color: string; also?: string[] };

export const CHAINS: Chain[] = [
  { id: "shufersal", en: "Shufersal", he: "שופרסל", color: "m2", also: ["shufersal deal", "שופרסל דיל", "shufersal sheli", "שופרסל שלי"] },
  { id: "rami-levy", en: "Rami Levy", he: "רמי לוי", color: "m1" },
  { id: "victory", en: "Victory", he: "ויקטורי", color: "m4" },
  { id: "yochananof", en: "Yochananof", he: "יוחננוף", color: "m7" },
  { id: "osher-ad", en: "Osher Ad", he: "אושר עד", color: "m5" },
  { id: "tiv-taam", en: "Tiv Taam", he: "טיב טעם", color: "m2" },
  { id: "carrefour", en: "Carrefour", he: "קרפור", color: "m3", also: ["yeinot bitan", "יינות ביתן"] },
  { id: "hatzi-hinam", en: "Hatzi Hinam", he: "חצי חינם", color: "m6" },
  { id: "am-pm", en: "AM:PM", he: "AM:PM", color: "m9", also: ["ampm", "am pm"] },
  { id: "keshet-teamim", en: "Keshet Teamim", he: "קשת טעמים", color: "m8" },
  { id: "super-yuda", en: "Super Yuda", he: "סופר יודה", color: "m4" },
  { id: "mahsanei-hashuk", en: "Mahsanei HaShuk", he: "מחסני השוק", color: "m7" },
];

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
