/**
 * Release decisions for the phone gestures (Round 12). Pure functions so they can be unit-tested
 * (`npx tsx scripts/test-gestures.ts`); the components only feed them distances and velocities.
 */

/** A fling: release speed in px/ms (≈ 500 px/s). Below it only the distance decides. */
export const FLING = 0.5;

/**
 * Bottom sheet released after a downward drag: close when dragged past 30 % of its height, or flung down
 * (a short flick still counts once it moved a little); otherwise it springs back.
 */
export function sheetRelease(dy: number, height: number, vy: number): "close" | "stay" {
  if (dy <= 0) return "stay";
  if (dy >= height * 0.3) return "close";
  return vy >= FLING && dy >= 16 ? "close" : "stay";
}

/**
 * Polish #14: how long a released sheet takes to leave — the rest of the way at the finger's own speed (velocity
 * handoff), kept within 120–260 ms (a slow release still leaves briskly; a hard fling never snaps out in 1 frame).
 */
export function sheetExitMs(remaining: number, vy: number): number {
  const v = Math.abs(vy);
  return Math.round(Math.min(260, Math.max(120, v > 0 ? Math.max(0, remaining) / v : 260)));
}

/** Share of an action group's width a row must be dragged to reveal it (both directions use the same rule). */
export const REVEAL_SHARE = 0.4;
/** Distance (px) at which a side's actions are revealed — the haptic tick fires here too. */
export const revealAt = (actionsWidth: number) => actionsWidth * REVEAL_SHARE;

export type SwipeResult = "closed" | "status" | "delete" | "remove";

/**
 * List row released after a horizontal drag. `dx`/`vx` are physical (px, px/ms; + = right), `dir` is 1 for LTR and
 * −1 for RTL: status blocks sit toward the inline end, Delete toward the inline start. Distance decides — past
 * `revealAt(width)` the side snaps open and stays, below it the row closes — and a fling decides when it is fast:
 * toward the side that is showing opens it, back toward the middle closes. Past half the row's width = full delete.
 */
export function swipeRelease({ dx, vx, dir, statusW, deleteW, rowW }: { dx: number; vx: number; dir: 1 | -1; statusW: number; deleteW: number; rowW: number }): SwipeResult {
  const x = dx * dir;
  const v = vx * dir;
  if (x <= -rowW * 0.5) return "remove";
  if (Math.abs(v) >= FLING) {
    if (v > 0) return x > 0 ? "status" : "closed";
    return x < 0 ? "delete" : "closed";
  }
  if (x >= revealAt(statusW)) return "status";
  if (x <= -revealAt(deleteW)) return "delete";
  return "closed";
}

/** Velocity (px/ms) from recent samples, over the last ~100 ms of the gesture. */
export function velocity(samples: { t: number; v: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last.t - s.t <= 100) {
    first = s;
    break;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.v - first.v) / dt : 0;
}

/** Axis lock for horizontal pagers (R16 A7): undecided until the finger moved this far (px). */
export const AXIS_LOCK = 8;

/**
 * Pager rubber band: past either end the content follows the finger at a falling rate (eases toward 60 px). `dx` is physical px; `canPrev`/`canNext` are logical (RTL-aware via `dir`).
 */
export function pagerOffset(dx: number, dir: 1 | -1, canPrev: boolean, canNext: boolean): number {
  const toNext = dx * dir < 0;
  if ((toNext && canNext) || (!toNext && canPrev)) return dx;
  return Math.sign(dx) * 60 * (1 - Math.exp(-Math.abs(dx) / 150));
}

/**
 * Pager released after a horizontal drag: −1 = previous, 1 = next, 0 = snap back. Past 25 % of the width, or a fling,
 * moves one page (in reading order: LTR drags left for next, RTL drags right). No page past either end.
 */
export function pagerRelease({ dx, vx, dir, width, index, count }: { dx: number; vx: number; dir: 1 | -1; width: number; index: number; count: number }): -1 | 0 | 1 {
  const x = -dx * dir; // + = toward next
  const v = -vx * dir;
  let step: -1 | 0 | 1 = 0;
  if (Math.abs(v) >= FLING && Math.abs(dx) >= 16) step = v > 0 ? 1 : -1;
  else if (Math.abs(x) >= width * 0.25) step = x > 0 ? 1 : -1;
  if (index + step < 0 || index + step >= count) return 0;
  return step;
}
