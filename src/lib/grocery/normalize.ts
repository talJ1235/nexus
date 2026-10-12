// R18 A4 — text normalisation for matching grocery names (client-safe). Hebrew: final letters → regular, niqqud and
// geresh / gershayim removed (״ and " are the same thing then), maqaf → space; English: lower case. Punctuation goes,
// except the % and the decimal point inside numbers ("3%", "1.5"). Extra spaces collapse.

const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const NIQQUD = /[֑-ׇ]/g;
const QUOTES = /[׳״'"`‘’“”´]/g;

export function normalize(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(NIQQUD, "")
    .replace(QUOTES, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^\p{L}\p{N}%.\s]/gu, " ")
    .replace(/(^|\s)\.+|\.+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const tokens = (text: string) => normalize(text).split(" ").filter(Boolean);

/** Hebrew one-letter prefixes that stick to a word: "ו" and, "ה" the, "ב" in, "ל" to, "מ" from, "ש" that, "כ" as. */
const PREFIX = /^[והבלמשכ]/;
/** Does text token `t` stand for dictionary token `w`? Exact, a Hebrew prefix letter, or an English plural. */
export function tokenIs(t: string, w: string) {
  if (t === w) return true;
  if (t.length === w.length + 1 && PREFIX.test(t) && t.slice(1) === w && /[א-ת]/.test(w)) return true;
  if (/^[a-z]/.test(w) && (t === `${w}s` || t === `${w}es` || (w.endsWith("y") && t === `${w.slice(0, -1)}ies`))) return true;
  return false;
}

/** Levenshtein distance (small strings only: names typed in an add field). */
export function editDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
