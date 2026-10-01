// Straight-edge candidates (Round 8 A2): a receipt's sides are long straight edges even when the paper barely differs
// from the table (white on white). Gradient → thin edges → Hough lines → two near-parallel pairs → quad. The frame
// borders count as lines too, so a receipt cut off by the edge of the photo still closes. Pure (typed arrays only).
import type { Pt } from "./geometry";
import type { Work } from "./paper";

type HLine = { t: number; r: number; v: number; cos: number; sin: number };

/** Hough lines of the work image's luma, strongest first. */
export function houghLines(g: Work, max = 14): HLine[] {
  const { w, h, L } = g;
  // 3×3 box blur twice: text strokes soften, long paper edges stay.
  const blur = (src: Float32Array | Uint8Array) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += src[yy * w + xx];
            n++;
          }
        }
        out[y * w + x] = s / n;
      }
    return out;
  };
  const S = blur(blur(L));
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = S[i - w + 1] + 2 * S[i + 1] + S[i + w + 1] - S[i - w - 1] - 2 * S[i - 1] - S[i + w - 1];
      const gy = S[i + w - 1] + 2 * S[i + w] + S[i + w + 1] - S[i - w - 1] - 2 * S[i - w] - S[i - w + 1];
      mag[i] = Math.hypot(gx, gy);
      dir[i] = Math.atan2(gy, gx);
    }
  const diag = Math.ceil(Math.hypot(w, h));
  const NT = 180;
  const NR = 2 * diag + 1;
  const acc = new Float32Array(NT * NR);
  const cosT = new Float32Array(NT);
  const sinT = new Float32Array(NT);
  for (let t = 0; t < NT; t++) {
    cosT[t] = Math.cos((t * Math.PI) / NT);
    sinT[t] = Math.sin((t * Math.PI) / NT);
  }
  const SPREAD = 5;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < 14) continue;
      // Thin: keep only the maximum across the edge (gradient direction quantised to 4).
      const a = dir[i];
      const q = Math.round(((a < 0 ? a + Math.PI : a) / Math.PI) * 4) % 4;
      const o = q === 0 ? 1 : q === 1 ? w + 1 : q === 2 ? w : w - 1;
      if (m < mag[i - o] || m < mag[i + o]) continue;
      // The line's normal is the gradient direction; vote near it, weighted (capped so text can't dominate).
      let td = Math.round(((a < 0 ? a + Math.PI : a) * NT) / Math.PI) % NT;
      if (td < 0) td += NT;
      const wv = Math.min(m, 80);
      for (let d = -SPREAD; d <= SPREAD; d++) {
        const t = (td + d + NT) % NT;
        const r = Math.round(x * cosT[t] + y * sinT[t]) + diag;
        acc[t * NR + r] += wv;
      }
    }
  const out: HLine[] = [];
  for (let k = 0; k < max; k++) {
    let best = 0;
    let bi = -1;
    for (let i = 0; i < acc.length; i++)
      if (acc[i] > best) {
        best = acc[i];
        bi = i;
      }
    if (bi < 0 || best <= 0) break;
    const t = Math.floor(bi / NR);
    const r = (bi % NR) - diag;
    out.push({ t, r, v: best, cos: cosT[t], sin: sinT[t] });
    // Suppress the neighbourhood (θ wraps around with ρ flipped).
    for (let dt = -6; dt <= 6; dt++) {
      let tt = t + dt;
      let rr = r;
      if (tt < 0) {
        tt += NT;
        rr = -r;
      }
      if (tt >= NT) {
        tt -= NT;
        rr = -r;
      }
      for (let dr = -8; dr <= 8; dr++) {
        const ri = rr + dr + diag;
        if (ri >= 0 && ri < NR) acc[tt * NR + ri] = 0;
      }
    }
  }
  // Ignore lines far weaker than the strongest (noise, texture).
  return out.filter((l) => l.v >= out[0].v * 0.12);
}

const meet = (a: HLine, b: HLine): Pt | null => {
  const d = a.cos * b.sin - b.cos * a.sin;
  if (Math.abs(d) < 1e-6) return null;
  return { x: (a.r * b.sin - b.r * a.sin) / d, y: (b.r * a.cos - a.r * b.cos) / d };
};

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
};

/** Quads from two near-parallel line pairs (frame borders included), as 4 points in work coordinates. */
export function lineCandidates(g: Work): Pt[][] {
  const { w, h } = g;
  const lines = houghLines(g);
  // Frame borders: x = 0, x = w, y = 0, y = h.
  const border: HLine[] = [
    { t: 0, r: 0, v: 0, cos: 1, sin: 0 },
    { t: 0, r: w - 1, v: 0, cos: 1, sin: 0 },
    { t: 90, r: 0, v: 0, cos: 0, sin: 1 },
    { t: 90, r: h - 1, v: 0, cos: 0, sin: 1 },
  ];
  const all = lines.concat(border);
  const minGap = Math.hypot(w, h) * 0.03;
  const pairs: [HLine, HLine][] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a.v === 0 && b.v === 0) continue; // two borders = the whole frame
      if (angleDiff(a.t, b.t) > 22) continue;
      // Distance between the lines (at their mean direction): measured at the frame centre.
      const da = a.cos * (w / 2) + a.sin * (h / 2) - a.r;
      const db = b.cos * (w / 2) + b.sin * (h / 2) - b.r;
      const sameSide = a.cos * b.cos + a.sin * b.sin > 0;
      const gap = Math.abs(sameSide ? da - db : da + db);
      if (gap < minGap) continue;
      pairs.push([a, b]);
    }
  const out: Pt[][] = [];
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i];
      const [c, d] = pairs[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (angleDiff(a.t, c.t) < 50) continue;
      if ([a, b, c, d].filter((l) => l.v === 0).length > 1) continue; // at most one side may be the frame
      const p = [meet(a, c), meet(c, b), meet(b, d), meet(d, a)];
      if (p.some((q) => !q)) continue;
      const q = p as Pt[];
      // Corners may sit a little outside the frame (cut-off receipts), not far.
      if (q.some((pt) => pt.x < -w * 0.15 || pt.x > w * 1.15 || pt.y < -h * 0.15 || pt.y > h * 1.15)) continue;
      out.push(q);
    }
  return out;
}
