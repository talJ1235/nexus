// The receipt camera's frame detector (Round 8 A3): a Web Worker when the browser has OffscreenCanvas (detection never
// blocks the UI), else the same code on the main thread. `detect` resolves with the result for that frame.
import type { WorkerIn, WorkerOut } from "./receipt-detect/worker";
import { ML_ASSETS } from "./receipt-image";

export type LiveResult = WorkerOut;

export type LiveDetector = { detect(frame: ImageBitmap): Promise<LiveResult | null>; close(): void };

export function createLiveDetector(): LiveDetector {
  let worker: Worker | null = null;
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    try {
      worker = new Worker(new URL("./receipt-detect/worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker = null;
    }
  }
  let seq = 0;
  const pending = new Map<number, (r: LiveResult | null) => void>();
  if (worker) {
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      // A worker that failed to load: settle what's waiting and fall back to the main thread from now on.
      for (const r of pending.values()) r(null);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const onMain = async (frame: ImageBitmap): Promise<LiveResult | null> => {
    const { brightnessOf, detectReceipt, prepare, sharpnessOf } = await import("./receipt-detect");
    const c = document.createElement("canvas");
    c.width = frame.width;
    c.height = frame.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(frame, 0, 0);
    frame.close();
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const d = await detectReceipt(data, { mode: "live", ml: ML_ASSETS }).catch(() => null);
    const g = prepare(data, 640);
    return { id: 0, w: c.width, h: c.height, quad: d?.quad ?? null, score: d?.score ?? 0, edge: d?.edge ?? 0, sharp: sharpnessOf(g), light: brightnessOf(g) };
  };
  return {
    detect(frame) {
      if (!worker) return onMain(frame);
      const id = ++seq;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        const msg: WorkerIn = { id, frame, ml: ML_ASSETS };
        worker!.postMessage(msg, [frame]);
      });
    },
    close() {
      worker?.terminate();
      worker = null;
      for (const r of pending.values()) r(null);
      pending.clear();
    },
  };
}
