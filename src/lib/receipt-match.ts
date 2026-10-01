// Receipt line → item matching. Pure (no DB), shared by server and client; see scripts/test-receipt.ts.

export type ReceiptLine = { name: string; qty: number; unitPrice: number | null; lineTotal: number | null; /** Set by the post-read checks (receipt-check.ts) when the numbers do not add up. */ check?: boolean };

export type MatchCandidate = {
  id: string;
  title: string;
  brand?: string | null;
  quantity: number;
  /** Stores this item has links at (storeKey + display name). */
  stores: { key: string; name: string }[];
  /** Expected unit price, already converted to the receipt's currency (null = unknown). */
  unitPrice: number | null;
};

export type Allocation = { itemId: string; qty: number; score: number };
export type LineMatch = {
  /** Items this line pays for; the qty is split across them when one item needs fewer units than were bought. */
  allocations: Allocation[];
  /** Best candidates for the "change" picker, best first (includes the allocated ones). */
  ranked: { itemId: string; score: number }[];
};

// Scores below this are not a match; a second item for the same line needs a clearly similar title.
export const MIN_SCORE = 0.4;
const MIN_TITLE = 0.3;
const SPLIT_TITLE = 0.6;

const STOP = new Set(["the", "a", "an", "for", "and", "with", "of", "to", "in", "on", "new", "pcs", "pc", "set", "x", "free", "shipping", "את", "של", "עם", "יח", "יחידות"]);
// Hebrew one/two-letter prefixes (ו ה ב ל מ ש כ) glued to a word: "והמנוע" / "למנוע" should still hit "מנוע".
const HE_PREFIXES = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ", "וה", "וב", "ול", "ומ", "וש", "שה", "בה", "לה", "מה", "כש"]);

/** Word tokens (weight 2 for tokens with digits — model numbers identify a part). "nema17" also yields "nema" + "17". */
export function matchTokens(s: string) {
  const out = new Map<string, number>();
  const add = (w: string) => {
    if (!w || STOP.has(w) || (w.length < 2 && !/\d/.test(w))) return;
    out.set(w, Math.max(out.get(w) ?? 0, /\d/.test(w) ? 2 : 1));
  };
  for (const raw of s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").split(" ")) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    const glued = w.match(/^([a-z]{2,})(\d+)$/);
    if (glued) {
      add(glued[1]);
      add(glued[2]);
    } else add(w);
  }
  return out;
}

const heEq = (a: string, b: string) => {
  if (a === b) return true;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return short.length >= 3 && /[֐-׿]/.test(short) && long.endsWith(short) && HE_PREFIXES.has(long.slice(0, long.length - short.length));
};

/** 0..1 — how much of the shorter title the other one covers (weighted), blended with plain overlap. */
export function titleScore(a: string, b: string) {
  const ta = [...matchTokens(a)];
  const tb = [...matchTokens(b)];
  if (!ta.length || !tb.length) return 0;
  const covered = (x: typeof ta, y: typeof tb) => x.reduce((n, [t, w]) => n + (y.some(([u]) => heEq(t, u)) ? w : 0), 0);
  const total = (x: typeof ta) => x.reduce((n, [, w]) => n + w, 0);
  const [ca, cb, sa, sb] = [covered(ta, tb), covered(tb, ta), total(ta), total(tb)];
  return 0.7 * Math.max(ca / sa, cb / sb) + 0.3 * ((ca + cb) / (sa + sb));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Does the receipt's store name refer to one of the item's stores? ("Amazon.com", "AliExpress Israel", "ksp.co.il") */
export function storeMatches(receiptStore: string | null | undefined, stores: MatchCandidate["stores"]) {
  const r = norm(receiptStore ?? "");
  if (r.length < 2) return false;
  return stores.some((s) => {
    const k = norm(s.key.split(".")[0]);
    const n = norm(s.name);
    return (k.length > 1 && (r.includes(k) || k.includes(r))) || (n.length > 1 && (r.includes(n) || n.includes(r)));
  });
}

function priceScore(line: ReceiptLine, c: MatchCandidate) {
  const paid = line.unitPrice ?? (line.lineTotal != null && line.qty > 0 ? line.lineTotal / line.qty : null);
  if (paid == null || c.unitPrice == null || !(paid > 0) || !(c.unitPrice > 0)) return 0.5;
  return Math.min(paid, c.unitPrice) / Math.max(paid, c.unitPrice);
}

export function scoreLine(line: ReceiptLine, c: MatchCandidate, receiptStore: string | null) {
  const title = Math.max(titleScore(line.name, c.title), c.brand ? titleScore(line.name, `${c.brand} ${c.title}`) : 0);
  if (title < MIN_TITLE) return { score: 0, title };
  const store = storeMatches(receiptStore, c.stores) ? 1 : 0;
  return { score: 0.65 * title + 0.2 * store + 0.15 * priceScore(line, c), title };
}

/**
 * Best items for every line. Pairs are assigned greedily by score; each item is used once. When a line bought more
 * units than its best item needs, the rest goes to further items with a clearly similar title (same part needed in
 * two projects). Fewer units than the item needs → a partial allocation (the caller splits the item).
 */
export function matchReceipt(lines: ReceiptLine[], candidates: MatchCandidate[], receiptStore: string | null): LineMatch[] {
  const pairs: { li: number; c: MatchCandidate; score: number; title: number }[] = [];
  const ranked: LineMatch["ranked"][] = lines.map(() => []);
  lines.forEach((line, li) => {
    for (const c of candidates) {
      const { score, title } = scoreLine(line, c, receiptStore);
      if (score < MIN_SCORE) continue;
      pairs.push({ li, c, score, title });
      ranked[li].push({ itemId: c.id, score });
    }
    ranked[li].sort((a, b) => b.score - a.score);
  });
  pairs.sort((a, b) => b.score - a.score);

  const left = lines.map((l) => Math.max(1, Math.round(l.qty) || 1));
  const used = new Set<string>();
  const out: LineMatch[] = lines.map((_, li) => ({ allocations: [], ranked: ranked[li].slice(0, 8) }));
  for (const p of pairs) {
    if (used.has(p.c.id) || left[p.li] <= 0) continue;
    const allocs = out[p.li].allocations;
    if (allocs.length && p.title < SPLIT_TITLE) continue;
    const qty = Math.min(left[p.li], Math.max(1, p.c.quantity));
    allocs.push({ itemId: p.c.id, qty, score: Math.round(p.score * 100) / 100 });
    left[p.li] -= qty;
    used.add(p.c.id);
  }
  return out;
}
