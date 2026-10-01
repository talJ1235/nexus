// Synthetic receipt photos for the receipt bench (Round 8 A1). Runs in a Chromium page (canvas text, filters and
// the JPEG encoder behave like the app's). Deterministic per seed. Bundled by scripts/receipt-bench.ts.
type Pt = { x: number; y: number };
export type Spec = {
  seed: number;
  bg: "white" | "wood" | "dark" | "cloth" | "hand" | "gray";
  ratio: number; // receipt height / width (2..6)
  frame: { w: number; h: number };
  scale: number; // receipt's projected long side / frame's long side
  rot: number; // degrees
  tilt: number; // 0..0.3 — the far end narrower (perspective)
  curl: number; // 0..0.04 — long sides bow (fraction of width)
  shadow: number; // 0..1 — lighting gradient strength
  glare: number; // 0..1
  blur: number; // px
  noise: number; // σ in levels
  quality: number; // JPEG
  outOfFrame: boolean;
  hebrew: boolean;
};

const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function specFor(i: number): Spec {
  const r = rng(1000 + i * 7919);
  const bgs: Spec["bg"][] = ["white", "wood", "dark", "cloth", "hand", "gray"];
  const landscape = r() < 0.2;
  return {
    seed: i,
    bg: bgs[i % bgs.length],
    ratio: 2 + r() * 4,
    frame: landscape ? { w: 800, h: 600 } : { w: 600, h: 800 },
    scale: 0.42 + r() * 0.5,
    rot: (r() * 2 - 1) * 25,
    tilt: r() * 0.28,
    curl: r() < 0.5 ? r() * 0.04 : 0,
    shadow: r(),
    glare: r() < 0.35 ? 0.3 + r() * 0.5 : 0,
    blur: r() < 0.4 ? r() * 1.6 : 0,
    noise: r() * 5,
    quality: 0.6 + r() * 0.25,
    outOfFrame: i % 9 === 4,
    hebrew: r() < 0.5,
  };
}

const HE = ["חלב 3%", "לחם אחיד", "ביצים L", "גבינה צהובה", "עגבניות", "מלפפון", "שמן זית", "קפה טורקי", "סוכר", "אורז", "במבה", "קוטג'"];
const EN = ["MILK 1L", "BREAD", "EGGS L x12", "CHEDDAR", "TOMATOES", "CUCUMBER", "OLIVE OIL", "COFFEE", "SUGAR 1KG", "RICE", "CHIPS", "YOGURT"];

function drawPaper(s: Spec, r: () => number): HTMLCanvasElement {
  const W = 360;
  const H = Math.round(W * s.ratio);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const base = 238 + r() * 16;
  const tint = r() * 6 - 3;
  x.fillStyle = `rgb(${base + tint},${base},${base - tint - 3})`;
  x.fillRect(0, 0, W, H);
  const ink = 30 + r() * 60;
  x.fillStyle = `rgba(${ink},${ink},${ink + 10},${0.6 + r() * 0.35})`;
  const rtl = s.hebrew;
  x.direction = rtl ? "rtl" : "ltr";
  const left = rtl ? W - 24 : 24;
  const right = rtl ? 24 : W - 24;
  let y = 46;
  x.textAlign = "center";
  x.font = `bold ${26 + r() * 8}px Arial`;
  x.fillText(rtl ? "סופר השכונה" : "CORNER MARKET", W / 2, y);
  y += 26;
  x.font = "14px 'Courier New', monospace";
  x.fillText(rtl ? "רחוב הרצל 12, תל אביב" : "12 HIGH ST, SPRINGFIELD", W / 2, y);
  y += 22;
  x.fillText("01/10/2026 14:32", W / 2, y);
  const dash = () => {
    y += 16;
    x.fillText("- - - - - - - - - - - - - - - - - - -", W / 2, y);
    y += 10;
  };
  dash();
  const names = rtl ? HE : EN;
  let total = 0;
  while (y < H - 170) {
    y += 22;
    const price = Math.round((3 + r() * 60) * 100) / 100;
    total += price;
    x.textAlign = rtl ? "right" : "left";
    x.fillText(names[Math.floor(r() * names.length)], left, y);
    x.textAlign = rtl ? "left" : "right";
    x.fillText(price.toFixed(2), right, y);
  }
  dash();
  y += 24;
  x.font = "bold 22px Arial";
  x.textAlign = rtl ? "right" : "left";
  x.fillText(rtl ? 'סה"כ' : "TOTAL", left, y);
  x.textAlign = rtl ? "left" : "right";
  x.fillText(total.toFixed(2), right, y);
  y += 30;
  // Barcode
  let bx = 60;
  while (bx < W - 60) {
    const bw = 1 + Math.floor(r() * 3);
    if (r() < 0.55) x.fillRect(bx, y, bw, 46);
    bx += bw + 1;
  }
  x.textAlign = "center";
  x.font = "14px Arial";
  x.fillText(rtl ? "תודה ולהתראות" : "THANK YOU", W / 2, Math.min(H - 14, y + 70));
  return c;
}

function drawBackground(x: CanvasRenderingContext2D, s: Spec, r: () => number) {
  const { w, h } = s.frame;
  const bg = s.bg === "hand" ? (["wood", "dark", "gray"] as const)[Math.floor(r() * 3)] : s.bg;
  if (bg === "white") {
    const v = 214 + r() * 22;
    x.fillStyle = `rgb(${v},${v - 1},${v - 4})`;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(0,0,0,${r() * 0.03})`;
      x.beginPath();
      x.arc(r() * w, r() * h, 20 + r() * 80, 0, Math.PI * 2);
      x.fill();
    }
  } else if (bg === "wood") {
    const R = 185 + r() * 30;
    x.fillStyle = `rgb(${R},${R * 0.78},${R * 0.55})`;
    x.fillRect(0, 0, w, h);
    const ang = r() * Math.PI;
    for (let i = 0; i < 160; i++) {
      x.strokeStyle = `rgba(${90 + r() * 50},${55 + r() * 30},${25},${0.06 + r() * 0.12})`;
      x.lineWidth = 1 + r() * 4;
      x.beginPath();
      const off = (i / 160) * (w + h) * 1.5 - (w + h) * 0.25;
      for (let t = -0.2; t <= 1.2; t += 0.05) {
        const px = Math.cos(ang) * t * (w + h) + Math.sin(ang) * off + Math.sin(t * 9 + i) * 4;
        const py = Math.sin(ang) * t * (w + h) - Math.cos(ang) * off;
        if (t === -0.2) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.stroke();
    }
  } else if (bg === "dark") {
    const v = 25 + r() * 40;
    x.fillStyle = `rgb(${v + 6},${v + 3},${v})`;
    x.fillRect(0, 0, w, h);
  } else if (bg === "gray") {
    const v = 105 + r() * 50;
    x.fillStyle = `rgb(${v},${v},${v + 4})`;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const d = r() * 60 - 30;
      x.fillStyle = `rgba(${v + d},${v + d},${v + d},0.7)`;
      x.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
    }
  } else {
    // Patterned cloth: gingham / stripes in a random colour, rotated.
    const hue = Math.floor(r() * 360);
    x.fillStyle = `hsl(${hue} 30% 88%)`;
    x.fillRect(0, 0, w, h);
    x.save();
    x.translate(w / 2, h / 2);
    x.rotate(r() * Math.PI);
    const cell = 18 + r() * 26;
    x.fillStyle = `hsla(${hue} 55% 45% / 0.45)`;
    const span = w + h;
    for (let i = -span; i < span; i += cell * 2) x.fillRect(i, -span, cell, span * 2);
    if (r() < 0.6) for (let i = -span; i < span; i += cell * 2) x.fillRect(-span, i, span * 2, cell);
    x.restore();
  }
}

function solveHomography(src: Pt[], dst: Pt[]): number[] {
  // dst = H · src; 8 unknowns (h33 = 1).
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}
const apply = (H: number[], p: Pt): Pt => {
  const z = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / z, y: (H[3] * p.x + H[4] * p.y + H[5]) / z };
};

/** Render one synthetic photo. Returns a JPEG data URL and the true corners (TL, TR, BR, BL of the paper). */
export function render(s: Spec): { url: string; corners: Pt[] } {
  const r = rng(s.seed * 31 + 7);
  const paper = drawPaper(s, r);
  const PW = paper.width;
  const PH = paper.height;
  const { w, h } = s.frame;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  drawBackground(x, s, r);

  // Target quad: an upright rectangle of the right size, narrowed at the far (top) end, rotated, placed.
  const longPx = Math.max(w, h) * s.scale;
  const hh = longPx;
  const ww = hh / s.ratio;
  const topShrink = 1 - s.tilt;
  const local: Pt[] = [
    { x: (-ww / 2) * topShrink, y: -hh / 2 },
    { x: (ww / 2) * topShrink, y: -hh / 2 },
    { x: ww / 2, y: hh / 2 },
    { x: -ww / 2, y: hh / 2 },
  ];
  const a = (s.rot * Math.PI) / 180;
  const rot = local.map((p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
  // Fit inside the frame (with a margin) unless this one is meant to stick out.
  const minX = Math.min(...rot.map((p) => p.x));
  const maxX = Math.max(...rot.map((p) => p.x));
  const minY = Math.min(...rot.map((p) => p.y));
  const maxY = Math.max(...rot.map((p) => p.y));
  const fit = Math.min(1, (w * 0.94) / (maxX - minX), (h * 0.94) / (maxY - minY));
  const pts = rot.map((p) => ({ x: p.x * fit, y: p.y * fit }));
  const bw = (maxX - minX) * fit;
  const bh = (maxY - minY) * fit;
  const cx = w / 2 + (r() * 2 - 1) * Math.max(0, (w - bw) / 2 - 10);
  let cy = h / 2 + (r() * 2 - 1) * Math.max(0, (h - bh) / 2 - 10);
  // Partly out of frame: one end of the receipt is cut off by the top or bottom edge.
  if (s.outOfFrame) cy += bh * 0.18 * (r() < 0.5 ? -1 : 1);
  const corners = pts.map((p) => ({ x: p.x + cx, y: p.y + cy }));

  // Soft drop shadow of the paper.
  x.save();
  x.filter = `blur(${6 + r() * 8}px)`;
  x.fillStyle = `rgba(0,0,0,${0.18 + r() * 0.2})`;
  x.beginPath();
  corners.forEach((p, i) => (i ? x.lineTo(p.x + 5, p.y + 8) : x.moveTo(p.x + 5, p.y + 8)));
  x.closePath();
  x.fill();
  x.restore();

  // Warp the paper in (inverse homography per pixel, bilinear, feathered edge; long sides bowed by `curl`).
  const H = solveHomography(corners, [
    { x: 0, y: 0 },
    { x: PW, y: 0 },
    { x: PW, y: PH },
    { x: 0, y: PH },
  ]);
  const src = paper.getContext("2d")!.getImageData(0, 0, PW, PH).data;
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const bow = s.curl * PW;
  const pxScale = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) / PW;
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)) - bow * pxScale - 2));
  const x1 = Math.min(w, Math.ceil(Math.max(...corners.map((p) => p.x)) + bow * pxScale + 2));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)) - bow * pxScale - 2));
  const y1 = Math.min(h, Math.ceil(Math.max(...corners.map((p) => p.y)) + bow * pxScale + 2));
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) {
      const p = apply(H, { x: xx + 0.5, y: yy + 0.5 });
      const v = p.y;
      const u = p.x - bow * Math.sin((Math.PI * v) / PH);
      const edge = Math.min(u, PW - u, v, PH - v) * pxScale + 0.5;
      if (edge <= 0) continue;
      const al = Math.min(1, edge);
      const uu = Math.max(0, Math.min(PW - 1.001, u));
      const vv = Math.max(0, Math.min(PH - 1.001, v));
      const iu = Math.floor(uu);
      const iv = Math.floor(vv);
      const fu = uu - iu;
      const fv = vv - iv;
      const o = (yy * w + xx) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const s00 = src[(iv * PW + iu) * 4 + ch];
        const s10 = src[(iv * PW + iu + 1) * 4 + ch];
        const s01 = src[((iv + 1) * PW + iu) * 4 + ch];
        const s11 = src[((iv + 1) * PW + iu + 1) * 4 + ch];
        const val = (s00 * (1 - fu) + s10 * fu) * (1 - fv) + (s01 * (1 - fu) + s11 * fu) * fv;
        // Curl shading: the bowed paper catches light unevenly.
        const shade = 1 - (bow ? 0.06 * Math.abs(Math.cos((Math.PI * v) / PH)) : 0);
        d[o + ch] = d[o + ch] * (1 - al) + val * shade * al;
      }
    }
  x.putImageData(img, 0, 0);

  // A hand holding the receipt by its bottom end (fingers cover part of the edge).
  if (s.bg === "hand") {
    const bl = corners[3];
    const br = corners[2];
    const mx = (bl.x + br.x) / 2;
    const my = (bl.y + br.y) / 2;
    const skin = ["#e0b08c", "#c68e6a", "#8d5a3b", "#f1c9a5"][Math.floor(r() * 4)];
    x.fillStyle = skin;
    x.beginPath();
    x.ellipse(mx, my + 70, 90, 80, 0, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.ellipse(mx - 20 + r() * 40, my - 4, 18, 34, (r() - 0.5) * 0.6, 0, Math.PI * 2);
    x.fill();
  }

  // Lighting: a shadow gradient across the scene, glare, blur, sensor noise.
  if (s.shadow > 0.2) {
    const ga = r() * Math.PI * 2;
    const g = x.createLinearGradient(w / 2 - Math.cos(ga) * w, h / 2 - Math.sin(ga) * h, w / 2 + Math.cos(ga) * w, h / 2 + Math.sin(ga) * h);
    g.addColorStop(0, "rgb(255,255,255)");
    g.addColorStop(1, `rgb(${255 - s.shadow * 120},${255 - s.shadow * 120},${255 - s.shadow * 110})`);
    x.globalCompositeOperation = "multiply";
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = "source-over";
  }
  if (s.glare) {
    const gx = corners[0].x + (corners[2].x - corners[0].x) * r();
    const gy = corners[0].y + (corners[2].y - corners[0].y) * r();
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, 60 + r() * 120);
    g.addColorStop(0, `rgba(255,255,255,${s.glare})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  }
  if (s.blur) {
    const t = document.createElement("canvas");
    t.width = w;
    t.height = h;
    const tx = t.getContext("2d")!;
    tx.filter = `blur(${s.blur}px)`;
    tx.drawImage(c, 0, 0);
    x.clearRect(0, 0, w, h);
    x.drawImage(t, 0, 0);
  }
  if (s.noise > 0.5) {
    const im = x.getImageData(0, 0, w, h);
    const dd = im.data;
    for (let i = 0; i < dd.length; i += 4) {
      // Box-Muller-ish: sum of uniforms (cheap, deterministic).
      const n = (r() + r() + r() - 1.5) * s.noise * 2;
      dd[i] += n;
      dd[i + 1] += n;
      dd[i + 2] += n;
    }
    x.putImageData(im, 0, 0);
  }
  return { url: c.toDataURL("image/jpeg", s.quality), corners };
}
