// Receipt detection off the main thread (Round 8 A3): the camera posts a 640 px ImageBitmap per frame (transferred),
// gets back the quad plus sharpness and brightness. One frame at a time — the camera skips frames while this is busy.
import { brightnessOf, detectReceipt, prepare, sharpnessOf } from "./index";

export type WorkerIn = { id: number; frame: ImageBitmap; ml: string | false };
export type WorkerOut = { id: number; w: number; h: number; quad: { x: number; y: number }[] | null; score: number; edge: number; sharp: number; light: number };

let canvas: OffscreenCanvas | null = null;

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { id, frame, ml } = e.data;
  const w = frame.width;
  const h = frame.height;
  if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0);
  frame.close();
  const data = ctx.getImageData(0, 0, w, h);
  const d = await detectReceipt(data, { mode: "live", ml }).catch(() => null);
  const g = prepare(data, 640);
  const out: WorkerOut = { id, w, h, quad: d?.quad ?? null, score: d?.score ?? 0, edge: d?.edge ?? 0, sharp: sharpnessOf(g), light: brightnessOf(g) };
  (self as unknown as Worker).postMessage(out);
};
