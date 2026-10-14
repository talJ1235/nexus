// R17 S3 — the boards' example inbox (Inbox-desktop / Inbox-phone) for one person, on real items of their space so
// the pictures show: Noa shopping (live), a price drop, a delivery today, Noa + Yoav added 7, budget 80 %, the week,
// a target reached (read). Used by test:inbox and the parity shots. R18 S2 D4: `supermarket: true` adds the
// supermarket kinds (the evening draft, adds while you shopped, sent from the computer — Push-phone's inbox).
//   await seedInbox(db, { userId, spaceId, now, supermarket })   → { ids, items }
import { randomBytes } from "node:crypto";

const id = () => `n_${randomBytes(6).toString("hex")}`;

export async function seedInbox(db, { userId, spaceId, now = Date.now(), locale = "en", supermarket = false }) {
  const items = (await db.execute({ sql: `SELECT id, title, image_url FROM items WHERE space_id = ? AND image_url IS NOT NULL ORDER BY created_at LIMIT 3`, args: [spaceId] })).rows;
  const it = (k) => items[k % Math.max(1, items.length)] ?? { id: "missing", title: "Item", image_url: null };
  const he = locale === "he";
  const space = he ? "הבית של יעקבי" : "Jacoby Home";
  const H = 3_600_000;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = (h, m = 0) => Math.min(now - 60_000, startOfDay.getTime() + h * H + m * 60_000);
  const rows = [
    { kind: "shop", key: "shop:seed-trip", at: now - 2 * 60_000, read: false, data: { who: he ? "נועה" : "Noa", whoId: "seed-noa", space, list: he ? "מצרכים" : "Groceries", left: 6, total: 15 } },
    { kind: "price", key: "price:seed-run:1", at: today(9), read: false, data: { itemId: it(0).id, title: he ? "מנקה הקיטור" : "Steam cleaner", store: "KSP", now: 899, was: 999, currency: "ILS", run: "seed-run", pic: it(0).image_url } },
    { kind: "delivery", key: "delivery:seed:1", at: today(8, 12), read: false, data: { itemId: it(1).id, title: he ? "קליפס לפתח מיזוג" : "Car vent clip", store: "AliExpress", pic: it(1).image_url } },
    { kind: "activity", key: "activity:seed:1", at: now - 26 * H, read: false, data: { names: he ? ["נועה", "יואב"] : ["Noa", "Yoav"], byIds: ["seed-noa", "seed-yoav"], added: 7, checked: 0, space, list: he ? "מצרכים" : "Groceries" } },
    { kind: "budget", key: "budget:seed:80", at: now - 3 * 24 * H, read: false, data: { space, pct: 80, spent: 2000, budget: 2500, currency: "ILS", month: new Date(now).getMonth() + 1 } },
    { kind: "week", key: "week:seed", at: now - 4 * 24 * H, read: false, data: { bought: 23, spent: 612, currency: "ILS", drops: 2 } },
    { kind: "price", key: "price:seed-run0:3", at: now - 5 * 24 * H, read: true, data: { itemId: it(2).id, title: he ? "מנורת השולחן" : "Desk lamp", store: he ? "איקאה" : "IKEA", now: 149, was: 179, currency: "ILS", run: "seed-run0", target: true, pic: it(2).image_url } },
  ];
  if (supermarket)
    rows.unshift(
      { kind: "draft", key: "draft:seed", at: now - 60_000, read: false, data: { space, items: 18, suggested: 4, day: new Date(now + 24 * H).toISOString().slice(0, 10) } },
      { kind: "sent", key: "sent:seed", at: today(19, 35), read: false, data: { who: he ? "טל" : "Tal", whoId: "seed-tal", self: false, items: 23, chain: "shufersal", branch: "Deal", space } },
      { kind: "trip_add", key: "tripadd:seed", at: today(18, 52), read: true, data: { who: he ? "נועה" : "Noa", whoIds: ["seed-noa"], titles: he ? ["חלב 1%", "חלה", "סבון כלים"] : ["Milk 1%", "Challah", "Dish soap"], n: 3, space, tripId: "seed-trip" } },
    );
  const ids = {};
  for (const r of rows) {
    const nid = id();
    ids[r.key] = nid;
    await db.execute({
      sql: `INSERT INTO notification (id, user_id, space_id, kind, group_key, data, created_at, updated_at, read_at, push_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')
            ON CONFLICT (user_id, group_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, read_at = excluded.read_at, deleted_at = NULL`,
      args: [nid, userId, spaceId, r.kind, r.key, JSON.stringify(r.data), r.at, r.at, r.read ? r.at : null],
    });
  }
  return { ids, items: items.map((x) => x.id) };
}
