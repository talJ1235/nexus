// Unit test for src/lib/dock.ts (R18 S3 A1: one dock for everyone — Home · Products · + · Supermarket · Insights; Projects
// is a segment of Products and lights Products).  npm run test:dock
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DOCK_ORDER, dockOf } from "../src/lib/dock";

assert.deepEqual([...DOCK_ORDER], ["home", "shopping", "supermarket", "spending"], "the same four tabs for everyone");
assert.ok(!(DOCK_ORDER as readonly string[]).includes("projects"), "Projects is never a dock tab");

const lights: [string, string | null][] = [
  ["home", "home"],
  ["to_buy", "shopping"],
  ["ordered", "shopping"],
  ["projects", "shopping"],
  ["collection", "shopping"],
  ["supermarket", "supermarket"],
  ["spending", "spending"],
  ["history", "spending"],
  ["orders", "spending"],
  ["store", null],
];
for (const [view, tab] of lights) assert.equal(dockOf(view), tab, `${view} lights ${tab}`);

// The per-device choice is gone for good: no module, no tab-use counting, no tab4 in the store or the shell.
assert.ok(!existsSync("src/lib/dock-tab.ts"), "lib/dock-tab.ts removed");
for (const f of ["src/components/app/store.tsx", "src/components/app/phone-shell.tsx", "src/components/app/nexus-app.tsx"]) {
  const src = readFileSync(f, "utf8");
  assert.ok(!/\btab4\b|tabUse|dockTab4/.test(src), `${f}: no tab4 / tab-use counting`);
}

console.log("OK test:dock — one dock (Home · Products · + · Supermarket · Insights), Projects lights Products, no per-device choice");
