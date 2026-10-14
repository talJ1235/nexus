// R18 S2 E1 — templates made by Nexus: repeating trips found in the home's history (pure, client-safe).
// A routine = trips on the same weekday (local time) whose baskets look alike (Jaccard ≥ 0.4 to the trip that gathers the
// most of them), at least 3 of them; its items = the products bought in at least half of those trips (and at least twice),
// never a hidden one. A kept routine is a "Made by Nexus" template that follows new trips until someone edits it.

export type RoutineTrip = { id: string; startedAt: number; keys: Set<string> };
export type Routine = { weekday: number; trips: number; tripIds: string[]; keys: string[] };

export const ROUTINE_MIN_TRIPS = 3;
export const ROUTINE_MIN_ITEMS = 4;
const SIMILAR = 0.4;
/** An existing Nexus template is the same routine when it shares the weekday and this much of its items. */
const SAME_ROUTINE = 0.3;

export function jaccard(a: Iterable<string>, b: Iterable<string>) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let n = 0;
  for (const k of A) if (B.has(k)) n++;
  return n / (A.size + B.size - n);
}

/** 0 = Sunday … 6 = Saturday, in the home's zone. */
export function weekdayIn(ts: number, tz: string) {
  const w = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(ts);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

export function detectRoutines(trips: RoutineTrip[], tz: string, hidden: Set<string> = new Set()): Routine[] {
  const byDay = new Map<number, RoutineTrip[]>();
  for (const t of trips) {
    if (!t.keys.size) continue;
    const d = weekdayIn(t.startedAt, tz);
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const out: Routine[] = [];
  for (const [weekday, list] of [...byDay].sort((a, b) => a[0] - b[0])) {
    let left = [...list].sort((a, b) => b.startedAt - a.startedAt);
    while (left.length >= ROUTINE_MIN_TRIPS) {
      // The trip that gathers the most look-alikes seeds the cluster (ties → the newest).
      let best: RoutineTrip[] = [];
      for (const seed of left) {
        const near = left.filter((t) => t === seed || jaccard(seed.keys, t.keys) >= SIMILAR);
        if (near.length > best.length) best = near;
      }
      if (best.length < ROUTINE_MIN_TRIPS) break;
      const count = new Map<string, number>();
      for (const t of best) for (const k of t.keys) count.set(k, (count.get(k) ?? 0) + 1);
      const need = Math.max(2, Math.ceil(best.length / 2));
      const keys = [...count]
        .filter(([k, n]) => n >= need && !hidden.has(k))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k]) => k);
      if (keys.length >= ROUTINE_MIN_ITEMS) out.push({ weekday, trips: best.length, tripIds: best.map((t) => t.id), keys });
      const taken = new Set(best);
      left = left.filter((t) => !taken.has(t));
    }
  }
  return out;
}

/** The existing Nexus template a routine updates: same weekday, the most items in common (≥ 30 %). */
export function matchRoutine<T extends { routineDay: number | null; keys: string[] }>(r: Routine, existing: T[]): T | null {
  let best: T | null = null;
  let score = SAME_ROUTINE;
  for (const e of existing) {
    if (e.routineDay !== r.weekday) continue;
    const j = jaccard(r.keys, e.keys);
    if (j >= score) {
      best = e;
      score = j;
    }
  }
  return best;
}

export type ApplyLine = { productKey: string; title: string; state: "new" | "on" | "hidden"; qty: number; onQty?: number };

/**
 * Apply = merge, never duplicate: a product already on the list stays as it is ("already on it — stays ×2"), a hidden one
 * is skipped, the rest are added with the template's quantity.
 */
export function applyPlan(items: { productKey: string; title: string; qty: number }[], onList: Map<string, number>, hidden: Set<string>): ApplyLine[] {
  return items.map((i) => (onList.has(i.productKey) ? { ...i, state: "on" as const, onQty: onList.get(i.productKey) } : hidden.has(i.productKey) ? { ...i, state: "hidden" as const } : { ...i, state: "new" as const }));
}
