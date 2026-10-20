// R19 D1 / D3 / D6 — how many units a list row buys for its price: packs = the count, a weighed product = kg (the weight
// said, else pieces × the home's learned kg per piece). One rule for the row, the basket, compare and every estimate.
import { measure } from "../grocery/weights";

type Row = { quantity: number; count?: number | null; amount: number | null; unit: string | null };

export function unitsFor(item: Row, weighedProduct: boolean, unitKg: number | null): number {
  if (weighedProduct) {
    const m = measure({ quantity: item.quantity, count: item.count ?? null, amount: item.amount, unit: item.unit }, unitKg);
    if (m.kg != null) return m.kg;
    return (item.count ?? item.quantity ?? 1) * (unitKg ?? 1);
  }
  return Math.max(1, item.quantity || 1);
}
