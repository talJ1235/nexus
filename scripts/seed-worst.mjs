// Polish (2026-10-08): the audit's worst-case spaces as a repeatable seed — LOCAL file databases only, never prod.
// Idempotent: wipes and re-creates the three spaces (ids pa_empty / pa_one / pa_big) and their rows, owned by the
// ADMIN_EMAIL user (created by the migration).
//   Empty — 0 items · One — 1 item, 1 project · pa_big — 500 items under a long Hebrew space name: 14 lists (long,
//   one-letter, emoji, German compound), long / unbreakable / Vietnamese / CJK / <script> titles, a long store name,
//   prices 0, 0.30000000000000004 and 12,345,678.9, qty 1000, members "Jo", "👩🏽‍💻 Priya", an Arabic name and a long
//   plus-addressed email.
//
//   TURSO_DATABASE_URL=file:polish-smoke.db ADMIN_EMAIL=… node scripts/seed-worst.mjs
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || "";
if (!url.startsWith("file:")) {
  console.log("FAIL seed-worst only runs against a file: database");
  process.exit(1);
}
const db = createClient({ url });
const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const owner = (await db.execute({ sql: `SELECT id FROM "user" WHERE lower(email) = ?`, args: [adminEmail] })).rows[0]?.id;
if (!owner) {
  console.log("FAIL seed-worst: no ADMIN_EMAIL user — run the migration with ADMIN_EMAIL set first");
  process.exit(1);
}

const now = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const SPACES = [
  ["pa_empty", "Empty"],
  ["pa_one", "One"],
  ["pa_big", "משפחת וישנייבסקה-קובלצ'יק — הדירה החדשה ברחוב הרצל 42"],
];
const ids = SPACES.map(([id]) => id);
const inIds = `(${ids.map(() => "?").join(", ")})`;
for (const t of ["price_points", "alerts", "sources", "items", "collections", "space_pref", "space_rev", "tombstone", "space_member"])
  await db.execute({ sql: `DELETE FROM ${t} WHERE space_id IN ${inIds}`, args: ids }).catch(() => {});
await db.execute({ sql: `DELETE FROM space WHERE id IN ${inIds}`, args: ids });
await db.execute(`DELETE FROM "user" WHERE id LIKE 'pa_u%'`);

for (const [id, name] of SPACES) {
  await db.execute({
    sql: "INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES (?, ?, ?, 'shared', 'ILS', 'blue', 'home', ?, ?)",
    args: [id, name, `s-${id}`, owner, now],
  });
  await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)", args: [`pm_${id}`, id, owner, now] });
}
const MEMBERS = [
  ["pa_u1", "Jo", "jo@example.com"],
  ["pa_u2", "👩🏽‍💻 Priya", "first.last+billing-notifications@example.com"],
  ["pa_u3", "Christopher Alexander Montgomery III", "c.montgomery@sub.department.region.example.co.uk"],
  ["pa_u4", "نور الهدى عبد الرحمن", "noor@example.org"],
];
for (const [uid, name, email] of MEMBERS) {
  await db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'user', ?, ?)`, args: [uid, name, email, now, now] });
  await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, 'pa_big', ?, 'member', ?)", args: [`pm_${uid}`, uid, now] });
}

const item = (id, space, col, title, status, priority, qty, tags, price, store, at) => [
  db.execute({
    sql: `INSERT INTO items (id, space_id, collection_id, title, tags, status, priority, quantity, ordered_at, purchased_at, purchased_price, purchased_currency, eta, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, space, col, title, JSON.stringify(tags), status, priority, qty, status !== "to_buy" ? at : null, status === "purchased" ? at : null, status !== "to_buy" ? price : null, status !== "to_buy" ? "ILS" : null, status === "ordered" ? now + 4 * DAY : null, at, at],
  }),
  db.execute({
    sql: "INSERT INTO sources (id, space_id, item_id, url, normalized_url, store, store_key, price, currency, shipping, raw_title, fetched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ILS', 0, ?, ?, ?)",
    args: [`${id}_s`, space, id, `https://example.com/p/${id}`, `https://example.com/p/${id}`, store, store.toLowerCase().replace(/[^a-z]/g, "").slice(0, 20), price, title, at, at],
  }),
];

// One: a single item in a single project.
await db.execute({ sql: "INSERT INTO collections (id, space_id, kind, name, color, budget, budget_currency, sort_order) VALUES ('pa_one_c', 'pa_one', 'project', 'Bike', 'blue', 1, 'ILS', 0)" });
await Promise.all(item("pa_one_i", "pa_one", "pa_one_c", "Helmet", "to_buy", "normal", 1, [], 1, "KSP", now - 7 * 60 * MIN));

// pa_big: 14 collections, 500 items.
const COLS = [
  ["project", "Railcam — motorised camera slider with a very long project name for testing", 1500],
  ["project", "שיפוץ המטבח, הסלון וחדר הרחצה בדירה החדשה", 120000],
  ["list", "Benachrichtigungseinstellungen", null],
  ["list", "J", null],
  ["list", "🦊 Fox stuff", null],
  ["list", "Groceries", null],
  ["list", "Garden", 0],
  ["list", "Car", null],
  ["project", "Kids", 300],
  ["list", "Office", null],
  ["project", "Birthday", 50],
  ["list", "Camping", null],
  ["list", "Gifts", null],
  ["list", "Misc", null],
];
const COLORS = ["blue", "amber", "green", "violet", "rose", "teal", "slate", "olive"];
for (const [i, [kind, name, budget]] of COLS.entries())
  await db.execute({
    sql: "INSERT INTO collections (id, space_id, kind, name, color, budget, budget_currency, sort_order) VALUES (?, 'pa_big', ?, ?, ?, ?, 'ILS', ?)",
    args: [`pa_big_c${i}`, kind, name, COLORS[i % COLORS.length], budget, i],
  });
const TITLES = [
  "Xiaomi Smart Standing Fan 2 Lite מאוורר עומד חכם עם שלט רחוק ואפליקציה, לבן, דגם 2026 החדש ביותר",
  "IMG_20250914_183022_HDR_portrait_edited_edited_FINAL_v12.HEIC",
  "J",
  "👩🏽‍💻 Laptop stand",
  "מברגה",
  "Konstantin Oberhauser-Wettstein Präzisionswerkzeug-Satz für Feinmechanik und Uhrmacher",
  "<script>alert(1)</script> &amp; **bold**",
  "Đặng Thị Ngọc Hân áo dài",
  "王秀英的茶壶",
  "Elegoo PLA 1.75mm אדום",
];
const STORES = ["KSP", "Northwind Industries Holdings International Outlet Store", "IKEA", "Ace", "AliExpress", "Amazon"];
const PRICES = [12345678.9, 0, 0.30000000000000004, 1, 49.95, 1284, 349];
const TAGS = ["design", "frontend", "q3", "urgent", "needs-review", "customer-feedback-from-enterprise-onboarding"];
const writes = [];
for (let i = 0; i < 500; i++) {
  const status = i % 5 === 3 ? "ordered" : i % 5 === 4 ? "purchased" : "to_buy";
  const col = i % 7 === 6 ? null : `pa_big_c${i % COLS.length}`;
  const title = i < 10 ? TITLES[i] : `${TITLES[i % 10]} #${i}`;
  writes.push(...item(`pa_big_i${i}`, "pa_big", col, title, status, i % 3 === 0 ? "urgent" : "normal", i % 9 === 0 ? 1000 : 1, i % 16 === 0 ? TAGS : [], PRICES[i % PRICES.length], STORES[i % STORES.length], now - i * 432 * MIN));
  if (writes.length >= 200) await Promise.all(writes.splice(0));
}
await Promise.all(writes);
console.log("OK seeded worst-case spaces: pa_empty (0 items), pa_one (1), pa_big (500)");
