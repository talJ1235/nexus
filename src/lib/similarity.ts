const STOP = new Set(["the", "a", "an", "for", "and", "with", "of", "to", "in", "on", "new", "pcs", "pc", "set", "1pc", "1pcs", "free", "shipping", "hot", "sale", "את", "של", "עם", "ל", "ב", "ו"]);

export function tokens(s: string) {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Jaccard similarity on word tokens, 0..1 */
export function titleSimilarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size < 2 || tb.size < 2) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
