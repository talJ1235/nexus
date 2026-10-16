// Unit test for src/lib/spending-month.ts (R18 S5 E1/E2): the month's start day, every member's trips, the space's
// currency, cumulative days, sections / stores, against last month.   npm run test:spending
import assert from "node:assert/strict";
import { localMidnight, monthOf, monthRange, shiftKey, spendingMonth, type ProductIn, type TripIn } from "../src/lib/spending-month";

const tz = "Asia/Jerusalem";
const at = (m: number, d: number, h = 12) => localMidnight(2026, m, d, tz) + h * 3_600_000;
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} ≈ ${b}`);
// ILS is the space's currency; USD = 3.7.
const toCur = (v: number, cur: string) => (cur === "USD" ? v * 3.7 : v);

// ---- month keys and ranges: the start day
assert.equal(shiftKey("2026-01", -1), "2025-12");
assert.equal(shiftKey("2026-12", 1), "2027-01");
assert.equal(monthOf(at(10, 5), 1, tz), "2026-10");
assert.equal(monthOf(at(10, 5), 10, tz), "2026-09", "before the 10th it's still September's budget month");
assert.equal(monthOf(at(10, 10, 0.1), 10, tz), "2026-10");
const r = monthRange("2026-10", 10, tz);
assert.equal(r.from, localMidnight(2026, 10, 10, tz));
assert.equal(r.to, localMidnight(2026, 11, 10, tz));
assert.equal(r.days, 31);
assert.equal(monthRange("2026-02", 1, tz).days, 28);
assert.equal(monthRange("2026-10", 31, tz).from, localMidnight(2026, 10, 28, tz), "start day clamps to 28");
// DST in Israel ends on 25 Oct 2026: a day boundary is still local midnight.
assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(localMidnight(2026, 10, 26, tz))), "00");

// ---- one month: trips by two members (one in USD), products with shipping
const trip = (id: string, userId: string, d: number, m: number, total: number | null, cur = "ILS", items: TripIn["items"] = []): TripIn => ({ id, userId, chain: id.startsWith("r") ? "rami-levy" : "shufersal", branch: "Herzl", finishedAt: at(m, d), total, currency: cur, items });
const line = (productKey: string, section: string, price: number | null, state: "bought" | "not_found" = "bought") => ({ productKey, title: productKey, section, price, qty: 1, state });
const trips: TripIn[] = [
  trip("s1", "tal", 2, 10, 300, "ILS", [line("milk", "dairy", 100), line("beef", "meat", 200)]),
  trip("r1", "noa", 8, 10, null, "ILS", [line("tomato", "produce", 40), line("bread", "bread", 20), line("eggs", "dairy", null), line("salt", "spice", 9, "not_found")]),
  trip("s2", "noa", 12, 10, 100, "USD", [line("milk", "dairy", 100)]),
  trip("s0", "tal", 5, 9, 200, "ILS", [line("milk", "dairy", 150), line("beef", "meat", 50)]),
  trip("late", "tal", 20, 10, 999), // after "now" — not counted yet
];
const products: ProductIn[] = [
  { id: "p1", title: "Headphones", at: at(10, 3), value: 450, shipping: 50, store: "KSP" },
  { id: "p0", title: "Shoes", at: at(9, 4), value: 100, shipping: 0, store: "Zara" },
];
const NOW = at(10, 15);
const m = spendingMonth({ key: "2026-10", startDay: 1, tz, now: NOW, trips, products, cap: 2000, toCur });
assert.equal(m.closed, false);
assert.equal(m.days, 31);
assert.equal(m.todayIdx, 14);
assert.equal(m.daysLeft, 16);
near(m.supermarket, 300 + 60 + 370, "every member's trips; a trip without a total sums its priced lines; USD converted");
near(m.products, 400, "products without their shipping");
near(m.delivery, 50, "shipping is Delivery & other");
near(m.total, 1180, "total");
near(m.left!, 820, "left of the budget");
assert.equal(m.cumulative.length, 15, "cumulative up to today");
near(m.cumulative[1], 300, "day 2: the first trip");
near(m.cumulative[2], 750, "day 3: + the headphones (with their shipping)");
near(m.cumulative[14], 1180, "today = the total");
// Sections: dairy = milk 100 + milk $100 → 470; meat 200; produce 40; bread 20. Unpriced / not found lines don't count.
assert.deepEqual(m.sections.map((x) => [x.key, Math.round(x.amount)]), [["dairy", 470], ["meat", 200], ["produce", 40], ["bread", 20]]);
assert.equal(m.sections.find((x) => x.key === "dairy")!.last, 150, "vs last month");
assert.equal(m.sections[0].items[0].title, "milk");
// Stores: shufersal 2 trips, rami-levy 1.
assert.deepEqual(m.stores.map((x) => [x.chain, Math.round(x.amount), x.trips]), [["shufersal", 670, 2], ["rami-levy", 60, 1]]);
// Against last month, same day: September 1–15 had the 200 trip + 100 shoes.
near(m.delta, 1180 - 300, "delta vs the same day last month");
near(m.vsLast.supermarket.last, 200, "supermarket last month so far");
near(m.vsLast.avgShop.now!, 730 / 3, "average shop");
assert.equal(m.paceState, "ahead", "1180 of 2000 (59 %) at day 15 of 31 (48 %) is ahead of pace");
assert.equal(spendingMonth({ key: "2026-10", startDay: 1, tz, now: NOW, trips, products, cap: 2400, toCur }).paceState, "on", "1180 of 2400 (49 %) is on pace");
// A closed month compares with all of last month and has no pace.
const sep = spendingMonth({ key: "2026-09", startDay: 1, tz, now: NOW, trips, products, cap: 250, toCur });
assert.equal(sep.closed, true);
near(sep.total, 300, "September");
near(sep.left!, -50, "over the budget");
assert.equal(sep.paceState, null);
assert.equal(sep.cumulative.length, 30);
// Start day 10: October = 10 Oct – 9 Nov → the trip of 12 Oct only (and nothing after now).
const late = spendingMonth({ key: "2026-10", startDay: 10, tz, now: NOW, trips, products, cap: null, toCur });
near(late.supermarket, 370, "start day 10: only the 12 Oct trip");
assert.equal(late.left, null, "no budget → no left");
assert.equal(late.paceState, null);
// First month: nothing before it.
const first = spendingMonth({ key: "2026-09", startDay: 1, tz, now: NOW, trips, products, cap: null, toCur });
assert.equal(first.hasHistory, false);
assert.equal(m.hasHistory, true);
assert.equal(spendingMonth({ key: "2026-08", startDay: 1, tz, now: NOW, trips, products, cap: null, toCur }).empty, true);

console.log("OK spending month (start day, members, currency, cumulative, sections, stores, vs last month)");
