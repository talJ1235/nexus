// R18 B — staples and "Build my list" (engine only), on a synthetic 8-week history in a throwaway file DB:
//   weekly Sunday trips (milk + bread every time, pasta in 4 with parmesan in 3, toilet paper every 2 weeks), three
//   Thursday trips with challah. Checks: B1 history (interval, usual qty, usual day), due items, never what's on the
//   list, dismiss honoured, Shabbat rule, companion rule, holiday rule, accept merges (quantity stays the user's), an
//   `auto` staple added once with undo, the evening draft computed and pushed once, templates merge without duplicates.
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

  // ---- Auto staple: added once by Nexus on its due day, undoable, not re-added that day.
  await s.update(schema.items, { staple: "auto" }, eq(schema.items.id, ids.tp));
  assert.ok(!(await G.suggestFor(s, { now: sat, tz: TZ })).some((x) => x.productKey === tpKey), "an `auto` staple is not suggested: the engine adds it");
  const sun = IL(10, 11, 8);
  assert.equal((await G.addDueStaples(s, { now: sat, tz: TZ })).length, 0, "not before its due day");
  const a1 = await G.addDueStaples(s, { now: sun, tz: TZ });
  assert.equal(a1.length, 1, "the due auto staple is added");
  assert.equal(a1[0].item.addedByName, "Nexus");
  assert.equal(a1[0].item.addedByUserId, null);
  assert.equal((await G.addDueStaples(s, { now: sun + 3_600_000, tz: TZ })).length, 0, "once");
  assert.equal(await G.undoStapleAdd(s, tpKey, a1[0].dueDay), true);
  assert.equal((await G.supermarketList(s)).filter((i) => i.productKey === tpKey).length, 0, "undo removes it");
  assert.equal((await G.addDueStaples(s, { now: sun + 7_200_000, tz: TZ })).length, 0, "not re-added after undo that day");

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
  const { userPrefSet } = await import("../src/lib/db-scoped/prefs");
  const { DRAFT_PREF_KEY } = await import("../src/lib/notify/kinds");
  await userPrefSet("noa", DRAFT_PREF_KEY, "off");
  assert.equal(await S.eveningDrafts(IL(10, 17, 19, 30)), 0, "the switch off → no draft");

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
  assert.equal((await db.select().from(schema.stapleAdd).where(and(eq(schema.stapleAdd.spaceId, "home")))).length, 1);

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
  console.log("ok E1 admin numbers: trips / week, items / trip, receipts, suggestions taken, week-4 retention");
  console.log("ok B1 history: interval, usual quantity, usual day + hour, last store");
  console.log("ok B2 suggestions: due, not on the list, dismissed, Shabbat, companion, holiday; accept merges; auto staple once + undo");
  console.log("ok B3 evening draft: 19–21 before the usual day, once, shoppers only, list untouched, switch off");
  console.log("ok B4 templates: no duplicates, quantities stay, trip → template");
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
