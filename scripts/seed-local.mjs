// Seeds the LOCAL database (file: URLs only) with a realistic demo catalog for UI work and smoke screenshots.
// Idempotent: wipes and re-creates rows whose id starts with "demo-". Never touches remote databases.
//
//   node --env-file=.env.local scripts/seed-local.mjs
//   SEED_PROFILE=sparse … — Round 14 A2: items + projects only (no alerts, no etas, no price points, no budgets), so
//   Home's exact rules find nothing and the AI look / broad fallbacks have to speak.
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || "";
if (!url.startsWith("file:")) {
  console.log("FAIL seed-local only runs against a file: database");
  process.exit(1);
}
const db = createClient({ url });

// Simple flat product illustrations (the sandbox can't reach store CDNs).
const art = (body) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`)}`;
const IMG = {
  charger: art('<rect x="22" y="18" width="56" height="64" rx="8" fill="#2b2f36"/><rect x="30" y="28" width="40" height="18" rx="3" fill="#8fd16a"/><circle cx="38" cy="64" r="5" fill="#d33"/><circle cx="62" cy="64" r="5" fill="#222"/>'),
  fan: art('<circle cx="50" cy="38" r="26" fill="#f4f4f4" stroke="#bbb" stroke-width="3"/><circle cx="50" cy="38" r="6" fill="#999"/><rect x="47" y="62" width="6" height="26" fill="#ccc"/><ellipse cx="50" cy="90" rx="18" ry="4" fill="#bbb"/>'),
  pla: art('<circle cx="50" cy="50" r="34" fill="#c9302c"/><circle cx="50" cy="50" r="12" fill="#eee"/><circle cx="50" cy="50" r="24" fill="none" stroke="#a52622" stroke-width="2"/>'),
  motor: art('<rect x="26" y="30" width="48" height="48" rx="4" fill="#3a3f47"/><rect x="26" y="30" width="48" height="10" fill="#555b64"/><rect x="47" y="14" width="6" height="18" fill="#aaa"/>'),
  lamp: art('<path d="M30 30h40l-10 26H40z" fill="#f2c14e"/><rect x="48" y="56" width="4" height="26" fill="#666"/><rect x="36" y="82" width="28" height="5" rx="2" fill="#444"/>'),
  chair: art('<rect x="34" y="16" width="32" height="36" rx="6" fill="#4c6ef5"/><rect x="30" y="52" width="40" height="8" rx="3" fill="#364fc7"/><rect x="48" y="60" width="4" height="20" fill="#555"/><rect x="34" y="80" width="32" height="4" rx="2" fill="#555"/>'),
  pi: art('<rect x="18" y="26" width="64" height="44" rx="4" fill="#2f9e44"/><rect x="26" y="34" width="18" height="18" fill="#222"/><rect x="52" y="34" width="22" height="8" fill="#ddd"/><rect x="52" y="48" width="22" height="8" fill="#ddd"/>'),
  drill: art('<rect x="20" y="30" width="46" height="18" rx="6" fill="#f08c00"/><rect x="66" y="35" width="16" height="8" fill="#888"/><rect x="30" y="48" width="14" height="30" rx="3" fill="#333"/>'),
};

const now = Date.now();
const day = 86400000;
const SPARSE = process.env.SEED_PROFILE === "sparse";
const collections = [
  { id: "demo-c-railcam", kind: "project", name: "Railcam", color: "amber", budget: 1500 },
  { id: "demo-c-home", kind: "list", name: "בית", color: "teal", budget: null },
  { id: "demo-c-print", kind: "list", name: "3D printing", color: "violet", budget: null },
];
// [id, title, img, collection, priority, qty, status, [store, key, price, currency, shipping, url], tags]
const items = [
  ["demo-1", "NOCO GENIUS1EU מטען מצברים", "charger", "demo-c-home", "normal", 1, "to_buy", ["Amazon", "amazon", 49.95, "USD", 12, "https://www.amazon.com/dp/B07W3QT6HM"], ["automotive"]],
  ["demo-2", "Xiaomi Smart Standing Fan 2 Lite מאוורר עומד חכם", "fan", "demo-c-home", "urgent", 1, "to_buy", ["KSP", "ksp", 349, "ILS", 0, "https://ksp.co.il/web/item/123456"], ["home"]],
  ["demo-3", "Elegoo PLA 1.75mm אדום", "pla", "demo-c-print", "normal", 3, "to_buy", ["AliExpress", "aliexpress", 14.2, "USD", 2.1, "https://www.aliexpress.com/item/1005001.html"], ["3d printing"]],
  ["demo-4", "NEMA 17 Stepper Motor 42-40 1.5A", "motor", "demo-c-railcam", "urgent", 2, "to_buy", ["AliExpress", "aliexpress", 8.9, "USD", 1.5, "https://www.aliexpress.com/item/1005002.html"], ["electronics"]],
  ["demo-5", "מנורת שולחן LED עם עמעום", "lamp", "demo-c-home", "someday", 1, "to_buy", ["IKEA", "ikea", 129, "ILS", null, "https://www.ikea.com/il/he/p/12345"], ["home", "lighting"]],
  ["demo-6", "Ergonomic office chair — כיסא משרדי ארגונומי", "chair", null, "normal", 1, "ordered", ["Office Depot", "officedepot", 899, "ILS", 50, "https://www.officedepot.co.il/item/1"], ["furniture"], 6, -1],
  ["demo-7", "Raspberry Pi 5 8GB", "pi", "demo-c-railcam", "normal", 1, "to_buy", ["Raspberry Pi Store", "raspberrypi", 80, "USD", 9, "https://www.raspberrypi.com/products/raspberry-pi-5/"], ["electronics"]],
  ["demo-8", "מברגה נטענת Makita DDF485 18V", "drill", null, "normal", 1, "purchased", ["Ace", "ace", 649, "ILS", 0, "https://www.ace.co.il/item/2"], ["tools"]],
];

// A year of purchases (Round 8: spending/stats and the totals look like real data, with big amounts and long names so
// phone layouts are tested against them). [.., daysAgo] as the 10th field.
// Round 13 Home: packages with dates (late / this week / later), a deal + a free-shipping gap at one store, a
// someday item that closes it, a regular buy that is due again, and an order that crossed free shipping this month.
items.push(
  ["demo-o1", "Arduino Nano ESP32", "pi", "demo-c-railcam", "normal", 1, "ordered", ["AliExpress", "aliexpress", 21, "USD", 0, "https://www.aliexpress.com/item/1005003.html"], [], 1, 4],
  ["demo-o2", "NEMA 17 bracket ×2", "motor", "demo-c-railcam", "normal", 2, "ordered", ["AliExpress", "aliexpress", 3.5, "USD", 0, "https://www.aliexpress.com/item/1005004.html"], [], 5, 2],
  ["demo-o3", "Bench power supply 30V 5A", "charger", null, "normal", 1, "ordered", ["Amazon", "amazon", 69, "USD", 0, "https://www.amazon.com/dp/B0POWER"], [], 3, 16],
  // Round 14 C1: an order arriving in ~40 days — the month view always has an arrival in a later month.
  ["demo-o4", "USB-C hub 7-in-1", "charger", null, "normal", 1, "ordered", ["Amazon", "amazon", 39, "USD", 0, "https://www.amazon.com/dp/B0HUB7"], [], 2, 40],
  ["demo-10", "כבל מאריך חשמל 5 מטר עם 4 שקעים", "charger", "demo-c-home", "normal", 1, "to_buy", ["ACE", "ace", 59, "ILS", 0, "https://www.ace.co.il/item/3"], ["home"]],
  ["demo-9", "Raspberry Pi 5 Active Cooler", "pi", "demo-c-railcam", "someday", 1, "to_buy", ["Raspberry Pi Store", "raspberrypi", 12, "USD", 0, "https://www.raspberrypi.com/products/active-cooler/"], ["electronics"]],
  ["demo-b1", "Raspberry Pi Camera cable 50cm", "pi", "demo-c-railcam", "normal", 4, "purchased", ["Raspberry Pi Store", "raspberrypi", 15, "USD", 0, "https://www.raspberrypi.com/products/camera-cable/"], [], 2],
  ["demo-b2", "Raspberry Pi 27W USB-C power supply", "charger", "demo-c-railcam", "normal", 4, "purchased", ["Raspberry Pi Store", "raspberrypi", 14, "USD", 0, "https://www.raspberrypi.com/products/27w-power-supply/"], [], 2],
  ["demo-r1", "Coffee beans 1kg — פולי קפה", "lamp", null, "normal", 1, "purchased", ["KSP", "ksp", 89, "ILS", 0, "https://example.com/coffee/1"], [], 89],
  ["demo-r2", "Coffee beans 1kg — פולי קפה", "lamp", null, "normal", 1, "purchased", ["KSP", "ksp", 89, "ILS", 0, "https://example.com/coffee/2"], [], 59],
  ["demo-r3", "Coffee beans 1kg — פולי קפה", "lamp", null, "normal", 1, "purchased", ["KSP", "ksp", 92, "ILS", 0, "https://example.com/coffee/3"], [], 29],
);
// Price history per item (days ago → factor of today's price); the Pi is well under its usual price.
const PTS = { "demo-7": [[40, 1.2], [30, 1.18], [20, 1.2], [10, 1.17], [0, 1]] };

const HIST = [
  ["Bambu Lab P1S 3D printer combo", "pla", "demo-c-print", "Bambu Lab Official Store Europe", "bambulab", 4800],
  ["MacBook Air sleeve", "chair", null, "Amazon", "amazon", 129],
  ["ספה תלת מושבית אפורה", "chair", "demo-c-home", "ACE — אייס חנויות לבית ולגן", "ace", 3990],
  ["Raspberry Pi camera module 3 wide", "pi", "demo-c-railcam", "Raspberry Pi Store", "raspberrypi", 210],
  ["Aluminium V-slot rail 2040 × 1 m (4 pcs)", "motor", "demo-c-railcam", "AliExpress", "aliexpress", 340],
  ["מקדחה רוטטת Bosch", "drill", "demo-c-home", "KSP", "ksp", 1290],
  ["GT2 belt + pulleys kit", "motor", "demo-c-railcam", "AliExpress", "aliexpress", 95],
  ["מזגן עילי 1 כ״ס", "fan", "demo-c-home", "KSP", "ksp", 2450],
  ["PETG filament 1kg × 4", "pla", "demo-c-print", "Bambu Lab Official Store Europe", "bambulab", 420],
  ["Desk lamp with wireless charger", "lamp", null, "IKEA", "ikea", 249],
];
HIST.forEach(([title, img, col, store, key, price], i) => {
  for (const back of [0, 1, 2]) {
    const ago = 8 + i * 11 + back * 120;
    if (ago > 360) continue;
    items.push([`demo-h${i}-${back}`, title, img, col, "normal", 1, "purchased", [store, key, price * (1 + back * 0.05), "ILS", 0, `https://example.com/${key}/${i}`], [], ago]);
  }
});

// Sparse: a few to-buy items (two waiting > 30 days), one order with no eta, two buys this month; no budgets.
if (SPARSE) {
  const keep = new Set(["demo-1", "demo-2", "demo-4", "demo-5", "demo-6", "demo-7", "demo-8", "demo-10", "demo-h0-0", "demo-h1-0"]);
  const ago = { "demo-1": 45, "demo-5": 38 };
  const kept = items.filter((x) => keep.has(x[0])).map((x) => {
    const y = [...x];
    y[9] = ago[y[0]] ?? (y[6] === "purchased" ? 1 : y[9] ?? 3);
    y[10] = undefined;
    return y;
  });
  items.length = 0;
  items.push(...kept);
  for (const c of collections) c.budget = null;
}

const CAT = { charger: "electronics", fan: "home-kitchen", pla: "materials", motor: "mechanical", lamp: "home-kitchen", chair: "home-kitchen", pi: "computers", drill: "tools" };

await db.execute("DELETE FROM price_points WHERE item_id LIKE 'demo-%'");
await db.execute("DELETE FROM alerts WHERE item_id LIKE 'demo-%'");
await db.execute("DELETE FROM sources WHERE item_id LIKE 'demo-%'");
await db.execute("DELETE FROM items WHERE id LIKE 'demo-%'");
await db.execute("DELETE FROM collections WHERE id LIKE 'demo-%'");
for (const [i, c] of collections.entries())
  await db.execute({
    sql: "INSERT INTO collections (id, kind, name, color, budget, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    args: [c.id, c.kind, c.name, c.color, c.budget, i],
  });
for (const [n, [id, title, img, col, prio, qty, status, src, tags, ago, etaDays]] of items.entries()) {
  const t = now - (ago ?? n) * day;
  await db.execute({
    sql: `INSERT INTO items (id, collection_id, title, image_url, category, tags, status, priority, quantity, ordered_at, purchased_at, purchased_price, purchased_currency, eta, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, col, title, IMG[img], CAT[img], JSON.stringify(tags), status, prio, qty, status !== "to_buy" ? t : null, status === "purchased" ? t : null, status !== "to_buy" ? src[2] + (src[4] ?? 0) : null, status !== "to_buy" ? src[3] : null, etaDays != null ? now + etaDays * day : null, t, t],
  });
  const [store, key, price, currency, shipping, url] = src;
  await db.execute({
    sql: "INSERT INTO sources (id, item_id, url, normalized_url, store, store_key, price, currency, shipping, raw_title, fetched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [`${id}-s`, id, url, url, store, key, price, currency, shipping, title, t, t],
  });
  for (const [k, f] of (SPARSE ? [] : (PTS[id] ?? [[20, 1.12], [10, 1.05], [0, 1]])).entries())
    await db.execute({
      sql: "INSERT INTO price_points (id, source_id, item_id, price, currency, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [`${id}-p${k}`, `${id}-s`, id, Math.round(price * f[1] * 100) / 100, currency, t - f[0] * day],
    });
}
if (SPARSE) {
  await db.execute("DELETE FROM kv WHERE key LIKE 'pref:budget:%'");
  console.log(`OK seeded ${items.length} demo items (sparse)`);
  process.exit(0);
}
// An unread price drop on the fan; the Raspberry Pi store's free-shipping rule (fee known); a monthly cap.
await db.execute({ sql: "INSERT INTO alerts (id, item_id, source_id, kind, old_price, new_price, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: ["demo-a1", "demo-2", "demo-2-s", "drop", 379, 349, "ILS", now - 3600_000] });
await db.execute({ sql: "INSERT OR REPLACE INTO store_settings (store_key, free_shipping_min, currency, shipping_fee, updated_at) VALUES (?, ?, ?, ?, ?)", args: ["raspberrypi", 100, "USD", 9, now] });
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(new Date(now)).slice(0, 7);
await db.execute({ sql: "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)", args: [`pref:budget:${month}`, JSON.stringify({ cap: 9000, currency: "ILS" }), now] });
console.log(`OK seeded ${items.length} demo items`);
