// R18 C — fast add (unit + a throwaway file DB): the parse table (40 lines, he + en), duplicate merge + undo (also with
// different units), the type-ahead's matched ranges (only the typed letters), the "did you mean" table, and the split
// table (the boards' WhatsApp paste and voice examples, docs/design/r18/Add-phone.dc.html).
//   npm run test:add
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { parseLine, splitList } from "../src/lib/grocery/parse";
import { typeAhead, matchRange } from "../src/lib/grocery/search";

// [line, qty, amount, unit, name]
const PARSE: [string, number, number | null, string | null, string][] = [
  ["2 חלב 3%", 2, null, null, "חלב 3%"],
  ["חלב 3%", 1, null, null, "חלב 3%"],
  ["2 milk 3%", 2, null, null, "milk 3%"],
  ["milk", 1, null, null, "milk"],
  ["1.5 ק״ג עגבניות", 1, 1.5, "kg", "עגבניות"],
  ['1,5 ק"ג עגבניות', 1, 1.5, "kg", "עגבניות"],
  ["2 קילו מלפפונים", 1, 2, "kg", "מלפפונים"],
  ["חצי קילו גבינה צהובה", 1, 0.5, "kg", "גבינה צהובה"],
  ["half kg cheese", 1, 0.5, "kg", "cheese"],
  ["200 גרם פסטרמה", 1, 200, "g", "פסטרמה"],
  ["200 g sliced cheese", 1, 200, "g", "sliced cheese"],
  ["300 גר׳ זיתים", 1, 300, "g", "זיתים"],
  ["2kg tomatoes", 1, 2, "kg", "tomatoes"],
  ["1.5 kg potatoes", 1, 1.5, "kg", "potatoes"],
  ["2 ליטר מיץ", 1, 2, "l", "מיץ"],
  ["1 l orange juice", 1, 1, "l", "orange juice"],
  ['500 מ"ל שמנת', 1, 0.5, "l", "שמנת"],
  ["פסטה 500 גרם", 1, null, null, "פסטה 500 גרם"],
  ["penne 500 g", 1, null, null, "penne 500 g"],
  ["שמן זית 1 ליטר", 1, null, null, "שמן זית 1 ליטר"],
  ["3% milk", 1, null, null, "3% milk"],
  ["7up", 1, null, null, "7up"],
  ["10 פיתות", 10, null, null, "פיתות"],
  ["12 eggs", 12, null, null, "eggs"],
  ["a dozen eggs", 12, null, null, "eggs"],
  ["two breads", 2, null, null, "breads"],
  ["שני לחמים", 2, null, null, "לחמים"],
  ["שתי חלות", 2, null, null, "חלות"],
  ["שלושה קוטג׳", 3, null, null, "קוטג׳"],
  ["milk x2", 2, null, null, "milk"],
  ["חלב ×3", 3, null, null, "חלב"],
  ["bread * 2", 2, null, null, "bread"],
  ["  2   ביצים  ", 2, null, null, "ביצים"],
  ["4 יוגורט", 4, null, null, "יוגורט"],
  ["6 בננות", 6, null, null, "בננות"],
  ["1 kg chicken breast", 1, 1, "kg", "chicken breast"],
  ["a bread", 1, null, null, "a bread"],
  ["ice cream", 1, null, null, "ice cream"],
  ["5 כוסות חד פעמיות", 5, null, null, "כוסות חד פעמיות"],
  ["0.5 ק״ג סלמון", 1, 0.5, "kg", "סלמון"],
];

(async () => {
  // ---- C1 parse table
  assert.equal(PARSE.length, 40);
  for (const [line, qty, amount, unit, name] of PARSE) {
    const p = parseLine(line);
    assert.deepEqual([p.qty, p.amount, p.unit, p.name], [qty, amount, unit, name], `parse ${JSON.stringify(line)}`);
  }

  // ---- C3 matched ranges (only the typed letters) + "did you mean"
  assert.deepEqual(matchRange("חלב 3%", "חל"), [0, 2]);
  assert.deepEqual(matchRange("קוטג׳ 5%", "קוטג"), [0, 4], "geresh after the match isn't bold");
  assert.deepEqual(matchRange("Plant milk", "mil"), [6, 9], "a word inside the title");
  assert.deepEqual(matchRange("ממרח שוקולד", "שוקולד"), [5, 11]);
  assert.equal(matchRange("לחם", "חלב"), null);
  const hh = [{ productKey: "milk 3%", title: "חלב 3%", count: 9, lastAt: Date.UTC(2026, 9, 10), section: "dairy" as const, art: "mlk" }];
  const ta = typeAhead("חל", hh, { locale: "he", now: Date.UTC(2026, 9, 12) });
  assert.equal(ta.hits[0].source, "household", "the household's own product first");
  assert.equal(ta.hits[0].title, "חלב 3%");
  const dym = (q: string, locale: string) => typeAhead(q, hh, { locale }).didYouMean.map((h) => h.title);
  for (const [q, want, locale] of [["עגבנות", "עגבניות", "he"], ["tomatos", "Tomatoes", "en"], ["חלאב", "חלב 3%", "he"], ["cucmber", "Cucumbers", "en"], ["בננה", "בננה", "he"], ["yoghurtt", "Yogurt", "en"]] as const) {
    const got = dym(q, locale);
    const direct = typeAhead(q, hh, { locale }).hits.map((h) => h.title);
    assert.ok(got.includes(want) || direct.includes(want), `did you mean: ${q} → ${want} (got ${got.join(", ") || direct.join(", ")})`);
  }
  assert.ok(dym("עגבנות", "he").length <= 3, "at most 3");
  assert.equal(dym("xq", "en").length, 0, "too short to guess");

  // ---- C4 split table (the boards' examples)
  const paste = (t: string) => splitList(t, ["milk 3%"]).map((p) => [p.name, p.qty, p.product, p.checked]);
  assert.deepEqual(paste("Noa: for tomorrow\nmilk\n2 cucumbers\ntoilet paper!!\nsomething nice for Shabbat"), [
    ["for tomorrow", 1, false, false],
    ["milk", 1, true, true],
    ["cucumbers", 2, true, true],
    ["toilet paper", 1, true, true],
    ["something nice for Shabbat", 1, false, false],
  ]);
  assert.deepEqual(paste("נועה: למחר\nחלב\n2 מלפפונים\nנייר טואלט!!\nמשהו טוב לשבת"), [
    ["למחר", 1, false, false],
    ["חלב", 1, true, true],
    ["מלפפונים", 2, true, true],
    ["נייר טואלט", 1, true, true],
    ["משהו טוב לשבת", 1, false, false],
  ]);
  const worst = splitList("[10:31, 12/10/2026] Noa: lactose-free 1% milk with added vitamin D (blue cap only!!)\n2 cucumbers 🥒\n• toilet paper!!\n- something nice for Shabbat the kids like, not spicy");
  assert.equal(worst.length, 4);
  assert.equal(worst[0].cls.section, "dairy", "WhatsApp time + sender prefix dropped, the long milk line is milk");
  assert.equal(worst[3].product, false, "a sentence comes back as a note");
  const voice = (t: string) => splitList(t).map((p) => [p.name, p.qty]);
  assert.deepEqual(voice("milk, eggs and two breads"), [["milk", 1], ["eggs", 1], ["breads", 2]]);
  assert.deepEqual(voice("חלב, ביצים ושני לחמים"), [["חלב", 1], ["ביצים", 1], ["לחמים", 2]]);
  assert.deepEqual(voice("חלב ויוגורט"), [["חלב", 1], ["יוגורט", 1]], "ו between two items = and");
  assert.deepEqual(voice("חלב בתוספת ויטמין"), [["חלב בתוספת ויטמין", 1]], "ו inside a word is not 'and'");
  assert.equal(splitList("milk", ["milk"]).length, 1);
  assert.equal(splitList("חלב 3%", ["milk 3%"])[0].onList, true, "already on the list is flagged");
  assert.deepEqual(splitList("Sparkling water, 6-pack\nmilk").map((p) => p.name), ["Sparkling water, 6-pack", "milk"], "a comma inside a product stays");
  assert.deepEqual(splitList("milk, eggs\nbread").map((p) => p.name), ["milk", "eggs", "bread"], "a line of products cut at commas");

  // ---- C2 merge + undo (DB)
  const DB = "add-test.db";
  for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
  process.env.TURSO_DATABASE_URL = `file:${DB}`;
  process.env.TURSO_AUTH_TOKEN = "";
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });
  const { schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const G = await import("../src/lib/db-scoped/grocery");
  const s = new Scoped({ spaceId: "sp", userId: "u1", by: "u1" });
  const add = (line: string) => {
    const p = parseLine(line);
    return G.addToList(s, { title: p.name, qty: p.qty, amount: p.amount, unit: p.unit, by: "u1" });
  };
  const a = await add("חלב 3%");
  assert.equal(a.merged, false);
  const b = await add("2 Milk 3%");
  assert.equal(b.merged, true, "Milk is already on the list");
  assert.equal(b.item.id, a.item.id);
  assert.equal(b.item.quantity, 3, "now ×3");
  assert.equal((await G.supermarketList(s)).length, 1, "no second row");
  await G.undoMerge(s, b.item.id, b.before!);
  assert.equal((await s.byId(schema.items, a.item.id))!.quantity, 1, "undo restores the old quantity");
  const t1 = await add("1 kg tomatoes");
  const t2 = await add("עגבניות 1.5 ק״ג".replace(/(.*) (1\.5 ק״ג)/, "$2 $1"));
  assert.equal(t2.merged, true);
  assert.equal(t2.item.amount, 2.5, "same unit: amounts add up (kg)");
  const t3 = await add("6 עגבניות");
  assert.equal(t3.merged, true, "different units of one product: one row");
  assert.match(t3.item.notes ?? "", /\+ ×6/, "the second amount is noted");
  await G.undoMerge(s, t3.item.id, t3.before!);
  assert.equal((await s.byId(schema.items, t1.item.id))!.notes, null, "undo removes the note");
  const p1 = await add("פסטה");
  await s.update(schema.items, { status: "purchased" }, (await import("drizzle-orm")).eq(schema.items.id, p1.item.id));
  assert.equal((await add("פסטה")).merged, false, "bought rows don't merge: a new row to buy");

  console.log("ok C1 parse table: 40 lines (he + en, units, decimals, half, pack sizes stay in the name)");
  console.log("ok C2 merge + undo: same product adds up, same unit adds amounts, other units noted, undo restores");
  console.log("ok C3 type-ahead: household first, typed letters only, did-you-mean table");
  console.log("ok C4 split: WhatsApp paste (he + en + worst case), voice lines, ו only between items, notes unchecked");
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
