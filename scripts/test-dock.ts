// Unit test for src/lib/dock-tab.ts (R18 S2 A1: the dock's fourth tab chooses itself).  npm run test:dock
import assert from "node:assert/strict";
import { dockTab4, noteTabUse, parseTabUse, tabTotals, type TabUse } from "../src/lib/dock-tab";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13, 12);
const day = (back: number) => new Date(NOW - back * DAY).toISOString().slice(0, 10);

// No onboarding answer / supermarket-only answers → always the Supermarket, whatever the use.
const heavyProjects: TabUse = { [day(1)]: { p: 9, s: 0 } };
assert.equal(dockTab4(null, heavyProjects, NOW), "supermarket");
assert.equal(dockTab4([], heavyProjects, NOW), "supermarket");
assert.equal(dockTab4(["super", "home"], heavyProjects, NOW), "supermarket");

// "projects" answered + Projects used more in the last 30 days → Projects.
assert.equal(dockTab4(["proj"], heavyProjects, NOW), "projects");
assert.equal(dockTab4(["proj", "super"], { [day(0)]: { p: 3, s: 2 } }, NOW), "projects");
// Equal or less → the Supermarket (a tie keeps the default).
assert.equal(dockTab4(["proj"], { [day(0)]: { p: 2, s: 2 } }, NOW), "supermarket");
assert.equal(dockTab4(["proj"], { [day(3)]: { p: 1, s: 4 } }, NOW), "supermarket");
// Fresh person who said "projects" but used neither yet → the Supermarket.
assert.equal(dockTab4(["proj"], {}, NOW), "supermarket");

// Only the last 30 days count: old Projects use doesn't keep the tab.
const old: TabUse = { [day(30)]: { p: 50 }, [day(2)]: { s: 1 } };
assert.deepEqual(tabTotals(old, NOW), { p: 0, s: 1 });
assert.equal(dockTab4(["proj"], old, NOW), "supermarket");
assert.deepEqual(tabTotals({ [day(29)]: { p: 1 } }, NOW), { p: 1, s: 0 });

// noteTabUse counts today and drops days older than 30.
let u: TabUse = { [day(40)]: { p: 5 }, [day(1)]: { s: 1 } };
u = noteTabUse(u, "p", NOW);
u = noteTabUse(u, "p", NOW);
u = noteTabUse(u, "s", NOW);
assert.deepEqual(u, { [day(1)]: { s: 1 }, [day(0)]: { p: 2, s: 1 } });

// parseTabUse never throws and drops junk.
assert.deepEqual(parseTabUse(null), {});
assert.deepEqual(parseTabUse("not json"), {});
assert.deepEqual(parseTabUse("[1,2]"), {});
assert.deepEqual(parseTabUse(JSON.stringify({ "2026-10-12": { p: 2, s: "x" }, nope: { p: 1 } })), { "2026-10-12": { p: 2, s: 0 } });

console.log("OK test:dock — tab-4 rule (onboarding × 30-day use), counting, parsing");
