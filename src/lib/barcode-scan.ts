// R18 S4 B2 — the barcode scanner's pure core (client-safe, no DOM): which back camera to use, which part of the frame
// to read on each pass (a centred crop and the whole frame alternately, every third pass turned 90°), when a read counts
// (two equal reads, or one with a valid check digit), and the image steps the node test runs on fixtures
// (`scripts/test-barcode.ts`). The browser side (`lib/barcode-reader.ts`, `lib/camera.ts`) draws the same regions from
// the video with a canvas.
import { checkDigitOk, upcEtoA } from "./barcode";

// ---------- formats ----------

/** What the scanner reads (zxing names) — retail codes, shelf / logistics codes, and 2D codes. */
export const ZX_FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE", "Code128", "Code39", "ITF", "QRCode", "DataMatrix"] as const;
/** The same for the native BarcodeDetector. */
export const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"] as const;

// ---------- which camera ----------

export type CamInfo = { id: string; label: string; caps?: { focusMode?: string[]; zoom?: { min?: number; max?: number }; facingMode?: string[]; width?: { max?: number } } | null };

const BACK = /back|rear|environment|world|אחור/i;
const FRONT = /front|user|face|selfie|קדמ/i;
const NOT_MAIN = /ultra|wide|tele|macro|depth|\bir\b|infrared|0\.5x|monochrome/i;

/** A score per back camera: continuous focus, a zoom range, a high resolution; never an ultra-wide / tele / depth lens. */
function score(c: CamInfo) {
  let s = 0;
  if (NOT_MAIN.test(c.label)) s -= 100;
  if (c.caps?.focusMode?.includes("continuous")) s += 40;
  const zMax = c.caps?.zoom?.max ?? 0;
  s += Math.min(zMax, 10) * 2;
  s += Math.min((c.caps?.width?.max ?? 0) / 1000, 8);
  // Android names lenses "camera2 0, facing back", "camera2 2, facing back"…: the lowest number is the main lens.
  const n = /camera2? (\d+)/i.exec(c.label)?.[1];
  if (n != null) s -= Number(n) * 0.5;
  return s;
}

/**
 * The main back camera among the video inputs (labels need the permission first), or null when there is no choice to
 * make (one back camera, none labelled). `remembered` wins while it is still there.
 */
export function pickCamera(list: CamInfo[], remembered?: string | null): string | null {
  if (remembered && list.some((c) => c.id === remembered)) return remembered;
  const back = list.filter((c) => (c.caps?.facingMode?.length ? c.caps.facingMode.includes("environment") : BACK.test(c.label) && !FRONT.test(c.label)));
  if (back.length < 2) return back[0]?.id ?? null;
  return [...back].sort((a, b) => score(b) - score(a))[0].id;
}

/** A zoom that makes a small barcode fill the frame without bringing the phone close (≈ 1.6×), inside the lens's range. */
export function scanZoom(z: { min?: number; max?: number; step?: number } | undefined | null): number | null {
  if (!z || z.max == null || z.max < 1.4) return null;
  const want = Math.min(z.max, 1.6);
  const step = z.step && z.step > 0 ? z.step : 0.1;
  return Math.max(z.min ?? 1, Math.round(want / step) * step);
}

// ---------- which part of the frame ----------

export type Region = { x: number; y: number; w: number; h: number; rotate: boolean };

/** Longest side a pass is decoded at: the centred crop of a 1920 frame (1382 px) keeps every pixel, a bigger region shrinks. */
export const MAX_SIDE = 1440;

/** Pass k: even = the centred crop (where the frame on screen is), odd = the whole frame; every third pass turned 90°. */
export function regionFor(k: number, vw: number, vh: number): Region {
  const rotate = k % 3 === 2;
  if (k % 2 === 0) {
    const w = Math.round(vw * 0.72);
    const h = Math.round(vh * 0.48);
    return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h, rotate };
  }
  return { x: 0, y: 0, w: vw, h: vh, rotate };
}

/** A point read inside a (possibly turned, scaled) region → the video's own pixels. */
export function toVideo(p: { x: number; y: number }, r: Region, scale: number) {
  const x = p.x / scale;
  const y = p.y / scale;
  // Turned 90° clockwise: the region's (x, y) was drawn at (h − y, x).
  return r.rotate ? { x: r.x + y, y: r.y + (r.h - x) } : { x: r.x + x, y: r.y + y };
}

// ---------- when a read counts ----------

/** Numbers with a check digit (EAN / UPC / GTIN-14) count on one read when it is right. */
export function selfChecked(code: string) {
  if (!/^\d+$/.test(code)) return false;
  if ([8, 12, 13, 14].includes(code.length) && checkDigitOk(code)) return true;
  const a = code.length === 8 ? upcEtoA(code) : null;
  return !!a && checkDigitOk(a);
}

/** Two equal reads within `windowMs` (or one self-checked) → the code; anything else → null. */
export function confirmer(windowMs = 1500) {
  let last = "";
  let at = 0;
  return (code: string, now: number): string | null => {
    if (!code) return null;
    if (selfChecked(code) || (code === last && now - at <= windowMs)) {
      last = "";
      return code;
    }
    last = code;
    at = now;
    return null;
  };
}

// ---------- image steps (node test + fallbacks) ----------

export type Img = { width: number; height: number; data: Uint8ClampedArray };

export function cropImg(img: Img, r: { x: number; y: number; w: number; h: number }): Img {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * img.width + r.x) * 4;
    out.set(img.data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return { width: r.w, height: r.h, data: out };
}

/** Turned 90° clockwise. */
export function rotateImg(img: Img): Img {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = (x * h + (h - 1 - y)) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = 255;
    }
  return { width: h, height: w, data: out };
}

/** One pass over a frame: the region for pass k, turned when the plan says so. */
export function regionImg(img: Img, k: number): { img: Img; region: Region } {
  const region = regionFor(k, img.width, img.height);
  const c = cropImg(img, region);
  return { img: region.rotate ? rotateImg(c) : c, region };
}
