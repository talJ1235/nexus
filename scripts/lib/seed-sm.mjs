// R18 S2 — supermarket demo data (the boards' list): a main store, 23 rows on the list in 13 sections, six finished
// trips over two months (so "Nexus suggests" has eggs every ~9 days, toilet paper every ~3 weeks, parmesan with pasta)
// and last prices for the estimate. Idempotent: rows with ids `demo-sm-*` / `demo-trip-*` are replaced.
//   seedSupermarket(db, { spaceId, userId, now? })   — used by seed-local (smoke) and the parity script.

const DAY = 86_400_000;

// [id, title, productKey, section, art, qty, amount, unit, notes, price]
export const SM_LIST = [
  ["tom", "Tomatoes", "tomatoes", "produce", "tom", 1, 1, "kg", null, 7.9],
  ["cuc", "Cucumbers", "cucumbers", "produce", "cuc", 1, 1, "kg", null, 6.9],
  ["ban", "Bananas", "bananas", "produce", "ban", 6, null, null, "Not too ripe", 1.2],
  ["lem", "Lemons", "lemons", "produce", "lem", 4, null, null, null, 1.5],
  ["par", "Parsley", "parsley", "produce", "par", 2, null, null, null, 4.9],
  ["chk", "Chicken breast", "chicken-breast", "meat", "chk", 1, 1, "kg", "Thin slices", 44.9],
  ["hum", "Hummus", "hummus", "deli", "hum", 2, null, null, null, 9.9],
  ["pen", "Penne 500 g", "pasta 500g", "dry", "pen", 2, null, null, null, 6.5],
  ["ric", "Basmati rice", "rice", "dry", "ric", 1, 1, "kg", null, 12.9],
  ["crt", "Crushed tomatoes", "crushed-tomatoes", "cans", "crt", 3, null, null, null, 5.9],
  ["tah", "Raw tahini", "tahini", "cans", "tah", 1, null, null, null, 18.9],
  ["cor", "Cornflakes", "cornflakes", "bfast", "cor", 1, null, null, null, 16.9],
  ["cof", "Ground coffee", "coffee", "bfast", "cof", 1, null, null, "The dark one", 24.9],
  ["wat", "Sparkling water, 6-pack", "sparkling-water 6", "drink", "wat", 1, null, null, null, 15.9],
  ["dis", "Dish soap", "dish-soap", "clean", "dis", 1, null, null, null, 9.9],
  ["trb", "Trash bags", "trash-bags", "clean", "trb", 1, null, null, null, 12.9],
  ["tpa", "Toothpaste", "toothpaste", "toil", "tpa", 2, null, null, null, 11.9],
  ["pit", "Pita", "pita", "bread", "pit", 10, null, null, null, 0.9],
  ["mlk", "Milk 3%", "milk 3%", "dairy", "mlk", 2, null, null, null, 6.9],
  ["cot", "Cottage cheese 5%", "cottage 5%", "dairy", "cot", 3, null, null, null, 5.9],
  ["ylc", "Sliced yellow cheese", "yellow-cheese", "dairy", "ylc", 1, 200, "g", null, 0.09],
  ["yog", "Yogurt", "yogurt", "dairy", "yog", 4, null, null, null, 3.9],
  ["pea", "Frozen peas", "frozen-peas", "frozen", "pea", 1, 800, "g", null, 0.016],
];

// What the past trips bought (product keys) — days ago.
const TRIPS = [
  [63, ["toilet-paper 32", "tomatoes"]],
  [50, ["pasta 500g", "parmesan", "cucumbers"]],
  [42, ["toilet-paper 32", "pasta 500g", "parmesan"]],
  [30, ["eggs l", "pasta 500g", "parmesan", "tomatoes"]],
  [21, ["eggs l", "toilet-paper 32", "bananas"]],
  [12, ["eggs l", "hummus"]],
];
const META = {
  "toilet-paper 32": ["Toilet paper, 32 rolls", "clean", 39.9],
  "pasta 500g": ["Penne 500 g", "dry", 6.5],
  parmesan: ["Grated parmesan", "dairy", 14.9],
  "milk 3%": ["Milk 3%", "dairy", 6.9],
  tomatoes: ["Tomatoes", "produce", 7.9],
  cucumbers: ["Cucumbers", "produce", 6.9],
  "eggs l": ["Eggs, size L", "dairy", 13.9],
  bananas: ["Bananas", "produce", 1.2],
  hummus: ["Hummus", "deli", 9.9],
};

const ART_OF = { "toilet-paper 32": "tp", parmesan: "prm", "eggs l": "egg" };
/** When those older rows were bought (days ago) — on each product's own rhythm, so the steady ones stay regular. */
const FIRST = { "eggs l": 39, "toilet-paper 32": 84, parmesan: 58 };

export async function seedSupermarket(db, { spaceId, userId, now = Date.now(), list = true }) {
  const run = (sql, args = []) => db.execute({ sql, args });
  await run("DELETE FROM trip_check WHERE space_id = ? AND trip_id LIKE 'demo-trip-%'", [spaceId]);
  await run("DELETE FROM trip WHERE space_id = ? AND id LIKE 'demo-trip-%'", [spaceId]);
  await run("DELETE FROM items WHERE space_id = ? AND id LIKE 'demo-sm-%'", [spaceId]);
  await run("DELETE FROM space_store WHERE space_id = ?", [spaceId]);
  await run("DELETE FROM suggest_dismiss WHERE space_id = ?", [spaceId]);
  await run("INSERT INTO space_store (space_id, chain, branch, is_default) VALUES (?, 'shufersal', 'Herzl St.', 1)", [spaceId]);
  if (list)
    for (const [k, [id, title, key, section, art, qty, amount, unit, notes]] of SM_LIST.entries())
      await run(
        `INSERT INTO items (id, space_id, title, list, status, priority, quantity, amount, unit, product_key, section, art_key, notes, watch, added_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, 'supermarket', 'to_buy', 'normal', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [`demo-sm-${id}`, spaceId, title, qty, amount, unit, key, section, art, notes, userId, now - (SM_LIST.length - k) * 60_000, now - (SM_LIST.length - k) * 60_000],
      );
  // Last prices for the estimate: one purchased row per listed product, 40 days ago (outside any trip).
  for (const [id, title, key, section, art, qty, amount, unit, , price] of SM_LIST)
    await run(
      `INSERT INTO items (id, space_id, title, list, status, priority, quantity, amount, unit, product_key, section, art_key, watch, purchased_at, purchased_price, purchased_currency, created_at, updated_at)
       VALUES (?, ?, ?, 'supermarket', 'purchased', 'normal', ?, ?, ?, ?, ?, ?, 0, ?, ?, 'ILS', ?, ?)`,
      [`demo-sm-p-${id}`, spaceId, title, qty, amount, unit, key, section, art, now - 40 * DAY, price, now - 41 * DAY, now - 40 * DAY],
    );
  // Products bought only in trips get one older purchased row too (their name on the list and in suggestions).
  for (const [k, [title, section, price]] of Object.entries(META)) {
    if (SM_LIST.some((r) => r[2] === k)) continue;
    await run(
      `INSERT INTO items (id, space_id, title, list, status, priority, quantity, product_key, section, art_key, watch, purchased_at, purchased_price, purchased_currency, created_at, updated_at)
       VALUES (?, ?, ?, 'supermarket', 'purchased', 'normal', 1, ?, ?, ?, 0, ?, ?, 'ILS', ?, ?)`,
      [`demo-sm-p-${k.replace(/[^a-z0-9]+/g, "-")}`, spaceId, title, k, section, ART_OF[k] ?? null, now - (FIRST[k] ?? 70) * DAY, price, now - (FIRST[k] ?? 70) * DAY - DAY, now - (FIRST[k] ?? 70) * DAY],
    );
  }
  // Thursday-ish evening trips.
  for (const [ago, keys] of TRIPS) {
    const id = `demo-trip-${ago}`;
    const at = now - ago * DAY;
    const total = keys.reduce((a, k) => a + META[k][2], 0);
    await run(
      `INSERT INTO trip (id, space_id, user_id, chain, branch, started_at, finished_at, total, currency, planned, bought, not_found)
       VALUES (?, ?, ?, 'shufersal', 'Herzl St.', ?, ?, ?, 'ILS', ?, ?, 0)`,
      [id, spaceId, userId, at, at + 40 * 60_000, Math.round(total * 100) / 100, keys.length, keys.length],
    );
    for (const [seq, k] of keys.entries())
      await run(
        "INSERT INTO trip_check (space_id, trip_id, product_key, section, action, qty, price, by_user, at, seq) VALUES (?, ?, ?, ?, 'check', 1, ?, ?, ?, ?)",
        [spaceId, id, k, META[k][1], META[k][2], userId, at + (seq + 1) * 60_000, seq + 1],
      );
  }
  return { list: list ? SM_LIST.length : 0, trips: TRIPS.length };
}
