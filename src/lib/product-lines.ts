// Understanding abbreviated product lines (Round 10 D1): "מילקי שוקו 3*100", "חלב תנ 3%" → a clean Hebrew name, an
// English name, brand, generic product type, size, search queries (Hebrew + English), an icon keyword, and a barcode
// when the line prints one. One batched model call per receipt (product-pictures.ts); this file is pure — the
// prompt/schema, the parser for the model's answer, and a dictionary heuristic for mock mode and as the fallback.

export type LineInfo = {
  /** The line as printed. */
  raw: string;
  nameHe: string;
  nameEn: string;
  brand: string | null;
  /** Generic product type, English ("milk", "pudding", "stepper motor"). */
  type: string;
  /** Generic type in Hebrew when known ("חלב", "פודינג"). */
  typeHe: string | null;
  size: string | null;
  queryHe: string;
  queryEn: string;
  iconKeyword: string;
  barcode: string | null;
};

export const LINE_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "number" },
          nameHe: { type: "string" },
          nameEn: { type: "string" },
          brand: { type: ["string", "null"] },
          type: { type: "string" },
          typeHe: { type: ["string", "null"] },
          size: { type: ["string", "null"] },
          queryHe: { type: "string" },
          queryEn: { type: "string" },
          iconKeyword: { type: "string" },
          barcode: { type: ["string", "null"] },
        },
        required: ["i", "nameHe", "nameEn", "brand", "type", "typeHe", "size", "queryHe", "queryEn", "iconKeyword", "barcode"],
      },
    },
  },
  required: ["lines"],
};

export function linePrompt(names: string[]) {
  return `These are product lines from a purchase (often an Israeli supermarket receipt, abbreviated: "תנ" = Tnuva, "שטר" = Strauss, "3*100" = a pack of 3 × 100 g, "3%" = fat). Lines can also be electronics/maker parts in English.
For each line return:
- "i": its number as given.
- "nameHe": the full, clean product name in Hebrew as a shopper would search it (expand abbreviations, keep the brand, drop prices/codes).
- "nameEn": the same in English.
- "brand": the brand/manufacturer, or null.
- "type": the generic product type in English, 1–3 words ("milk", "chocolate pudding", "stepper motor").
- "typeHe": the generic type in Hebrew, or null for non-grocery items.
- "size": size/variant as printed in a clean form ("3% · 1 L", "3 × 100 g"), or null.
- "queryHe": a Google Images query in Hebrew that finds this exact product photo (brand + name + size).
- "queryEn": the same query in English.
- "iconKeyword": one simple English noun for an emoji icon ("milk", "pudding", "battery").
- "barcode": the 8–14 digit barcode/catalogue number if the line prints one, else null.
Never invent a brand you can't infer. Lines:
${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;
}

const str = (v: unknown, max = 160) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Validate the model's answer; any line it skipped or garbled falls back to the heuristic. */
export function parseLineInfos(raw: unknown, names: string[]): LineInfo[] {
  const got = new Map<number, Record<string, unknown>>();
  const list = raw && typeof raw === "object" && Array.isArray((raw as { lines?: unknown }).lines) ? ((raw as { lines: unknown[] }).lines as Record<string, unknown>[]) : [];
  for (const l of list) if (l && typeof l.i === "number") got.set(Math.round(l.i) - 1, l);
  return names.map((name, i) => {
    const r = got.get(i);
    const h = heuristicLineInfo(name);
    if (!r) return h;
    const nameHe = str(r.nameHe) ?? h.nameHe;
    const nameEn = str(r.nameEn) ?? h.nameEn;
    const barcode = str(r.barcode, 20)?.replace(/\D/g, "") ?? null;
    return {
      raw: name,
      nameHe,
      nameEn,
      brand: str(r.brand, 60),
      type: str(r.type, 60)?.toLowerCase() ?? h.type,
      typeHe: str(r.typeHe, 60),
      size: str(r.size, 40),
      queryHe: str(r.queryHe) ?? nameHe,
      queryEn: str(r.queryEn) ?? nameEn,
      iconKeyword: (str(r.iconKeyword, 30) ?? h.iconKeyword).toLowerCase(),
      barcode: barcode && barcode.length >= 8 && barcode.length <= 14 ? barcode : h.barcode,
    };
  });
}

// ---------- Heuristic (mock mode, fallback) ----------

/** Brand abbreviations common on Israeli receipts → [Hebrew, English]. */
const BRANDS: [RegExp, string, string][] = [
  [/(^|\s)(תנו?|תנובה)(?=\s|$)/, "תנובה", "Tnuva"],
  [/(^|\s)(שטר|שטראוס)(?=\s|$)/, "שטראוס", "Strauss"],
  [/(^|\s)(אסם)(?=\s|$)/, "אסם", "Osem"],
  [/(^|\s)(עלית)(?=\s|$)/, "עלית", "Elite"],
  [/(^|\s)(יטבתה|יטב)(?=\s|$)/, "יטבתה", "Yotvata"],
  [/(^|\s)(טרה)(?=\s|$)/, "טרה", "Tara"],
  [/(^|\s)(תלמה)(?=\s|$)/, "תלמה", "Telma"],
  [/(^|\s)(וילי פוד|וילי)(?=\s|$)/, "וילי פוד", "Willi-Food"],
];

/** Product words → [English name, generic type (en), generic type (he), icon, implied brand index in BRANDS]. */
const WORDS: [RegExp, string, string, string, string, number?][] = [
  [/מילקי/, "Milky", "chocolate pudding", "פודינג", "pudding", 1],
  [/קוטג/, "cottage cheese", "cottage cheese", "קוטג'", "cheese"],
  [/שוקו/, "chocolate milk", "chocolate milk", "שוקו", "milk"],
  [/חלב/, "milk", "milk", "חלב", "milk"],
  [/יוגורט/, "yogurt", "yogurt", "יוגורט", "yogurt"],
  [/גבינ/, "cheese", "cheese", "גבינה", "cheese"],
  [/חמאה/, "butter", "butter", "חמאה", "butter"],
  [/לחם/, "bread", "bread", "לחם", "bread"],
  [/פית/, "pita", "pita bread", "פיתות", "bread"],
  [/ביצ/, "eggs", "eggs", "ביצים", "egg"],
  [/במבה/, "Bamba", "peanut snack", "חטיף", "peanuts", 2],
  [/ביסלי/, "Bissli", "snack", "חטיף", "pretzel", 2],
  [/שוקולד/, "chocolate", "chocolate", "שוקולד", "chocolate"],
  [/קפה/, "coffee", "coffee", "קפה", "coffee"],
  [/(^|\s)תה(\s|$)/, "tea", "tea", "תה", "tea"],
  [/אורז/, "rice", "rice", "אורז", "rice"],
  [/פסטה|ספגטי/, "pasta", "pasta", "פסטה", "spaghetti"],
  [/שמן/, "oil", "cooking oil", "שמן", "oil"],
  [/סוכר/, "sugar", "sugar", "סוכר", "sugar"],
  [/קמח/, "flour", "flour", "קמח", "flour"],
  [/מים/, "water", "mineral water", "מים", "water"],
  [/קולה/, "cola", "cola", "משקה", "soda"],
  [/מיץ/, "juice", "juice", "מיץ", "juice"],
  [/עגבני/, "tomatoes", "tomato", "עגבניה", "tomato"],
  [/מלפפונ/, "cucumbers", "cucumber", "מלפפון", "cucumber"],
  [/בננ/, "bananas", "banana", "בננה", "banana"],
  [/תפוח/, "apples", "apple", "תפוח", "apple"],
  [/נייר טואלט|נ\.טואלט/, "toilet paper", "toilet paper", "נייר טואלט", "roll"],
];

/** Sizes as printed: "3%", "100 גר", "1 ל'", "3*100", "1.5ל", "500 מ\"ל". */
const SIZE = /(\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?(?:\s*(?:גר|ג'|ג|מ"ל|מל|g|ml))?|\d+(?:\.\d+)?\s*(?:%|גר'?|ג'|ג(?=\s|$)|מ"ל|מל|ל'|ליטר|ל(?=\s|$)|ק"ג|קג|יח'|יח|g|kg|ml|l(?=\s|$)|mm|cm|v|w|mah))/gi;

export function heuristicLineInfo(raw: string): LineInfo {
  const text = raw.replace(/\s+/g, " ").trim();
  const barcode = text.match(/\b\d{8,14}\b/)?.[0] ?? null;
  let rest = text.replace(/\b\d{8,14}\b/g, " ");
  const sizes = [...rest.matchAll(SIZE)].map((m) => m[0].replace(/\s+/g, "").replace(/[x×]/i, "*"));
  rest = rest.replace(SIZE, " ");
  let brandHe: string | null = null;
  let brandEn: string | null = null;
  for (const [re, he, en] of BRANDS) {
    if (re.test(rest)) {
      brandHe = he;
      brandEn = en;
      rest = rest.replace(re, " ");
      break;
    }
  }
  const word = WORDS.find(([re]) => re.test(rest));
  if (!brandHe && word?.[5] != null) [, brandHe, brandEn] = BRANDS[word[5]];
  const hebrew = /[֐-׿]/.test(text);
  const core = rest.replace(/[^\p{L}\p{N}\s'".\-]/gu, " ").replace(/\s+/g, " ").trim();
  const nameHe = [core, brandHe].filter(Boolean).join(" ") || text;
  const nameEn = hebrew ? [brandEn, word?.[1]].filter(Boolean).join(" ") || core : core;
  const size = sizes.length ? sizes.join(" · ") : null;
  const type = word?.[2] ?? (hebrew ? "grocery product" : core.split(" ").slice(-2).join(" ").toLowerCase() || "product");
  return {
    raw,
    nameHe,
    nameEn,
    brand: brandEn,
    type,
    typeHe: word?.[3] ?? null,
    size,
    queryHe: [brandHe, core, size].filter(Boolean).join(" "),
    queryEn: [brandEn, hebrew ? word?.[1] ?? core : core, size].filter(Boolean).join(" "),
    iconKeyword: word?.[4] ?? "package",
    barcode,
  };
}
