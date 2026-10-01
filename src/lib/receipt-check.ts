// Deterministic checks after a receipt is read (Round 7 E1). Pure, shared by the server and scripts/test-receipt-check.ts.
import type { ReceiptLine } from "./receipt-match";

type Doc = { lines: ReceiptLine[]; shipping: number | null; discount?: number | null; total: number | null };

export type ReceiptCheck = {
  /** Indexes of lines where qty × unit price doesn't match the printed line total. */
  badLines: number[];
  /** null = no printed total to compare with. */
  sumOk: boolean | null;
  /** Σ lines + shipping − discount, and how far it is from the printed total. */
  computed: number;
  diff: number | null;
  ok: boolean;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const lineValue = (l: ReceiptLine) => l.lineTotal ?? (l.unitPrice != null ? l.unitPrice * l.qty : null);

/** qty × unit ≈ line total (±1 % or 2 agorot/cents); Σ lines (+ shipping − discounts) ≈ total within 2 %. */
export function checkReceipt(d: Doc): ReceiptCheck {
  const badLines: number[] = [];
  d.lines.forEach((l, i) => {
    if (l.unitPrice == null || l.lineTotal == null) return;
    const expect = l.unitPrice * l.qty;
    if (Math.abs(expect - l.lineTotal) > Math.max(0.02, l.lineTotal * 0.01)) badLines.push(i);
  });
  const computed = round2(d.lines.reduce((a, l) => a + (lineValue(l) ?? 0), 0) + (d.shipping ?? 0) - (d.discount ?? 0));
  if (d.total == null || d.total <= 0 || d.lines.some((l) => lineValue(l) == null)) return { badLines, sumOk: null, computed, diff: null, ok: badLines.length === 0 };
  const diff = round2(computed - d.total);
  const sumOk = Math.abs(diff) <= Math.max(0.05, d.total * 0.02);
  return { badLines, sumOk, computed, diff, ok: badLines.length === 0 && sumOk };
}

/** The lines to name in a targeted retry: the bad ones, or (sum off, no single bad line) the priciest few. */
export function linesToRecheck(d: Doc, c: ReceiptCheck): number[] {
  if (c.badLines.length) return c.badLines;
  if (c.sumOk === false)
    return d.lines
      .map((l, i) => [i, lineValue(l) ?? 0] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([i]) => i);
  return [];
}

/** Keep the better of two reads (fewer problems wins; ties keep the first). Lines still off get `check: true`. */
export function pickBetter<T extends Doc>(first: T, retry: T | null): T & { check: ReceiptCheck } {
  const a = checkReceipt(first);
  if (!retry || !retry.lines.length) return mark(first, a);
  const b = checkReceipt(retry);
  const score = (c: ReceiptCheck) => c.badLines.length * 2 + (c.sumOk === false ? 3 : 0);
  return score(b) < score(a) ? mark(retry, b) : mark(first, a);
}

function mark<T extends Doc>(d: T, c: ReceiptCheck): T & { check: ReceiptCheck } {
  const flagged = new Set(c.ok ? [] : linesToRecheck(d, c));
  return { ...d, lines: d.lines.map((l, i) => (flagged.has(i) ? { ...l, check: true } : l)), check: c };
}

/** A PDF text layer worth reading as text: enough characters and at least a few numbers that look like prices. */
export function hasRealText(text: string | null | undefined) {
  if (!text) return false;
  const t = text.replace(/\s+/g, " ").trim();
  const words = t.match(/[\p{L}]{2,}/gu)?.length ?? 0;
  const prices = t.match(/\d+[.,]\d{2}\b/g)?.length ?? 0;
  return t.length >= 80 && words >= 8 && prices >= 2;
}

/**
 * Split a very tall receipt image (height/width > 2.5) into consecutive tiles with ~15 % overlap.
 * Returns [y, height] pairs in source pixels; one tile when it isn't tall.
 */
export function tileRanges(width: number, height: number, maxRatio = 2.5, overlap = 0.15): [number, number][] {
  if (height / width <= maxRatio) return [[0, height]];
  const tileH = Math.round(width * 2);
  const step = Math.round(tileH * (1 - overlap));
  const out: [number, number][] = [];
  for (let y = 0; ; y += step) {
    const h = Math.min(tileH, height - y);
    out.push([y, h]);
    if (y + h >= height) break;
  }
  return out;
}
