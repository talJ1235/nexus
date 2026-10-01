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

/** Self-hosted assets of scanic's ML detector (copied to public/ by scripts/copy-scanic-ml.mjs). */
export const ML_ASSETS = "/scanic-ml/";

export const quadToCorners = (q: { x: number; y: number }[]): CornerPoints => ({ topLeft: q[0], topRight: q[1], bottomRight: q[2], bottomLeft: q[3] });

/**
 * Find the receipt's 4 corners in a still (photo or picked file) with the receipt detector (paper + straight edges +
 * scanic + ML, fused — see lib/receipt-detect). The still is analysed at ≤ 1000 px; null when nothing is clear.
 */
export async function detectCorners(canvas: HTMLCanvasElement): Promise<{ corners: CornerPoints; confidence: number } | null> {
  const { detectReceipt } = await import("./receipt-detect");
  const small = await toCanvas(canvas, 1000);
  const k = canvas.width / small.width;
  const data = small.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height);
  const d = await detectReceipt(data, { mode: "still", ml: ML_ASSETS }).catch(() => null);
  if (!d) return null;
  // Corners may sit slightly outside the photo (cut-off receipt): clamp to the image.
  const q = d.quad.map((p) => ({ x: Math.max(0, Math.min(canvas.width, p.x * k)), y: Math.max(0, Math.min(canvas.height, p.y * k)) }));
  return { corners: quadToCorners(q), confidence: d.score };
}

/** Perspective-correct to the given corners. */
export async function cropTo(canvas: HTMLCanvasElement, corners: CornerPoints): Promise<HTMLCanvasElement> {
  const { extractDocument } = await import("scanic");
  const r = await extractDocument(canvas, corners, { output: "canvas" }).catch(() => null);
  return r?.success && r.output instanceof HTMLCanvasElement ? r.output : canvas;
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
