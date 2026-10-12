// R18 A3 — supermarket sections and the default Israeli walking order (R18-SCREENS §2). Client-safe (no server
// imports): the S2 screens, the engines and the tests read the same list. `icon` = the path key the boards draw
// (docs/design/r18/Supermarket-phone.dc.html `P`). `other` is where an unknown product waits until it is classified.

export const SECTIONS = [
  { key: "produce", icon: "produce", en: "Fruit & vegetables", he: "פירות וירקות" },
  { key: "meat", icon: "meat", en: "Meat, poultry & fish", he: "בשר, עוף ודגים" },
  { key: "deli", icon: "deli", en: "Deli & salads", he: "מעדנייה וסלטים" },
  { key: "dry", icon: "dry", en: "Dry goods", he: "יבשים" },
  { key: "cans", icon: "cans", en: "Cans & sauces", he: "שימורים ורטבים" },
  { key: "spice", icon: "spice", en: "Spices & baking", he: "תבלינים ואפייה" },
  { key: "bfast", icon: "bfast", en: "Breakfast & spreads", he: "ארוחת בוקר וממרחים" },
  { key: "snack", icon: "snack", en: "Snacks & sweets", he: "חטיפים ומתוקים" },
  { key: "drink", icon: "drink", en: "Drinks", he: "משקאות" },
  { key: "clean", icon: "clean", en: "Cleaning & disposables", he: "ניקיון וחד־פעמי" },
  { key: "toil", icon: "toil", en: "Toiletries & pharm", he: "טואלטיקה ופארם" },
  { key: "baby", icon: "baby", en: "Baby", he: "תינוקות" },
  { key: "pets", icon: "pets", en: "Pets", he: "חיות מחמד" },
  { key: "bread", icon: "bread", en: "Bread & bakery", he: "לחם ומאפים" },
  { key: "dairy", icon: "dairy", en: "Dairy & eggs", he: "חלב וביצים" },
  { key: "frozen", icon: "frozen", en: "Frozen", he: "קפואים" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
/** A section key, or `other` (not classified yet — shown last). */
export type SectionOrOther = SectionKey | "other";

export const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];
/** Produce at the entrance, bread / dairy / eggs at the back, frozen last (stays cold). */
export const DEFAULT_ORDER: readonly SectionKey[] = SECTION_KEYS;
export const OTHER = "other" as const;

export const isSection = (v: unknown): v is SectionKey => typeof v === "string" && (SECTION_KEYS as string[]).includes(v);

export function sectionName(key: string, locale: string) {
  const s = SECTIONS.find((x) => x.key === key);
  if (!s) return locale === "he" ? "אחר" : "Other";
  return locale === "he" ? s.he : s.en;
}

/**
 * A stored order (json from `space_store.section_order`) → a complete order: known keys in their stored order, any
 * missing key appended in default order, unknown / repeated keys dropped. null / junk → the default.
 */
export function cleanOrder(raw: unknown): SectionKey[] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const seen = new Set<SectionKey>();
  const out: SectionKey[] = [];
  if (Array.isArray(v))
    for (const k of v)
      if (isSection(k) && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
  for (const k of DEFAULT_ORDER) if (!seen.has(k)) out.push(k);
  return out;
}

/** The list order for a trip: the branch's confirmed order, else the default. */
export function tripOrder(store: { sectionOrder?: string | null } | null | undefined): SectionKey[] {
  return store?.sectionOrder ? cleanOrder(store.sectionOrder) : [...DEFAULT_ORDER];
}

/** Position of a section in an order (`other` and unknown last). */
export function sectionRank(order: readonly string[], key: string | null | undefined) {
  const i = key ? order.indexOf(key) : -1;
  return i < 0 ? order.length : i;
}
