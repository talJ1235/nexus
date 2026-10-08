// R17 B1 — short names for long product titles (pure; scripts/test-short-name.ts). A store title like "Two Pieces Car
// Perfume Clip Flower Air Outlet Decoration Bright Peach Blossom … AliExpress 34" becomes something a person would
// write; the original stays in items.full_title. The rules run first (and alone without AI / over quota); the AI's
// one categorize call (lib/ai.ts) is asked for the same thing and wins when it answers within the limits.

export const SHORT_MAX = 40;
/** Titles longer than this (or noisy ones) get a short name. */
export const LONG_TITLE = 50;

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };
const STORES = [
  "AliExpress",
  "Aliexpress",
  "Amazon\\.com",
  "Amazon\\.de",
  "Amazon\\.co\\.uk",
  "Amazon",
  "Temu",
  "eBay",
  "SHEIN",
  "Shein",
  "Walmart\\.com",
  "Walmart",
  "IKEA",
  "KSP",
  "Ivory",
  "Bug",
  "Zap",
  "Shufersal",
  "שופרסל",
  "רמי לוי",
  "איקאה",
  "באג",
  "איבורי",
  "זאפ",
];
const STORE_SUFFIX = new RegExp(`\\s*(?:[-|–—:·,]\\s*)?(?:${STORES.join("|")})(?:\\s*\\d{1,4})?\\s*$`, "u");
const STORE_PREFIX = new RegExp(`^(?:${STORES.join("|")})\\s*[:|–—-]\\s*`, "u");
const FILLER = [
  "brand new",
  "new arrival",
  "high quality",
  "free shipping",
  "drop shipping",
  "dropshipping",
  "hot sale",
  "fresh color",
  "fresh colour",
  "new",
  "hot",
  "sale",
  "fashion",
  "trendy",
  "popular",
  "cheap",
  "wholesale",
  "bright",
  "2023",
  "2024",
  "2025",
  "2026",
];
const COLOURS = new Set(["red", "blue", "green", "black", "white", "pink", "purple", "yellow", "orange", "grey", "gray", "gold", "silver", "brown", "beige", "navy", "khaki", "rose", "multicolor", "multicolour", "colorful", "colourful"]);
const CONNECT = new Set(["a", "an", "of", "for", "with", "and", "the", "&", "in", "to", "on", "by", "w/", "+", "-", "–", "|", ",", "עם", "של", "ל", "ו"]);

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const bare = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** The title without the store's name around it (incl. AliExpress's "AliExpress 34" with no dash) and its own store. */
export function stripStore(title: string, store?: string | null): string {
  let t = title.replace(/\s+/g, " ").trim();
  for (let k = 0; k < 2; k++) t = t.replace(STORE_SUFFIX, "").replace(STORE_PREFIX, "").trim();
  if (store && store.length >= 3) {
    const esc = store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*[-|–—:·]\\s*${esc}.*$`, "iu"), "").replace(new RegExp(`^${esc}\\s*[:|–—-]\\s*`, "iu"), "").trim();
  }
  return t.replace(/[\s,;:|–—-]+$/u, "").trim();
}

/** Does this title want a short name? Long, or carrying a store suffix / repeated words. */
export function needsShort(title: string): boolean {
  const t = title.trim();
  if (t.length > LONG_TITLE) return true;
  if (stripStore(t) !== t.replace(/\s+/g, " ")) return true;
  const seen = new Set<string>();
  for (const w of words(t).map(bare).filter((w) => w.length > 2)) {
    if (seen.has(w)) return true;
    seen.add(w);
  }
  return false;
}

/** The rules' short name (≤ SHORT_MAX characters, the title's own language) and a quantity when the title starts with
 *  one ("Two Pieces …", "10Pcs …", "Set of 3 …"). */
export function ruleShortName(title: string, store?: string | null): { name: string; qty: number | null } {
  let t = stripStore(title, store);
  let qty: number | null = null;
  // A count at the start → quantity.
  const lead = t.match(/^(?:set\s+of\s+(\d{1,3}|[a-z]+)\b|(\d{1,3}|[a-z]+)\s*-?\s*(?:pcs?|pieces?|pack|packs|pairs?|sets?|units?)\b\.?)\s*(?:of\s+|x\s+)?/i);
  if (lead) {
    const raw = (lead[1] ?? lead[2]).toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUM_WORDS[raw];
    if (n && n > 1 && n <= 100) {
      qty = n;
      t = t.slice(lead[0].length);
    }
  }
  // Filler phrases.
  for (const f of FILLER) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${f.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu"), " ");
  let ws = words(t);
  // A list of colours (2+) is variant noise.
  if (ws.filter((w) => COLOURS.has(bare(w))).length >= 2) ws = ws.filter((w) => !COLOURS.has(bare(w)));
  // Repeated words: keep the first.
  const seen = new Set<string>();
  ws = ws.filter((w) => {
    const b = bare(w);
    if (!b || CONNECT.has(b) || /^\d+$/.test(b)) return true;
    if (seen.has(b)) return false;
    seen.add(b);
    return true;
  });
  // Brackets and their content (often specs lists in Chinese-store titles) go when the name is long.
  let name = ws.join(" ").replace(/\s*[[(【][^\])】]*[\])】]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) name = stripStore(title, store);
  // A clause break (", " or " - ") after something that already names the product: stop there.
  const clause = name.split(/,\s|\s[-–—|]\s/)[0].trim();
  if (clause !== name && clause.length >= 12 && clause.length <= SHORT_MAX) name = clause;
  // Fit on a word boundary; no connector or punctuation at the end.
  if (name.length > SHORT_MAX) {
    const out: string[] = [];
    for (const w of words(name)) {
      if ([...out, w].join(" ").length > SHORT_MAX) break;
      out.push(w);
    }
    name = out.length ? out.join(" ") : name.slice(0, SHORT_MAX);
  }
  const tail = words(name);
  while (tail.length > 1 && (CONNECT.has(bare(tail[tail.length - 1]) || tail[tail.length - 1]) || /^[,;:|–—-]+$/.test(tail[tail.length - 1]))) tail.pop();
  name = tail.join(" ").replace(/[\s,;:|–—-]+$/u, "");
  return { name, qty };
}

/** An AI answer is used only within the limits (non-empty, ≤ SHORT_MAX, no store name); else the rules' name. */
export function pickShortName(title: string, ai: string | null | undefined, store?: string | null): { name: string; qty: number | null } {
  const rules = ruleShortName(title, store);
  const a = (ai ?? "").replace(/\s+/g, " ").trim();
  if (a && a.length <= SHORT_MAX && stripStore(a, store) === a) return { name: a, qty: rules.qty };
  return rules;
}
