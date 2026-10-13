// R18 S2 — how a supermarket row's quantity reads: "×3", "200 g", "1.5 L", and with B1's count + weight
// "6 · 1 kg" (both said), "6 · ≈ 0.9 kg" (count said, weight from the unit weight), "1 kg · ≈ 6" (the reverse).
import { measure } from "@/lib/grocery/weights";

type Q = { quantity: number; amount?: number | null; unit?: string | null; count?: number | null };

const num = (n: number, locale: string) => new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", { maximumFractionDigits: 2 }).format(n);

export function unitWord(unit: string, locale: string) {
  if (locale === "he") return unit === "kg" ? "ק״ג" : unit === "g" ? "גרם" : unit === "l" ? "ל׳" : "";
  return unit === "kg" ? "kg" : unit === "g" ? "g" : unit === "l" ? "L" : "";
}

const said = (i: Q, locale: string) => (i.unit && i.unit !== "u" && i.amount != null ? `${num(i.amount, locale)} ${unitWord(i.unit, locale)}` : null);

/** `unitKg` = kg per piece for this product (null = unknown: nothing is estimated). */
export function qtyLabel(i: Q, locale: string, unitKg: number | null = null) {
  const m = measure(i, unitKg);
  const weight = said(i, locale);
  if (i.count != null && weight) return `${i.count} · ${weight}`;
  if (i.count != null) return m.kg != null ? `${i.count} · ≈ ${num(m.kg, locale)} ${unitWord("kg", locale)}` : String(i.count);
  if (weight) return m.approx === "count" && m.count != null ? `${weight} · ≈ ${m.count}` : weight;
  return `×${i.quantity}`;
}
