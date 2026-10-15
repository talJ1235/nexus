// R18 S4 A1 — an add onto a row already on the list merges into its measures (packs / pieces / weight / volume), never
// into the notes. Units onto a weighed row → pieces (the weight follows: the estimate with a unit weight, else both are
// kept); a weight onto a counted row → weight (the count follows). Pure, client-safe; `addToList` and the one-off note
// cleanup (`cleanMergeNotes`) both use it.
import { withCount, withWeight } from "./weights";

export type Row = { quantity: number; count: number | null; amount: number | null; unit: string | null };
export type Add = { qty: number; count: number | null; amount: number | null; unit: string | null };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const kgOf = (amount: number | null, unit: string | null) => (amount == null ? null : unit === "g" ? amount / 1000 : unit === "kg" ? amount : null);
const isWeight = (u: string | null | undefined) => u === "kg" || u === "g";
const cap = (n: number) => Math.min(999, Math.max(1, Math.round(n)));

/** Pieces a row stands for (said, else ≈ from its weight, else its packs when nothing else is said). */
function piecesOf(r: Row, unitKg: number | null) {
  if (r.count != null) return r.count;
  const kg = kgOf(r.amount, r.unit);
  if (kg != null) return unitKg ? Math.max(1, Math.round(kg / unitKg)) : null;
  return r.unit ? null : r.quantity;
}

/** A weight in the row's own unit (g stays g under a kilo). */
function inUnit(kg: number, like: string | null): { amount: number; unit: "kg" | "g" } {
  return like === "g" && kg < 1 ? { amount: Math.round(kg * 1000), unit: "g" } : { amount: r3(kg), unit: "kg" };
}

export function mergeAdd(cur: Row, add: Add, unitKg: number | null): Row {
  const unit = add.unit && add.unit !== "u" ? add.unit : null;
  const amount = unit && add.amount != null && add.amount > 0 ? add.amount : null;
  const qty = Math.max(1, Math.round(add.qty || 1));
  let r: Row = { ...cur };

  // Weight (kg / g): weights add up, the count follows.
  if (isWeight(unit) && amount != null) {
    const addKg = kgOf(amount, unit)!;
    const curKg = kgOf(r.amount, r.unit);
    if (curKg != null) {
      const w = inUnit(curKg + addKg, r.unit);
      r = { ...r, ...withWeight(r, w.amount, w.unit, unitKg) };
    } else if (r.unit === "l") {
      r.quantity = r.quantity + qty; // a weight onto a volume: no conversion — one more pack
    } else {
      const pcs = piecesOf(r, unitKg);
      if (unitKg != null && pcs != null) {
        const w = inUnit(pcs * unitKg + addKg, unit);
        r = { ...r, quantity: r.count != null ? r.quantity : 1, count: r.count, amount: w.amount, unit: w.unit };
        r = { ...r, ...withWeight(r, w.amount, w.unit, unitKg) };
      } else {
        // No unit weight: both measures stay on the row (its pieces / packs and the weight).
        r = { ...r, amount: r3(amount), unit };
      }
    }
    if (add.count != null) r.count = cap((r.count ?? 0) + add.count);
    return r;
  }

  // Volume (l).
  if (unit === "l" && amount != null) {
    if (r.unit === "l") r.amount = r3((r.amount ?? 0) + amount);
    else if (!r.unit) r = { ...r, amount: r3(amount), unit: "l" };
    else r.quantity = r.quantity + qty;
    return r;
  }

  // Pieces (a said count) or plain units ("מלפפון", "2 milk").
  const n = add.count ?? qty;
  const curKg = kgOf(r.amount, r.unit);
  if (r.count == null && !r.unit) {
    // Packs onto packs; said pieces onto packs count them as pieces.
    if (add.count == null) return { ...r, quantity: r.quantity + qty };
    return { ...r, quantity: 1, count: cap(r.quantity + n) };
  }
  if (r.unit === "l" && r.count == null) return { ...r, quantity: r.quantity + n };
  const pcs = r.count ?? (curKg != null && unitKg ? Math.max(1, Math.round(curKg / unitKg)) : null);
  if (pcs != null) return { ...r, ...withCount(r, pcs + n, unitKg) };
  // A weighed row, no unit weight: keep both — the pieces next to the weight.
  return { ...r, count: cap(n) };
}

/** The fragments the old merge wrote into notes ("+ ×3", "+ 2 kg", "+ 0.5 L", "+ 200 g"). */
const FRAG = /^\+ (?:×(\d{1,3})|(\d+(?:\.\d+)?) (kg|g|L))$/;

/** One-off cleanup: note fragments made by the old merge go back into the row's measures (idempotent). */
export function cleanMergeNotes(row: Row & { notes: string | null }, unitKg: number | null): (Row & { notes: string | null }) | null {
  if (!row.notes || !row.notes.includes("+ ")) return null;
  const parts = row.notes.split(" · ");
  const keep: string[] = [];
  let r: Row = { quantity: row.quantity, count: row.count, amount: row.amount, unit: row.unit };
  let hit = false;
  for (const p of parts) {
    const m = FRAG.exec(p.trim());
    if (!m) {
      keep.push(p);
      continue;
    }
    hit = true;
    r = m[1] ? mergeAdd(r, { qty: Number(m[1]), count: null, amount: null, unit: null }, unitKg) : mergeAdd(r, { qty: 1, count: null, amount: Number(m[2]), unit: m[3] === "L" ? "l" : m[3] }, unitKg);
  }
  if (!hit) return null;
  const notes = keep.join(" · ").trim();
  return { ...r, notes: notes || null };
}
