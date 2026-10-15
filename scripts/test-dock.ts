// Unit test for src/lib/dock.ts (R18 S3 A1: one dock for everyone — Home · Products · + · Supermarket · Insights; Projects
// is a segment of Products and lights Products).  npm run test:dock
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DOCK_ORDER, dockOf } from "../src/lib/dock";
import { press, LONG_MS } from "../src/lib/press";

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

// R18 S4 B1: tap vs long-press on synthetic pointer timings — every tap is the camera, only a real hold opens the menu.
{
  type E = Parameters<typeof press>[1];
  const run = (events: E[]) => {
    let st: Parameters<typeof press>[0] = null;
    const out: string[] = [];
    for (const e of events) {
      const [n, o] = press(st, e);
      st = n;
      if (o) out.push(o);
    }
    return out.join(",");
  };
  const down = (at = 0, x = 100, y = 100): E => ({ type: "down", id: 1, x, y, at });
  const up = (at: number): E => ({ type: "up", id: 1, at });
  const mv = (x: number, y: number): E => ({ type: "move", id: 1, x, y });
  const timer = (at: number): E => ({ type: "timer", at });
  assert.equal(run([down(), up(80)]), "tap", "fast tap");
  assert.equal(run([down(), up(380)]), "tap", "slow tap (under 450 ms)");
  assert.equal(run([down(), mv(104, 97), mv(98, 106), up(200)]), "tap", "tap with jitter ≤ 10 px");
  assert.equal(run([down(), mv(115, 100), up(200)]), "", "a slide is neither");
  assert.equal(run([down(), timer(LONG_MS), up(700)]), "long", "long-press: the menu, and the release is not a tap");
  assert.equal(run([down(), mv(104, 104), timer(LONG_MS), mv(130, 100), up(900)]), "long", "moving after the hold fired keeps it");
  assert.equal(run([down(), mv(120, 100), timer(LONG_MS), up(900)]), "", "moved before the hold: nothing");
  assert.equal(run([down(), up(520)]), "long", "a late timer: a release past 450 ms is still a hold, never a tap");
  assert.equal(run([down(), timer(300), up(320)]), "tap", "an early timer tick does nothing");
  assert.equal(run([down(), { type: "down", id: 2, x: 10, y: 10, at: 50 }, up(100)]), "", "a second finger cancels");
  assert.equal(run([down(), { type: "cancel" }, up(100)]), "", "pointercancel (the browser took the gesture)");
  assert.equal(run([down(), up(80), down(200), up(260)]), "tap,tap", "two quick taps are two taps");
  const shell = readFileSync("src/components/app/phone-shell.tsx", "utf8");
  assert.ok(/onClick=\{press\.onClick\}/.test(shell) && !/press\.fired\(\)/.test(shell), "the dock + decides on pointer events, not on click");
  console.log("OK test:dock — B1 press timings: fast / slow / jitter taps, long-press, slide, late timer, second finger, cancel");
}
