"use client";

/**
 * The barcode decoder, loadable ahead of time (Round 10 B1): the native BarcodeDetector where it reads EAN-13 (then
 * zxing is never downloaded), else zxing-wasm (self-hosted .wasm, compiled once). `prewarmScanners()` runs in idle
 * time after the app loads on phones, when the + menu opens, and at the tap — in parallel with the camera, never
 * before it.
 * R18 S4 B2: each pass reads one region of the frame at the camera's own resolution (a centred crop and the whole frame
 * alternately, every third pass turned 90° — `regionFor`), in more formats (EAN / UPC, Code 128 / 39, ITF, QR,
 * DataMatrix), and says where the code is (corners in the video's pixels) for the frozen frame's outline.
 */
import { cameraMark } from "./camera";
import { MAX_SIDE, NATIVE_FORMATS, regionFor, toVideo, ZX_FORMATS, type Region } from "./barcode-scan";

export type Read = { text: string; format: string; points: { x: number; y: number }[] | null };
export type ReadFrame = (v: HTMLVideoElement | HTMLCanvasElement, pass?: number) => Promise<Read | null>;

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string; format?: string; cornerPoints?: { x: number; y: number }[] }[]> };
declare global {
  interface Window {
    BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
  }
}

let reader: Promise<{ read: ReadFrame; native: boolean }> | null = null;
let decoderName: "native" | "zxing" | null = null;
/** Which decoder runs (the /debug/camera page). */
export const decoderInUse = () => decoderName;

function sizeOf(src: HTMLVideoElement | HTMLCanvasElement) {
  return src instanceof HTMLVideoElement ? { w: src.videoWidth, h: src.videoHeight } : { w: src.width, h: src.height };
}

/** Draw pass k's region of the frame into `canvas` (scaled to ≤ MAX_SIDE, turned 90° clockwise when planned). */
function drawRegion(ctx: CanvasRenderingContext2D, src: HTMLVideoElement | HTMLCanvasElement, k: number): { region: Region; scale: number } | null {
  const { w: vw, h: vh } = sizeOf(src);
  if (!vw || !vh) return null;
  const region = regionFor(k, vw, vh);
  const scale = Math.min(1, MAX_SIDE / Math.max(region.w, region.h));
  const dw = Math.round(region.w * scale);
  const dh = Math.round(region.h * scale);
  const c = ctx.canvas;
  c.width = region.rotate ? dh : dw;
  c.height = region.rotate ? dw : dh;
  ctx.save();
  if (region.rotate) {
    ctx.translate(dh, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(src, region.x, region.y, region.w, region.h, 0, 0, dw, dh);
  ctx.restore();
  return { region, scale };
}

async function load() {
  const supported = window.BarcodeDetector ? await window.BarcodeDetector.getSupportedFormats?.().catch((): string[] => []) : [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (supported?.includes("ean_13")) {
    const det = new window.BarcodeDetector!({ formats: NATIVE_FORMATS.filter((f) => supported.includes(f)) });
    cameraMark("scan:decoder");
    decoderName = "native";
    return {
      native: true,
      read: async (src: HTMLVideoElement | HTMLCanvasElement, k = 0): Promise<Read | null> => {
        const d = drawRegion(ctx, src, k);
        if (!d) return null;
        const r = (await det.detect(canvas).catch(() => []))[0];
        if (!r?.rawValue) return null;
        return { text: r.rawValue, format: r.format ?? "", points: r.cornerPoints?.map((p) => toVideo(p, d.region, d.scale)) ?? null };
      },
    };
  }
  const z = await import("zxing-wasm/reader");
  await z.prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/vendor/zxing_reader.wasm" : prefix + path) },
    fireImmediately: true,
  });
  cameraMark("scan:decoder");
  decoderName = "zxing";
  return {
    native: false,
    read: async (src: HTMLVideoElement | HTMLCanvasElement, k = 0): Promise<Read | null> => {
      const d = drawRegion(ctx, src, k);
      if (!d) return null;
      const r = await z.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { formats: [...ZX_FORMATS], tryHarder: true, tryRotate: false, tryDownscale: true, maxNumberOfSymbols: 1 });
      const hit = r.find((x) => x.isValid);
      if (!hit) return null;
      const p = hit.position;
      return { text: hit.text, format: hit.format, points: p ? [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((q) => toVideo(q, d.region, d.scale)) : null };
    },
  };
}

export function getBarcodeReader() {
  reader ??= load().catch((e) => {
    reader = null;
    throw e;
  });
  return reader;
}

let fetched = false;

/**
 * Warm both camera screens' code (barcode decoder + the receipt detector module). Cheap to call again.
 * `download: true` (idle time after load) only fetches — the modules and the .wasm into the HTTP cache — so a reload
 * in the middle never aborts a compile; the + menu and the tap compile (fast from cache).
 */
export function prewarmScanners(opts: { download?: boolean } = {}) {
  void import("./receipt-detect").catch(() => {});
  if (!opts.download) return void getBarcodeReader().catch(() => {});
  if (fetched || window.BarcodeDetector) return;
  fetched = true;
  void import("zxing-wasm/reader").catch(() => {});
  void fetch("/vendor/zxing_reader.wasm", { priority: "low" } as RequestInit).catch(() => {});
}
