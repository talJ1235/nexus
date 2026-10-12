// R18 A2 — a trip's check log replayed (pure, client-safe): the counts and the order the shopper walked. The server
// stores every action in `trip_check` with a per-trip `seq`; replaying the log in `seq` order always gives the same
// state, so the counts on the `trip` row can be rebuilt at any time.

export type CheckAction = "check" | "uncheck" | "not_found" | "substitute" | "qty" | "price" | "add";
export const CHECK_ACTIONS: readonly CheckAction[] = ["check", "uncheck", "not_found", "substitute", "qty", "price", "add"];

export type CheckRow = { seq: number; action: CheckAction | string; itemId?: string | null; productKey?: string | null; section?: string | null; at?: number };

export type Replayed = {
  bought: number;
  notFound: number;
  /** Items added during the trip. */
  added: number;
  /** Rows bought, in the order they were (last) checked. */
  order: string[];
  /** The sections in the order the shopper first checked something in them (checks still standing). */
  sections: string[];
};

const keyOf = (c: CheckRow) => c.itemId ?? c.productKey ?? "";

export function replayTrip(rows: CheckRow[]): Replayed {
  const state = new Map<string, "bought" | "not_found">();
  const order: string[] = [];
  const sectionOf = new Map<string, string | null | undefined>();
  let added = 0;
  for (const c of [...rows].sort((a, b) => a.seq - b.seq)) {
    const k = keyOf(c);
    if (c.action === "add") added++;
    if (!k) continue;
    if (c.section) sectionOf.set(k, c.section);
    const drop = () => {
      const i = order.indexOf(k);
      if (i >= 0) order.splice(i, 1);
    };
    if (c.action === "check" || c.action === "substitute") {
      drop();
      order.push(k);
      state.set(k, "bought");
    } else if (c.action === "uncheck") {
      drop();
      state.delete(k);
    } else if (c.action === "not_found") {
      drop();
      state.set(k, "not_found");
    }
  }
  const sections: string[] = [];
  for (const k of order) {
    const s = sectionOf.get(k);
    if (s && !sections.includes(s)) sections.push(s);
  }
  let notFound = 0;
  for (const v of state.values()) if (v === "not_found") notFound++;
  return { bought: order.length, notFound, added, order, sections };
}

/** Only checks, in `seq` order, with their section (A5's input). */
export const checkSequence = (rows: CheckRow[]) => replayTrip(rows).order.map((k) => ({ key: k, section: [...rows].reverse().find((r) => keyOf(r) === k && r.section)?.section ?? null }));
