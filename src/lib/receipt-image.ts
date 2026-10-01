// Receipt photos, prepared in the browser before upload (Round 7 E1/E2): perspective crop (scanic), grayscale + contrast
// stretch, long side ≤ 2000 px, JPEG ~0.85; very tall receipts are split into overlapping tiles sent as one receipt.
import type { CornerPoints } from "scanic";
import { tileRanges } from "./receipt-check";

export type { CornerPoints };
type Source = Blob | HTMLCanvasElement | ImageBitmap;

export async function toCanvas(src: Source, max = 4000): Promise<HTMLCanvasElement> {
  if (src instanceof HTMLCanvasElement && Math.max(src.width, src.height) <= max) return src;
  const bmp = src instanceof Blob ? await createImageBitmap(src) : src;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  if (src instanceof Blob) (bmp as ImageBitmap).close();
  return c;
}

/** Find the receipt's 4 corners (null when no clear document outline). */
export async function detectCorners(canvas: HTMLCanvasElement, maxProcessingDimension = 640): Promise<{ corners: CornerPoints; confidence: number } | null> {
  const { scanDocument } = await import("scanic");
  const r = await scanDocument(canvas, { mode: "detect", maxProcessingDimension }).catch(() => null);
  if (!r?.success || !r.corners) return null;
  // A receipt fills a good part of the frame; tiny or folded quads are noise.
  const q = [r.corners.topLeft, r.corners.topRight, r.corners.bottomRight, r.corners.bottomLeft];
  const area = Math.abs(q.reduce((a, p, i) => a + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2;
  if (area / (canvas.width * canvas.height) < 0.08) return null;
  return { corners: r.corners, confidence: r.confidence ?? 0.5 };
}

/** Perspective-correct to the given corners. */
export async function cropTo(canvas: HTMLCanvasElement, corners: CornerPoints): Promise<HTMLCanvasElement> {
  const { extractDocument } = await import("scanic");
  const r = await extractDocument(canvas, corners, { output: "canvas" }).catch(() => null);
  return r?.success && r.output instanceof HTMLCanvasElement ? r.output : canvas;
}

/** Sharpness of a frame (variance of a Laplacian over a small grayscale copy). Higher = sharper. */
export function sharpness(source: CanvasImageSource, w = 160): number {
  const el = source as HTMLVideoElement & HTMLCanvasElement;
  const sw = el.videoWidth || el.width;
  const sh = el.videoHeight || el.height;
  if (!sw || !sh) return 0;
  const h = Math.round((sh / sw) * w);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += v;
      sum2 += v * v;
      n++;
    }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/** Grayscale + contrast stretch (1st–99th percentile) in place. */
function enhance(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = v;
    hist[v]++;
  }
  const total = d.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

const toJpeg = (c: HTMLCanvasElement, q = 0.85) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", q));

/**
 * One receipt part → upload-ready JPEG blobs (several when it's very tall). `autoCrop`: find and straighten the
 * receipt first (used for picked files; the live camera passes already-cropped canvases).
 */
export async function prepareReceiptPart(src: Source, opts: { autoCrop?: boolean; corners?: CornerPoints | null } = {}): Promise<Blob[]> {
  let c = await toCanvas(src);
  const corners = opts.corners ?? (opts.autoCrop ? (await detectCorners(c))?.corners : null);
  if (corners) c = await cropTo(c, corners);
  c = await toCanvas(c, 2000);
  if (c === src) {
    // Never modify the caller's canvas.
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    copy.getContext("2d")!.drawImage(c, 0, 0);
    c = copy;
  }
  enhance(c);
  const out: Blob[] = [];
  for (const [y, h] of tileRanges(c.width, c.height)) {
    if (y === 0 && h === c.height) {
      out.push(await toJpeg(c));
      break;
    }
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = h;
    t.getContext("2d")!.drawImage(c, 0, y, c.width, h, 0, 0, c.width, h);
    out.push(await toJpeg(t));
  }
  return out;
}
