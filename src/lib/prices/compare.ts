// R19 D3 — where is my list cheapest: each store's total for the list (deals in, club on / off), how many rows it has
// ("8 of 9"), the missing rows counted at their average price elsewhere (so a store that lacks the expensive things never
// looks cheapest), the saving against mine, and whether splitting between two stores is worth it. Pure — test:compare.
import { bestDeal, type Deal } from "./deals";

export type StoreKey = string; // "<chain>" (its chain price) or "<chain>:<store id>" (a branch's own prices)
export type CompareRow = { id: string; title: string; units: number; weighted: boolean; at: Record<StoreKey, { price: number; deals: Deal[] }> };
export type StoreTotal = { store: StoreKey; total: number; found: number; missing: { id: string; title: string; avg: number }[]; deals: number; saving: number };

const r2 = (x: number) => Math.round(x * 100) / 100;

export function compareStores(rows: CompareRow[], stores: StoreKey[], mine: StoreKey | null, o: { club?: boolean } = {}): StoreTotal[] {
  const club = o.club ?? true;
  // A row's cost at a store (deals in) and its average across the stores that have it.
  const cost = (r: CompareRow, st: StoreKey) => {
    const p = r.at[st];
    if (!p) return null;
    const best = bestDeal(p.deals, r.units, p.price, { weighted: r.weighted, club });
    return { v: best ? best.use.total : r.units * p.price, deal: !!best && best.use.saved > 0 };
  };
  const avg = new Map<string, number>();
  for (const r of rows) {
    const vs = stores.map((st) => cost(r, st)?.v).filter((v): v is number => v != null);
    if (vs.length) avg.set(r.id, vs.reduce((a, b) => a + b, 0) / vs.length);
  }
  const out = stores.map((st) => {
    let total = 0;
    let found = 0;
    let deals = 0;
    const missing: StoreTotal["missing"] = [];
    for (const r of rows) {
      const c = cost(r, st);
      if (c) {
        total += c.v;
        found++;
        if (c.deal) deals++;
      } else if (avg.has(r.id)) {
        total += avg.get(r.id)!;
        missing.push({ id: r.id, title: r.title, avg: r2(avg.get(r.id)!) });
      }
    }
    return { store: st, total: r2(total), found, missing, deals, saving: 0 };
  });
  const mineTotal = out.find((x) => x.store === mine)?.total ?? null;
  for (const x of out) x.saving = mineTotal == null ? 0 : r2(mineTotal - x.total);
  // Cheapest first; on a tie, the one that has more of the list.
  return out.filter((x) => x.found > 0).sort((a, b) => a.total - b.total || b.found - a.found);
}

/** Two stores: each row bought where it's cheaper. Worth it only when it saves more than `min` over the best one store. */
export function splitHint(rows: CompareRow[], ranked: StoreTotal[], o: { club?: boolean; min?: number } = {}): { a: StoreKey; b: StoreKey; total: number; saving: number; worth: boolean } | null {
  if (ranked.length < 2) return null;
  const club = o.club ?? true;
  const [a, b] = [ranked[0].store, ranked[1].store];
  let total = 0;
  for (const r of rows) {
    const vs = [a, b]
      .map((st) => r.at[st] && ((best) => (best ? best.use.total : r.units * r.at[st].price))(bestDeal(r.at[st].deals, r.units, r.at[st].price, { weighted: r.weighted, club })))
      .filter((v): v is number => v != null);
    if (vs.length) total += Math.min(...vs);
    else total += ranked[0].missing.find((m) => m.id === r.id)?.avg ?? 0;
  }
  const saving = r2(ranked[0].total - total);
  return { a, b, total: r2(total), saving, worth: saving >= (o.min ?? 25) };
}
