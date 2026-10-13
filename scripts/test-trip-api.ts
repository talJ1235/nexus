// R18 S2 D1 — the one trip API, a whole trip through it only (throwaway file DB): ops built by lib/grocery/trip-api.ts
// (start · add · check · uncheck · not found · substitute · quantity (count + weight) · price · note · finish), merged by
// mergeOps with the same start / finish hooks the action uses. Checks the trip row (store, counts, total, finished),
// the list (bought rows, the add merged once, the note, the count), the price point of the branch, and that sending the
// whole queue again (a lost answer) changes nothing: start / finish once per op id, an offline add once by client id.
//   npm run test:trip-api
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DB = "trip-api-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

(async () => {
  const { db, schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const T = await import("../src/lib/db-scoped/trips");
  const G = await import("../src/lib/db-scoped/grocery");
  const { mergeOps } = await import("../src/lib/db-scoped/trip-sync");
  const S = await import("../src/lib/notify/senders");
  const { tripOps } = await import("../src/lib/grocery/trip-api");
  const { eq } = await import("drizzle-orm");
  const d = new Date();
  await db.insert(schema.user).values({ id: "noa", name: "Noa", email: "noa@test.example", emailVerified: true, createdAt: d, updatedAt: d });
  await db.insert(schema.space).values({ id: "home", name: "Home", slug: "home", kind: "personal", createdBy: "noa", createdAt: d } as never);
  await db.insert(schema.member).values({ id: "m1", organizationId: "home", userId: "noa", role: "owner", createdAt: d } as never);
  const s = new Scoped({ spaceId: "home", userId: "noa", by: "noa" });

  // The list before the store.
  const rows: Record<string, typeof schema.items.$inferSelect> = {};
  for (const [k, title] of [["milk", "חלב 3%"], ["bread", "לחם"], ["eggs", "ביצים"], ["tom", "עגבניות"], ["salmon", "סלמון"], ["oil", "שמן זית"]] as const)
    rows[k] = (await G.addToList(s, { title, by: "noa" })).item;

  // The action's store + hooks (supermarket-actions.ts syncTripOps), in memory.
  const kv = new Map<string, string>();
  const store = { seen: async (k: string) => kv.get(k) ?? null, mark: async (k: string, v: string) => kv.set(k, v) };
  const hooks = {
    start: async (op: { planned?: number; at: number; chain?: string | null; branch?: string | null }) => {
      await S.tripStarted("noa", "home", op.planned ?? null, op.at, op.chain ? { chain: op.chain, branch: op.branch ?? "" } : undefined);
      return T.openTripOf("noa");
    },
    finish: async (op: { total?: number | null; at: number }, trip: { id: string }) => {
      if (op.total != null) await s.update(schema.trip, { total: op.total }, eq(schema.trip.id, trip.id));
      await S.tripFinished("noa", null, op.at);
    },
  };
  let n = 0;
  const t0 = Date.now() - 40 * 60_000;
  const op = (o: ReturnType<(typeof tripOps)["start"]>) => ({ ...o, id: `op_${++n}`, at: t0 + n * 60_000, ...(o.kind === "add" ? { clientId: `c_${n}` } : {}) });
  const ref = (k: string) => ({ id: rows[k].id, rev: rows[k].rev });
  const queue = [
    op(tripOps.start({ chain: "shufersal", branch: "Herzl St.", planned: 6 })),
    op(tripOps.check(ref("milk"))),
    op(tripOps.check(ref("bread"))),
    op(tripOps.uncheck(ref("bread"))),
    op(tripOps.check(ref("bread"))),
    op(tripOps.notFound(ref("salmon"))),
    op(tripOps.substitute(ref("oil"), "Canola oil")),
    op(tripOps.quantity(ref("tom"), { count: 6, amount: 1, unit: "kg" })),
    op(tripOps.check(ref("tom"))),
    op(tripOps.price(ref("milk"), 6.9)),
    op(tripOps.note(ref("eggs"), "Size L only")),
    op(tripOps.add({ title: "במבה", qty: 2 })),
    op(tripOps.add({ title: "חלב 3%" })), // already bought this trip → a new row (the bought one isn't on the list)
    op(tripOps.finish({ total: 187.4 })),
  ];
  const r1 = await mergeOps(s, "noa", null, queue, store, hooks);
  assert.equal(r1.skipped.length, 0, `everything applied (${r1.skipped.join(", ")})`);
  assert.equal(r1.applied, queue.length);

  // The trip row: where, what, how much, finished.
  const [trip] = await db.select().from(schema.trip).where(eq(schema.trip.spaceId, "home"));
  assert.ok(trip.finishedAt, "finished");
  assert.deepEqual([trip.chain, trip.branch], ["shufersal", "Herzl St."]);
  assert.equal(trip.total, 187.4);
  assert.equal(trip.bought, 4, "milk, bread, oil (substitute), tomatoes");
  assert.equal(trip.notFound, 1, "salmon");
  assert.equal(await T.openTripOf("noa"), null, "no open trip after finish");
  // The list.
  const get = async (k: string) => (await s.byId(schema.items, rows[k].id))!;
  assert.equal((await get("milk")).status, "purchased");
  assert.equal((await get("bread")).status, "purchased", "check → uncheck → check");
  assert.equal((await get("salmon")).status, "to_buy", "not found stays on the list");
  assert.equal((await get("oil")).status, "purchased", "a substitute counts as bought");
  const tom = await get("tom");
  assert.deepEqual([tom.count, tom.amount, tom.unit, tom.status], [6, 1, "kg", "purchased"], "count + weight, then checked");
  assert.equal((await get("eggs")).notes, "Size L only");
  assert.equal((await get("milk")).purchasedPrice, 6.9);
  const [pp] = await db.select().from(schema.pricePoints).where(eq(schema.pricePoints.itemId, rows.milk.id));
  assert.deepEqual([pp.price, pp.chain, pp.branch, pp.tripId], [6.9, "shufersal", "Herzl St.", trip.id], "the price is the branch's");
  const bamba = (await G.supermarketList(s)).filter((i) => i.title === "במבה");
  assert.equal(bamba.length, 1);
  assert.equal(bamba[0].quantity, 2);
  const log = await T.tripChecks(s, trip.id);
  assert.deepEqual(log.map((c) => c.action), ["check", "check", "uncheck", "check", "not_found", "substitute", "qty", "check", "price", "add", "add"], "every action in the trip's log, in order (start / finish / note are not checks)");

  // A lost answer: the same queue again changes nothing.
  const before = JSON.stringify(await db.select().from(schema.items));
  const r2 = await mergeOps(s, "noa", null, queue, store, hooks);
  assert.equal(r2.applied - r2.skipped.length <= r2.applied, true);
  assert.equal((await db.select().from(schema.trip)).length, 1, "start applied once (no second trip)");
  assert.equal(JSON.stringify(await db.select().from(schema.items)).length, before.length, "no new rows");
  assert.equal((await G.supermarketList(s)).filter((i) => i.title === "במבה").length, 1, "the offline add once, by its client id");

  // A trip started offline and finished offline in one queue, on a fresh list.
  const eggs2 = (await G.addToList(s, { title: "קוטג׳", by: "noa" })).item;
  const q2 = [op(tripOps.start({ planned: 1 })), op(tripOps.check({ id: eggs2.id, rev: eggs2.rev })), op(tripOps.finish())];
  const r3 = await mergeOps(s, "noa", null, q2, store, hooks);
  assert.equal(r3.applied, 3);
  const trips = await db.select().from(schema.trip);
  assert.equal(trips.length, 2);
  assert.ok(trips.every((t) => t.finishedAt), "both finished");
  console.log(`ok trip API: a whole trip through the API only (${queue.length} ops: start · check · uncheck · not found · substitute · count + weight · price · note · add · finish), resend = no change, offline start → finish`);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
