// R17 S3 — notifications, unit + a throwaway file DB: quiet hours (held to 07:00, a finished trip at night is not
// pushed), the active hour (most common open hour, default 09:00, never at night), Thursday for the week, the reminder
// card schedule (3 → 7 → 14 → 30 days, then never), grouping / in-place updates (one row per group key), the actor is
// never notified, batching per price check (one push), the switch off (rows written, nothing due).
//   npm run test:notify
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DB = "notify-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

const TZ = "Asia/Jerusalem";
/** An instant given as Israel wall-clock time (October 2026 = UTC+3). */
const IL = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 3, m);
const DAY = 86_400_000;

async function unit() {
  const s = await import("../src/lib/notify/schedule");
  // Quiet hours.
  assert.equal(s.isQuiet(IL(8, 23), TZ), true);
  assert.equal(s.isQuiet(IL(8, 6, 59), TZ), true);
  assert.equal(s.isQuiet(IL(8, 7), TZ), false);
  assert.equal(s.isQuiet(IL(8, 21, 59), TZ), false);
  // Urgent: now by day; 07:00 after a quiet night; a finished trip at night is inbox only.
  assert.equal(s.sendAfterFor("shop", IL(8, 12), TZ, 9), IL(8, 12));
  assert.equal(s.sendAfterFor("shop", IL(8, 23, 30), TZ, 9), IL(9, 7));
  assert.equal(s.sendAfterFor("delivery", IL(9, 2), TZ, 9), IL(9, 7));
  assert.equal(s.sendAfterFor("shop", IL(8, 23, 30), TZ, 9, { finishedTrip: true }), null);
  // Batched: the next active hour (now when inside it).
  assert.equal(s.sendAfterFor("activity", IL(8, 12), TZ, 9), IL(9, 9));
  assert.equal(s.sendAfterFor("price", IL(8, 9, 20), TZ, 9), IL(8, 9, 20));
  assert.equal(s.sendAfterFor("price", IL(8, 8, 59), TZ, 9), IL(8, 9));
  assert.equal(s.sendAfterFor("budget", IL(8, 23), TZ, 20), IL(9, 20));
  // Week: Thursday (2026-10-08 is a Thursday) at the active hour.
  assert.equal(s.local(IL(8, 12), TZ).weekday, 4);
  assert.equal(s.sendAfterFor("week", IL(8, 12), TZ, 18), IL(8, 18));
  assert.equal(s.sendAfterFor("week", IL(8, 19), TZ, 18), IL(15, 18));
  assert.equal(s.sendAfterFor("week", IL(10, 9), TZ, 9), IL(15, 9));
  // Active hour: the most common open hour; night opens never win; nothing → 09:00.
  assert.equal(s.activeHour([], TZ), 9);
  assert.equal(s.activeHour([IL(1, 20, 5), IL(2, 20, 40), IL(3, 8, 10), IL(4, 23), IL(5, 23), IL(6, 23)], TZ), 20);
  // Other zones: New York's 07:00 (EDT = UTC−4); a half-hour zone still lands on :00 local.
  assert.equal(s.afterQuiet(Date.UTC(2026, 9, 8, 4), "America/New_York"), Date.UTC(2026, 9, 8, 11));
  assert.equal(s.local(s.nextLocal(Date.UTC(2026, 9, 8, 0), "Asia/Kolkata", 9), "Asia/Kolkata").hour, 9);
  assert.equal(s.validTz("Not/AZone"), false);
  // Activity: ≤ 1 push per space per hour.
  assert.equal(s.activityNotBefore(IL(8, 9), IL(8, 8, 30)), IL(8, 9, 30));
  assert.equal(s.activityNotBefore(IL(8, 9), IL(8, 7)), IL(8, 9));

  // The reminder card schedule.
  const a = await import("../src/lib/notify/ask");
  const base = { today: "2026-10-08", switchOn: true, onboardingAt: null as number | null };
  let st = a.parseAsk(null);
  assert.equal(a.askDue(st, { ...base, now: IL(8, 12) }), true, "never asked → the first offer");
  assert.equal(a.askDue(st, { ...base, now: IL(8, 12), onboardingAt: IL(8, 2) }), false, "not the first session after onboarding");
  assert.equal(a.askDue(st, { ...base, now: IL(8, 12), switchOn: false }), false, "switch off → never");
  st = a.saidNo(st, IL(1, 12), "2026-10-01"); // onboarding's "Not now"
  const due = (s0: typeof st, now: number, today: string) => a.askDue(s0, { ...base, now, today });
  assert.equal(due(st, IL(4, 11), "2026-10-04"), false, "< 3 days");
  assert.equal(due(st, IL(4, 12), "2026-10-04"), true, "3 days");
  st = a.wasShown(st, "2026-10-04");
  assert.equal(due(st, IL(4, 18), "2026-10-04"), false, "once a day");
  st = a.saidNo(st, IL(4, 18), "2026-10-04");
  assert.equal(due(st, IL(11, 17), "2026-10-11"), false);
  assert.equal(due(st, IL(11, 18), "2026-10-11"), true, "7 days");
  st = a.saidNo(st, IL(11, 18), "2026-10-11");
  assert.equal(due(st, IL(25, 18), "2026-10-25"), true, "14 days");
  st = a.saidNo(st, IL(25, 18), "2026-10-25");
  assert.equal(due(st, IL(25, 18) + 29 * DAY, "2026-11-23"), false);
  assert.equal(due(st, IL(25, 18) + 30 * DAY, "2026-11-24"), true, "30 days");
  st = a.saidNo(st, IL(25, 18) + 30 * DAY, "2026-11-24");
  assert.equal(due(st, IL(25, 18) + 400 * DAY, "2027-11-29"), false, "then never again");
  assert.equal(a.askDue(a.saidYes(a.parseAsk(null)), { ...base, now: IL(8, 12) }), false, "granted → no more cards");
  // The client half.
  const here = { perm: "default" as const, screen: "home", settledMs: 2000, overlay: false, shopping: false };
  assert.equal(a.askHere(here), true);
  assert.equal(a.askHere({ ...here, settledMs: 1000 }), false);
  assert.equal(a.askHere({ ...here, screen: "to-buy" }), false);
  assert.equal(a.askHere({ ...here, overlay: true }), false);
  assert.equal(a.askHere({ ...here, shopping: true }), false);
  assert.equal(a.askHere({ ...here, perm: "granted" }), false);
  assert.equal(a.askHere({ ...here, perm: "iphone-browser" }), true);

  // Texts in both languages; the reader's language, not the writer's.
  const { dictionaries } = await import("../src/lib/i18n");
  const t = await import("../src/lib/notify/text");
  const en = dictionaries.en.nt;
  const he = dictionaries.he.nt;
  assert.equal(t.rowText("activity", { names: ["Noa", "Yoav"], byIds: [], added: 7, checked: 0, space: "Home" }, en, "en").title, "Noa and Yoav added 7 items");
  assert.equal(t.rowText("activity", { names: ["נועה"], byIds: [], added: 5, checked: 0, space: "בית" }, he, "he").title, "נועה הוסיף/ה 5 פריטים");
  assert.equal(t.rowText("shop", { who: "Noa", whoId: "u", space: "Jacoby Home", left: 3, total: 15, done: true, bought: 12 }, en, "en").sub, "Jacoby Home · bought 12, 3 left");
  assert.equal(t.rowText("shop", { who: "Noa", whoId: "u", space: "Jacoby Home", list: "Groceries", left: 6, total: 15 }, en, "en").live, "6 of 15 left");
  assert.match(t.pushText("price", { itemId: "i", title: "Steam cleaner", store: "KSP", now: 899, was: 999, currency: "ILS", run: "r" }, en, "en").title, /Steam cleaner dropped to ₪899/);
  assert.equal(t.groupedPushText(["price", "price", "price"], en).title, "3 price drops");
  assert.equal(t.groupedPushText(["price", "activity"], en).title, "2 updates");
  // The Thursday numbers: bought + spent over 7 days, drops / targets per item.
  const { weekNumbers } = await import("../src/lib/weekly");
  const { FALLBACK_RATES } = await import("../src/lib/money");
  const it = (id: string, status: string, purchasedAt: number | null, price: number) =>
    ({ id, status, purchasedAt, quantity: 1, priority: "normal", sources: [{ id: `s${id}`, price, currency: "ILS", url: "", store: "", storeKey: "" }], chosenSourceId: `s${id}`, purchasedPrice: price, purchasedCurrency: "ILS", lastPaidPrice: price, lastPaidCurrency: "ILS" }) as never;
  const now = IL(8, 12);
  const w = weekNumbers({ items: [it("a", "purchased", now - DAY, 100), it("b", "purchased", now - 8 * DAY, 50), it("c", "to_buy", null, 70)], alerts: [{ kind: "drop", itemId: "c", createdAt: now - DAY }, { kind: "target", itemId: "c", createdAt: now - 2 * DAY }, { kind: "drop", itemId: "x", createdAt: now - 9 * DAY }] as never, rates: FALLBACK_RATES, currency: "ILS", now });
  assert.equal(w.bought, 1);
  assert.equal(Math.round(w.spent), 100);
  assert.equal(w.drops, 1, "one per item, last 7 days");
  console.log("ok unit: quiet hours, active hour, week, ask schedule, texts, week numbers");
}

async function withDb() {
  const { db, schema } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { notify } = await import("../src/lib/notify/enqueue");
  const n = await import("../src/lib/db-scoped/notify");
  const d = new Date(IL(8, 12));
  for (const [id, name] of [["uA", "Noa Levi"], ["uB", "Yoav Cohen"], ["uC", "Maya"]]) await db.insert(schema.user).values({ id, name, email: `${id}@test.example`, emailVerified: true, createdAt: d, updatedAt: d });
  const rowsOf = (u: string) => db.select().from(schema.notification).where(eq(schema.notification.userId, u));

  // Actor excluded; urgent by day is due now (no address → the in-request send just finds nothing).
  const now = IL(8, 12);
  await notify(["uA", "uB", "uC"], "shop", "shop:t1", { who: "Noa", whoId: "uA", space: "Home", left: 15, total: 15 }, { actor: "uA", spaceId: "s1", now });
  assert.equal((await rowsOf("uA")).length, 0, "the actor is never notified");
  const [b1] = await rowsOf("uB");
  assert.equal(b1.sendAfter, now);
  // Urgent goes out within the request: claimed at once; nobody has a push address here → "skipped" (inbox only).
  assert.ok(b1.sentAt != null, "urgent: sent in the same request");
  assert.equal(b1.pushState, "skipped");
  // In place: the same group key updates the one row (finished), unread again.
  await n.markNotificationsRead("uB", "all", now + 1);
  await notify(["uB"], "shop", "shop:t1", (prev: unknown) => ({ ...(prev as object), done: true, bought: 12, left: 3 }), { actor: "uA", spaceId: "s1", now: now + 60_000, finishedTrip: true });
  const b2 = await rowsOf("uB");
  assert.equal(b2.length, 1, "one row per group key");
  assert.equal(JSON.parse(b2[0].data).done, true);
  assert.equal(JSON.parse(b2[0].data).who, "Noa", "the update merges the earlier data");
  assert.equal(b2[0].readAt, null, "an update is news again");

  // Switch off: written, nothing due.
  await db.insert(schema.userPref).values({ userId: "uC", key: "pref:notify", value: JSON.stringify({ on: false }), updatedAt: now });
  await notify(["uC"], "price", "price:run1:i1", { itemId: "i1", title: "Lamp", now: 149, was: 179, currency: "ILS", run: "run1", target: true }, { actor: null, spaceId: "s1", now });
  const [c1] = (await rowsOf("uC")).filter((r) => r.kind === "price");
  assert.equal(c1.pushState, "off");
  assert.equal(c1.sendAfter, null);

  // Batching per check: 3 price rows of one run for B → one push (claimed together at the active hour).
  for (const i of ["i1", "i2", "i3"]) await notify(["uB"], "price", `price:run2:${i}`, { itemId: i, title: `Thing ${i}`, now: 90, was: 100, currency: "ILS", run: "run2" }, { actor: null, spaceId: "s1", now });
  const due9 = IL(9, 9);
  assert.ok((await rowsOf("uB")).filter((r) => r.kind === "price").every((r) => r.sendAfter === due9), "batched to the next active hour (09:00 default)");
  const { payloadFor } = await import("../src/lib/notify/dispatch");
  const claimed = await n.claimDue(due9, { userId: "uB" });
  assert.equal(claimed.filter((r) => r.kind === "price").length, 3);
  const p = payloadFor(claimed.filter((r) => r.kind === "price"), "en");
  assert.equal(p.title, "3 price drops");
  assert.equal(p.url, "/inbox");
  assert.equal((await n.claimDue(due9, { userId: "uB" })).length, 0, "a claimed row is never claimed again");
  // One row → its own text and the Open action; Hebrew for a Hebrew reader.
  const one = payloadFor([claimed.find((r) => r.kind === "price")!], "he");
  assert.equal(one.dir, "rtl");
  assert.deepEqual(one.actions?.map((x) => x.action), ["open"]);

  // Activity: at most one push per space per hour.
  await db.update(schema.notification).set({ pushState: "sent", sentAt: IL(9, 9) }).where(eq(schema.notification.groupKey, "price:run2:i1"));
  await notify(["uB"], "activity", "activity:s1:h1", { names: ["Noa"], byIds: ["uA"], added: 2, checked: 0, space: "Home" }, { actor: "uA", spaceId: "s1", now: IL(9, 9, 10) });
  await db.update(schema.notification).set({ pushState: "sent", sentAt: IL(9, 9, 10) }).where(eq(schema.notification.groupKey, "activity:s1:h1"));
  await notify(["uB"], "activity", "activity:s1:h2", { names: ["Noa"], byIds: ["uA"], added: 1, checked: 0, space: "Home" }, { actor: "uA", spaceId: "s1", now: IL(9, 9, 40) });
  const [h2] = (await rowsOf("uB")).filter((r) => r.groupKey === "activity:s1:h2");
  assert.equal(h2.sendAfter, IL(9, 10, 10), "an hour after the last activity push for that space");

  // Retention: 30 days.
  await db.update(schema.notification).set({ updatedAt: now - 31 * DAY }).where(eq(schema.notification.userId, "uC"));
  const purged = await n.purgeNotifications(now);
  assert.equal(purged.notifications, 2);
  console.log("ok db: actor excluded, in-place update, switch off, one push per check, ≤1 activity push per space per hour, 30-day purge");
}

/** M: the senders — a shared space with Noa (owner), Yoav (member), Maya (viewer). */
async function senders() {
  const { db, schema } = await import("../src/db");
  const { and, eq } = await import("drizzle-orm");
  const S = await import("../src/lib/notify/senders");
  const d = new Date(IL(8, 12));
  for (const [id, name] of [["noa", "Noa Levi"], ["yoav", "Yoav"], ["maya", "Maya"]]) await db.insert(schema.user).values({ id, name, email: `${id}@test.example`, emailVerified: true, createdAt: d, updatedAt: d });
  await db.insert(schema.space).values({ id: "home", name: "Jacoby Home", slug: "home", kind: "shared", createdBy: "noa", createdAt: d } as never);
  await db.insert(schema.space).values({ id: "solo", name: "Noa", slug: "solo", kind: "personal", createdBy: "noa", createdAt: d } as never);
  let mid = 0;
  for (const [u, r] of [["noa", "owner"], ["yoav", "member"], ["maya", "viewer"]]) await db.insert(schema.member).values({ id: `mm${mid++}`, organizationId: "home", userId: u, role: r, createdAt: d } as never);
  const rows = (u: string, kind?: string) => db.select().from(schema.notification).where(kind ? and(eq(schema.notification.userId, u), eq(schema.notification.kind, kind as never)) : eq(schema.notification.userId, u));

  // M1: a trip — started (urgent, to the others, never the shopper), live count, finished in place.
  const t0 = IL(8, 17);
  await S.tripStarted("noa", "home", 15, t0);
  assert.equal((await rows("noa", "shop")).length, 0, "the shopper is not notified");
  const [y1] = await rows("yoav", "shop");
  const [m1] = await rows("maya", "shop");
  assert.ok(y1 && m1, "every other member (viewers too) hears about the trip");
  assert.equal(JSON.parse(y1.data).who, "Noa");
  await S.tripStarted("noa", "home", 15, t0 + 60_000);
  assert.equal((await rows("yoav", "shop")).length, 1, "a reload mid-trip is the same trip");
  await S.tripProgress("noa", 6);
  assert.equal(JSON.parse((await rows("yoav", "shop"))[0].data).left, 6, "the live count updates in place");
  await db.insert(schema.activity).values({ userId: "noa", spaceId: "home", kind: "checked_off", n: 12, at: t0 + 5 * 60_000 });
  // A check-off during the trip is the trip's news, not activity.
  await S.sharedActivity("noa", "home", "checked_off", 1, t0 + 6 * 60_000);
  assert.equal((await rows("yoav", "activity")).length, 0);
  await S.tripFinished("noa", 3, t0 + 20 * 60_000);
  const y2 = await rows("yoav", "shop");
  assert.equal(y2.length, 1, "finishing updates the same row");
  const dd = JSON.parse(y2[0].data);
  assert.equal(dd.done, true);
  assert.equal(dd.bought, 12);
  assert.equal(dd.left, 3);
  // Personal space: nobody to tell.
  await S.tripStarted("noa", "solo", 4, t0);
  assert.equal((await rows("yoav", "shop")).length, 1);

  // M2: activity — one grouped row per space per hour, names merged.
  const a0 = IL(9, 10, 5);
  await S.sharedActivity("noa", "home", "items_added", 3, a0);
  await S.sharedActivity("yoav", "home", "items_added", 2, a0 + 60_000);
  const [ma] = await rows("maya", "activity");
  const ad = JSON.parse(ma.data);
  assert.deepEqual(ad.names, ["Noa", "Yoav"]);
  assert.equal(ad.added, 5);
  assert.equal((await rows("maya", "activity")).length, 1, "one row per space per hour");
  const [na] = await rows("noa", "activity");
  assert.deepEqual(JSON.parse(na.data).names, ["Yoav"], "Noa only hears about Yoav");

  // M3: price alerts of one run → one row per item for every member.
  await db.insert(schema.items).values({ id: "it1", spaceId: "home", title: "Steam cleaner", status: "to_buy", createdAt: t0, updatedAt: t0 } as never);
  await db.insert(schema.items).values({ id: "it2", spaceId: "home", title: "Desk lamp", status: "to_buy", createdAt: t0, updatedAt: t0 } as never);
  const al = (id: string, itemId: string, kind: "drop" | "target") => ({ id, spaceId: "home", rev: 0, revBy: null, itemId, sourceId: null, kind, oldPrice: 999, newPrice: 899, currency: "ILS", sentAt: null, readAt: null, createdAt: t0 });
  const n = await S.priceAlerts([al("a1", "it1", "drop"), al("a2", "it2", "target"), { ...al("a3", "it2", "drop"), kind: "back_in_stock" as never }], "run9", IL(9, 12));
  assert.equal(n, 2, "drops and targets only");
  const yp = await rows("yoav", "price");
  assert.equal(yp.length, 2);
  assert.ok(yp.every((r) => r.sendAfter === yp[0].sendAfter), "one run shares one send time (one push)");

  // M4: a delivery due today → 08:00 local, once.
  await db.insert(schema.items).values({ id: "it3", spaceId: "home", title: "Car vent clip", status: "ordered", eta: IL(10, 14), createdAt: t0, updatedAt: t0 } as never);
  await S.deliveriesToday(IL(10, 3));
  const [yd] = await rows("yoav", "delivery");
  assert.equal(yd.sendAfter, IL(10, 8), "delivery today at 08:00 local");
  await S.deliveriesToday(IL(10, 4));
  assert.equal((await rows("yoav", "delivery")).length, 1, "once per item per day");
  assert.equal(yd.sentAt, null);

  // N2: budget recipients — the owner always, picked members, never viewers.
  assert.deepEqual(await S.budgetRecipients("home", "noa"), ["noa"]);
  await db.insert(schema.spacePref).values({ spaceId: "home", key: S.BUDGET_TO_KEY, value: JSON.stringify(["yoav", "maya"]), updatedAt: t0 } as never);
  assert.deepEqual((await S.budgetRecipients("home", "noa")).sort(), ["noa", "yoav"], "a viewer is never a budget recipient");
  console.log("ok senders: trip start / live / finish in place, activity grouped per hour, one price row per item per run, delivery at 08:00 once, budget recipients");
}

unit()
  .then(withDb)
  .then(senders)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
