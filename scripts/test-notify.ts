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
  console.log("ok unit: quiet hours, active hour, week, ask schedule, texts");
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

unit()
  .then(withDb)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
