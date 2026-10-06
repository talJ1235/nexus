// R16 B1 — the change feed on a fresh migrated file DB: every scoped write bumps the space revision in the same batch,
// stamps rev / rev_by, children stamp their item, deletes leave tombstones, changesSince returns exactly what changed,
// other spaces see nothing, and a client behind the tombstone window / a bulk move gets { reset }.
//   npx tsx --conditions=react-server scripts/test-feed.ts
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import assert from "node:assert/strict";

const DB = "feed-test.db";
for (const f of [DB, `${DB}-journal`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: { ...process.env, ADMIN_EMAIL: "" }, stdio: "ignore" });

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const { changesFor } = await import("../src/lib/db-scoped/changes");
  const { purgeTombstones, readRev, resetMark } = await import("../src/lib/db-scoped/feed");
  const { spacePrefSet } = await import("../src/lib/db-scoped/prefs");
  const A = new Scoped({ spaceId: "spA", userId: "noa" });
  const B = new Scoped({ spaceId: "spB", userId: "yoav" });
  const rev = async (s = A) => (await readRev(s.spaceId)).rev;
  const now = Date.now();

  await A.insert(schema.collections, { id: "c1", kind: "list", name: "Groceries", sortOrder: 0, createdAt: now });
  assert.equal(await rev(), 1, "first write → rev 1");
  const [c1] = await A.select(schema.collections, eq(schema.collections.id, "c1"));
  assert.deepEqual([c1.rev, c1.revBy], [1, "noa"], "row stamped with rev + who");

  await A.insert(schema.items, { id: "i1", title: "Milk", collectionId: "c1", createdAt: now, updatedAt: now });
  const r2 = await rev();
  await A.insert(schema.sources, { id: "s1", itemId: "i1", url: "https://s.test/m", normalizedUrl: "s.test/m", store: "S", storeKey: "s", price: 5, currency: "ILS", createdAt: now });
  const [i1] = await A.select(schema.items, eq(schema.items.id, "i1"));
  assert.equal(i1.rev, (await rev()), "a child insert stamps its item");
  assert.ok(i1.rev > r2);

  const before = await rev();
  const res = (await A.update(schema.items, { title: "Oat milk" }, eq(schema.items.id, "i1"))) as { rowsAffected: number };
  assert.equal(res.rowsAffected, 1, "the update's own result comes back");
  assert.equal(await rev(), before + 1, "one bump per write");

  // changesSince: everything after a revision, items whole (with their store link).
  const all = await changesFor(A, 0);
  assert.deepEqual(all.items.map((i) => [i.id, i.title, i.sources.length]), [["i1", "Oat milk", 1]]);
  assert.deepEqual(all.collections.map((c) => c.id), ["c1"]);
  const since = await changesFor(A, before);
  assert.deepEqual(since.items.map((i) => i.id), ["i1"]);
  assert.equal(since.collections.length, 0, "the list didn't change after `before`");
  const none = await changesFor(A, await rev());
  assert.equal(none.items.length + none.collections.length + none.removed.length, 0, "nothing new → empty");

  // Child delete → the item is re-sent (no tombstone); item delete → tombstone with who.
  const r3 = await rev();
  await A.delete(schema.sources, eq(schema.sources.id, "s1"));
  const afterChild = await changesFor(A, r3);
  assert.deepEqual(afterChild.items.map((i) => [i.id, i.sources.length]), [["i1", 0]]);
  assert.equal(afterChild.removed.length, 0);
  const r4 = await rev();
  await A.delete(schema.items, eq(schema.items.id, "i1"));
  const gone = await changesFor(A, r4);
  assert.deepEqual(gone.removed, [{ tbl: "items", id: "i1", by: "noa" }]);
  assert.equal(gone.items.length, 0);

  // Batch: several writes in one transaction, all stamped.
  await A.batch([A.insert(schema.altGroups, { id: "g1", name: "Drills", createdAt: now }), A.update(schema.collections, { name: "Food" }, eq(schema.collections.id, "c1"))]);
  const b = await changesFor(A, r4 + 1);
  assert.deepEqual([b.altGroups.map((g) => g.id), b.collections.map((c) => c.name)], [["g1"], ["Food"]]);

  // Upsert (store settings) keeps the stamp on conflict.
  await A.insert(schema.storeSettings, { storeKey: "s", freeShippingMin: 100, currency: "ILS", updatedAt: now }).onConflictDoUpdate({ target: [schema.storeSettings.spaceId, schema.storeSettings.storeKey], set: { freeShippingMin: 100 } });
  const r5 = await rev();
  await A.insert(schema.storeSettings, { storeKey: "s", freeShippingMin: 150, currency: "ILS", updatedAt: now }).onConflictDoUpdate({ target: [schema.storeSettings.spaceId, schema.storeSettings.storeKey], set: { freeShippingMin: 150 } });
  assert.deepEqual((await changesFor(A, r5)).storeSettings.map((x) => x.freeShippingMin), [150]);

  // Space prefs: budget changes are in the feed (with the recomputed history); AI caches are not.
  const r6 = await rev();
  await spacePrefSet(A, "pref:budget:2026-10", JSON.stringify({ cap: 900, currency: "ILS" }));
  const p = await changesFor(A, r6);
  assert.equal(p.budget?.["2026-10"]?.cap, 900);
  const r7 = await rev();
  await spacePrefSet(A, "home:ai:look", "{}");
  assert.equal(await rev(), r7, "AI caches don't bump the revision");

  // Tenancy: B's feed never shows A's rows.
  assert.equal(await rev(B), 0);
  const bAll = await changesFor(B, 0);
  assert.equal(bAll.items.length + bAll.collections.length + bAll.altGroups.length + bAll.removed.length, 0);

  // Behind the tombstone window (floor) or before a bulk move → reset.
  await db.update(schema.spaceRev).set({ floor: 3 }).where(eq(schema.spaceRev.spaceId, "spA"));
  assert.equal((await changesFor(A, 2)).reset, true, "older than the floor → reset");
  assert.equal((await changesFor(A, 3)).reset, undefined);
  await db.batch([resetMark("spA")]);
  assert.equal((await changesFor(A, (await rev()) - 1)).reset, true, "before a bulk move → reset");
  assert.equal((await changesFor(A, 999)).reset, true, "ahead of the server → reset");
  // Cron: 30-day-old tombstones go and the floor moves up to them.
  await db.update(schema.tombstone).set({ at: now - 31 * 86_400_000 }).where(eq(schema.tombstone.rowId, "i1"));
  const tombRev = (await db.select().from(schema.tombstone).where(eq(schema.tombstone.rowId, "i1")))[0].rev;
  assert.equal(await purgeTombstones(), 1);
  assert.equal((await db.select().from(schema.tombstone).where(eq(schema.tombstone.rowId, "i1"))).length, 0);
  assert.equal((await readRev("spA")).floor, Math.max(3, tombRev));
  console.log("OK feed: bump + stamp in one batch, children stamp items, tombstones, changesSince, tenancy, reset");
}

main().catch((e) => {
  console.error("FAIL feed —", e?.message ?? e);
  process.exit(1);
});
