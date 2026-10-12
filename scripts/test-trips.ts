// R18 A2 / A3 / A5 — trips, sections, the learned walking order. Unit + a throwaway file DB.
//   A2: a trip (start → 10 checks incl. uncheck / not found → finish) replays to the same counts and order; the trip
//       notifications read the `trip` row (an R17 pref trip still finishes); a price from a trip carries chain + branch.
//   A3: the default Israeli order; a branch override is used for that branch only; junk orders are cleaned.
//   A5: dairy before bread in 2 trips → a suggestion; once → none; dismissed → quiet until 3 more trips; never applied.
//   npm run test:trips
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DB = "trips-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

const T0 = Date.UTC(2026, 9, 12, 7);
const MIN = 60_000;
const DAY = 86_400_000;

async function sections() {
  const S = await import("../src/lib/grocery/sections");
  assert.equal(S.SECTIONS.length, 16);
  assert.deepEqual(S.DEFAULT_ORDER.slice(0, 2), ["produce", "meat"], "produce at the entrance, then meat");
  assert.deepEqual(S.DEFAULT_ORDER.slice(-3), ["bread", "dairy", "frozen"], "bread / dairy at the back, frozen last");
  for (const s of S.SECTIONS) assert.ok(s.he && s.en && s.icon, `${s.key} has he + en names and an icon`);
  const custom = ["dairy", "bread", "produce"];
  const full = S.cleanOrder(JSON.stringify(custom));
  assert.deepEqual(full.slice(0, 3), custom, "an override keeps its order");
  assert.equal(full.length, 16, "missing sections are appended");
  assert.deepEqual(S.cleanOrder('["x","dairy","dairy"]').slice(0, 1), ["dairy"], "unknown / repeated keys dropped");
  assert.deepEqual(S.cleanOrder("not json"), [...S.DEFAULT_ORDER]);
  assert.deepEqual(S.tripOrder(null), [...S.DEFAULT_ORDER], "no branch order → the default");
  assert.equal(S.sectionRank(S.DEFAULT_ORDER, "other"), 16, "other goes last");
}

async function db() {
  const { db, schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const T = await import("../src/lib/db-scoped/trips");
  const G = await import("../src/lib/db-scoped/grocery");
  const S = await import("../src/lib/notify/senders");
  const { replayTrip } = await import("../src/lib/grocery/trip");
  const { eq } = await import("drizzle-orm");
  const d = new Date(T0);
  for (const [id, name] of [["noa", "Noa"], ["yoav", "Yoav"]]) await db.insert(schema.user).values({ id, name, email: `${id}@test.example`, emailVerified: true, createdAt: d, updatedAt: d });
  await db.insert(schema.space).values({ id: "home", name: "Home", slug: "home", kind: "shared", createdBy: "noa", createdAt: d } as never);
  await db.insert(schema.space).values({ id: "other", name: "Other", slug: "other", kind: "personal", createdBy: "yoav", createdAt: d } as never);
  for (const [i, u, r] of [["m1", "noa", "owner"], ["m2", "yoav", "member"]]) await db.insert(schema.member).values({ id: i, organizationId: "home", userId: u, role: r, createdAt: d } as never);
  const s = new Scoped({ spaceId: "home", userId: "noa", by: "noa" });

  // ---- A3: a branch override applies to that branch only.
  await G.saveStore(s, "Shufersal", "Modiin", { isDefault: true });
  await G.confirmOrder(s, "Shufersal", "Modiin", ["dairy", "bread"]);
  assert.deepEqual((await G.listOrder(s, "Shufersal", "Modiin")).slice(0, 2), ["dairy", "bread"]);
  assert.deepEqual((await G.listOrder(s, "Rami Levy", "Modiin")).slice(0, 2), ["produce", "meat"], "another branch: the default");
  assert.equal((await G.defaultStore(s))?.chain, "Shufersal");
  await G.confirmOrder(s, "Shufersal", "Modiin", null);

  // ---- A2: a trip with 10 actions replays to the same counts and order.
  const items: string[] = [];
  for (const t of ["עגבניות", "מלפפונים", "חלב 3%", "קוטג׳", "לחם", "פיתות", "ביצים", "טחינה", "במבה", "נייר טואלט"]) items.push((await G.addToList(s, { title: t, by: "noa" })).item.id);
  await S.tripStarted("noa", "home", 10, T0);
  const trip = (await T.openTripOf("noa"))!;
  assert.ok(trip && trip.spaceId === "home" && trip.chain === "Shufersal", "the trip row exists, at the default store");
  assert.equal((await db.select().from(schema.userPref).where(eq(schema.userPref.key, S.TRIP_KEY))).length, 0, "the pref is never written");
  const row = async (id: string) => (await s.byId(schema.items, id))!;
  const act = async (i: number, action: "check" | "uncheck" | "not_found" | "price", min: number, price?: number) => {
    const it = await row(items[i]);
    return T.addCheck(s, trip.id, { action, itemId: it.id, productKey: it.productKey, section: it.section, price, at: T0 + min * MIN });
  };
  await act(0, "check", 1); // tomatoes
  await act(1, "check", 2); // cucumbers
  await act(2, "check", 5); // milk
  await act(3, "check", 6); // cottage
  await act(1, "uncheck", 7); // cucumbers back
  await act(4, "not_found", 8); // bread: not found
  await act(5, "check", 9); // pita
  await act(1, "check", 10); // cucumbers again (now after pita)
  await act(7, "check", 11); // tahini
  const seq = await act(7, "price", 11, 12.9);
  assert.equal(seq, 10, "seq runs 1..10 per trip");
  const fresh = (await T.tripById(s, trip.id))!;
  assert.equal(fresh.bought, 6);
  assert.equal(fresh.notFound, 1);
  const replay = replayTrip(await T.tripChecks(s, trip.id));
  assert.deepEqual(replay.order, [items[0], items[2], items[3], items[5], items[1], items[7]], "the order checked (an uncheck + recheck moves it)");
  assert.deepEqual(replay.sections, ["produce", "dairy", "bread", "cans"]);
  const [pp] = await db.select().from(schema.pricePoints).where(eq(schema.pricePoints.tripId, trip.id));
  assert.ok(pp && pp.chain === "Shufersal" && pp.branch === "Modiin" && pp.price === 12.9, "a trip price carries chain + branch");
  await S.tripFinished("noa", 4, T0 + 30 * MIN);
  const done = (await T.tripById(s, trip.id))!;
  assert.ok(done.finishedAt, "finished");
  assert.equal(done.bought, 6, "finishing replays the log again: same counts");
  const shopRow = (await db.select().from(schema.notification).where(eq(schema.notification.userId, "yoav")))[0];
  assert.equal(JSON.parse(shopRow.data).bought, 6, "the finished push reads the trip's count");
  assert.equal(await T.openTripOf("noa"), null);

  // An R17 trip still open in the pref finishes (and the pref is cleared, never rewritten).
  await db.insert(schema.userPref).values({ userId: "yoav", key: S.TRIP_KEY, value: JSON.stringify({ key: "shop:yoav:1", spaceId: "home", at: T0, total: 3 }) } as never);
  await S.tripFinished("yoav", 0, T0 + 40 * MIN);
  assert.equal((await db.select().from(schema.userPref).where(eq(schema.userPref.key, S.TRIP_KEY))).length, 0, "an R17 pref trip ends");

  // ---- A5: learn the branch's order.
  const learnTrip = async (startMin: number, order: string[]) => {
    const t = await T.startTrip(s, "noa", { chain: "Shufersal", branch: "Modiin", now: T0 + startMin * MIN });
    let m = startMin;
    for (const id of order) {
      const it = await row(id);
      await T.addCheck(s, t.id, { action: "check", itemId: id, productKey: it.productKey, section: it.section, at: T0 + ++m * MIN });
    }
    await T.finishTrip(s, t.id, { now: T0 + (m + 1) * MIN });
    return G.refreshSuggestedOrder(s, "Shufersal", "Modiin", T0 + (m + 2) * MIN);
  };
  // The earlier trip went produce → dairy → bread → cans (dairy before bread already once).
  const milk = items[2];
  const pita = items[5];
  const tomato = items[0];
  // A trip the other way first, so "once" really is once.
  await db.update(schema.trip).set({ chain: "Other", branch: "x" }).where(eq(schema.trip.id, trip.id));
  assert.equal(await learnTrip(100, [tomato, pita, milk]), null, "bread before dairy = the default: nothing to suggest");
  assert.equal(await learnTrip(200, [tomato, milk, pita]), null, "dairy before bread once → no suggestion (the trips disagree)");
  const sug = await learnTrip(300, [tomato, milk, pita]);
  assert.ok(sug, "dairy before bread in 2 trips that agree → a suggestion");
  assert.ok(sug!.indexOf("dairy") < sug!.indexOf("bread"));
  assert.equal(sug![0], "produce", "unwalked / unchanged sections stay put");
  const st = (await G.storeOf(s, "Shufersal", "Modiin"))!;
  assert.ok(st.suggestedOrder && !st.sectionOrder, "suggested, never applied");
  await G.dismissOrder(s, "Shufersal", "Modiin", T0 + 400 * MIN);
  assert.equal(await learnTrip(500, [tomato, milk, pita]), null, "dismissed: quiet (1 trip since)");
  assert.equal(await learnTrip(600, [tomato, milk, pita]), null, "dismissed: quiet (2 trips since)");
  assert.ok(await learnTrip(700, [tomato, milk, pita]), "3 more trips → may suggest again");
  // Scoping: another space sees none of it.
  const o = new Scoped({ spaceId: "other", userId: "yoav", by: "yoav" });
  assert.equal((await T.finishedTrips(o)).length, 0);
  assert.equal(await T.tripById(o, trip.id), null, "a trip id from another space → not found");
  void DAY;
}

(async () => {
  await sections();
  console.log("ok A3 sections: 16 keys, default order, override per branch, cleaned orders");
  await db();
  console.log("ok A2 trips: 10 actions replay to the same counts + order, notifications read the trip row, R17 pref trip ends, trip prices carry chain + branch");
  console.log("ok A5 order: 2 agreeing trips → suggestion, 1 → none, dismissed → 3 more trips, never applied, scoped");
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
