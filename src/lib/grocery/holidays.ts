// R18 B2 — a small Israeli holiday table for the next 12 months (from Oct 2026) and the product types people buy for
// each. `eve` = the day before the holiday starts (the evening it begins); dates in Israel. Extend once a year.

export type Holiday = { key: string; eve: string; en: string; he: string; types: string[] };

export const HOLIDAYS: Holiday[] = [
  { key: "hanukkah", eve: "2026-12-04", en: "Hanukkah", he: "חנוכה", types: ["oil", "potatoes", "flour", "pastries"] },
  { key: "tu-bishvat", eve: "2027-01-22", en: "Tu BiShvat", he: "ט״ו בשבט", types: ["dates", "nuts"] },
  { key: "purim", eve: "2027-03-22", en: "Purim", he: "פורים", types: ["candy", "snacks", "wine"] },
  { key: "pesach", eve: "2027-04-21", en: "Passover", he: "פסח", types: ["crackers", "wine", "eggs", "potatoes"] },
  { key: "independence", eve: "2027-05-11", en: "Independence Day", he: "יום העצמאות", types: ["burgers", "kebab", "hummus", "soft-drinks"] },
  { key: "shavuot", eve: "2027-06-10", en: "Shavuot", he: "שבועות", types: ["white-cheese", "cream-cheese", "cream", "butter"] },
  { key: "rosh-hashana", eve: "2027-10-01", en: "Rosh Hashana", he: "ראש השנה", types: ["honey", "apples", "dates", "challah"] },
  { key: "yom-kippur", eve: "2027-10-10", en: "Yom Kippur", he: "יום כיפור", types: ["whole-chicken", "water"] },
  { key: "sukkot", eve: "2027-10-15", en: "Sukkot", he: "סוכות", types: ["wine", "challah"] },
];

/** The holiday whose eve is today or within the next `days` days (local date "YYYY-MM-DD"). */
export function holidayAhead(today: string, days = 3): Holiday | null {
  const t = Date.parse(`${today}T12:00:00Z`);
  for (const h of HOLIDAYS) {
    const d = (Date.parse(`${h.eve}T12:00:00Z`) - t) / 86_400_000;
    if (d >= 0 && d <= days) return h;
  }
  return null;
}

/** Shabbat items: what Israeli households buy for Friday dinner. */
export const SHABBAT_TYPES = ["challah", "wine"];
