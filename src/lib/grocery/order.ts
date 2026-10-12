// R18 A5 — learn a branch's walking order from finished trips (pure). Suggest, never apply: the S2 banner asks "use this
// order?". Input = each trip's checks in `seq` order; a trip's section sequence = the sections in the order the shopper
// first checked something in them. A suggestion needs ≥ 2 recent trips that agree with each other (no two sections in
// opposite order) and an order that differs from the current one. After a dismiss, 3 more trips first.

import { replayTrip, type CheckRow } from "./trip";
import { isSection, type SectionKey } from "./sections";

export type LearnTrip = { finishedAt: number | null; checks: CheckRow[] };
export const MIN_AGREEING = 2;
export const AFTER_DISMISS = 3;

/** The sections of one trip, in walking order (only real sections). */
export const tripSections = (t: LearnTrip) => replayTrip(t.checks).sections.filter(isSection) as SectionKey[];

/** Pairs a < b (a walked before b) seen in one sequence. */
function pairs(seq: SectionKey[]) {
  const out = new Set<string>();
  for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) out.add(`${seq[i]}>${seq[j]}`);
  return out;
}
const flips = (a: Set<string>, b: Set<string>) => [...a].some((p) => b.has(p.split(">").reverse().join(">")));

/**
 * The order the sequences imply, laid into `current`: the walked sections fill the slots they hold in `current`, in
 * walking order (a topological order of what the trips saw, ties by the current order); sections never walked stay put.
 */
export function mergeOrder(current: SectionKey[], seqs: SectionKey[][]): SectionKey[] {
  const seen = new Set(seqs.flat());
  const edges = new Map<SectionKey, Set<SectionKey>>();
  const indeg = new Map<SectionKey, number>();
  for (const s of seen) (edges.set(s, new Set()), indeg.set(s, 0));
  for (const q of seqs)
    for (let i = 0; i + 1 < q.length; i++) {
      const [a, b] = [q[i], q[i + 1]];
      if (!edges.get(a)!.has(b)) (edges.get(a)!.add(b), indeg.set(b, indeg.get(b)! + 1));
    }
  const rank = (k: SectionKey) => current.indexOf(k);
  const ready = [...seen].filter((s) => indeg.get(s) === 0);
  const walked: SectionKey[] = [];
  while (ready.length) {
    ready.sort((a, b) => rank(a) - rank(b));
    const s = ready.shift()!;
    walked.push(s);
    for (const t of edges.get(s)!) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) ready.push(t);
    }
  }
  if (walked.length < seen.size) return current; // a cycle: the trips don't agree
  const out = [...current];
  const slots = current.map((k, i) => (seen.has(k) ? i : -1)).filter((i) => i >= 0);
  slots.forEach((slot, i) => (out[slot] = walked[i]));
  return out;
}

/**
 * The suggested order, or null. `trips` oldest → newest (finished only). `dismissedAt`: trips finished before it don't
 * count, and at least AFTER_DISMISS trips must have finished since.
 */
export function learnOrder(trips: LearnTrip[], current: SectionKey[], o: { dismissedAt?: number | null } = {}): SectionKey[] | null {
  let done = trips.filter((t) => t.finishedAt != null);
  if (o.dismissedAt != null) {
    done = done.filter((t) => (t.finishedAt ?? 0) > o.dismissedAt!);
    if (done.length < AFTER_DISMISS) return null;
  }
  // The newest trips that agree with each other (each sees ≥ 2 sections).
  const recent: SectionKey[][] = [];
  const recentPairs: Set<string>[] = [];
  for (const t of [...done].reverse()) {
    const seq = tripSections(t);
    if (seq.length < 2) continue;
    const p = pairs(seq);
    if (recentPairs.some((q) => flips(p, q))) break;
    recent.push(seq);
    recentPairs.push(p);
  }
  if (recent.length < MIN_AGREEING) return null;
  const next = mergeOrder(current, recent.reverse());
  if (next.join() === current.join()) return null;
  // Every swap against the current order must be walked that way in ≥ 2 of those trips (one trip is not a habit).
  for (let i = 0; i < next.length; i++)
    for (let j = i + 1; j < next.length; j++) {
      const [a, b] = [next[i], next[j]];
      if (current.indexOf(a) < current.indexOf(b)) continue;
      if (recentPairs.filter((p) => p.has(`${a}>${b}`)).length < MIN_AGREEING) return null;
    }
  return next;
}
