// Polish #6: the letter on an avatar / space tile is the first *grapheme*, never `name[0]`. A name that starts with an
// emoji ("👩🏽‍💻 Priya") would otherwise give half a surrogate pair, which the server streams as U+FFFD and the client
// renders as itself — a hydration mismatch on every page that shows that person.
const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The first user-perceived character of `name`, upper-cased (`fallback` when empty). */
export function initialOf(name: string | null | undefined, fallback = "?") {
  const s = (name ?? "").trim();
  if (!s) return fallback;
  const first = seg ? (seg.segment(s)[Symbol.iterator]().next().value?.segment ?? "") : (Array.from(s)[0] ?? "");
  return first.toUpperCase() || fallback;
}
