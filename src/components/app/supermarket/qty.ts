// R18 S2 — how a supermarket row's quantity reads: "×3", "1 kg", "200 g", "1.5 L".
type Q = { quantity: number; amount?: number | null; unit?: string | null };

const num = (n: number, locale: string) => new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", { maximumFractionDigits: 2 }).format(n);

export function unitWord(unit: string, locale: string) {
  if (locale === "he") return unit === "kg" ? "ק״ג" : unit === "g" ? "גרם" : unit === "l" ? "ל׳" : "";
  return unit === "kg" ? "kg" : unit === "g" ? "g" : unit === "l" ? "L" : "";
}

export function qtyLabel(i: Q, locale: string) {
  if (i.unit && i.unit !== "u" && i.amount != null) return `${num(i.amount, locale)} ${unitWord(i.unit, locale)}`;
  return `×${i.quantity}`;
}
