// R18 B + S2 C1 — suggestions and the learning model (engine only), on a synthetic 8-week history in a throwaway file DB:
//   weekly Sunday trips (milk + bread every time, pasta in 4 with parmesan in 3, toilet paper every 2 weeks), three
//   Thursday trips with challah. Checks: history (interval, usual qty, usual day ≥ 3 trips on a weekday), due items,
//   never what's on the list, dismissed this cycle, Shabbat / companion / holiday reasons, accept merges (quantity stays
//   the user's), the evening draft computed and pushed once; C1: regular vs occasional, "Don't suggest this again"
//   (never; Settings brings it back), nothing ever added by Nexus (S1's `auto` gone), skips (3 in a row → half the rate,
//   5 → until bought again; a purchase starts over; + breaks the run), cold start (the basic basket sized by onboarding,
//   fading after 4 trips), the draft's gate (no switch); templates; admin numbers.
//   npm run test:staples
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DB = "staples-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

const TZ = "Asia/Jerusalem";
/** Israel wall-clock (summer 2026 = UTC+3; December = UTC+2). */
const IL = (m: number, d: number, h: number, min = 0) => Date.UTC(2026, m - 1, d, h - (m >= 11 || (m === 10 && d > 25) ? 2 : 3), min);
const DAY = 86_400_000;

(async () => {
  const { db, schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const T = await import("../src/lib/db-scoped/trips");
  const G = await import("../src/lib/db-scoped/grocery");
  const S = await import("../src/lib/notify/senders");
  const { and, eq } = await import("drizzle-orm");
  const d = new Date(IL(8, 1, 12));
  for (const [id, name] of [["noa", "Noa"], ["yoav", "Yoav"]]) await db.insert(schema.user).values({ id, name, email: `${id}@test.example`, emailVerified: true, createdAt: d, updatedAt: d });
  await db.insert(schema.space).values({ id: "home", name: "Home", slug: "home", kind: "shared", createdBy: "noa", createdAt: d } as never);
  for (const [i, u, r] of [["m1", "noa", "owner"], ["m2", "yoav", "member"]]) await db.insert(schema.member).values({ id: i, organizationId: "home", userId: u, role: r, createdAt: d } as never);
  const s = new Scoped({ spaceId: "home", userId: "noa", by: "noa" });

  // Products (added once, bought in trips; they leave the list as purchased).
  const ids: Record<string, string> = {};
  for (const [k, t, q] of [["milk", "חלב 3%", 2], ["bread", "לחם", 1], ["pasta", "פסטה", 2], ["parm", "פרמזן מגורר", 1], ["tp", "נייר טואלט", 1], ["challah", "חלה", 2]] as const)
    ids[k] = (await G.addToList(s, { title: t, qty: q, by: "noa" })).item.id;
  const item = async (k: string) => (await s.byId(schema.items, ids[k]))!;
  const trip = async (at: number, keys: string[]) => {
    const t = await T.startTrip(s, "noa", { chain: "Shufersal", branch: "Modiin", now: at });
    let m = 0;
    for (const k of keys) {
      const it = await item(k);
      await T.addCheck(s, t.id, { action: "check", itemId: it.id, productKey: it.productKey, section: it.section, qty: it.quantity, at: at + ++m * 60_000 });
    }
    await T.finishTrip(s, t.id, { now: at + 30 * 60_000 });
  };
  for (let k = 0; k < 8; k++) {
    const sunday = IL(8, 16, 10) + k * 7 * DAY;
    await trip(sunday, ["milk", "bread", ...(k % 2 === 1 ? ["pasta"] : []), ...(k % 2 === 1 && k < 7 ? ["parm"] : []), ...(k % 2 === 0 ? ["tp"] : [])]);
  }
  for (const day of [24, 1, 8]) await trip(day === 24 ? IL(9, 24, 18) : IL(10, day, 18), ["challah"]);
  await s.update(schema.items, { status: "purchased" }, eq(schema.items.list, "supermarket"));

  // ---- B1: history.
  const { history } = await G.historyOf(s, TZ);
  const milkKey = (await item("milk")).productKey!;
  const tpKey = (await item("tp")).productKey!;
  const pastaKey = (await item("pasta")).productKey!;
  const parmKey = (await item("parm")).productKey!;
  const challahKey = (await item("challah")).productKey!;
  const milk = history.products.get(milkKey)!;
  assert.equal(milk.count, 8);
  assert.equal(milk.intervalDays, 7, "milk every ~7 days");
  assert.equal(milk.usualQty, 2, "usual quantity");
  assert.equal(history.products.get(tpKey)!.intervalDays, 14, "toilet paper every ~14 days");
  assert.deepEqual(history.usualDay, { weekday: 0, hour: 10 }, "usual shop: Sunday 10:00 (≥ 3 trips)");
  assert.equal(milk.last.chain, "Shufersal");

  // ---- B2: due, on the list, dismissed.
  const sat = IL(10, 10, 19, 30); // Saturday evening: Sunday's list
  let sug = await G.suggestFor(s, { now: sat, tz: TZ });
  const by = (k: string) => sug.find((x) => x.productKey === k);
  assert.equal(by(milkKey)?.reasonKey, "due");
  assert.equal(by(milkKey)?.reasonArgs.days, 7, "the reason: every ~7 days");
  assert.ok(by((await item("bread")).productKey!), "bread due too");
  await G.addToList(s, { title: "חלב 3%", qty: 1, by: "yoav" });
  await G.dismissSuggestion(s, (await item("bread")).productKey!, sat + 5 * DAY);
  sug = await G.suggestFor(s, { now: sat, tz: TZ });
  assert.equal(by(milkKey), undefined, "never what is already on the list (any quantity)");
  assert.equal(by((await item("bread")).productKey!), undefined, "dismissed for this cycle");
  assert.ok(sug.some((x) => x.productKey === tpKey), "toilet paper due (every ~14 days)");

  // ---- Shabbat: Thursday, challah not bought since Sunday.
  const thu = IL(10, 15, 10);
  sug = await G.suggestFor(s, { now: thu, tz: TZ });
  assert.equal(by(challahKey)?.reasonKey, "shabbat", "challah before Friday");
  assert.equal((await G.suggestFor(s, { now: IL(10, 12, 10), tz: TZ })).find((x) => x.productKey === challahKey), undefined, "not on Monday");

  // ---- Companion: pasta on the list → parmesan (3 of 4 pasta trips).
  await G.addToList(s, { title: "פסטה", by: "noa" });
  sug = await G.suggestFor(s, { now: IL(10, 13, 10), tz: TZ });
  assert.equal(by(parmKey)?.reasonKey, "with", "usually with pasta");
  assert.equal(by(parmKey)?.reasonArgs.title, "פסטה");

  // ---- Holiday: two days before Hanukkah's eve → oil.
  sug = await G.suggestFor(s, { now: IL(12, 2, 10), tz: TZ, locale: "en" });
  const oil = sug.find((x) => x.reasonKey === "holiday" && x.productKey === "oil");
  assert.ok(oil && oil.title === "Cooking oil" && oil.reasonArgs.holiday === "hanukkah", "Hanukkah: oil");

  // ---- Accept merges: an existing quantity stays the user's; a new one is added once.
  const before = (await G.supermarketList(s)).length;
  await G.acceptSuggestions(s, [{ productKey: milkKey, title: "חלב 3%", qty: 2, amount: null, unit: null, section: "dairy", art: "mlk" }], "noa");
  const milkRows = (await G.supermarketList(s)).filter((i) => i.productKey === milkKey);
  assert.equal(milkRows.length, 1, "no duplicate");
  assert.equal(milkRows[0].quantity, 1, "the user's quantity stays");
  assert.equal((await G.supermarketList(s)).length, before);

  // ---- B3: the evening draft — once per evening, to the members who shop, never changing the list.
  const listBefore = JSON.stringify((await G.supermarketList(s)).map((i) => [i.id, i.quantity]));
  assert.equal(await S.eveningDrafts(IL(10, 10, 18)), 0, "not before 19:00");
  assert.equal(await S.eveningDrafts(sat), 1, "Saturday 19:30, Sunday is the usual day");
  assert.equal(await S.eveningDrafts(sat + 20 * 60_000), 0, "once per evening");
  assert.equal(await S.eveningDrafts(IL(10, 9, 19, 30)), 0, "not the evening before another day");
  const rows = await db.select().from(schema.notification).where(eq(schema.notification.kind, "draft"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "noa", "only the member who shops");
  const dd = JSON.parse(rows[0].data);
  assert.equal(dd.day, "2026-10-11");
  assert.ok(dd.items >= 2 && dd.suggested >= 1, "list count + suggestions");
  assert.ok(await S.draftOf("home", "2026-10-11"), "the draft is stored once for the space");
  assert.equal(JSON.stringify((await G.supermarketList(s)).map((i) => [i.id, i.quantity])), listBefore, "the draft never changes the list");
  // C1: no switch — three drafts in a row nobody opened → quiet until the next trip.
  assert.equal(await S.eveningDrafts(IL(10, 17, 19, 30)), 1, "second Saturday");
  assert.equal(await S.eveningDrafts(IL(10, 24, 19, 30)), 1, "third Saturday");
  assert.equal(await S.eveningDrafts(IL(10, 31, 19, 30)), 0, "3 unopened in a row → quiet");
  await db.update(schema.notification).set({ readAt: IL(10, 31, 20) }).where(eq(schema.notification.kind, "draft"));
  assert.equal(await S.eveningDrafts(IL(10, 31, 19, 45)), 1, "opened → the streak is broken");
  await db.delete(schema.notification).where(eq(schema.notification.kind, "draft"));
  await db.delete(schema.kv);

  // ---- B4: templates — apply merges (never duplicates), save a trip as a template.
  const done = (await T.finishedTrips(s)).at(-1)!;
  const tpl = (await G.templateFromTrip(s, done.id, "Thursday", "noa"))!;
  assert.equal(tpl.items.length, 1);
  const tpl2 = (await G.createTemplate(s, "Basic weekly basket", [
    { productKey: milkKey, title: "חלב 3%", qty: 3 },
    { productKey: "eggs", title: "ביצים", qty: 1 },
    { productKey: "eggs", title: "ביצים", qty: 1 },
  ], "noa"))!;
  assert.equal(tpl2.items.length, 2, "a template keeps a product once");
  await G.applyTemplate(s, tpl2.id, "noa");
  await G.applyTemplate(s, tpl2.id, "noa");
  const list = await G.supermarketList(s);
  assert.equal(list.filter((i) => i.productKey === "eggs").length, 1, "applying twice: still one row");
  assert.equal(list.find((i) => i.productKey === milkKey)!.quantity, 1, "an existing quantity stays");

  // ---- E1: Admin → System → Supermarket (counts only).
  const { supermarketMetrics } = await import("../src/lib/db-scoped/admin");
  await db.insert(schema.activity).values([{ userId: "noa", spaceId: "home", kind: "suggest_accepted", n: 3, at: sat }, { userId: "noa", spaceId: "home", kind: "suggest_dismissed", n: 1, at: sat }]);
  const mm = await supermarketMetrics(IL(10, 10, 20));
  assert.equal(mm.trips, 7, "4 Sundays + 3 Thursdays in the last 4 weeks");
  assert.equal(mm.tripsPerWeek, 1.8);
  assert.ok(mm.itemsPerTrip! > 1);
  assert.equal(mm.receiptShare, 0);
  assert.deepEqual([mm.accepted, mm.dismissed], [3, 1]);
  assert.deepEqual([mm.cohort, mm.retained], [1, 1], "first trip 8 weeks ago, shopped again in week 4");
  assert.ok(!JSON.stringify(mm).includes("חלב"), "never content");
  // ---- C1: regular vs occasional — an irregular product is never suggested "when due", only in context.
  const olive = (await G.addToList(s, { title: "שמן זית", by: "noa" })).item;
  for (const at of [IL(8, 20, 12), IL(8, 22, 12), IL(9, 30, 12)]) {
    const t = await T.startTrip(s, "yoav", { chain: "Shufersal", branch: "Modiin", now: at });
    await T.addCheck(s, t.id, { action: "check", itemId: olive.id, productKey: olive.productKey, section: olive.section, at: at + 60_000 });
    await T.finishTrip(s, t.id, { now: at + 600_000 });
  }
  await s.update(schema.items, { status: "purchased" }, eq(schema.items.id, olive.id));
  const hist2 = (await G.historyOf(s, TZ)).history;
  assert.equal(hist2.products.get(olive.productKey!)!.regular, false, "gaps 2 / 39 days: occasional");
  assert.equal(hist2.products.get(milkKey)!.regular, true, "milk every 7 days: regular");
  assert.equal(hist2.products.get(tpKey)!.regular, true, "toilet paper every 14 days: regular");
  assert.equal((await G.suggestFor(s, { now: IL(10, 31, 10), tz: TZ })).find((x) => x.productKey === olive.productKey), undefined, "an occasional product is never 'due'");

  // ---- C1: hidden — "Don't suggest this again" wins over every reason; "Suggest it again" brings it back.
  const breadKey = (await item("bread")).productKey!;
  await G.hideProduct(s, breadKey, "noa", sat - 3_600_000);
  await G.hideProduct(s, challahKey, "noa", sat - 3_600_000);
  assert.equal((await G.suggestFor(s, { now: IL(10, 17, 19, 30), tz: TZ })).find((x) => x.productKey === breadKey), undefined, "hidden: never suggested, even when due");
  assert.equal((await G.suggestFor(s, { now: IL(10, 15, 10), tz: TZ })).find((x) => x.productKey === challahKey), undefined, "hidden: not even for Shabbat");
  const hidden = await G.hiddenOf(s);
  assert.deepEqual(hidden.map((h) => h.productKey).sort(), [breadKey, challahKey].sort());
  assert.equal(hidden.find((h) => h.productKey === breadKey)!.title, "לחם", "named by the home's own row");
  assert.equal((await G.knowledgeFor(s, breadKey, TZ)).state, "hidden");
  await G.unhideProduct(s, challahKey);
  assert.equal((await G.suggestFor(s, { now: IL(10, 15, 10), tz: TZ })).find((x) => x.productKey === challahKey)?.reasonKey, "shabbat", "unhidden: back");
  assert.equal((await G.hiddenOf(s)).length, 1);

  // ---- C1: never added by Nexus — S1's `auto` is gone: the column is ignored, the sweeps add nothing.
  await s.update(schema.items, { staple: "auto" }, eq(schema.items.id, ids.tp));
  assert.ok((await G.suggestFor(s, { now: sat, tz: TZ })).some((x) => x.productKey === tpKey), "an old `auto` row is only suggested");
  const listCount = (await G.supermarketList(s)).length;
  const sweeps = await S.runNotifySweeps(IL(10, 11, 8));
  assert.equal("staples" in sweeps, false, "no auto-staple sweep");
  assert.equal((await G.supermarketList(s)).length, listCount, "nothing added to the list by itself");
  assert.equal((await db.select().from(schema.stapleAdd)).length, 0);
  assert.equal(((await G.supermarketList(s)).filter((i) => i.addedByUserId == null)).length, 0, "no row added by Nexus");
  await s.update(schema.items, { staple: "off" }, eq(schema.items.id, ids.tp));

  // ---- C1: skips — × three times in a row → half the rate (twice the gap); five → not until bought again; a purchase
  // starts the count over. (Each × is "not this time": quiet until the end of that cycle, here already past.)
  const skipAt = (k: number) => IL(10, 10, 12) + k * 60_000;
  for (let k = 0; k < 3; k++) await G.dismissSuggestion(s, milkKey, IL(10, 10, 13), skipAt(k));
  // An empty list: no "usually with" context, only the rhythm.
  await s.delete(schema.items, and(eq(schema.items.list, "supermarket"), eq(schema.items.status, "to_buy")));
  // "Due" is the rhythm the skips slow down; context reasons (here: usually with the pasta on the list) still apply until 5.
  const milkDue = async (at: number) => (await G.suggestFor(s, { now: at, tz: TZ })).some((x) => x.productKey === milkKey && x.reasonKey === "due");
  const milkAny = async (at: number) => (await G.suggestFor(s, { now: at, tz: TZ })).some((x) => x.productKey === milkKey);
  assert.equal(await milkDue(sat), false, "3 skips: not at its usual gap (7 days)");
  assert.equal(await milkDue(IL(10, 17, 19, 30)), true, "3 skips: suggested at twice the gap (14 days)");
  assert.equal((await G.knowledgeFor(s, milkKey, TZ)).state, "regular");
  for (let k = 3; k < 5; k++) await G.dismissSuggestion(s, milkKey, IL(10, 10, 13), skipAt(k));
  assert.equal(await milkAny(IL(10, 17, 19, 30)), false, "5 skips: not suggested at all (not even at twice the gap)");
  const milkRow = (await G.addToList(s, { title: "חלב 3%", by: "noa" })).item;
  const t1 = await T.startTrip(s, "noa", { chain: "Shufersal", branch: "Modiin", now: IL(10, 18, 10) });
  await T.addCheck(s, t1.id, { action: "check", itemId: milkRow.id, productKey: milkKey, section: "dairy", at: IL(10, 18, 10, 5) });
  await T.finishTrip(s, t1.id, { now: IL(10, 18, 10, 30) });
  await s.update(schema.items, { status: "purchased", purchasedAt: IL(10, 18, 10, 5) }, eq(schema.items.id, milkRow.id));
  assert.equal(await milkDue(IL(10, 24, 19, 30)), true, "bought again: the count starts over, due at its gap");
  assert.equal(await G.dismissSuggestion(s, milkKey, IL(10, 24, 21), IL(10, 24, 20)), 1, "a skip after the purchase is the first in a new row");
  await G.acceptSuggestions(s, [{ productKey: milkKey, title: "חלב 3%", qty: 2, amount: null, unit: null, section: "dairy", art: "mlk" }], "noa");
  const [mp] = await s.select(schema.suggestDismiss, eq(schema.suggestDismiss.productKey, milkKey));
  assert.equal(mp.skips, null, "+ breaks a skip run");

  // ---- C1: cold start — a new home gets the basic basket (sized by onboarding) until 4 trips; then its own history takes
  // over and basket items it never bought fade out.
  await db.insert(schema.space).values({ id: "fresh", name: "Fresh", slug: "fresh", kind: "personal", createdBy: "yoav", createdAt: d } as never);
  const f = new Scoped({ spaceId: "fresh", userId: "yoav", by: "yoav" });
  const cold = await G.suggestFor(f, { now: sat, tz: TZ, locale: "en", who: "family" });
  assert.ok(cold.length >= 10 && cold.every((x) => x.reasonKey === "basket"), "no history: the basket");
  assert.equal(cold.find((x) => x.productKey === "milk")?.qty, 3, "a family: bigger quantities");
  assert.equal((await G.suggestFor(f, { now: sat, tz: TZ, locale: "en", who: "me" })).find((x) => x.productKey === "milk")?.qty, 2, "one or two people: the usual");
  const { basketFor } = await import("../src/lib/grocery/basket");
  assert.ok(basketFor({ who: "family" }).some((x) => x.productKey === "cornflakes") && !basketFor({ who: "me" }).some((x) => x.productKey === "cornflakes"), "family items only for a family");
  assert.ok(basketFor({ baby: true }).some((x) => x.productKey === "diapers") && basketFor({ pets: true }).some((x) => x.productKey === "cat-food"), "baby / pet items when the home has them");
  assert.equal(cold.find((x) => x.productKey === "milk")?.title, "Milk", "named in the reader's language");
  assert.ok(!cold.some((x) => x.productKey === "diapers"), "no baby items without a sign of a baby");
  for (const [k, day] of [[0, 4], [1, 11], [2, 18]] as const) {
    const it = (await G.addToList(f, { title: "Milk", by: "yoav" })).item;
    const t = await T.startTrip(f, "yoav", { now: IL(9, day, 10) });
    await T.addCheck(f, t.id, { action: "check", itemId: it.id, productKey: it.productKey, section: "dairy", at: IL(9, day, 10, 5) });
    await T.finishTrip(f, t.id, { now: IL(9, day, 10, 30) });
    await f.update(schema.items, { status: "purchased" }, eq(schema.items.id, it.id));
    void k;
  }
  const three = await G.suggestFor(f, { now: sat, tz: TZ, locale: "en", who: "me" });
  assert.ok(three.some((x) => x.reasonKey === "basket"), "3 trips: the basket still fills in");
  assert.equal(three.find((x) => x.productKey === "milk")?.reasonKey, "due", "bought: its own rhythm, not the basket");
  const it4 = (await G.addToList(f, { title: "Eggs", by: "yoav" })).item;
  const t4 = await T.startTrip(f, "yoav", { now: IL(9, 25, 10) });
  await T.addCheck(f, t4.id, { action: "check", itemId: it4.id, productKey: it4.productKey, section: "dairy", at: IL(9, 25, 10, 5) });
  await T.finishTrip(f, t4.id, { now: IL(9, 25, 10, 30) });
  await f.update(schema.items, { status: "purchased" }, eq(schema.items.id, it4.id));
  const four = await G.suggestFor(f, { now: sat, tz: TZ, locale: "en", who: "me" });
  assert.equal(four.filter((x) => x.reasonKey === "basket").length, 0, "4 trips: never-bought basket items fade out");

  // ---- C1: the evening draft's gate (pure): usual day ≥ 3 trips on that weekday, something to suggest, the list not
  // empty-and-unused, < 3 unopened drafts since the last trip. No switch of its own.
  const { draftAllowed, usualDay } = await import("../src/lib/grocery/staples");
  const g = { usualWeekday: 0, tomorrowWeekday: 0, suggestions: 2, listItems: 5, addedSinceTrip: 3, unopenedDrafts: 0 };
  assert.equal(draftAllowed(g), true);
  assert.equal(draftAllowed({ ...g, usualWeekday: null }), false, "no usual day yet");
  assert.equal(draftAllowed({ ...g, tomorrowWeekday: 3 }), false, "tomorrow isn't the day");
  assert.equal(draftAllowed({ ...g, suggestions: 0 }), false, "nothing to suggest");
  assert.equal(draftAllowed({ ...g, listItems: 0, addedSinceTrip: 0 }), false, "empty and unused");
  assert.equal(draftAllowed({ ...g, listItems: 0, addedSinceTrip: 2 }), true, "empty but used (things bought off it)");
  assert.equal(draftAllowed({ ...g, unopenedDrafts: 3 }), false, "3 unopened in a row → quiet until the next trip");
  const at = (d: number) => ({ startedAt: IL(9, d, 10) });
  assert.equal(usualDay([at(6), at(13), at(17), at(20)], TZ)?.weekday, 0, "3 Sundays");
  assert.equal(usualDay([at(6), at(9), at(17), at(24)], TZ), null, "no weekday with 3 trips");

  console.log("ok C1 regular vs occasional, hidden (never, Settings brings it back), no auto add, skips (3 → half, 5 → until bought), cold start + fade, draft gate");
  console.log("ok E1 admin numbers: trips / week, items / trip, receipts, suggestions taken, week-4 retention");
  console.log("ok B1 history: interval, usual quantity, usual day + hour, last store");
  console.log("ok B2 suggestions: due, not on the list, dismissed, Shabbat, companion, holiday; accept merges");
  console.log("ok B3 evening draft: 19–21 before the usual day, once, shoppers only, list untouched, 3 unopened → quiet");
  console.log("ok B4 templates: no duplicates, quantities stay, trip → template");
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
