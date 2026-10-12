// R18 A4 — the grocery dictionary + classify. Pure (no DB, no network):
//   - normalisation: final letters, niqqud, geresh / gershayim (״ = "), maqaf, extra spaces
//   - product keys: "milk 3%" ≠ "milk 1%", the same product in Hebrew and English gets the same key, gtin wins
//   - ≥ 90 % of the lines below land in the expected section: the boards' worst-case + demo data (docs/design/r18, he + en)
//     and receipt-style lines written for this test (Tal's own receipts are read from the local DB only when it exists,
//     and only counts are printed — no content is committed or shown)
//   - Open Food Facts category tags → a section; an AI answer → a classification
//   npm run test:grocery
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { classifyLocal, productKeyFor } from "../src/lib/grocery/classify";
import { PRODUCT_TYPES } from "../src/lib/grocery/dictionary";
import { normalize } from "../src/lib/grocery/normalize";
import { SECTION_KEYS } from "../src/lib/grocery/sections";

// [line, expected section] — boards (Supermarket-phone WORST / DEMO / SUG, Add-phone paste + voice) in both languages.
const BOARD: [string, string][] = [
  ["Tomatoes", "produce"], ["עגבניות", "produce"], ["Cucumbers", "produce"], ["מלפפונים", "produce"], ["Bananas", "produce"], ["בננות", "produce"],
  ["Red bell peppers", "produce"], ["פלפל אדום", "produce"], ["Lemons", "produce"], ["לימונים", "produce"], ["Parsley", "produce"], ["פטרוזיליה", "produce"],
  ["Chicken breast", "meat"], ["חזה עוף", "meat"], ["Ground beef 15%", "meat"], ["בשר טחון 15%", "meat"], ["Salmon fillet", "meat"], ["פילה סלמון", "meat"],
  ["Hummus", "deli"], ["חומוס", "deli"], ["Eggplant salad", "deli"], ["סלט חצילים", "deli"],
  ["Penne 500 g", "dry"], ["פסטה פנה 500 גרם", "dry"], ["Basmati rice", "dry"], ["אורז בסמטי", "dry"], ["Red lentils", "dry"], ["עדשים כתומות", "dry"],
  ["Crushed tomatoes", "cans"], ["עגבניות מרוסקות", "cans"], ["Raw tahini", "cans"], ["טחינה גולמית", "cans"],
  ["Organic extra-virgin olive oil, cold pressed, 3 L tin", "cans"], ["שמן זית כתית מעולה אורגני בכבישה קרה, פח 3 ליטר", "cans"],
  ["Sweet paprika", "spice"], ["פפריקה מתוקה", "spice"], ["Baking powder", "spice"], ["אבקת אפייה", "spice"],
  ["Cornflakes", "bfast"], ["קורנפלקס", "bfast"], ["Ground coffee", "bfast"], ["קפה טחון", "bfast"], ["Chocolate spread", "bfast"], ["ממרח שוקולד", "bfast"],
  ["Peanut puffs", "snack"], ["חטיף בוטנים", "snack"], ["Rice cakes", "snack"], ["פריכיות אורז", "snack"],
  ["Sparkling water, 6-pack", "drink"], ["מים מוגזים, שישייה", "drink"], ["Orange juice 2 L", "drink"], ["מיץ תפוזים 2 ליטר", "drink"],
  ["Dish soap", "clean"], ["סבון כלים", "clean"], ["Trash bags", "clean"], ["שקיות אשפה", "clean"], ["Toilet paper, 32 rolls", "clean"], ["נייר טואלט, 32 גלילים", "clean"],
  ["Dishwasher tablets", "clean"], ["טבליות למדיח", "clean"],
  ["Toothpaste", "toil"], ["משחת שיניים", "toil"], ["Shampoo", "toil"], ["שמפו", "toil"],
  ["Diapers, size 4", "baby"], ["חיתולים, מידה 4", "baby"], ["Wet wipes", "baby"], ["מגבונים לחים", "baby"],
  ["Dry cat food 7 kg", "pets"], ["מזון יבש לחתולים 7 ק״ג", "pets"],
  ["Gluten-free whole-grain spelt sourdough bread, sliced, 750 g", "bread"], ["לחם כוסמין מלא ללא גלוטן, פרוס, מחמצת טבעית 750 גרם", "bread"],
  ["Pita", "bread"], ["פיתות", "bread"], ["Challah", "bread"], ["חלה", "bread"], ["Bread", "bread"], ["לחם", "bread"],
  ["Lactose-free 1% milk with added vitamin D", "dairy"], ["חלב 1% ללא לקטוז בתוספת ויטמין D", "dairy"], ["Milk 3%", "dairy"], ["חלב 3%", "dairy"],
  ["Cottage cheese 5%", "dairy"], ["קוטג׳ 5%", "dairy"], ["Yogurt", "dairy"], ["יוגורט", "dairy"], ["Eggs, size L", "dairy"], ["ביצים L", "dairy"],
  ["Sliced yellow cheese", "dairy"], ["גבינה צהובה פרוסה", "dairy"], ["Grated parmesan", "dairy"], ["פרמזן מגורר", "dairy"],
  ["Organic free-range eggs, size XL, carton of 30", "dairy"], ["ביצי חופש אורגניות, מידה XL, תבנית של 30", "dairy"],
  ["Frozen peas", "frozen"], ["אפונה קפואה", "frozen"], ["Frozen schnitzel", "frozen"], ["שניצל קפוא", "frozen"],
];
// Receipt-style lines (brand + pack size, abbreviations), written for this test.
const RECEIPTS: [string, string][] = [
  ["חלב תנובה 3% 1 ליטר", "dairy"], ["קוטג' תנובה 5% 250 גרם", "dairy"], ["לחם אחיד פרוס", "bread"], ["במבה אסם 80 גרם", "snack"],
  ["ביסלי גריל", "snack"], ["עגבניה שרי", "produce"], ["מלפפון", "produce"], ["בצל יבש", "produce"], ["תפו\"א לבן", "produce"],
  ["גזר ארוז", "produce"], ["אבוקדו האס", "produce"], ["שמן קנולה 1 ליטר", "cans"], ["טונה בשמן 4 יח'", "cans"],
  ["רסק עגבניות 100 גרם", "cans"], ["קפה נמס עלית 200 גרם", "bfast"], ["תה ויסוצקי 100 שקיות", "bfast"], ["סוכר לבן 1 ק\"ג", "spice"],
  ["קמח לבן 1 קג", "spice"], ["מלח שולחני", "spice"], ["אורז פרסי 1 ק\"ג", "dry"], ["פתיתים אפויים", "dry"],
  ["ספגטי 500 גר", "dry"], ["שוקו בשקית", "dairy"], ["גבינה לבנה 5%", "dairy"], ["שמנת חמוצה 15%", "dairy"],
  ["חמאה 200 גרם", "dairy"], ["יוגורט יווני", "dairy"], ["חזה עוף טרי", "meat"], ["כרעיים עוף", "meat"], ["קבב בקר", "meat"],
  ["נקניקיות עוף", "deli"], ["פסטרמה הודו", "deli"], ["זיתים ירוקים", "deli"], ["מלפפון חמוץ", "deli"],
  ["מים מינרליים 1.5 ליטר", "drink"], ["קוקה קולה זירו 1.5 ליטר", "drink"], ["בירה גולדסטאר", "drink"], ["יין אדום יבש", "drink"],
  ["נוזל כביסה", "clean"], ["אקונומיקה", "clean"], ["נייר סופג", "clean"], ["רדיד אלומיניום", "clean"], ["שקיות זבל", "clean"],
  ["סבון ידיים", "toil"], ["דאודורנט רול און", "toil"], ["אקמול", "toil"], ["טישו", "toil"], ["מגבונים", "baby"],
  ["האגיס מידה 5", "baby"], ["מטרנה", "baby"], ["חול לחתולים", "pets"], ["לחמניות המבורגר", "bread"], ["בורקס גבינה", "bread"],
  ["גלידה וניל", "frozen"], ["ירקות קפואים", "frozen"], ["פיצה קפואה", "frozen"], ["Whole milk 1 L", "dairy"],
  ["Free range eggs 12", "dairy"], ["Sliced bread", "bread"], ["Ketchup", "cans"], ["Instant coffee", "bfast"], ["Paper towels", "clean"],
];

let fail = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fail++;
  if (!cond) console.log(`FAIL ${msg}`);
};

// ---- normalisation
assert.equal(normalize("קוטג׳"), normalize('קוטג"'), "geresh / gershayim removed");
assert.equal(normalize('ק"ג'), normalize("ק״ג"), "״ and \" are the same");
assert.equal(normalize("לחם  מלא"), "לחמ מלא", "final letters + extra spaces");
assert.equal(normalize("חָלָב"), "חלב", "niqqud removed");
assert.equal(normalize("חד־פעמי"), "חד פעמי", "maqaf → space");
assert.equal(normalize("Milk 1,5%"), "milk 1.5%", "decimal comma, % kept");

// ---- the dictionary itself
assert.ok(PRODUCT_TYPES.length >= 200, `~200 product types (${PRODUCT_TYPES.length})`);
assert.equal(new Set(PRODUCT_TYPES.map((t) => t.key)).size, PRODUCT_TYPES.length, "type keys are unique");
for (const t of PRODUCT_TYPES) assert.ok(SECTION_KEYS.includes(t.section) && t.he && t.en, `${t.key}: section + he + en`);

// ---- product keys
const key = (s: string) => classifyLocal(s).productKey;
assert.notEqual(key("milk 3%"), key("milk 1%"), "milk 3% ≠ milk 1%");
assert.equal(key("חלב 3%"), key("Milk 3%"), "the same product in Hebrew and English");
assert.equal(key("פסטה פנה 500 גרם"), key("Penne 500 g"), "pack sizes in both languages");
assert.equal(classifyLocal("חלב", "7290000000017").productKey, "gtin:7290000000017", "a barcode is the key");
assert.equal(productKeyFor("משהו טוב לשבת", null).startsWith("~"), true, "unknown → the normalised text");
assert.equal(classifyLocal("something nice for Shabbat").section, "other", "unknown → section other");

// ---- sections
let ok = 0;
const lines = [...BOARD, ...RECEIPTS];
for (const [line, want] of lines) {
  const got = classifyLocal(line).section;
  if (got === want) ok++;
  else console.log(`  miss: ${JSON.stringify(line)} → ${got} (want ${want})`);
}
const pct = Math.round((ok / lines.length) * 1000) / 10;
check(lines.length >= 100, `at least 100 lines (${lines.length})`);
check(pct >= 90, `≥ 90 % in the expected section (${pct} %)`);
console.log(`${pct >= 90 ? "ok" : "FAIL"} sections: ${ok}/${lines.length} = ${pct} % (boards ${BOARD.length}, receipt-style ${RECEIPTS.length})`);

// ---- Open Food Facts tags + an AI answer (pure helpers of the server module)
(async () => {
  process.env.TURSO_DATABASE_URL ??= "file:grocery-test.db";
  const srv = await import("../src/lib/grocery/classify-server").catch(() => null);
  if (srv) {
    assert.equal(srv.sectionFromOff(["en:dairies", "en:milks"]), "dairy");
    assert.equal(srv.sectionFromOff(["en:plant-based-foods-and-beverages", "en:beverages", "en:waters"]), "drink");
    assert.equal(srv.sectionFromOff(["en:frozen-foods", "en:frozen-vegetables"]), "frozen", "frozen beats vegetables");
    assert.equal(srv.sectionFromOff(["en:unknown"]), null);
    const a = srv.fromAi("קרקר אורז בטעם פיצה", { section: "snack", type: "crackers" });
    assert.ok(a.section === "snack" && a.productKey.startsWith("crackers") && a.via === "ai");
    console.log("ok Open Food Facts categories → sections; AI answers → classifications");
  }
  // ---- Tal's own receipts (local DB only, counts only)
  if (existsSync("local.db") && !process.env.CI) {
    const { createClient } = await import("@libsql/client");
    const c = createClient({ url: "file:local.db" });
    const rows = (await c.execute("SELECT data FROM receipts WHERE data IS NOT NULL").catch(() => ({ rows: [] }))).rows;
    let n = 0;
    let known = 0;
    for (const r of rows) {
      try {
        for (const l of (JSON.parse(String(r.data)) as { lines?: { title?: string; name?: string }[] }).lines ?? []) {
          const t = l.title ?? l.name;
          if (!t) continue;
          n++;
          if (classifyLocal(t).type) known++;
        }
      } catch {}
    }
    console.log(`info local receipts: ${known}/${n} lines matched a product type (counts only; many lines are not groceries)`);
  }
  console.log(fail ? `FAIL grocery (${fail})` : "OK grocery");
  process.exit(fail ? 1 : 0);
})();
