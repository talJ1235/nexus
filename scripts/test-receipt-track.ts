// Unit test for src/lib/receipt-detect/track.ts (live receipt outline).  npx tsx scripts/test-receipt-track.ts
import assert from "node:assert/strict";
import type { Quad } from "../src/lib/receipt-detect/geometry";
import { type LiveFrame, QuadTracker, align, guidance } from "../src/lib/receipt-detect/track";

const W = 480;
const H = 640;
const quad = (x: number, y: number, w = 160, h = 420): Quad => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const frame = (q: Quad | null, t: number, p: Partial<LiveFrame> = {}): LiveFrame => ({ quad: q, score: 0.8, edge: 0.9, sharp: 100, light: 120, w: W, h: H, t, ...p });

// First detection shows at once; a nearby one is smoothed halfway.
let tr = new QuadTracker();
assert.deepEqual(tr.update(frame(quad(100, 100), 0)), quad(100, 100));
const s = tr.update(frame(quad(110, 100), 100))!;
assert.equal(s[0].x, 105);

// Hysteresis: a far, not-better quad needs 3 frames in a row to take over.
tr = new QuadTracker();
tr.update(frame(quad(40, 60), 0));
for (let i = 1; i <= 2; i++) assert.equal(tr.update(frame(quad(280, 160), i * 100))![0].x, 40, `frame ${i} keeps the shown quad`);
assert.equal(tr.update(frame(quad(280, 160), 300))![0].x, 280);
// …but a clearly better one wins immediately.
tr = new QuadTracker();
tr.update(frame(quad(40, 60), 0, { score: 0.5 }));
assert.equal(tr.update(frame(quad(280, 160), 100, { score: 0.8 }))![0].x, 280);

// Lost after 3 missed frames, not before.
tr = new QuadTracker();
tr.update(frame(quad(100, 100), 0));
assert.ok(tr.update(frame(null, 100)));
assert.ok(tr.update(frame(null, 200)));
assert.equal(tr.update(frame(null, 300)), null);

// Steady: 0.7 s without moving → 1; a move resets.
tr = new QuadTracker();
for (let t = 0; t <= 400; t += 100) tr.update(frame(quad(100, 100), t));
assert.ok(tr.steadiness(400) < 1);
for (let t = 500; t <= 800; t += 100) tr.update(frame(quad(100, 100), t));
assert.equal(tr.steadiness(800), 1);
tr.update(frame(quad(160, 100), 900));
assert.equal(tr.steadiness(900), 0);

// Sharp enough = ≥ 70 % of the best of the last 2 s (relative, not a fixed number).
tr = new QuadTracker();
tr.update(frame(quad(100, 100), 0, { sharp: 400 }));
tr.update(frame(quad(100, 100), 100, { sharp: 200 }));
assert.equal(tr.sharpEnough(200), false);
assert.equal(tr.sharpEnough(300), true);
tr.update(frame(quad(100, 100), 2500, { sharp: 50 })); // the 400 frame is older than 2 s now
assert.equal(tr.sharpEnough(50), true);

// Corner order is aligned to the shown quad.
const q = quad(100, 100);
assert.deepEqual(align([q[2], q[3], q[0], q[1]], q), q);

// Guidance.
assert.equal(guidance(null, null), "find");
assert.equal(guidance(frame(null, 0, { light: 30 }), null), "light");
assert.equal(guidance(frame(null, 0, { light: 230 }), null), "darker");
assert.equal(guidance(frame(quad(0, 100), 0), quad(0, 100)), "frame");
assert.equal(guidance(frame(quad(200, 200, 60, 160), 0), quad(200, 200, 60, 160)), "closer");
assert.equal(guidance(frame(quad(100, 100), 0, { edge: 0.3 }), quad(100, 100)), "darker");
assert.equal(guidance(frame(quad(100, 100), 0), quad(100, 100)), "steady");

console.log("OK receipt track");
