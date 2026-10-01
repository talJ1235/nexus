// "Paper" detector made for receipts (Round 8 A2): receipts are bright, low-saturation regions. Several thresholds on
// a paper-likelihood channel → morphology close → connected components (holes filled) → convex hull → 4-point fit,
// refined by fitting a line to each side. Pure (typed arrays only), so it runs in a Worker and in the bench.
import { type Pt, convexHull, fitLine, intersectLines, maxAreaQuad, segmentDistance, dist } from "./geometry";

export type ImageLike = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** A small working copy: luma, chroma (max − min) and paper likelihood (bright and neutral → high). */
export type Work = { w: number; h: number; L: Uint8Array; S: Uint8Array; P: Uint8Array; k: number };

/** Box-downscale to a long side of `maxDim` (never up) and compute the channels. `k` = work px per input px. */
export function prepare(img: ImageLike, maxDim: number): Work {
  const { width: W, height: H, data } = img;
  const k = Math.min(1, maxDim / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const L = new Uint8Array(w * h);
  const S = new Uint8Array(w * h);
  const P = new Uint8Array(w * h);
  const sx = W / w;
  const sy = H / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      // Sample at most a 3×3 grid of the source block: plenty for a smooth downscale, and fast on big stills.
      const stepY = Math.max(1, Math.floor((y1 - y0) / 3));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 3));
      for (let yy = y0; yy < y1; yy += stepY)
        for (let xx = x0; xx < x1; xx += stepX) {
          const i = (yy * W + xx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      r /= n;
      g /= n;
      b /= n;
      const o = y * w + x;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const s = Math.max(r, g, b) - Math.min(r, g, b);
      L[o] = l;
      S[o] = s;
      P[o] = Math.max(0, Math.min(255, l - 1.6 * s));
    }
  }
  return { w, h, L, S, P, k };
}

function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) {
      best = v;
      t = i;
    }
  }
  return t;
}

function percentile(hist: Uint32Array, total: number, q: number): number {
  let acc = 0;
  for (let i = 0; i < 256; i++) if ((acc += hist[i]) >= total * q) return i;
  return 255;
}

/** Separable max (dilate) or min (erode) with a (2r+1)² square. */
function morph(src: Uint8Array, w: number, h: number, r: number, max: boolean): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pick = max ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 1 - pick;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        // Outside the frame counts as background for dilate and as foreground for erode (edges don't eat in).
        const s = xx < 0 || xx >= w ? 1 - pick : src[row + xx];
        if (s === pick) {
          v = pick;
          break;
        }
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      let v = 1 - pick;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        const s = yy < 0 || yy >= h ? 1 - pick : tmp[yy * w + x];
        if (s === pick) {
          v = pick;
          break;
        }
      }
      out[y * w + x] = v;
    }
  return out;
}

type Blob = { px: Int32Array; n: number; x0: number; y0: number; x1: number; y1: number };

/** 4-connected components of a binary mask, largest first, ignoring those under `minArea` pixels. */
function components(mask: Uint8Array, w: number, h: number, minArea: number, limit = 4): Blob[] {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const px = new Int32Array(w * h);
  const out: Blob[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0;
    let n = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (sp) {
      const p = stack[--sp];
      px[n++] = p;
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack[sp++] = p - 1;
      }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack[sp++] = p + 1;
      }
      if (y > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack[sp++] = p - w;
      }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack[sp++] = p + w;
      }
    }
    if (n >= minArea) out.push({ px: px.slice(0, n), n, x0, y0, x1, y1 });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, limit);
}

/** The component as a filled bbox-local mask (holes from text, logos and barcodes filled). */
function filled(b: Blob, w: number): { m: Uint8Array; bw: number; bh: number } {
  const bw = b.x1 - b.x0 + 3;
  const bh = b.y1 - b.y0 + 3;
  const m = new Uint8Array(bw * bh); // 1 = component, 2 = reached from outside
  for (let i = 0; i < b.n; i++) {
    const p = b.px[i];
    const x = p % w;
    const y = (p - x) / w;
    m[(y - b.y0 + 1) * bw + (x - b.x0 + 1)] = 1;
  }
  const stack = new Int32Array(bw * bh);
  let sp = 0;
  stack[sp++] = 0;
  m[0] = 2;
  while (sp) {
    const p = stack[--sp];
    const x = p % bw;
    const y = (p - x) / bw;
    const nb = [x > 0 ? p - 1 : -1, x < bw - 1 ? p + 1 : -1, y > 0 ? p - bw : -1, y < bh - 1 ? p + bw : -1];
    for (const q of nb)
      if (q >= 0 && m[q] === 0) {
        m[q] = 2;
        stack[sp++] = q;
      }
  }
  for (let i = 0; i < m.length; i++) m[i] = m[i] === 2 ? 0 : 1;
  return { m, bw, bh };
}

/** Candidate quads (4 unordered points, work coordinates) for paper-like regions. */
export function paperCandidates(g: Work): Pt[][] {
  const { w, h, P } = g;
  const N = w * h;
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) hist[P[i]]++;
  const t0 = otsu(hist, N);
  const top = percentile(hist, N, 0.98);
  const levels = new Set([t0, Math.round(t0 + (top - t0) * 0.35), Math.round(t0 + (top - t0) * 0.65), Math.max(0, t0 - 20)]);
  const r = Math.max(1, Math.round(Math.max(w, h) / 180));
  const out: Pt[][] = [];
  const masks: Uint8Array[] = [];
  for (const t of levels) {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) m[i] = P[i] > t ? 1 : 0;
    masks.push(m);
  }
  masks.push(adaptiveMask(P, w, h));
  for (const raw of masks) {
    const m = morph(morph(raw, w, h, r, true), w, h, r, false);
    for (const b of components(m, w, h, N * 0.015)) {
      const q = blobQuad(b, w, h);
      if (q) out.push(q);
    }
  }
  return out;
}

/** Locally brighter-than-surroundings paper (handles shadow gradients and near-white tables). */
function adaptiveMask(P: Uint8Array, w: number, h: number): Uint8Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += P[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(4, Math.round(Math.max(w, h) / 6));
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + r + 1);
      const s = I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa];
      const mean = s / ((yb - ya) * (xb - xa));
      m[y * w + x] = P[y * w + x] > mean + 10 && P[y * w + x] > 90 ? 1 : 0;
    }
  }
  return m;
}

/** Quad for one blob, or null when it is the background (hugs the frame) or too thin. */
function blobQuad(b: Blob, w: number, h: number): Pt[] | null {
  const { m, bw, bh } = filled(b, w);
  const pts: Pt[] = [];
  let touch = 0;
  const sides = new Set<number>();
  const add = (x: number, y: number) => {
    const X = x + b.x0 - 1;
    const Y = y + b.y0 - 1;
    pts.push({ x: X + 0.5, y: Y + 0.5 });
    const t = X <= 0 ? 0 : X >= w - 1 ? 1 : Y <= 0 ? 2 : Y >= h - 1 ? 3 : -1;
    if (t >= 0) {
      touch++;
      sides.add(t);
    }
  };
  for (let y = 0; y < bh; y++) {
    let a = -1;
    let z = -1;
    for (let x = 0; x < bw; x++)
      if (m[y * bw + x]) {
        if (a < 0) a = x;
        z = x;
      }
    if (a >= 0) {
      add(a, y);
      add(z, y);
    }
  }
  for (let x = 0; x < bw; x++) {
    let a = -1;
    let z = -1;
    for (let y = 0; y < bh; y++)
      if (m[y * bw + x]) {
        if (a < 0) a = y;
        z = y;
      }
    if (a >= 0) {
      add(x, a);
      add(x, z);
    }
  }
  // The table / background: hugs most of the frame border, or touches three or four sides.
  if (touch / pts.length > 0.4 || sides.size >= 3) return null;
  const hull = convexHull(pts);
  const q = maxAreaQuad(hull);
  if (!q) return null;
  return refine(q, pts, Math.hypot(w, h));
}

/** Fit a line to the outline points along each side (ignoring the rounded/curled corner ends), re-intersect. */
function refine(q: Pt[], pts: Pt[], diag: number): Pt[] {
  const tol = diag * 0.025;
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const near = pts.filter((p) => {
      const s = segmentDistance(p, a, b);
      return s.d < tol && s.t > 0.12 && s.t < 0.88;
    });
    if (near.length < 6) return q;
    const l = fitLine(near);
    if (!l) return q;
    lines.push(l);
  }
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersectLines(lines[(i + 3) % 4], lines[i]);
    if (!p || dist(p, q[i]) > diag * 0.08) return q;
    out.push(p);
  }
  return out;
}
