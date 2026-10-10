// Unit test for src/lib/gestures.ts (sheet swipe-down, row swipe decisions).  npx tsx scripts/test-gestures.ts
import assert from "node:assert/strict";
import { pagerOffset, pagerRelease, revealAt, rubberBand, sheetExitMs, sheetRelease, swipeRelease, velocity } from "../src/lib/gestures";

// Sheet: 30 % of the height or a downward fling closes; otherwise springs back.
assert.equal(sheetRelease(119, 400, 0.1), "stay");
assert.equal(sheetRelease(120, 400, 0), "close");
assert.equal(sheetRelease(40, 400, 0.9), "close"); // fling
assert.equal(sheetRelease(8, 400, 2), "stay"); // a tap jitter is not a fling
assert.equal(sheetRelease(-30, 400, -1), "stay"); // dragged up
assert.equal(sheetRelease(60, 400, -0.8), "stay"); // dragged down, then flung back up
// Polish #14: the exit continues at the finger's speed, within 120–260 ms.
assert.equal(sheetExitMs(300, 1.5), 200);
assert.equal(sheetExitMs(300, 5), 120); // a hard fling never snaps out
assert.equal(sheetExitMs(300, 0.2), 260); // a slow release still leaves briskly
assert.equal(sheetExitMs(300, 0), 260);
// Polish #26: a sheet dragged up gives a little, never more than 60 px.
assert.ok(rubberBand(-100) < 0 && rubberBand(-100) > -60 && rubberBand(-1000) > -60.01 && rubberBand(0) === 0);

// Rows: status 2 × 84 px (reveal at 67.2), Delete 92 px (reveal at 36.8), row 360 px.
const base = { statusW: 168, deleteW: 92, rowW: 360 };
assert.equal(revealAt(168), 67.2);
for (const dir of [1, -1] as const) {
  const r = (dx: number, vx: number) => swipeRelease({ ...base, dx: dx * dir, vx: vx * dir, dir });
  // Slow (no fling) — distance decides, same rule both ways.
  assert.equal(r(70, 0.05), "status", `slow past status threshold, dir ${dir}`);
  assert.equal(r(60, 0.05), "closed", `slow below status threshold, dir ${dir}`);
  assert.equal(r(-40, -0.05), "delete", `slow past delete threshold, dir ${dir}`);
  assert.equal(r(-30, -0.05), "closed", `slow below delete threshold, dir ${dir}`);
  assert.equal(r(140, 0), "status", `slow and stopped, dir ${dir}`);
  // Slowly closing a held row: stays open until it's back under the threshold.
  assert.equal(r(100, -0.1), "status");
  assert.equal(r(30, -0.1), "closed");
  // Fast fling: short distance still opens toward the side that is showing; flinging back closes.
  assert.equal(r(25, 0.9), "status", `fling toward status, dir ${dir}`);
  assert.equal(r(-20, -0.9), "delete", `fling toward delete, dir ${dir}`);
  assert.equal(r(120, -0.9), "closed", `fling back from status, dir ${dir}`);
  assert.equal(r(-60, 0.9), "closed", `fling back from delete, dir ${dir}`);
  // Full swipe toward Delete removes, slow or fast.
  assert.equal(r(-190, -0.1), "remove");
  assert.equal(r(-200, -1.5), "remove");
}
// RTL is a mirror: a physical right swipe is the Delete side in Hebrew.
assert.equal(swipeRelease({ ...base, dx: 70, vx: 0, dir: -1 }), "delete");
assert.equal(swipeRelease({ ...base, dx: -70, vx: 0, dir: -1 }), "status");

// Velocity over the last ~100 ms; a finger that stopped before release reads 0.
assert.equal(velocity([{ t: 0, v: 0 }]), 0);
assert.ok(Math.abs(velocity([{ t: 0, v: 0 }, { t: 16, v: 15 }, { t: 32, v: 30 }]) - 30 / 32) < 1e-9);
assert.equal(velocity([{ t: 0, v: 0 }, { t: 50, v: 40 }, { t: 300, v: 40 }]), 0);

// R16 A7: the suggestions pager — 25 % of the width or a fling moves one page; never past the ends; RTL mirrors.
{
  const p = (dx: number, vx: number, dir: 1 | -1, index = 1, count = 3) => pagerRelease({ dx, vx, dir, width: 320, index, count });
  assert.equal(p(-100, 0, 1), 1, "LTR drag left past 25 % = next");
  assert.equal(p(100, 0, 1), -1, "LTR drag right = previous");
  assert.equal(p(-40, 0, 1), 0, "short drag snaps back");
  assert.equal(p(-30, -0.9, 1), 1, "fling left = next");
  assert.equal(p(-10, -0.9, 1), 0, "a tap-sized fling does nothing");
  assert.equal(p(100, 0, -1), 1, "RTL drag right = next");
  assert.equal(p(-100, 0, 1, 2), 0, "no page after the last");
  assert.equal(p(100, 0, 1, 0), 0, "no page before the first");
  assert.equal(pagerOffset(-50, 1, true, true), -50, "follows the finger 1:1");
  assert.ok(Math.abs(pagerOffset(-150, 1, true, false)) < 50, "rubber band at the end");
  assert.ok(Math.abs(pagerOffset(150, -1, true, false)) < 50, "rubber band at the end (RTL)");
  // R17 P7: the suggestions loop — past the last is the first, before the first the last (both directions, RTL too).
  const l = (dx: number, dir: 1 | -1, index: number, count = 3) => pagerRelease({ dx, vx: 0, dir, width: 320, index, count, loop: true });
  assert.equal(l(-100, 1, 2), 1, "loop: LTR next from the last moves (the caller wraps to the first)");
  assert.equal(l(100, 1, 0), -1, "loop: LTR previous from the first moves (→ the last)");
  assert.equal(l(100, -1, 2), 1, "loop: RTL next from the last");
  assert.equal(l(-100, -1, 0), -1, "loop: RTL previous from the first");
  assert.equal(l(-40, 1, 2), 0, "loop: a short drag still snaps back");
  assert.equal(l(-100, 1, 0, 1), 0, "loop: one suggestion — nothing to move to");
}

console.log("OK gestures");
