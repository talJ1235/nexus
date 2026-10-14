// R18 S2 E1 — templates made by Nexus, on a synthetic history in a throwaway file DB: six Thursday trips with the same
// basket (+ noise), three Friday-morning trips, a lone Monday. Checks: routines need ≥ 3 look-alike trips on one weekday
// and ≥ 4 items bought in at least half of them; a new routine is an offer (not a template yet) → Keep it / No thanks
// (turned down never comes back); a kept one follows new trips until someone edits it (then it's theirs); hidden products
// never enter (and leave when hidden later); apply = merge (never duplicates, the user's quantity stays, hidden skipped).
//   npm run test:templates
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DB = "templates-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

const TZ = "Asia/Jerusalem";
/** Israel wall-clock, summer 2026 (UTC+3). */
const IL = (m: number, d: number, h: number, min = 0) => Date.UTC(2026, m - 1, d, h - 3, min);
const DAY = 86_400_000;

async function pure() {
  const R = await import("../src/lib/grocery/routines");
  const thu = (k: number) => IL(8, 6, 18) + k * 7 * DAY; // 6 Aug 2026 = Thursday
  const base = ["tomato", "cucumber", "milk", "pita", "eggs"];
  const trips = [0, 1, 2].map((k) => ({ id: `t${k}`, startedAt: thu(k), keys: new Set([...base, k === 1 ? "chips" : "salt"]) }));
  assert.equal(R.weekdayIn(thu(0), TZ), 4);
  assert.equal(R.weekdayIn(Date.UTC(2026, 7, 6, 22, 30), TZ), 5, "01:30 Friday in Israel is Friday, not Thursday");
  const [r] = R.detectRoutines(trips, TZ);
  assert.deepEqual([r.weekday, r.trips, [...r.keys].sort()], [4, 3, [...base, "salt"].sort()], "salt in 2 of 3 = in; chips once = out");
  assert.equal(R.detectRoutines(trips.slice(0, 2), TZ).length, 0, "two trips aren't a routine");
  assert.equal(R.detectRoutines(trips, TZ, new Set(["milk"]))[0].keys.includes("milk"), false, "hidden never enters");
  assert.equal(R.detectRoutines(trips.map((t) => ({ ...t, keys: new Set(["a", "b", "c"]) })), TZ).length, 0, "fewer than 4 items isn't a routine");
  // Two different baskets on the same weekday stay apart; a different weekday doesn't join.
  const bbq = [3, 4, 5].map((k) => ({ id: `b${k}`, startedAt: thu(k), keys: new Set(["steak", "coal", "pita", "hummus", "beer"]) }));
  const mon = { id: "m", startedAt: thu(0) - 3 * DAY, keys: new Set(base) };
  const all = R.detectRoutines([...trips, ...bbq, mon], TZ);
  assert.equal(all.length, 2, "weekly + barbecue, the Monday alone isn't one");
  const wk = all.find((x) => x.keys.includes("tomato"))!;
  assert.ok(R.matchRoutine(wk, [{ routineDay: 4, keys: [...base, "salt", "chips"] }]), "same weekday, items alike → the same routine");
  assert.equal(R.matchRoutine(wk, [{ routineDay: 3, keys: base }]), null, "another weekday → a new one");
  assert.equal(R.matchRoutine(all.find((x) => x.keys.includes("steak"))!, [{ routineDay: 4, keys: base }]), null, "same weekday, other items → a new one");
  // Apply plan: on the list → stays (its quantity), hidden → skipped, the rest new.
  const plan = R.applyPlan([{ productKey: "milk", title: "Milk", qty: 3 }, { productKey: "eggs", title: "Eggs", qty: 1 }, { productKey: "salt", title: "Salt", qty: 1 }], new Map([["milk", 2]]), new Set(["salt"]));
  assert.deepEqual(plan.map((l) => [l.productKey, l.state, l.onQty ?? null]), [["milk", "on", 2], ["eggs", "new", null], ["salt", "hidden", null]]);
  console.log("ok E1 routines (pure): ≥ 3 look-alike trips on a weekday, ≥ 4 items in half, hidden out, apply plan");
}

async function withDb() {
  const { db, schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const T = await import("../src/lib/db-scoped/trips");
  const G = await import("../src/lib/db-scoped/grocery");
  const { eq } = await import("drizzle-orm");
  const d = new Date(IL(8, 1, 12));
  await db.insert(schema.user).values({ id: "noa", name: "Noa", email: "noa@test.example", emailVerified: true, createdAt: d, updatedAt: d });
  await db.insert(schema.space).values({ id: "home", name: "Home", slug: "home", kind: "personal", createdBy: "noa", createdAt: d } as never);
  await db.insert(schema.member).values({ id: "m1", organizationId: "home", userId: "noa", role: "owner", createdAt: d } as never);
  const s = new Scoped({ spaceId: "home", userId: "noa", by: "noa" });
  const ids: Record<string, string> = {};
  const P = [["tomato", "עגבניות"], ["cucumber", "מלפפונים"], ["milk", "חלב 3%"], ["pita", "פיתות"], ["eggs", "ביצים"], ["cottage", "קוטג׳"], ["chips", "במבה"], ["challah", "חלה"], ["hummus", "חומוס"], ["coffee", "קפה"]] as const;
  for (const [k, t] of P) ids[k] = (await G.addToList(s, { title: t, qty: k === "milk" ? 2 : 1, by: "noa" })).item.id;
  const key = async (k: string) => (await s.byId(schema.items, ids[k]))!.productKey!;
  const trip = async (at: number, keys: string[]) => {
    const t = await T.startTrip(s, "noa", { chain: "Shufersal", branch: "Modiin", now: at });
    let m = 0;
    for (const k of keys) {
      const it = (await s.byId(schema.items, ids[k]))!;
      await T.addCheck(s, t.id, { action: "check", itemId: it.id, productKey: it.productKey, section: it.section, qty: it.quantity, at: at + ++m * 60_000 });
    }
    await T.finishTrip(s, t.id, { now: at + 30 * 60_000 });
  };
  const weekly = ["tomato", "cucumber", "milk", "pita", "eggs"];
  for (let k = 0; k < 3; k++) await trip(IL(8, 6, 18) + k * 7 * DAY, [...weekly, ...(k === 1 ? ["chips"] : [])]);
  await trip(IL(8, 3, 9), ["coffee"]); // a lone Monday
  await s.update(schema.items, { status: "purchased" }, eq(schema.items.list, "supermarket"));

  // A new routine is an offer, not a template yet.
  assert.equal(await G.refreshRoutines(s, TZ, IL(8, 21, 0)), 1);
  const offer = (await G.routineOffer(s))!;
  assert.deepEqual([offer.madeBy, offer.routineDay, offer.routineTrips, offer.items.length], ["nexus", 4, 3, 5]);
  assert.equal((await G.templatesOf(s)).length, 0, "an offer isn't in the templates list");
  assert.equal(await G.refreshRoutines(s, TZ, IL(8, 21, 1)), 0, "the same routine is offered once");
  // Keep it → a "Made by Nexus" template.
  await G.answerRoutine(s, offer.id, true, IL(8, 21, 2));
  assert.equal(await G.routineOffer(s), null);
  const [kept] = await G.templatesOf(s);
  assert.equal(kept.id, offer.id);

  // It follows new trips: cottage cheese joins three more Thursdays (in ≥ half of 6) → the template gains it.
  for (let k = 3; k < 6; k++) await trip(IL(8, 6, 18) + k * 7 * DAY, [...weekly, "cottage"]);
  assert.equal(await G.refreshRoutines(s, TZ, IL(9, 11, 0)), 0, "an update, not a new offer");
  const up = (await s.byId(schema.template, offer.id))!;
  assert.equal(up.routineTrips, 6);
  assert.ok(up.items.some((i) => i.productKey === "cottage" || i.title === "קוטג׳"), "cottage joined");
  assert.equal(up.items.find((i) => i.title === "חלב 3%")!.qty, 2, "the routine's own quantity");

  // Hidden products never enter: hide eggs → they leave the Nexus template and don't come back on refresh.
  const eggs = await key("eggs");
  await G.hideProduct(s, eggs, "noa");
  await G.dropFromNexusTemplates(s, eggs);
  assert.equal((await s.byId(schema.template, offer.id))!.items.some((i) => i.productKey === eggs), false);
  await G.refreshRoutines(s, TZ, IL(9, 11, 1));
  assert.equal((await s.byId(schema.template, offer.id))!.items.some((i) => i.productKey === eggs), false, "still out after a refresh");

  // Edited → theirs: Nexus never changes it again.
  await s.update(schema.template, { editedAt: IL(9, 12, 0) }, eq(schema.template.id, offer.id));
  const before = JSON.stringify((await s.byId(schema.template, offer.id))!.items);
  await G.unhideProduct(s, eggs);
  for (let k = 6; k < 9; k++) await trip(IL(8, 6, 18) + k * 7 * DAY, [...weekly, "cottage", "hummus"]);
  await G.refreshRoutines(s, TZ, IL(10, 2, 0));
  assert.equal(JSON.stringify((await s.byId(schema.template, offer.id))!.items), before, "an edited template is the user's");

  // No thanks → never offered again (Friday mornings: challah + hummus + pita + eggs + cucumber).
  const fri = ["challah", "hummus", "pita", "eggs", "cucumber"];
  for (let k = 0; k < 3; k++) await trip(IL(8, 7, 9) + k * 7 * DAY, fri);
  assert.equal(await G.refreshRoutines(s, TZ, IL(10, 2, 1)), 1);
  const friOffer = (await G.routineOffer(s))!;
  assert.equal(friOffer.routineDay, 5);
  await G.answerRoutine(s, friOffer.id, false, IL(10, 2, 2));
  assert.equal(await G.routineOffer(s), null);
  await trip(IL(8, 7, 9) + 3 * 7 * DAY, fri);
  assert.equal(await G.refreshRoutines(s, TZ, IL(10, 2, 3)), 0, "turned down: not offered again");
  assert.equal((await G.templatesOf(s)).some((t) => t.id === friOffer.id), false);

  // Apply = merge: milk on the list ×5 stays ×5, nothing doubles, a hidden product is skipped.
  await G.addToList(s, { title: "חלב 3%", qty: 5, by: "noa" });
  const hum = await key("hummus");
  await G.hideProduct(s, hum, "noa");
  const own = (await G.createTemplate(s, "Barbecue", [{ productKey: await key("milk"), title: "חלב 3%", qty: 1 }, { productKey: hum, title: "חומוס", qty: 2 }, { productKey: await key("pita"), title: "פיתות", qty: 10 }], "noa"))!;
  const r1 = (await G.applyTemplate(s, own.id, "noa", IL(10, 3, 0)))!;
  assert.deepEqual([r1.added, r1.on, r1.skipped], [1, 1, 1]);
  const r2 = (await G.applyTemplate(s, own.id, "noa", IL(10, 3, 1)))!;
  assert.deepEqual([r2.added, r2.on], [0, 2], "applying twice adds nothing");
  const list = await G.supermarketList(s);
  assert.equal(list.find((i) => i.title === "חלב 3%")!.quantity, 5, "the user's quantity wins");
  assert.equal(list.filter((i) => i.title === "פיתות").length, 1);
  assert.equal(list.find((i) => i.title === "פיתות")!.quantity, 10);
  assert.equal(list.some((i) => i.productKey === hum), false, "hidden skipped");
  assert.ok((await s.byId(schema.template, own.id))!.usedAt, "used_at set");
  console.log("ok E1 Nexus templates: offer → keep / no thanks, follows trips until edited, hidden never enters, apply merges");

  // ---- E2: editing makes a template the user's (a Nexus one is also kept), rename sticks.
  await G.unhideProduct(s, hum);
  await G.unhideProduct(s, eggs);
  await G.refreshRoutines(s, TZ, IL(10, 4, 0));
  const fresh = (await s.select(schema.template, eq(schema.template.madeBy, "nexus"))).find((t) => t.editedAt == null && t.dismissedAt == null && t.routineDay === 4);
  if (fresh) {
    const ed = (await G.editTemplate(s, fresh.id, { name: "Our Thursday", items: fresh.items.slice(1) }, IL(10, 4, 1)))!;
    assert.ok(ed.editedAt && ed.keptAt, "edited → theirs (and kept)");
    assert.equal(ed.name, "Our Thursday");
  }
  const named = (await G.editTemplate(s, own.id, { name: "  BBQ  " }, IL(10, 4, 2)))!;
  assert.deepEqual([named.name, named.items.length], ["BBQ", 3], "a rename keeps the items");
  assert.equal((await G.editTemplate(s, own.id, { items: [...named.items, named.items[0]] }))!.items.length, 3, "a product once");

  // ---- E2: past trips (newest first) with what wasn't found; save a trip as a template (+ missed, quantities kept or
  // not); save the list; add again merges.
  const t = await T.startTrip(s, "noa", { chain: "Shufersal", branch: "Modiin", now: IL(10, 8, 18) });
  const milkRow = (await s.byId(schema.items, ids.milk))!;
  const coffeeRow = (await s.byId(schema.items, ids.coffee))!;
  await T.addCheck(s, t.id, { action: "check", itemId: milkRow.id, productKey: milkRow.productKey, section: milkRow.section, qty: 2, price: 13.8, at: IL(10, 8, 18, 5) });
  await T.addCheck(s, t.id, { action: "not_found", itemId: coffeeRow.id, productKey: coffeeRow.productKey, section: coffeeRow.section, at: IL(10, 8, 18, 6) });
  await T.finishTrip(s, t.id, { now: IL(10, 8, 18, 30) });
  const past = await G.pastTrips(s);
  assert.equal(past[0].id, t.id, "newest first");
  assert.deepEqual(past[0].items.map((i) => [i.title, i.state, i.price]), [["חלב 3%", "bought", 13.8], ["קפה", "not_found", null]]);
  assert.equal(past.length, 15, "every finished trip");
  const a = (await G.templateFromTrip(s, t.id, "Quick", "noa"))!;
  assert.deepEqual(a.items.map((i) => [i.title, i.qty]), [["חלב 3%", 2]], "bought only, quantities kept");
  const b = (await G.templateFromTrip(s, t.id, "Quick 2", "noa", { missed: true, keepQty: false }))!;
  assert.deepEqual(b.items.map((i) => [i.title, i.qty]), [["חלב 3%", 1], ["קפה", 1]], "+ not found, quantities left at 1");
  const fromList = (await G.templateFromList(s, "Now", "noa"))!;
  assert.equal(fromList.items.length, (await G.supermarketList(s)).filter((i) => i.productKey).length);
  const before2 = (await G.supermarketList(s)).length;
  const again = await G.addMissing(s, past[0].items, "noa");
  assert.equal(again.length, 1, "milk is on the list (stays), coffee added");
  assert.equal((await G.supermarketList(s)).length, before2 + 1);
  assert.equal((await G.supermarketList(s)).find((i) => i.title === "חלב 3%")!.quantity, 5, "the quantity on the list stays");
  console.log("ok E2 edit → theirs, rename, past trips (not found, newest first), trip / list → template, add again merges");
}

pure()
  .then(withDb)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
