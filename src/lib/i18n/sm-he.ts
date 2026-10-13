import type { smEn } from "./sm-en";

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

// R18 S2 — the supermarket screens' strings (he).
export const smHe: Widen<typeof smEn> = {
  title: "סופר",
  products: "מוצרים",
  projectsSeg: "פרויקטים",
  segLabel: "לקנות, בדרך או פרויקטים",
  quick: {
    label: "פעולות מהירות",
    add: "הוספה לרשימה",
    scan: "סריקה",
    photo: "צילום",
    shop: "מתחילים לקנות",
  },
};
