// Unit test for R18 S5 F (onboarding v2): parsing saved answers (R17's 7 steps → the 9-step flow, junk dropped, new
// fields optional), the home's size / counts / next shopping day / supermarket share, the diet filter for suggestions
// (lib/grocery/diet.ts) and the starter basket scaled by people.   npm run test:household
import assert from "node:assert/strict";
import { countsFor, freshOnboarding, nextShopDay, parseOnboarding, people, smShareStart, STEPS } from "../src/lib/onboarding";
import { dietAllows, dietConflicts } from "../src/lib/grocery/diet";
import { basketFor } from "../src/lib/grocery/basket";

// ---- parsing: R17 answers keep working, step numbers move to the same question
const r17 = (step: number, more: object = {}) => JSON.stringify({ v: 1, status: "active", step, why: ["super"], stores: [], custom: [], budget: 2500, currency: "ILS", who: "partner", sharedSpaceId: null, notif: null, installed: false, at: 1, ...more });
assert.equal(STEPS, 9);
assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((k) => parseOnboarding(r17(k))!.step), [1, 3, 6, 2, 7, 8, 9], "why · stores · budget · who · install · notifications · done");
const old = parseOnboarding(r17(3))!;
assert.equal(old.s9, true);
assert.equal(old.budget, 2500);
assert.equal(old.who, "partner");
assert.equal(old.adults, undefined, "no counts invented for old answers");
assert.deepEqual(old.days, []);
assert.deepEqual(old.diet, []);
assert.equal(old.freq, null);
assert.equal(old.startDay, 1);
assert.equal(old.smShare, null);
// Saved the S5 way: the step stays.
assert.equal(parseOnboarding(JSON.stringify({ ...freshOnboarding(1), step: 4 }))!.step, 4);
assert.equal(parseOnboarding(JSON.stringify({ ...freshOnboarding(1), step: 40 }))!.step, 9, "clamped");
// Junk dropped, never thrown.
const junk = parseOnboarding(JSON.stringify({ ...freshOnboarding(1), adults: 0, kids: 99, babies: "x", pets: -2, freq: "daily", mode: "car", days: [1, 1, 9, 3, -1, 2.5], diet: ["vegan", "paleo"], startDay: 31, smShare: -5 }))!;
assert.equal(junk.adults, 1);
assert.equal(junk.kids, 12);
assert.equal(junk.babies, undefined);
assert.equal(junk.pets, 0);
assert.equal(junk.freq, null);
assert.equal(junk.mode, null);
assert.deepEqual(junk.days, [1, 3]);
assert.deepEqual(junk.diet, ["vegan"]);
assert.equal(junk.startDay, 28);
assert.equal(junk.smShare, 0);
assert.equal(parseOnboarding("{nope"), null);
assert.equal(parseOnboarding(JSON.stringify({ v: 2 })), null);
assert.equal(parseOnboarding(null), null);

// ---- the home
assert.equal(people({ who: "family" }), 4);
assert.equal(people({ who: "partner" }), 2);
assert.equal(people({ who: null }), 1);
assert.equal(people({ who: "family", adults: 2, kids: 3, babies: 1 }), 6, "counts win over who");
assert.deepEqual(countsFor("family"), { adults: 2, kids: 2 });
assert.deepEqual(countsFor("me"), { adults: 1, kids: 0 });
assert.ok(smShareStart(1) < smShareStart(2) && smShareStart(2) < smShareStart(4) && smShareStart(4) < smShareStart(6), "a bigger home starts with a bigger supermarket share");
assert.equal(nextShopDay([2, 5], 3), 5);
assert.equal(nextShopDay([2, 5], 6), 2, "wraps to next week");
assert.equal(nextShopDay([4], 4), 4, "today counts");
assert.equal(nextShopDay([], 1), null);

// ---- the diet filter: suggestions never propose what goes against the home's choices
assert.deepEqual(dietConflicts("chicken-breast", ["vegan"]), ["vegan"]);
assert.deepEqual(dietConflicts("milk", ["vegan", "vegetarian"]), ["vegan"], "milk is fine for vegetarians");
assert.deepEqual(dietConflicts("salmon", ["vegetarian"]), ["vegetarian"]);
assert.deepEqual(dietConflicts("eggs", ["vegan"]), ["vegan"]);
assert.deepEqual(dietConflicts("honey", ["vegan"]), ["vegan"]);
assert.deepEqual(dietConflicts("pasta", ["gluten"]), ["gluten"]);
assert.deepEqual(dietConflicts("yogurt", ["lactose"]), ["lactose"]);
assert.deepEqual(dietConflicts("butter", ["lactose"]), [], "butter is near lactose-free");
assert.deepEqual(dietConflicts("peanut-butter", ["nuts"]), ["nuts"]);
assert.deepEqual(dietConflicts("tomatoes", ["vegan", "gluten", "lactose", "nuts"]), []);
assert.equal(dietAllows("ground-beef", ["vegetarian"]), false);
assert.equal(dietAllows("ground-beef", ["kosher", "organic"]), true, "kosher / organic are noted only — nothing to filter on");
assert.equal(dietAllows("ground-beef", []), true);
assert.equal(dietAllows("ground-beef", undefined), true);
assert.equal(dietAllows("some-unknown-thing", ["vegan"]), true, "unknown keys pass");

// ---- the starter basket follows the home's size
const qty = (b: ReturnType<typeof basketFor>, k: string) => b.find((x) => x.productKey === k)?.qty ?? 0;
const two = basketFor({ people: 2 });
const six = basketFor({ people: 6 });
const milk = two.find((x) => x.qty > 0 && x.amount == null)!.productKey;
assert.ok(qty(six, milk) >= qty(two, milk), "six people → at least as much as two");
assert.ok(six.reduce((a, x) => a + x.qty, 0) > two.reduce((a, x) => a + x.qty, 0), "six people → more in total");
assert.ok(!basketFor({ people: 2 }).some((x) => /diaper|formula/.test(x.productKey)), "no baby items without babies");

console.log("OK household");
