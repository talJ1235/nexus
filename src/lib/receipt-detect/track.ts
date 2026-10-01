// Live-camera logic for the receipt outline (Round 8 A3), pure so it can be unit-tested: smooth the detected quad
// and only jump to a different one when it is clearly better (hysteresis), measure how long it has held steady,
// judge sharpness relative to the session, and pick a guidance hint.
import { type Pt, type Quad, area } from "./geometry";

export type LiveFrame = {
  quad: Quad | null;
  score: number;
  /** Edge support of the found quad (0..1): low = little contrast between paper and surface. */
  edge: number;
  sharp: number;
  light: number;
  w: number;
  h: number;
  t: number;
};

const maxMove = (a: Pt[], b: Pt[]) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

/** `q` rotated so its corners line up with `ref` (detectors may start the corner order elsewhere on a square-ish quad). */
export function align(q: Quad, ref: Quad): Quad {
  let best = q;
  let bestD = Infinity;
  for (let s = 0; s < 4; s++) {
    const r = [0, 1, 2, 3].map((i) => q[(i + s) % 4]) as Quad;
    const d = r.reduce((a, p, i) => a + Math.hypot(p.x - ref[i].x, p.y - ref[i].y), 0);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export const STEADY_MS = 700;
const SMOOTH = 0.5; // weight of the new detection
const NEAR = 0.08; // ≤ 8 % of the diagonal: same quad, smooth into it
const STILL = 0.02; // ≤ 2 % between frames: holding steady
const LOSE_AFTER = 3; // missed frames before the outline disappears
const SWITCH_AFTER = 3; // frames a different quad must persist to take over

export class QuadTracker {
  shown: Quad | null = null;
  score = 0;
  private misses = 0;
  private cand: { quad: Quad; n: number } | null = null;
  private last: Quad | null = null;
  private steadySince = 0;
  private sharpHist: { t: number; v: number }[] = [];

  reset() {
    this.shown = null;
    this.score = 0;
    this.misses = 0;
    this.cand = null;
    this.last = null;
    this.steadySince = 0;
    this.sharpHist = [];
  }

  /** Feed one detection; returns the quad to show (smoothed) or null. */
  update(f: LiveFrame): Quad | null {
    const diag = Math.hypot(f.w, f.h);
    this.sharpHist = this.sharpHist.filter((s) => f.t - s.t <= 2000);
    this.sharpHist.push({ t: f.t, v: f.sharp });
    if (!f.quad) {
      this.last = null;
      this.steadySince = 0;
      if (++this.misses >= LOSE_AFTER) {
        this.shown = null;
        this.score = 0;
        this.cand = null;
      }
      return this.shown;
    }
    this.misses = 0;
    const q = this.shown ? align(f.quad, this.shown) : f.quad;
    // Steadiness: raw detections barely moving frame to frame.
    if (this.last && maxMove(align(q, this.last), this.last) / diag < STILL) {
      if (!this.steadySince) this.steadySince = f.t;
    } else this.steadySince = f.t;
    this.last = q;

    if (!this.shown) {
      this.shown = q;
      this.score = f.score;
      return this.shown;
    }
    if (maxMove(q, this.shown) / diag <= NEAR) {
      this.shown = this.shown.map((p, i) => ({ x: p.x + (q[i].x - p.x) * SMOOTH, y: p.y + (q[i].y - p.y) * SMOOTH })) as Quad;
      this.score = this.score * 0.7 + f.score * 0.3;
      this.cand = null;
      return this.shown;
    }
    // A different quad: take it at once when clearly better, else only when it persists.
    if (f.score > this.score + 0.08) return this.take(q, f.score);
    if (this.cand && maxMove(align(q, this.cand.quad), this.cand.quad) / diag <= NEAR) {
      if (++this.cand.n >= SWITCH_AFTER) return this.take(q, f.score);
    } else this.cand = { quad: q, n: 1 };
    this.score *= 0.97;
    return this.shown;
  }

  private take(q: Quad, score: number) {
    this.shown = q;
    this.score = score;
    this.cand = null;
    this.steadySince = 0;
    return q;
  }

  /** 0..1: how far into the steady hold before an automatic capture. */
  steadiness(now: number): number {
    if (!this.shown || !this.steadySince) return 0;
    return Math.min(1, (now - this.steadySince) / STEADY_MS);
  }

  /** Sharp enough: at least 70 % of the sharpest frame of the last 2 s (blur is relative to the scene and phone). */
  sharpEnough(v: number): boolean {
    const best = Math.max(0, ...this.sharpHist.map((s) => s.v));
    return best > 0 && v >= best * 0.7;
  }
}

export type Guide = "light" | "find" | "darker" | "frame" | "closer" | "steady";

/** What to tell the user, from the latest frame and the shown quad. */
export function guidance(f: LiveFrame | null, shown: Quad | null): Guide {
  if (!f) return "find";
  if (f.light < 55) return "light";
  if (!shown) return f.light > 205 ? "darker" : "find";
  const m = Math.max(f.w, f.h) * 0.015;
  if (shown.some((p) => p.x <= m || p.y <= m || p.x >= f.w - m || p.y >= f.h - m)) return "frame";
  if (area(shown) / (f.w * f.h) < 0.1) return "closer";
  if (f.quad && f.edge < 0.45) return "darker";
  return "steady";
}
