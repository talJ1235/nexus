// R17 B1 — short names for long store titles: 20 real long titles (AliExpress, Amazon, Temu, Hebrew stores) → the rules'
// short name; the AI's answer is used only within the limits. npm run test:short-name
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { needsShort, pickShortName, ruleShortName, SHORT_MAX, stripStore } from "../src/lib/short-name";

const titles: [string, string][] = JSON.parse(readFileSync("scripts/fixtures/long-titles.json", "utf8"));
const expected: [string, number | null][] = [
  ["Car Perfume Clip Flower Air Outlet", 2],
  ["NEMA 17 Stepper Motor 42-40 1.5A 2-Phase", 10],
  ["ESP32-S3 DevKitC-1 N16R8 Development", null],
  ["Baseus 65W GaN Charger USB C Fast", null],
  ["Anker USB C Cable", null],
  ["SanDisk 128GB Extreme microSDXC UHS-I", null],
  ["Logitech MX Master 3S", null],
  ["Women's Summer Casual Loose Floral Print", null],
  ["Silicone Kitchen Utensils Set Heat", 3],
  ["Stainless Steel Water Bottle 1L Double", null],
  ["UWANT Y100 Steam Sofa Cleaner Upholstery", null],
  ["מכשיר לניקוי כתמים מספות עם קיטור Y100", null],
  ["אוזניות אלחוטיות Apple AirPods Pro 2", null],
  ["כבל USB-C ל-USB-C באורך 2 מטר 100W טעינה", null],
  ["Raspberry Pi 5 8GB Single Board Computer", null],
  ["Ceramic Coffee Mugs 350ml Nordic Style", 3],
  ["Bambu Lab PLA Basic Filament 1.75mm 1kg", null],
  ["Xiaomi Mi Smart Standing Fan 2 Lite", null],
  ["Mini Portable Bluetooth Speaker", null],
  ["IKEA KALLAX Shelf unit", null],
];
assert.equal(titles.length, 20);
for (const [k, [title, store]] of titles.entries()) {
  assert.ok(needsShort(title), `needs a short name: ${title}`);
  const r = ruleShortName(title, store);
  assert.equal(r.name, expected[k][0], `#${k + 1} ${title}`);
  assert.equal(r.qty, expected[k][1], `#${k + 1} qty`);
  assert.ok(r.name.length > 0 && r.name.length <= SHORT_MAX, `≤ ${SHORT_MAX}: ${r.name}`);
  assert.ok(!/aliexpress|amazon\.com|temu\b/i.test(r.name), `no store name: ${r.name}`);
  // The same language: a Hebrew title stays Hebrew, an English one English.
  assert.equal(/[֐-׿]/.test(r.name), /^[^a-z]*[֐-׿]/i.test(title), `language kept: ${r.name}`);
}
// Today's regex only stripped "- AliExpress 34"; the dash-less form too now.
assert.equal(stripStore("Car Air Refresher AliExpress 34"), "Car Air Refresher");
assert.equal(stripStore("Car Air Refresher - AliExpress 34"), "Car Air Refresher");
assert.equal(stripStore("Amazon.com: Anker Cable"), "Anker Cable");
assert.equal(stripStore("Shelf unit - IKEA"), "Shelf unit");
// Short, clean titles are left alone.
for (const t of ["Raspberry Pi 5 8GB", "פולי קפה 1 ק״ג", "USB-C cable 2m"]) assert.equal(needsShort(t), false, t);
// The AI's name wins when it's within the limits; too long or carrying a store name → the rules.
assert.deepEqual(pickShortName(titles[0][0], "Flower car vent perfume clip", "AliExpress"), { name: "Flower car vent perfume clip", qty: 2 });
assert.equal(pickShortName(titles[0][0], "Flower car vent perfume clip with cherry blossom scent refill", "AliExpress").name, expected[0][0]);
assert.equal(pickShortName(titles[0][0], "Car perfume clip - AliExpress", "AliExpress").name, expected[0][0]);
assert.equal(pickShortName(titles[0][0], null, "AliExpress").name, expected[0][0]);
console.log(`OK short names (${titles.length} real titles, store suffixes, qty, AI limits)`);
