// Receipt outline detection (Round 8 A2): the paper detector and scanic's classical detector both propose quads; each
// is validated and scored on the same evidence (paper inside, edge strength along the outline), the best one wins.
// Pure apart from scanic (which uses OffscreenCanvas when present), so it runs on the page, in a Worker and in the bench.
import { type Line, type Pt, type Quad, area, fitLine, intersectLines, orderQuad, sidesOnBorder, validQuad } from "./geometry";
import { lineCandidates } from "./lines";
import { type ImageLike, type Work, paperCandidates, prepare } from "./paper";

export type { Pt, Quad, ImageLike, Work };
export { prepare };

export type DetectMode = "live" | "still";
export type DetectOptions = {
  mode: DetectMode;
  /** Also run scanic's classical detector (default true). */
  scanic?: boolean;
  /** Also run the paper detector (default true). */
  paper?: boolean;
  /** Also run the straight-edge (Hough) detector (default true). */
  lines?: boolean;
  /**
   * scanic's ML detector (self-hosted under `/scanic-ml/`): base URL of its assets, or false to leave it out. Stills
   * wait for it (the model loads once, ~3.4 MB); live frames use it only once loaded and only when unsure.
   */
  ml?: string | false;
  /** Collect every candidate with its score (bench). */
  debug?: { q: Pt[]; source: string; score: number; valid: boolean }[];
};
export type Detection = { quad: Quad; score: number; source: "paper" | "lines" | "scanic" | "ml"; edge: number; fill: number; ms: number };

/** Below this the outline is too doubtful to show. */
export const MIN_SCORE = 0.42;
/** Live frames: run scanic / ML only below this score. */
const SCANIC_BELOW = 0.6;

const sample = (a: Uint8Array, w: number, h: number, x: number, y: number) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : a[yi * w + xi];
};

/**
 * How receipt-like a quad is, 0..1: edge support (a clear brightness/whiteness step across the outline), contrast,
 * and fill (the inside is mostly bright paper — text is allowed).
 */
export function scoreQuad(g: Work, q: Quad): { score: number; edge: number; fill: number } {
  const { w, h, L, P } = g;
  const diag = Math.hypot(w, h);
  const d = Math.max(1.5, diag * 0.007);
  const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  let counted = 0;
  let support = 0;
  let whiter = 0;
  const steps: number[] = [];
  const PER_SIDE = 22;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (nx * (mx - c.x) + ny * (my - c.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (let j = 0; j < PER_SIDE; j++) {
      const t = 0.07 + (0.86 * j) / (PER_SIDE - 1);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const li1 = sample(L, w, h, x - nx * d, y - ny * d);
      const li2 = sample(L, w, h, x - nx * 2 * d, y - ny * 2 * d);
      const lo1 = sample(L, w, h, x + nx * d, y + ny * d);
      const lo2 = sample(L, w, h, x + nx * 2 * d, y + ny * 2 * d);
      if (li1 < 0 || li2 < 0 || lo1 < 0 || lo2 < 0) continue; // outside the frame: no evidence either way
      const pi = (sample(P, w, h, x - nx * d, y - ny * d) + sample(P, w, h, x - nx * 2 * d, y - ny * 2 * d)) / 2;
      const po = (sample(P, w, h, x + nx * d, y + ny * d) + sample(P, w, h, x + nx * 2 * d, y + ny * 2 * d)) / 2;
      const step = Math.max(Math.abs((li1 + li2 - lo1 - lo2) / 2), pi - po);
      counted++;
      steps.push(step);
      if (step > 12) support++;
      if (pi - po > 6) whiter++;
    }
  }
  const total = PER_SIDE * 4;
  // Out-of-frame parts are neutral; a quad with almost no visible outline can't score high on edges.
  const seen = counted / total;
  const edge = counted ? (support / counted) * Math.min(1, seen / 0.5) : 0;
  steps.sort((x, y) => x - y);
  const contrast = counted ? Math.min(1, steps[Math.floor(steps.length / 2)] / 50) : 0;
  const white = counted ? whiter / counted : 0;

  // Fill: a grid inside the quad (bilinear in the quad's own coordinates).
  const vals: number[] = [];
  for (let gy = 0; gy < 24; gy++)
    for (let gx = 0; gx < 12; gx++) {
      const u = 0.06 + (0.88 * gx) / 11;
      const v = 0.06 + (0.88 * gy) / 23;
      const x = (1 - v) * ((1 - u) * q[0].x + u * q[1].x) + v * ((1 - u) * q[3].x + u * q[2].x);
      const y = (1 - v) * ((1 - u) * q[0].y + u * q[1].y) + v * ((1 - u) * q[3].y + u * q[2].y);
      const p = sample(P, w, h, x, y);
      if (p >= 0) vals.push(p);
    }
  let fill = 0;
  if (vals.length) {
    const sorted = vals.slice().sort((x, y) => x - y);
    const ref = sorted[Math.floor(sorted.length * 0.8)];
    // Loose: paper with text; tight: one even white (a paper strip merged with pale cloth/table is two-toned).
    const loose = vals.filter((p) => p >= ref - 45).length / vals.length;
    const tight = vals.filter((p) => p >= ref - 22).length / vals.length;
    fill = 0.5 * loose + 0.5 * tight;
    if (ref < 130) fill *= ref / 130; // the inside isn't paper-bright
  }
  // Sides along the frame border carry no evidence (cut-off receipts are fine but must win on their other sides).
  const score = (0.42 * edge + 0.23 * contrast + 0.25 * fill + 0.1 * white) * (1 - 0.08 * sidesOnBorder(q, w, h));
  return { score, edge, fill };
}

/**
 * Snap each side to the strongest luma step within ±3 % of the diagonal along its normal, refit the four lines and
 * re-intersect. Detectors land a few pixels off (ML, Hough bins, closed masks); this puts the outline on the paper edge.
 */
export function polishQuad(g: Work, q: Quad): Quad {
  const { w, h, L } = g;
  const diag = Math.hypot(w, h);
  const R = Math.max(3, Math.round(diag * 0.03));
  const at = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : L[yi * w + xi];
  };
  const lines: (Line | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const pts: Pt[] = [];
    const N = Math.max(8, Math.min(40, Math.round(len / 4)));
    for (let j = 0; j < N; j++) {
      const t = 0.1 + (0.8 * j) / (N - 1);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      let best = 0;
      let bo = 0;
      for (let o = -R; o <= R; o++) {
        const p1 = at(x + nx * (o - 1.5), y + ny * (o - 1.5));
        const p2 = at(x + nx * (o + 1.5), y + ny * (o + 1.5));
        if (p1 < 0 || p2 < 0) continue;
        // Prefer the step nearest the current outline among strong ones.
        const v = Math.abs(p2 - p1) * (1 - Math.abs(o) / (R * 2.5));
        if (v > best) {
          best = v;
          bo = o;
        }
      }
      if (best > 10) pts.push({ x: x + nx * bo, y: y + ny * bo });
    }
    if (pts.length < Math.max(5, N * 0.4)) {
      lines.push(null);
      continue;
    }
    // Drop the worst third of residuals (text, shadow), refit.
    let l = fitLine(pts);
    if (l) {
      const ll = l;
      const kept = pts
        .map((p) => ({ p, r: Math.abs(ll.a * p.x + ll.b * p.y + ll.c) }))
        .sort((u, v) => u.r - v.r)
        .slice(0, Math.ceil(pts.length * 0.67))
        .map((u) => u.p);
      l = fitLine(kept) ?? l;
    }
    lines.push(l);
  }
  const out = q.map((p, i) => {
    const l1 = lines[(i + 3) % 4];
    const l2 = lines[i];
    // A side without a clear edge keeps its original line.
    const fallback = (k: number) => fitLine([q[k], q[(k + 1) % 4]]);
    const p2 = intersectLines(l1 ?? fallback((i + 3) % 4)!, l2 ?? fallback(i)!);
    return p2 && Math.hypot(p2.x - p.x, p2.y - p.y) < R * 2.5 ? p2 : p;
  });
  return out as Quad;
}

const toQuad = (c: { topLeft: Pt; topRight: Pt; bottomRight: Pt; bottomLeft: Pt }, k: number): Pt[] =>
  [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].map((p) => ({ x: p.x * k, y: p.y * k }));

/** Is `ImageData` constructible here (browser main thread / worker)? scanic needs a real one. */
const hasImageData = () => typeof ImageData !== "undefined";

async function scanicQuad(img: ImageLike, mode: DetectMode): Promise<{ topLeft: Pt; topRight: Pt; bottomRight: Pt; bottomLeft: Pt } | null> {
  if (!hasImageData()) return null;
  const { scanDocument } = await import("scanic");
  const data = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const r = await scanDocument(data, {
    mode: "detect",
    maxProcessingDimension: mode === "live" ? 640 : 900,
    enableDetectionCascade: true,
    applyDilation: true,
    dilationKernelSize: 5,
    maxDocumentAspectRatio: 8,
    minDocumentCoverageRatio: 0.04,
  }).catch(() => null);
  return r?.success && r.corners ? r.corners : null;
}

type Corners = { topLeft: Pt; topRight: Pt; bottomRight: Pt; bottomLeft: Pt };
let mlReady: Promise<boolean> | null = null;
let mlLoaded = false;

async function mlRun(data: ImageData, base: string): Promise<Corners | null> {
  const { scanDocument } = await import("scanic");
  const r = await scanDocument(data, { mode: "detect", detector: "ml", ml: { assetBaseUrl: base, minScore: 0.5 } });
  return r.success && r.corners ? r.corners : null;
}

/** The ML quad; `wait: false` returns null until the model has loaded (and starts loading it). */
async function mlQuad(img: ImageLike, base: string, wait: boolean): Promise<Corners | null> {
  if (!hasImageData()) return null;
  const data = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  if (!mlReady)
    mlReady = mlRun(new ImageData(32, 32), base)
      .then(() => (mlLoaded = true))
      .catch(() => false); // offline / assets missing: classical detectors only
  if (!mlLoaded) {
    if (!wait || !(await mlReady)) return null;
  }
  return mlRun(data, base).catch(() => null);
}

/**
 * Find the receipt in an image. Corners come back in the input's pixel coordinates (TL, TR, BR, BL), or null when
 * nothing receipt-like is clear enough.
 */
export async function detectReceipt(img: ImageLike, opts: DetectOptions): Promise<Detection | null> {
  const t0 = performance.now();
  const g = prepare(img, opts.mode === "live" ? 360 : 480);
  const cands: { q: Pt[]; source: Detection["source"] }[] = [];
  if (opts.paper !== false) for (const q of paperCandidates(g)) cands.push({ q, source: "paper" });
  if (opts.lines !== false) for (const q of lineCandidates(g)) cands.push({ q, source: "lines" });
  const top: { d: Detection | null } = { d: null };
  const scored: Detection[] = [];
  const rank = (d: Detection) => d.score + 0.015 * Math.sqrt(area(d.quad) / (g.w * g.h));
  const consider = (list: typeof cands) => {
    for (const c of list) {
      const q = orderQuad(c.q);
      const valid = validQuad(q, g.w, g.h);
      if (!valid) {
        opts.debug?.push({ q: q.map((p) => ({ x: p.x / g.k, y: p.y / g.k })), source: c.source, score: -1, valid });
        continue;
      }
      const s = scoreQuad(g, q);
      opts.debug?.push({ q: q.map((p) => ({ x: p.x / g.k, y: p.y / g.k })), source: c.source, score: s.score, valid });
      scored.push({ quad: q, score: s.score, edge: s.edge, fill: s.fill, source: c.source, ms: 0 });
    }
    // Polish the strongest few onto the paper edge and score again; keep whichever version scores better.
    scored.sort((a, b) => b.score - a.score);
    for (const d of scored.slice(0, 6)) {
      const pq = orderQuad(polishQuad(g, d.quad));
      if (validQuad(pq, g.w, g.h)) {
        const s = scoreQuad(g, pq);
        if (s.score > d.score) Object.assign(d, { quad: pq, score: s.score, edge: s.edge, fill: s.fill });
      }
      // Between near-equal scores prefer the larger quad (a strip inside the receipt scores like the receipt).
      if (!top.d || rank(d) > rank(top.d)) top.d = d;
    }
    scored.length = 0;
  };
  consider(cands);
  // scanic adds little on top of paper + lines (bench) but costs ~35 ms per live frame: live frames ask it only
  // when the others are unsure; stills always do.
  if (opts.scanic !== false && (opts.mode === "still" || !top.d || top.d.score < SCANIC_BELOW)) {
    const c = await scanicQuad(img, opts.mode);
    if (c) consider([{ q: toQuad(c, g.k), source: "scanic" }]);
  }
  if (opts.ml && (opts.mode === "still" || !top.d || top.d.score < SCANIC_BELOW)) {
    const c = await mlQuad(img, opts.ml, opts.mode === "still");
    if (c) consider([{ q: toQuad(c, g.k), source: "ml" }]);
  }
  const best = top.d;
  if (!best || best.score < MIN_SCORE) return null;
  const inv = 1 / g.k;
  best.quad = best.quad.map((p) => ({ x: p.x * inv, y: p.y * inv })) as Quad;
  best.ms = performance.now() - t0;
  return best;
}

/** Sharpness of a work image: variance of a 4-neighbour Laplacian of the luma. Higher = sharper. */
export function sharpnessOf(g: Work): number {
  const { w, h, L } = g;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      sum += v;
      sum2 += v * v;
      n++;
    }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/** Mean luma (0..255) — for the "more light" hint. */
export function brightnessOf(g: Work): number {
  let s = 0;
  for (let i = 0; i < g.L.length; i++) s += g.L[i];
  return g.L.length ? s / g.L.length : 0;
}

/**
 * Snap a dragged corner (index `i` of the quad, work coordinates) onto the paper: the two sides that meet there are
 * refit to the strongest nearby edges (as in polishQuad) and intersected. A lone corner detector would also catch
 * text and barcode corners; the sides carry far more evidence. Null when nothing clear lies within `radius`.
 */
export function snapCorner(g: Work, quad: Pt[], i: number, radius: number): Pt | null {
  const p = polishQuad(g, quad as Quad)[i];
  const d = Math.hypot(p.x - quad[i].x, p.y - quad[i].y);
  return d > 0.5 && d <= radius ? p : null;
}
