"use client";

/**
 * The barcode decoder, loadable ahead of time (Round 10 B1): the native BarcodeDetector where it reads EAN-13 (then
 * zxing is never downloaded), else zxing-wasm (self-hosted .wasm, compiled once). `prewarmScanners()` runs in idle
 * time after the app loads on phones, when the + menu opens, and at the tap — in parallel with the camera, never
 * before it.
 */
import { cameraMark } from "./camera";

export type ReadFrame = (v: HTMLVideoElement) => Promise<string | null>;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
  }
}

let reader: Promise<{ read: ReadFrame; native: boolean }> | null = null;

async function load() {
  const native = window.BarcodeDetector && (await window.BarcodeDetector.getSupportedFormats?.().catch((): string[] => []))?.includes("ean_13");
  if (native) {
    const det = new window.BarcodeDetector!({ formats: FORMATS });
    cameraMark("scan:decoder");
    return { native: true, read: async (v: HTMLVideoElement) => (await det.detect(v).catch(() => []))[0]?.rawValue ?? null };
  }
  const z = await import("zxing-wasm/reader");
  await z.prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/vendor/zxing_reader.wasm" : prefix + path) },
    fireImmediately: true,
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  cameraMark("scan:decoder");
  return {
    native: false,
    read: async (v: HTMLVideoElement) => {
      const w = 720;
      const h = Math.round((v.videoHeight / v.videoWidth) * w) || 540;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const r = await z.readBarcodes(ctx.getImageData(0, 0, w, h), { formats: ["EAN13", "EAN8", "UPCA", "UPCE", "Code128"], tryHarder: true, maxNumberOfSymbols: 1 });
      return r.find((x) => x.isValid)?.text ?? null;
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

/** Warm both camera screens' code (barcode decoder + the receipt detector module). Cheap to call again. */
export function prewarmScanners() {
  void getBarcodeReader().catch(() => {});
  void import("./receipt-detect").catch(() => {});
}
