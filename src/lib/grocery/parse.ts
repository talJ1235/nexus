// R18 C1 + C4 — typed lines, pasted lists and voice lines → list entries (pure, client-safe).
// parseLine("2 חלב 3%") → qty 2 + "חלב 3%"; "1.5 ק״ג עגבניות" → 1.5 kg; "חצי קילו גבינה" → 0.5 kg. Numbers inside or
// after the name stay in the name ("3%", "פסטה 500 גרם" = a pack size). splitList cuts a WhatsApp paste / a voice
// transcript into parts; each part is parsed and classified, and lines that aren't products come back as notes.

import type { Unit } from "./dictionary";
import { classifyLocal, type Classified } from "./classify";
import { normalize } from "./normalize";

export type Parsed = {
  /** Unit count (≥ 1). */
  qty: number;
  /** Weight / volume for kg / g / L (null = counted in units). */
  amount: number | null;
  unit: Unit | null;
  name: string;
};

const UNIT_RE: [RegExp, Unit, number][] = [
  [/^(ק["״']?ג|קילו(?:גרם)?|kg|kgs|kilo(?:s|gram|grams)?)$/i, "kg", 1],
  [/^(גרם|גר['׳]?|g|gr|grams?)$/i, "g", 1],
  [/^(ליטר(?:ים)?|ל['׳]|l|lt|liters?|litres?)$/i, "l", 1],
  [/^(מ["״']?ל|ml)$/i, "l", 0.001],
];
const WORD_NUM: Record<string, number> = {
  אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שני: 2, שתי: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6,
  שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10, תריסר: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12, a: 1, an: 1,
  חצי: 0.5, half: 0.5, "½": 0.5,
};
export const isNumberWord = (w: string) => Object.prototype.hasOwnProperty.call(WORD_NUM, w.toLowerCase());

const num = (s: string) => {
  const t = s.replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return WORD_NUM[s.toLowerCase()] ?? null;
};
const unitOf = (w: string): [Unit, number] | null => {
  for (const [re, u, f] of UNIT_RE) if (re.test(w)) return [u, f];
  return null;
};

export function parseLine(raw: string): Parsed {
  let words = String(raw ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let qty = 1;
  let amount: number | null = null;
  let unit: Unit | null = null;
  // "×2" / "x2" / "* 2" at the end.
  const tail = words.length > 1 ? /^(?:[x×*])\s*(\d+)$/i.exec(words[words.length - 1]) ?? (/^[x×*]$/i.test(words[words.length - 2] ?? "") ? /^(\d+)$/.exec(words[words.length - 1]) : null) : null;
  if (tail) {
    qty = Number(tail[1]);
    words = words.slice(0, /^[x×*]$/i.test(words[words.length - 2] ?? "") ? -2 : -1);
  }
  // A number (or a number word) first; "2kg" glued; then maybe a unit word.
  const glued = words.length ? /^(\d+(?:[.,]\d+)?)(ק["״]?ג|kg|g|גרם|l|ml)$/i.exec(words[0]) : null;
  if (glued && words.length > 1) {
    const u = unitOf(glued[2]);
    if (u) {
      amount = Number(glued[1].replace(",", ".")) * u[1];
      unit = u[0];
      words = words.slice(1);
    }
  } else if (words.length > 1 && !/%$/.test(words[0])) {
    // "a dozen eggs", "חצי קילו"
    let n = num(words[0]);
    let used = n != null ? 1 : 0;
    if (n != null && (words[0] === "a" || words[0] === "an") && words[1] && num(words[1]) != null) {
      n = num(words[1]);
      used = 2;
    }
    if (n != null && words.length > used) {
      const u = unitOf(words[used]);
      if (u && words.length > used + 1) {
        amount = Math.round(n * u[1] * 1000) / 1000;
        unit = u[0];
        words = words.slice(used + 1);
      } else if (!(words[0] === "a" || words[0] === "an") || used === 2) {
        if (n >= 1 && Number.isInteger(n)) qty = n;
        else {
          amount = n;
          unit = "u";
        }
        words = words.slice(used);
      }
    }
  }
  if (!(qty >= 1) || qty > 999) qty = 1;
  return { qty, amount, unit, name: words.join(" ").trim() };
}

// ---------- C4: split a paste / a voice line ----------

export type SplitPart = Parsed & {
  /** The text as written (for the preview). */
  text: string;
  /** false = not a product ("something nice for Shabbat"): offered as a note, unchecked. */
  product: boolean;
  checked: boolean;
  onList: boolean;
  cls: Classified;
};

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200d\uFE0F]/gu;
/** "[10:31, 12/10/2026] Noa:" / "10:31 - Noa:" / "Noa:" at the start of a WhatsApp line. */
const SENDER = /^(?:\[[^\]]{4,30}\]\s*)?(?:\d{1,2}[:.]\d{2}\s*[-–]\s*)?([^\d:\n]{1,24}):\s*/u;
const BULLET = /^\s*(?:[-*•·▪◦–—]+|\d{1,2}[.)])\s*/u;

function cleanLine(line: string) {
  let s = line.replace(EMOJI, " ");
  s = s.replace(SENDER, "");
  s = s.replace(BULLET, "");
  s = s.replace(/[!?]{1,}/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/^[,;:.]+|[,;:.]+$/g, "").trim();
}

const NOTE_WORDS = /^(something|anything|maybe|for|to|please|dont|don't|remember|משהו|אולי|בשביל|למחר|לשבת|לארוחה|תזכור|תזכרי|אל|לא)$/i;
/** An unknown line that reads like a sentence, not a product: 4+ words, or it opens with "something" / "for" / "משהו"… */
export function looksLikeNote(text: string) {
  const w = normalize(text).split(" ").filter(Boolean);
  if (!w.length) return true;
  return w.length >= 4 || NOTE_WORDS.test(w[0]);
}

const knows = (text: string) => classifyLocal(parseLine(text).name || text).type != null;

/** "חלב, ביצים ושני לחמים" / "milk, eggs and two breads" → parts. `ו` = "and" only between two items. */
export function splitVoice(line: string): string[] {
  const out: string[] = [];
  for (const chunk of line.split(/\s*[,;،]\s*|\s+(?:and|&|וגם)\s+/i)) {
    const words = chunk.split(" ").filter(Boolean);
    let cur: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (cur.length && /^ו[\u05D0-\u05EA]/.test(w)) {
        const rest = [w.slice(1), ...words.slice(i + 1)].join(" ");
        if (isNumberWord(w.slice(1)) || (knows(cur.join(" ")) && knows(rest))) {
          out.push(cur.join(" "));
          cur = [w.slice(1)];
          continue;
        }
      }
      cur.push(w);
    }
    if (cur.length) out.push(cur.join(" "));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Split a pasted list or a voice transcript. `onList` = product keys already on the supermarket list (to buy). Lines
 * cut at commas only when every piece is a known product ("Sparkling water, 6-pack" stays one line).
 */
export function splitList(text: string, onList: Iterable<string> = []): SplitPart[] {
  const have = new Set(onList);
  const lines = String(text ?? "").split(/\r?\n/).map(cleanLine).filter(Boolean);
  const pieces: string[] = [];
  if (lines.length === 1) pieces.push(...splitVoice(lines[0]));
  else
    for (const l of lines) {
      const parts = l.split(/\s*[,;،]\s*/).filter(Boolean);
      if (parts.length > 1 && parts.every(knows)) pieces.push(...parts);
      else pieces.push(l);
    }
  return pieces.map((p) => {
    const parsed = parseLine(p);
    const cls = classifyLocal(parsed.name || p);
    const product = cls.type != null || !looksLikeNote(parsed.name || p);
    return { ...parsed, text: p, product, checked: product, onList: product && have.has(cls.productKey), cls };
  });
}

/** Display key for "is it the same line" in a preview (normalised name). */
export const lineKey = (s: string) => normalize(parseLine(s).name);
