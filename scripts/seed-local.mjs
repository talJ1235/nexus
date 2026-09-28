// Seeds the LOCAL database (file: URLs only) with a realistic demo catalog for UI work and smoke screenshots.
// Idempotent: wipes and re-creates rows whose id starts with "demo-". Never touches remote databases.
//
//   node --env-file=.env.local scripts/seed-local.mjs
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
  ["demo-6", "Ergonomic office chair — כיסא משרדי ארגונומי", "chair", null, "normal", 1, "ordered", ["Office Depot", "officedepot", 899, "ILS", 50, "https://www.officedepot.co.il/item/1"], ["furniture"]],
  ["demo-7", "Raspberry Pi 5 8GB", "pi", "demo-c-railcam", "normal", 1, "to_buy", ["Raspberry Pi Store", "raspberrypi", 80, "USD", 9, "https://www.raspberrypi.com/products/raspberry-pi-5/"], ["electronics"]],
  ["demo-8", "מברגה נטענת Makita DDF485 18V", "drill", null, "normal", 1, "purchased", ["Ace", "ace", 649, "ILS", 0, "https://www.ace.co.il/item/2"], ["tools"]],
];

await db.execute("DELETE FROM price_points WHERE item_id LIKE 'demo-%'");
await db.execute("DELETE FROM sources WHERE item_id LIKE 'demo-%'");
await db.execute("DELETE FROM items WHERE id LIKE 'demo-%'");
await db.execute("DELETE FROM collections WHERE id LIKE 'demo-%'");
for (const [i, c] of collections.entries())
  await db.execute({
    sql: "INSERT INTO collections (id, kind, name, color, budget, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    args: [c.id, c.kind, c.name, c.color, c.budget, i],
  });
for (const [n, [id, title, img, col, prio, qty, status, src, tags]] of items.entries()) {
  const t = now - n * day;
  await db.execute({
    sql: `INSERT INTO items (id, collection_id, title, image_url, tags, status, priority, quantity, ordered_at, purchased_at, purchased_price, purchased_currency, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, col, title, IMG[img], JSON.stringify(tags), status, prio, qty, status !== "to_buy" ? t : null, status === "purchased" ? t : null, status !== "to_buy" ? src[2] : null, status !== "to_buy" ? src[3] : null, t, t],
  });
  const [store, key, price, currency, shipping, url] = src;
  await db.execute({
    sql: "INSERT INTO sources (id, item_id, url, normalized_url, store, store_key, price, currency, shipping, raw_title, fetched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [`${id}-s`, id, url, url, store, key, price, currency, shipping, title, t, t],
  });
  for (const [k, f] of [[20, 1.12], [10, 1.05], [0, 1]].entries())
    await db.execute({
      sql: "INSERT INTO price_points (id, source_id, item_id, price, currency, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [`${id}-p${k}`, `${id}-s`, id, Math.round(price * f[1] * 100) / 100, currency, t - f[0] * day],
    });
}
console.log(`OK seeded ${items.length} demo items`);
