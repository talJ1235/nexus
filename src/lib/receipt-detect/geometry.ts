// Plane geometry for receipt quads (pure, no DOM): hulls, 4-point fits, validation and polygon IoU.
export type Pt = { x: number; y: number };
/** Corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Signed shoelace area (positive = clockwise in image coordinates, y down). */
export function signedArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
export const area = (p: Pt[]) => Math.abs(signedArea(p));

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (monotone chain), clockwise in image coordinates. */
export function convexHull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** The largest-area quadrilateral whose corners are hull vertices (hull thinned to ≤ 72 points). */
export function maxAreaQuad(hull: Pt[]): Pt[] | null {
  let h = hull;
  if (h.length < 4) return null;
  if (h.length > 72) {
    const step = h.length / 72;
    h = Array.from({ length: 72 }, (_, i) => h[Math.floor(i * step)]);
  }
  const n = h.length;
  let best = -1;
  let out: Pt[] | null = null;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      // Diagonal i–j; the best third and fourth corners on either side.
      let a1 = -1;
      let k1 = -1;
      for (let k = i + 1; k < j; k++) {
        const a = Math.abs(cross(h[i], h[j], h[k]));
        if (a > a1) {
          a1 = a;
          k1 = k;
        }
      }
      let a2 = -1;
      let k2 = -1;
      for (let k = j + 1; k < n + i; k++) {
        const kk = k % n;
        const a = Math.abs(cross(h[i], h[j], h[kk]));
        if (a > a2) {
          a2 = a;
          k2 = kk;
        }
      }
      if (k1 < 0 || k2 < 0) continue;
      if (a1 + a2 > best) {
        best = a1 + a2;
        out = [h[i], h[k1], h[j], h[k2]];
      }
    }
  return out;
}

/**
 * Order 4 points as TL, TR, BR, BL. A clearly elongated quad whose long axis is closer to vertical (a receipt held
 * upright, tilted up to ~45°) starts at the upper short side, so the crop comes out upright; otherwise the corner
 * nearest the image's top-left starts.
 */
export function orderQuad(pts: Pt[]): Quad {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  // Clockwise on screen (y down) = increasing atan2.
  const cw = pts.slice().sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  let start = 0;
  const sides = [0, 1, 2, 3].map((i) => dist(cw[i], cw[(i + 1) % 4]));
  const short = (sides[0] + sides[2]) / 2 < (sides[1] + sides[3]) / 2 ? 0 : 1; // sides `short` and `short + 2`
  const long = (sides[1 - short] + sides[3 - short]) / 2;
  const shortLen = (sides[short] + sides[short + 2]) / 2;
  const mid = (i: number) => ({ x: (cw[i].x + cw[(i + 1) % 4].x) / 2, y: (cw[i].y + cw[(i + 1) % 4].y) / 2 });
  const m1 = mid(short);
  const m2 = mid(short + 2);
  const vertical = Math.abs(m1.y - m2.y) > Math.abs(m1.x - m2.x);
  if (long > shortLen * 1.3 && vertical) start = m1.y < m2.y ? short : short + 2;
  else {
    let bestS = Infinity;
    for (let i = 0; i < 4; i++) {
      const s = cw[i].x + cw[i].y;
      if (s < bestS) {
        bestS = s;
        start = i;
      }
    }
  }
  return [0, 1, 2, 3].map((i) => cw[(start + i) % 4]) as Quad;
}

/** Interior angles in degrees. */
export function angles(q: Pt[]): number[] {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4];
    const b = q[(i + 1) % 4];
    const v1 = { x: a.x - p.x, y: a.y - p.y };
    const v2 = { x: b.x - p.x, y: b.y - p.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

export function isConvex(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const c = cross(q[i], q[(i + 1) % q.length], q[(i + 2) % q.length]);
    if (Math.abs(c) < 1e-9) return false;
    const s = Math.sign(c);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Long side / short side (average of opposite sides). */
export function aspect(q: Quad): number {
  const a = (dist(q[0], q[1]) + dist(q[2], q[3])) / 2;
  const b = (dist(q[1], q[2]) + dist(q[3], q[0])) / 2;
  return Math.max(a, b) / Math.max(1e-6, Math.min(a, b));
}

/**
 * Receipt plausibility: convex, angles 50°–130°, 2.5–95 % of the frame (a long receipt photographed whole from a
 * distance covers only ~3 %), aspect ≤ 8 and not a sliver.
 */
export function validQuad(q: Quad, w: number, h: number): boolean {
  if (!isConvex(q)) return false;
  if (angles(q).some((a) => a < 50 || a > 130)) return false;
  const frac = area(q) / (w * h);
  if (frac < 0.025 || frac > 0.95) return false;
  if (aspect(q) > 8) return false;
  const minSide = Math.min(...q.map((p, i) => dist(p, q[(i + 1) % 4])));
  if (minSide < Math.hypot(w, h) * 0.03) return false;
  // A receipt cut off by the photo's edge loses one end; two sides along the border = a stripe/table edge.
  return sidesOnBorder(q, w, h) < 2;
}

/** How many sides lie along the frame border (both ends within 2 % of the same edge). */
export function sidesOnBorder(q: Pt[], w: number, h: number): number {
  const m = Math.max(w, h) * 0.02;
  const on = (p: Pt) => [p.x <= m, p.x >= w - m, p.y <= m, p.y >= h - m];
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const a = on(q[i]);
    const b = on(q[(i + 1) % 4]);
    if (a.some((v, k) => v && b[k])) n++;
  }
  return n;
}

/** Sutherland–Hodgman: `subject` clipped by the convex polygon `clip`. */
export function clipPolygon(subject: Pt[], clip: Pt[]): Pt[] {
  let out = subject;
  const orient = Math.sign(signedArea(clip)) || 1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: Pt) => cross(a, b, p) * orient >= 0;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = inside(p);
      const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const x = lineIntersect(a, b, p, q);
        if (x) out.push(x);
      }
    }
  }
  return out;
}

function lineIntersect(a: Pt, b: Pt, p: Pt, q: Pt): Pt | null {
  const d = (a.x - b.x) * (p.y - q.y) - (a.y - b.y) * (p.x - q.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((a.x - p.x) * (p.y - q.y) - (a.y - p.y) * (p.x - q.x)) / d;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Intersection over union of two convex polygons, both first clipped to the frame (when given). */
export function iou(a: Pt[], b: Pt[], frame?: { w: number; h: number }): number {
  let pa = a;
  let pb = b;
  if (frame) {
    const r = [{ x: 0, y: 0 }, { x: frame.w, y: 0 }, { x: frame.w, y: frame.h }, { x: 0, y: frame.h }];
    pa = clipPolygon(a, r);
    pb = clipPolygon(b, r);
  }
  const inter = clipPolygon(pa, pb);
  const i = inter.length >= 3 ? area(inter) : 0;
  const u = area(pa) + area(pb) - i;
  return u > 0 ? i / u : 0;
}

/** A line a·x + b·y + c = 0 with (a, b) unit length. */
export type Line = { a: number; b: number; c: number };

/** Total-least-squares line through points. */
export function fitLine(pts: Pt[]): Line | null {
  if (pts.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Direction = principal eigenvector; the normal is perpendicular to it.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const a = -Math.sin(theta);
  const b = Math.cos(theta);
  return { a, b, c: -(a * mx + b * my) };
}

export function intersectLines(l1: Line, l2: Line): Pt | null {
  const d = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(d) < 1e-9) return null;
  return { x: (l1.b * l2.c - l2.b * l1.c) / d, y: (l2.a * l1.c - l1.a * l2.c) / d };
}

/** Distance from p to the segment a–b, and where along it (0..1) the foot falls. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  const fx = a.x + t * vx;
  const fy = a.y + t * vy;
  return { d: Math.hypot(p.x - fx, p.y - fy), t };
}
