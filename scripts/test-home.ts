// Unit test for src/lib/home.ts (Home model, delivery track, cadence, suggestions).  npm run test:home
import assert from "node:assert/strict";
import { addDays, cadenceOf, dayKeyIn, deliveryTrack, fallbackInsights, fallbackSuggestions, HIDE_MS, homeModel, homeSuggestions, mergeHome, monthGrid, reorderDue, shiftMonth, weekDays, type HomeInput } from "../src/lib/home";
import { numbersIn, numbersKnown, validateHomeAi } from "../src/lib/home-ai";
import { FALLBACK_RATES } from "../src/lib/money";
import type { Alert, Collection, ItemWithSources, PricePoint, Source } from "../src/lib/types";

const rates = FALLBACK_RATES;
const tz = "Asia/Jerusalem";
const DAY = 86_400_000;
// Sunday 4 Oct 2026, 18:00 in Israel (UTC+3).
const NOW = Date.UTC(2026, 9, 4, 15, 0);
const at = (d: number, h = 12) => Date.UTC(2026, 9, d, h - 3); // day d of October 2026, h o'clock Israel time
let n = 0;
const near = (a: number, b: number, msg = "") => assert.ok(Math.abs(a - b) < 0.01, `${msg} ${a} ≈ ${b}`);

type Opt = Partial<ItemWithSources> & { price?: number | null; currency?: string; store?: string; shipping?: number | null; pts?: [number, number][] };
const item = (p: Opt = {}) => {
  const id = `i${++n}`;
  const { price = 100, currency = "ILS", store = "Shop", shipping = null, pts = [], ...rest } = p;
  const src = { id: `s${n}`, itemId: id, store, storeKey: store.toLowerCase(), url: `https://${store.toLowerCase()}.test/${n}`, price, currency, shipping } as Source;
  const points = pts.map(([price, recordedAt], k) => ({ id: `p${n}-${k}`, sourceId: src.id, itemId: id, price, currency, recordedAt }) as PricePoint);
  return {
    id, title: `Item ${id}`, status: "to_buy", priority: "normal", quantity: 1, chosenSourceId: null, altGroupId: null, collectionId: null, category: null, watch: true,
    orderedAt: null, purchasedAt: null, purchasedPrice: null, purchasedCurrency: null, eta: null, orderNumber: null, createdAt: at(1), updatedAt: at(1),
    points, attachments: [], sources: [src], ...rest,
  } as ItemWithSources;
};
const coll = (p: Partial<Collection> = {}) => ({ id: `c${++n}`, kind: "project", name: `P${n}`, color: "amber", budget: null, budgetCurrency: "ILS", archived: false, createdAt: at(1), sortOrder: 0, ...p }) as Collection;
const alert = (p: Partial<Alert>) => ({ id: `a${++n}`, itemId: "", sourceId: null, kind: "drop", oldPrice: 120, newPrice: 100, currency: "ILS", sentAt: null, readAt: null, createdAt: at(3), ...p }) as Alert;
const base = (p: Partial<HomeInput>): HomeInput => ({ items: [], alerts: [], budget: {}, storeSettings: [], rates, now: NOW, tz, collections: [], altGroups: [], currency: "ILS", ...p });
const statusMatchesQueue = (m: ReturnType<typeof homeModel>) => assert.equal(m.status.needYou?.count ?? 0, m.needs.length, "status count = queue length");

// ---- Calendar: Sunday-first week holding today, Monday-first when asked; tz-aware day keys.
assert.equal(dayKeyIn(NOW, tz), "2026-10-04");
assert.equal(dayKeyIn(Date.UTC(2026, 9, 4, 22, 30), tz), "2026-10-05"); // 01:30 next day in Israel
assert.deepEqual(weekDays("2026-10-04"), ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
assert.deepEqual(weekDays("2026-10-04", 1)[0], "2026-09-28");
assert.equal(weekDays("2026-10-07", 1)[0], "2026-10-05");
assert.equal(addDays("2026-10-31", 1), "2026-11-01");

// ---- Empty account: nothing to say anywhere.
{
  const m = homeModel(base({}));
  assert.equal(m.empty, true);
  assert.equal(m.status.needYou, null);
  assert.equal(m.status.packages, null);
  assert.equal(m.status.pace, null); // no budget
  assert.equal(m.stats.leftToBuy.total, 0);
  assert.equal(m.stats.budget.cap, null);
  assert.equal(m.stats.saved.total, 0); // → "Track prices to start saving", never ₪0 of invented savings
  assert.equal(m.needs.length, 0);
  assert.equal(m.week.events.length, 0);
  assert.equal(m.packages.length, 0);
  assert.equal(m.projects.length, 0);
  assert.equal(m.noticed.length, 0);
  assert.equal(m.pace.usual, null);
  assert.deepEqual(homeSuggestions(m), []);
  statusMatchesQueue(m);
}

// ---- B4 delivery track: time-based fill over the first 3 segments, late = all 4 warn, no eta = 1 + "No date".
{
  const o = { status: "ordered" as const, updatedAt: at(1), createdAt: at(1) };
  assert.deepEqual(deliveryTrack({ ...o, orderedAt: at(1), eta: null }, NOW, tz), { filled: 1, tone: "faint", late: false, noDate: true });
  assert.deepEqual(deliveryTrack({ ...o, orderedAt: at(3), eta: at(2) }, NOW, tz), { filled: 4, tone: "warn", late: true, noDate: false });
  assert.equal(deliveryTrack({ ...o, orderedAt: at(4, 17), eta: at(14) }, NOW, tz).filled, 1); // just ordered
  assert.equal(deliveryTrack({ ...o, orderedAt: at(1, 18), eta: at(8, 18) }, NOW, tz).filled, 2); // 3/7 of the way
  assert.equal(deliveryTrack({ ...o, orderedAt: at(1), eta: at(4, 23) }, NOW, tz).filled, 3); // due tonight: not "Delivered"
  assert.equal(deliveryTrack({ ...o, orderedAt: at(1), eta: at(4, 1) }, NOW, tz).late, false); // earlier today is not late
  assert.equal(deliveryTrack({ status: "purchased", orderedAt: at(1), eta: at(3), updatedAt: at(3), createdAt: at(1) }, NOW, tz).filled, 4);
  assert.equal(deliveryTrack({ status: "to_buy", orderedAt: null, eta: null, updatedAt: at(1), createdAt: at(1) }, NOW, tz).filled, 0);
}

// ---- Reorder cadence: 2 buys = none, 3 regular buys, irregular buys use the median gap; due within ±3 days.
{
  assert.equal(cadenceOf([at(1), at(11)]), null);
  const c3 = cadenceOf([NOW - 60 * DAY, NOW - 30 * DAY, NOW - 0.5 * DAY])!;
  near(c3.interval / DAY, 29.75);
  const irregular = cadenceOf([0, 10 * DAY, 12 * DAY, 40 * DAY, 50 * DAY])!; // gaps 10, 2, 28, 10 → median 10
  near(irregular.interval / DAY, 10);
  assert.equal(irregular.due, 60 * DAY);
  const buy = (t: number, title = "Coffee beans 1kg") => item({ title, status: "purchased", purchasedAt: t, purchasedPrice: 50, purchasedCurrency: "ILS" });
  const items = [buy(NOW - 62 * DAY), buy(NOW - 31 * DAY), buy(NOW - 2 * DAY, "coffee  beans 1KG")];
  assert.equal(reorderDue(items, NOW).length, 0); // last buy 2 days ago: next one is ~29 days away
  const due = [buy(NOW - 92 * DAY), buy(NOW - 61 * DAY), buy(NOW - 30 * DAY)];
  assert.equal(reorderDue(due, NOW).length, 1);
  assert.equal(reorderDue([...due, item({ title: "Coffee Beans 1kg" })], NOW).length, 0); // already on the list
  assert.equal(reorderDue(due.slice(0, 2), NOW).length, 0); // 2 buys
}

// ---- A full account: stats, status strip, queue order, week events, packages, projects, saved.
{
  const railcam = coll({ name: "Railcam", budget: 1000 });
  const home = coll({ name: "Home" });
  const tools = coll({ name: "Tools", budget: 500 });
  const extra = coll({ name: "Garden" });
  const fan = item({ title: "Fan", price: 329, collectionId: home.id, pts: [[349, at(1)]] });
  const motor = item({ title: "Motor", price: 120, priority: "urgent", collectionId: railcam.id, store: "AliExpress" });
  const belt = item({ title: "Belt", price: 22, priority: "someday", collectionId: railcam.id, store: "AliExpress" });
  const saw = item({ title: "Saw", price: 200, collectionId: tools.id });
  const seed = item({ title: "Seeds", price: 30, collectionId: extra.id });
  const loose = item({ title: "Loose", price: 50 });
  const lateBox = item({ title: "Charger", status: "ordered", orderedAt: at(1), eta: at(3), purchasedPrice: 289, purchasedCurrency: "ILS" });
  const tue = item({ title: "NEMA", status: "ordered", orderedAt: at(1), eta: at(6), purchasedPrice: 100, purchasedCurrency: "ILS" });
  const later = item({ title: "Lamp", status: "ordered", orderedAt: at(1), eta: at(20), purchasedPrice: 10, purchasedCurrency: "ILS" });
  const noEta = item({ title: "Cable", status: "ordered", orderedAt: at(2), eta: null, purchasedPrice: 5, purchasedCurrency: "ILS" });
  // Bought this year: a drop (first seen 150, paid 120), and an AliExpress order that crossed free shipping (fee known).
  const dropped = item({ title: "Drill", status: "purchased", orderedAt: at(2), purchasedAt: at(2), purchasedPrice: 120, purchasedCurrency: "ILS", pts: [[150, Date.UTC(2026, 5, 1)]] });
  const batchA = item({ title: "Part A", status: "purchased", store: "AliExpress", orderedAt: at(2), purchasedAt: at(3), purchasedPrice: 40, purchasedCurrency: "ILS", price: 40 });
  const batchB = item({ title: "Part B", status: "purchased", store: "AliExpress", orderedAt: at(2, 14), purchasedAt: at(3), purchasedPrice: 30, purchasedCurrency: "ILS", price: 30 });
  const items = [fan, motor, belt, saw, seed, loose, lateBox, tue, later, noEta, dropped, batchA, batchB];
  const alerts = [alert({ itemId: fan.id, kind: "drop", newPrice: 329 }), alert({ itemId: fan.id, kind: "drop", createdAt: at(2) }), alert({ itemId: lateBox.id }), alert({ itemId: saw.id, kind: "out_of_stock" }), alert({ itemId: seed.id, readAt: at(3) })];
  // AliExpress: free over ₪150, else ₪15. Motor (120) is 30 short (= 20 %); the someday belt (22) doesn't close it → no row.
  const storeSettings = [{ spaceId: "s", storeKey: "aliexpress", freeShippingMin: 60, currency: "ILS", shippingFee: 15, updatedAt: 0 }];
  const input = base({ items, alerts, collections: [railcam, home, tools, extra], storeSettings, budget: { "2026-09": { cap: 3000, currency: "ILS" } } });
  const m = homeModel(input);
  statusMatchesQueue(m);

  // Left to buy: countable to-buy totals, urgent count, top 3 projects + "Other".
  near(m.stats.leftToBuy.total, 329 + 120 + 22 + 200 + 30 + 50);
  assert.equal(m.stats.leftToBuy.count, 6);
  assert.equal(m.stats.leftToBuy.urgent, 1);
  assert.deepEqual(m.stats.leftToBuy.segments.map((s) => s.key), [home.id, saw.collectionId, railcam.id, "other"]);
  near(m.stats.leftToBuy.segments[3].value, 80); // Seeds 30 + Loose 50

  // Budget: spent this month (received + ordered, dated this month) of the cap; 27 days to go on Oct 4.
  near(m.stats.budget.spent, 289 + 100 + 10 + 5 + 120 + 40 + 30);
  near(m.stats.budget.left!, 3000 - 594);
  assert.equal(m.stats.budget.daysToGo, 27);
  near(m.stats.budget.todayFrac, 4 / 31);

  // On the way: late first, then by eta, no eta last; pips late / week / later.
  assert.deepEqual(m.packages.map((p) => p.item.title), ["Charger", "NEMA", "Lamp", "Cable"]);
  assert.equal(m.stats.onTheWay.count, 4);
  assert.equal(m.stats.onTheWay.late, 1);
  assert.equal(m.stats.onTheWay.next, at(6));
  assert.deepEqual(m.stats.onTheWay.pips, ["late", "week", "later", "later"]);
  assert.equal(m.status.packages!.count, 1); // NEMA arrives Tuesday; the late one is from last week
  assert.equal(m.status.packages!.late, 1);
  assert.equal(m.packages[3].track.noDate, true);

  // Saved this year: drop 30 + free shipping 15 (one AliExpress order on Oct 2: 70 ≥ 60).
  near(m.stats.saved.drops, 30);
  near(m.stats.saved.freeShipping, 15);
  near(m.stats.saved.total, 45);
  near(m.stats.saved.month, 45);

  // Needs you: the newest unread drop per to-buy item, then late deliveries; out_of_stock / read / not-to-buy are skipped.
  assert.deepEqual(m.needs.map((x) => x.kind), ["alert", "late"]);
  assert.equal(m.needs[0].key, `alert:${alerts[0].id}`);
  assert.equal(m.status.needYou!.count, 2);

  // Pace: cap − projected (spent + committed + urgent to buy).
  near(m.pace.delta!, 3000 - 594 - 120);
  assert.equal(m.status.pace!.delta, m.pace.delta);
  assert.equal(m.pace.spent.length, 4);

  // This week: late on today, the deal (open drop) today, NEMA on Tue, the budget close on Saturday.
  assert.deepEqual(m.week.events.map((e) => `${e.kind}@${e.day}`), ["late@2026-10-04", "deal@2026-10-04", "arrive@2026-10-06", "budget@2026-10-10"]);

  // Projects: top 3 by activity, % bought by money, next = most urgent, else cheapest.
  assert.equal(m.projects.length, 3);
  const rc = m.projects.find((p) => p.collection.id === railcam.id)!;
  assert.equal(rc?.next?.title, "Motor");

  // Dismiss a row for 7 days: it leaves the queue AND the status count.
  const d = homeModel({ ...input, dismissed: { [m.needs[0].key]: NOW + HIDE_MS } });
  assert.equal(d.needs.length, 1);
  statusMatchesQueue(d);
  assert.equal(homeModel({ ...input, dismissed: { [m.needs[0].key]: NOW - 1 } }).needs.length, 2); // expired

  // Free-shipping gap ≤ 30 % that an item on the list closes: a someday item at the store that closes it.
  const bigBelt = { ...belt, sources: [{ ...belt.sources[0], price: 35 }] };
  const m2 = homeModel({ ...input, items: items.map((i) => (i.id === belt.id ? bigBelt : i)), storeSettings: [{ ...storeSettings[0], freeShippingMin: 150 }] });
  const ship = m2.needs.find((x) => x.kind === "ship");
  assert.ok(ship && ship.kind === "ship" && ship.add.id === belt.id && "priority" in ship.apply);
  near((ship as { remaining: number }).remaining, 30);
  statusMatchesQueue(m2);

  // Monday-first locale: same events, the week starts Mon 28 Sep.
  const mon = homeModel({ ...input, weekStartsOn: 1 });
  assert.equal(mon.week.days[0], "2026-09-28");
  assert.deepEqual(mon.week.events.map((e) => e.kind), ["late", "deal", "budget"]); // Sunday the 4th closes this week; Tuesday is next week
  // Language-independent: the model holds data and keys only, never words.
  assert.ok(!/[֐-׿]/.test(JSON.stringify({ ...m, ctx: null })));
}

// ---- No budget: no pace tile; month stat compares with the usual month instead.
{
  const prev = (mo: number, v: number) => item({ status: "purchased", orderedAt: Date.UTC(2026, mo, 3), purchasedAt: Date.UTC(2026, mo, 3), purchasedPrice: v, purchasedCurrency: "ILS" });
  const items = [prev(3, 1000), prev(4, 900), prev(5, 1100), prev(6, 1000), prev(7, 1000), prev(8, 1000), item({ status: "purchased", orderedAt: at(2), purchasedAt: at(2), purchasedPrice: 880, purchasedCurrency: "ILS" })];
  const m = homeModel(base({ items }));
  assert.equal(m.status.pace, null);
  assert.equal(m.stats.budget.cap, null);
  near(m.stats.budget.usual!, 1000);
  near(m.stats.budget.vsUsualPct!, -0.12);
  assert.equal(m.pace.speed, "slower"); // ₪880 by the 4th vs ₪1,000 usually by then
}

// ---- Suggestions: ranking, at most 4, snooze per key.
{
  const proj = [coll({ name: "Old A", budget: 600 }), coll({ name: "Old B", budget: 900 })];
  const nob = coll({ name: "New" });
  const deal = item({ title: "NEMA 17", price: 80, store: "AliExpress", pts: [[100, at(1)], [100, at(2)], [100, at(3)], [80, at(4)]] });
  const partner = item({ title: "GT2 belt", price: 25, priority: "someday", store: "AliExpress" });
  const buys = [92, 61, 30].map((d) => item({ title: "Filament", status: "purchased", purchasedAt: NOW - d * DAY, purchasedPrice: 80, purchasedCurrency: "ILS" }));
  const inNew = item({ title: "Screws", price: 10, collectionId: nob.id });
  const input = base({ items: [deal, partner, ...buys, inNew], collections: [...proj, nob], storeSettings: [{ spaceId: "s", storeKey: "aliexpress", freeShippingMin: 100, currency: "ILS", shippingFee: 12, updatedAt: 0 }] });
  const m = homeModel(input);
  const sug = homeSuggestions(m);
  assert.deepEqual(sug.map((x) => x.kind), ["deal", "reorder", "budget"]);
  assert.equal(sug[0].facts.pct, 20);
  assert.equal(sug[0].facts.partner, "GT2 belt"); // 80 + 25 closes the ₪20 gap → "order both"
  assert.ok(sug[0].action.type === "order" && sug[0].action.partner?.itemId === partner.id);
  assert.equal(sug[2].facts.min, 600);
  assert.ok(sug.length <= 4);
  const snoozed = homeSuggestions(homeModel({ ...input, dismissed: { [`sug:${sug[0].key}`]: NOW + HIDE_MS } }));
  assert.deepEqual(snoozed.map((x) => x.kind), ["reorder", "budget"]);
  // A 5 % dip isn't a deal.
  const meh = item({ title: "Meh", price: 95, pts: [[100, at(1)], [100, at(2)], [95, at(3)]] });
  assert.equal(homeSuggestions(homeModel(base({ items: [meh] }))).length, 0);
}

// ---- Nexus noticed: weekday lows need ≥ 8 points.
{
  const pts: [number, number][] = [];
  for (let w = 0; w < 4; w++) {
    pts.push([90, Date.UTC(2026, 8, 1 + w * 7, 9)]); // Tuesdays cheaper
    pts.push([100, Date.UTC(2026, 8, 3 + w * 7, 9)]);
  }
  const it = item({ category: "electronics", pts });
  const m = homeModel(base({ items: [it] }));
  const wd = m.noticed.find((x) => x.kind === "weekday");
  assert.ok(wd && wd.kind === "weekday" && wd.day === 2 && wd.category === "electronics");
  const few = item({ category: "electronics", pts: pts.slice(0, 7) });
  assert.equal(homeModel(base({ items: [few] })).noticed.length, 0);
}

// ---- Round 14 A2: the AI's look — unknown ids are dropped, invented numbers are dropped.
{
  const ids = { items: new Set(["i1", "i2"]), collections: new Set(["c1"]) };
  const known = numbersIn('[[i1]] Fan | unit=349.5 | qty=2\n- [c1] project "Rail": 3 items, planned 1200, spent 80');
  assert.deepEqual(numbersIn("₪1,234.50 and 30% of 3"), [1234.5, 30, 3]);
  assert.ok(numbersKnown("Fan costs ₪349.5 now", known));
  assert.ok(numbersKnown("Fan costs about ₪350", known)); // a rounding of a known number
  assert.ok(numbersKnown("Rail has 1,200 planned", known));
  assert.ok(!numbersKnown("You saved 999 this year", known));
  assert.ok(numbersKnown("No numbers at all", known));
  const r = validateHomeAi(
    {
      suggestions: [
        { title: "Open the fan", why: "It costs 349.5", action: { type: "open", itemId: "i1" } },
        { title: "Ghost", why: "", action: { type: "open", itemId: "nope" } },
        { title: "Budget for Rail", why: "", action: { type: "budget", collectionId: "c1" } },
        { title: "Bad budget", why: "", action: { type: "budget", collectionId: "c9" } },
        { title: "Open nothing", why: "", action: { type: "open" } },
        { title: "Made-up saving of 42", why: "", action: { type: "none" } },
        { title: "Just a thought", why: "", action: { type: "none" } },
        { title: "Fourth valid one", why: "", action: { type: "add", itemId: "i2" } },
      ],
      insights: [{ text: "Rail: 3 items planned" }, { text: "You spent 7777" }, { text: "Fan", action: { type: "open", itemId: "zz" } }, { text: "Fan again", action: { type: "open", itemId: "i2" } }, { text: "" }],
    },
    ids,
    known,
  );
  assert.deepEqual(r.suggestions.map((x) => x.title), ["Open the fan", "Budget for Rail", "Just a thought"]); // ≤ 3
  assert.deepEqual(r.insights.map((x) => x.text), ["Rail: 3 items planned", "Fan again"]);
  assert.deepEqual(r.insights[1].action, { type: "open", itemId: "i2" });
  assert.deepEqual(validateHomeAi(null, ids, known), { suggestions: [], insights: [] });
  assert.deepEqual(validateHomeAi({ suggestions: "x", insights: [null] }, ids, known), { suggestions: [], insights: [] });
}

// ---- Round 14 A2: broad fallbacks, only when their facts exist; order rules → AI → fallbacks.
{
  const p = coll({ name: "Desk" });
  const old = item({ title: "Old lamp", price: 300, createdAt: NOW - 40 * DAY, collectionId: p.id });
  const cheap = item({ title: "Cable", price: 20, targetPrice: null });
  const ord = item({ title: "Chair", status: "ordered", orderedAt: at(2), eta: null });
  const bought = item({ title: "Mouse", status: "purchased", purchasedAt: at(2), purchasedPrice: 120, purchasedCurrency: "ILS", category: "electronics", store: "KSP" });
  const m = homeModel(base({ items: [old, cheap, ord, bought], collections: [p] }));
  const fb = fallbackSuggestions(m, { extension: false, receipts: 0 });
  assert.deepEqual(fb.map((x) => x.kind), ["set_budget", "target", "eta", "stale", "extension", "receipt"]);
  assert.equal(fb[1].facts.item, "Old lamp"); // the most expensive to-buy item without a target
  assert.equal(fb[3].facts.days, 40);
  // Phones (extension null), a known receipt, a budget and targets set: those fallbacks go away.
  const withBudget = homeModel(base({ items: [{ ...old, targetPrice: 250 }, { ...cheap, targetPrice: 15 }], budget: { "2026-10": { cap: 5000, currency: "ILS" } } }));
  assert.deepEqual(fallbackSuggestions(withBudget, { extension: null, receipts: 3 }).map((x) => x.kind), ["stale"]);
  const ins = fallbackInsights(m);
  assert.deepEqual(ins.map((x) => x.kind), ["top_store", "big_project", "waiting"]);
  assert.ok(ins[0].kind === "top_store" && ins[0].store === "KSP");
  assert.ok(ins[1].kind === "big_project" && ins[1].collection.id === p.id && ins[1].left === 300);
  assert.ok(ins[2].kind === "waiting" && ins[2].count === 1 && ins[2].amount === 300);
  // A truly empty account says nothing (R13 A7).
  const empty = homeModel(base({}));
  assert.deepEqual(fallbackInsights(empty), []);
  assert.equal(fallbackSuggestions(empty, { extension: null, receipts: null }).length, 1); // set_budget — but Home shows the empty state
  assert.deepEqual(mergeHome([{ key: "a" }, { key: "b" }], [{ key: "c" }, { key: "a" }], [{ key: "d" }, { key: "e" }], 4).map((x) => x.key), ["a", "b", "c", "d"]);
}

// ---- Round 14 C1: month grid (6 weeks from the week holding the 1st), month shifts, events beyond this week.
{
  const g = monthGrid("2026-10");
  assert.equal(g.length, 42);
  assert.equal(g[0], "2026-09-27"); // Sunday before Thu 1 Oct
  assert.equal(monthGrid("2026-10", 1)[0], "2026-09-28");
  assert.ok(g.includes("2026-10-31"));
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  const later = item({ title: "Hub", status: "ordered", orderedAt: at(2), eta: Date.UTC(2026, 10, 13, 9) });
  const m = homeModel(base({ items: [later] }));
  assert.ok(m.events.some((e) => e.kind === "arrive" && e.day === "2026-11-13"));
  assert.equal(m.week.events.filter((e) => e.kind === "arrive").length, 0); // not this week
}

console.log("OK test-home");
