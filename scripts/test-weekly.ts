// Unit test for src/lib/weekly.ts (weekly Telegram summary).  npx tsx scripts/test-weekly.ts
import assert from "node:assert/strict";
import type { MonthForecast } from "../src/lib/budget";
import { FALLBACK_RATES } from "../src/lib/money";
import { weeklySummary, type WeeklyInput } from "../src/lib/weekly";
import type { Alert, ItemWithSources, Source } from "../src/lib/types";

const DAY = 86_400_000;
const now = Date.parse("2026-10-04T05:00:00Z"); // a Sunday morning in Israel
let n = 0;
const src = (itemId: string, storeKey: string, price: number) => ({ id: `s${++n}`, itemId, store: storeKey.toUpperCase(), storeKey, url: `https://${storeKey}.test/${n}`, price, currency: "ILS", shipping: null }) as Source;
const item = (id: string, p: Partial<ItemWithSources> = {}, sources: Source[] = []) =>
  ({ id, title: `Item ${id}`, status: "to_buy", priority: "normal", quantity: 1, chosenSourceId: null, altGroupId: null, eta: null, points: [], attachments: [], sources, ...p }) as ItemWithSources;
const alert = (itemId: string, p: Partial<Alert>) => ({ id: `a${++n}`, itemId, sourceId: null, kind: "drop", oldPrice: 100, newPrice: 80, currency: "ILS", sentAt: null, readAt: null, createdAt: now - DAY, ...p }) as Alert;
const base = (p: Partial<WeeklyInput>): WeeklyInput => ({ items: [], altGroups: [], storeSettings: [], alerts: [], rates: FALLBACK_RATES, currency: "ILS", locale: "en", now, origin: "https://nexus.test", timeZone: "Asia/Jerusalem", month: null, ...p });
const month = (p: Partial<MonthForecast>): MonthForecast => ({ spent: 0, committed: 0, forecast: 0, forecastCount: 0, unpriced: 0, total: 0, cap: null, pct: null, state: "none", ...p });

// Nothing worth sending → null (a plain OK month doesn't count on its own).
assert.equal(weeklySummary(base({})), null);
assert.equal(weeklySummary(base({ items: [item("a")], month: month({ total: 100, cap: 1000, pct: 10, state: "ok" }) })), null);
// …but a month near/over its cap does.
assert.match(weeklySummary(base({ month: month({ total: 950, cap: 1000, pct: 95, state: "near" }) }))!, /This month: ₪950 of ₪1,000 \(95%\)/);

// Drops: this week only, newest per item, only items still to buy, each linking to ?item=<id>.
const items = [item("d1"), item("d2", { status: "purchased" }), item("u1", { priority: "urgent", title: "Fan <12V>" })];
let msg = weeklySummary(
  base({
    items,
    alerts: [alert("d1", { oldPrice: 100, newPrice: 90, createdAt: now - 2 * DAY }), alert("d1", { oldPrice: 90, newPrice: 70, createdAt: now - DAY }), alert("d2", {}), alert("d1", { createdAt: now - 9 * DAY })],
  }),
)!;
assert.match(msg, /Price drops/);
assert.match(msg, /href="https:\/\/nexus\.test\/\?item=d1">Item d1<\/a>: ₪90 → <b>₪70<\/b>/);
assert.equal(msg.match(/\?item=d1/g)?.length, 1);
assert.ok(!msg.includes("?item=d2"));
// Urgent items, HTML-escaped titles.
assert.match(msg, /Urgent, not ordered yet<\/b>\n• <a href="https:\/\/nexus\.test\/\?item=u1">Fan &lt;12V&gt;<\/a>/);
assert.ok(msg.endsWith(`<a href="https://nexus.test/">Open Nexus</a>`));

// Target reached uses its own line.
msg = weeklySummary(base({ items: [item("t")], alerts: [alert("t", { kind: "target", newPrice: 50 })] }))!;
assert.match(msg, /🎯 .*target reached, <b>₪50<\/b>/);

// Orders: overdue vs arriving within 7 days; later ones left out.
msg = weeklySummary(
  base({
    items: [item("late", { status: "ordered", eta: now - 3 * DAY }), item("soon", { status: "ordered", eta: now + 2 * DAY }), item("later", { status: "ordered", eta: now + 20 * DAY })],
  }),
)!;
assert.match(msg, /Orders overdue<\/b>\n• .*Item late.* · 1 Oct/);
assert.match(msg, /Arriving this week<\/b>\n• .*Item soon.* · 6 Oct/);
assert.ok(!msg.includes("Item later"));

// Free shipping: close (≤25 % of the threshold missing) is listed; far away and already free are not.
const settings = [
  { storeKey: "close", freeShippingMin: 200, shippingFee: 20, currency: "ILS", updatedAt: 0 },
  { storeKey: "far", freeShippingMin: 200, shippingFee: 20, currency: "ILS", updatedAt: 0 },
  { storeKey: "free", freeShippingMin: 100, shippingFee: 20, currency: "ILS", updatedAt: 0 },
];
msg = weeklySummary(
  base({
    storeSettings: settings,
    items: [item("c", {}, [src("c", "close", 170)]), item("f", {}, [src("f", "far", 40)]), item("r", {}, [src("r", "free", 150)]), item("s", { priority: "someday" }, [src("s", "far", 150)])],
  }),
)!;
assert.match(msg, /Close to free shipping<\/b>\n• CLOSE: ₪30 more/);
assert.ok(!msg.includes("FAR") && !msg.includes("FREE:"));

// More than 5 rows → "…and n more"; budget line shown with a cap.
msg = weeklySummary(base({ items: Array.from({ length: 7 }, (_, i) => item(`u${i}`, { priority: "urgent" })), month: month({ total: 300, cap: 1000, pct: 30, state: "ok" }) }))!;
assert.match(msg, /…and 2 more/);
assert.match(msg, /This month: ₪300 of ₪1,000 \(30%\)/);

// Hebrew.
msg = weeklySummary(base({ locale: "he", items: [item("u", { priority: "urgent" })] }))!;
assert.match(msg, /השבוע שלך/);
assert.match(msg, /דחוף, עוד לא הוזמן/);

console.log("OK weekly summary");
