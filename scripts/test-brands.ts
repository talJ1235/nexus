// R18 S3 C6 — the usual brand. Unit + a throwaway file DB:
//   brandOf: the name minus its type and pack size ("Tnuva milk 3% 1L" → Tnuva 3%; brand synonyms stay brands).
//   usualOf: ≥ 3 buys and ≥ 60 % one brand, after the cut-off.
//   recorded from a trip's barcoded checks when it finishes (not unchecked / not found / no barcode; once), barcode
//   adds and receipt lines (dropped with their ref); forget `b:<type>` / `all` hides it (Undo brings it back); another
//   space never sees it; What Nexus learned lists it as a `b:` fact.
//   npm run test:brands
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DB = "brands-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

const T0 = Date.UTC(2026, 9, 12, 7);
const MIN = 60_000;

async function pure() {
  const { brandOf } = await import("../src/lib/grocery/classify");
  const { usualOf } = await import("../src/lib/grocery/brands");
  const b = (t: string) => brandOf(t)?.brand ?? null;
  assert.equal(b("Tnuva milk 3% 1L"), "Tnuva 3%");
  assert.equal(b("חלב תנובה 3% 1 ליטר"), "תנובה 3%");
  assert.equal(b("Tara milk 1%"), "Tara 1%");
  assert.equal(b("Barilla penne 500 g"), "Barilla");
  assert.equal(b("Activia yogurt"), "Activia", "a brand that is also a dictionary synonym stays the brand");
  assert.equal(b("Coca Cola Zero 1.5 L x6"), "Coca Cola");
  assert.equal(brandOf("Tnuva milk 3% 1L")?.type, "milk");
  for (const t of ["Milk", "Eggs L 12", "Bamba 80g", "Something odd"]) assert.equal(b(t), null, `${t}: no brand`);
  const r = (brand: string, at: number) => ({ type: "milk", brand, brandKey: brand.toLowerCase(), at });
  assert.equal(usualOf([r("Tnuva 3%", 1), r("Tnuva 3%", 2)]), null, "two buys: too few");
  assert.deepEqual(usualOf([r("Tnuva 3%", 1), r("Tnuva 3%", 2), r("Tnuva 3%", 3)]), { brand: "Tnuva 3%", n: 3, of: 3 });
  assert.deepEqual(usualOf([r("Tnuva 3%", 1), r("Tara 3%", 2), r("Tnuva 3%", 3), r("Tara 3%", 4), r("TNUVA 3%", 5)]), { brand: "TNUVA 3%", n: 3, of: 5 }, "60 % is enough; the latest spelling shows");
  assert.equal(usualOf([r("Tnuva 3%", 1), r("Tara 3%", 2), r("Yotvata", 3), r("Tnuva 3%", 4), r("Tara 3%", 5)]), null, "40 % is not");
  assert.equal(usualOf([r("Tnuva 3%", 1), r("Tnuva 3%", 2), r("Tnuva 3%", 3)], 2), null, "buys before the cut-off don't count");
}

async function db() {
  const { db, schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const T = await import("../src/lib/db-scoped/trips");
  const G = await import("../src/lib/db-scoped/grocery");
  const B = await import("../src/lib/db-scoped/brands");
  const d = new Date(T0);
  for (const [id, name] of [["noa", "Noa"], ["yoav", "Yoav"]]) await db.insert(schema.user).values({ id, name, email: `${id}@test.example`, emailVerified: true, createdAt: d, updatedAt: d });
  await db.insert(schema.space).values({ id: "home", name: "Home", slug: "home", kind: "shared", createdBy: "noa", createdAt: d } as never);
  await db.insert(schema.space).values({ id: "other", name: "Other", slug: "other", kind: "personal", createdBy: "yoav", createdAt: d } as never);
  const s = new Scoped({ spaceId: "home", userId: "noa", by: "noa" });
  const other = new Scoped({ spaceId: "other", userId: "yoav", by: "yoav" });

  // ---- a trip: barcoded rows checked at the end count once; unchecked / not found / no barcode don't.
  const add = async (title: string, gtin?: string) => (await G.addToList(s, { title, by: "noa", ...(gtin ? { gtin } : {}) })).item;
  const milk = await add("Tnuva milk 3% 1L", "7290004131074");
  const yog = await add("Activia yogurt", "7290000000001");
  const pasta = await add("Barilla penne 500 g");
  const tara = await add("Tara milk 1%", "7290000000002");
  const trip = await T.startTrip(s, "noa", { now: T0 });
  const check = (it: typeof milk, action: "check" | "uncheck" | "not_found", min: number) => T.addCheck(s, trip!.id, { action, itemId: it.id, productKey: it.productKey, section: it.section, gtin: it.gtin, at: T0 + min * MIN });
  await check(milk, "check", 1);
  await check(yog, "check", 2);
  await check(yog, "uncheck", 3);
  await check(pasta, "check", 4);
  await check(tara, "not_found", 5);
  await T.finishTrip(s, trip!.id, { now: T0 + 30 * MIN });
  const rows = await s.select(schema.brandBuy);
  assert.deepEqual(rows.map((r) => [r.type, r.brand, r.source]), [["milk", "Tnuva 3%", "check"]], "only the barcoded row that ended checked");
  assert.equal(await B.recordTripBrands(s, trip!.id, "noa"), 0, "once per trip");

  // ---- two more buys (a barcode add, a receipt line) → the usual brand; a different brand doesn't tip it under 60 %.
  assert.equal(await B.usualBrandFor(s, "חלב"), null, "one buy: nothing to say yet");
  await B.recordBrand(s, { title: "Tnuva milk 3%", source: "scan", ref: "add:x", at: T0 + 2 * 86_400_000 });
  await B.recordBrand(s, { id: "bb_r_rc1_0", title: "TNUVA MILK 3% 1L", source: "receipt", ref: "rc1", at: T0 + 3 * 86_400_000 });
  assert.equal(await B.recordBrand(s, { id: "bb_r_rc1_0", title: "TNUVA MILK 3% 1L", source: "receipt", ref: "rc1" }), false, "a resent line is a no-op");
  assert.deepEqual(await B.usualBrandFor(s, "Milk 3%"), { brand: "TNUVA 3%", n: 3, of: 3 }, "one brand whatever the case; the latest spelling");
  assert.deepEqual(await B.usualBrandFor(s, "חלב"), { brand: "TNUVA 3%", n: 3, of: 3 }, "by type: a Hebrew row of the same type reads it too");
  await B.recordBrand(s, { title: "Tara milk 3%", source: "scan", at: T0 + 4 * 86_400_000 });
  await B.recordBrand(s, { title: "Tara milk 3%", source: "scan", at: T0 + 5 * 86_400_000 });
  assert.deepEqual(await B.usualBrandFor(s, "milk"), { brand: "TNUVA 3%", n: 3, of: 5 }, "3 of 5 = 60 %: still shown");
  await B.recordBrand(s, { title: "Tara milk 3%", source: "scan", at: T0 + 6 * 86_400_000 });
  assert.equal(await B.usualBrandFor(s, "milk"), null, "3 of 6: no usual brand");
  assert.equal(await B.usualBrandFor(s, "Barilla penne"), null, "another type has its own count");
  // An undone receipt takes its line back.
  await B.dropBrands(s, "rc1");
  assert.equal((await s.select(schema.brandBuy)).filter((r) => r.ref === "rc1").length, 0);

  // ---- forget: one fact (b:<type>) or everything hides it; Undo of the one fact brings it back.
  for (let k = 0; k < 4; k++) await B.recordBrand(s, { title: "Barilla penne 500 g", source: "scan", at: T0 + (7 + k) * 86_400_000 });
  assert.deepEqual(await B.usualBrandFor(s, "pasta"), { brand: "Barilla", n: 4, of: 4 });
  const facts = await G.learnedFacts(s, "Asia/Jerusalem");
  assert.ok(facts.some((f) => f.key === "b:pasta" && f.kind === "brand" && f.args.brand === "Barilla"), "What Nexus learned lists it");
  const prev = await G.forgetFact(s, "b:pasta", T0 + 20 * 86_400_000);
  assert.equal(await B.usualBrandFor(s, "pasta"), null, "forgotten");
  await G.restoreForget(s, "b:pasta", prev);
  assert.equal((await B.usualBrandFor(s, "pasta"))?.n, 4, "Undo brings it back");
  await G.forgetFact(s, "all", T0 + 20 * 86_400_000);
  assert.equal(await B.usualBrandFor(s, "pasta"), null, "Forget everything clears it too");
  assert.equal((await B.usualBrands(s)).size, 0);
  for (let k = 0; k < 3; k++) await B.recordBrand(s, { title: "Barilla penne", source: "scan", at: T0 + (21 + k) * 86_400_000 });
  assert.equal((await B.usualBrandFor(s, "pasta"))?.n, 3, "learned again from what happens next");

  // ---- another space never sees this home's brands.
  assert.equal((await B.usualBrands(other)).size, 0);
  assert.equal(await B.usualBrandFor(other, "pasta"), null);
  assert.equal((await other.select(schema.brandBuy)).length, 0);
}

(async () => {
  await pure();
  await db();
  console.log("OK brands");
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
