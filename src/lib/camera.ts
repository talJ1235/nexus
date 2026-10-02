"use client";

/**
 * One shared back-camera stream for the barcode scanner and the receipt camera (Round 10 B1: open fast).
 * - `primeCamera()` is called in the tap handler itself, so getUserMedia starts before React renders the viewfinder.
 * - The first request asks for a modest resolution (cameras start faster); `upgradeCamera()` raises it after the first
 *   frame for the screen that needs more.
 * - Closing keeps the stream alive for a minute, so reopening is instant; it stops at once when the page is hidden.
 * Timings land as performance marks (cam:tap → cam:frame, scan:decoder) for the smoke trace.
 */
export type CameraKind = "barcode" | "receipt";

const FIRST_WIDTH = 640;
const KEEP_MS = 60_000;

let stream: MediaStream | null = null;
let pending: Promise<MediaStream> | null = null;
let users = 0;
let stopTimer = 0;
let listening = false;

const mark = (name: string) => {
  try {
    performance.clearMarks(name);
    performance.mark(name);
  } catch {}
};

const live = (s: MediaStream | null) => !!s && s.getVideoTracks().some((t) => t.readyState === "live");

function stopNow() {
  clearTimeout(stopTimer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  pending = null;
}

function listen() {
  if (listening) return;
  listening = true;
  const hide = () => document.visibilityState === "hidden" && users === 0 && stopNow();
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", () => users === 0 && stopNow());
}

function open(): Promise<MediaStream> {
  if (live(stream)) return Promise.resolve(stream!);
  if (pending) return pending;
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new DOMException("no camera", "NotFoundError"));
  listen();
  pending = navigator.mediaDevices
    .getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: FIRST_WIDTH }, height: { ideal: Math.round((FIRST_WIDTH * 3) / 4) } } })
    .then((s) => {
      pending = null;
      // Released while it was starting (closed fast): keep it for the minute like any other release.
      stream = s;
      if (users === 0) scheduleStop();
      return s;
    })
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

function scheduleStop() {
  clearTimeout(stopTimer);
  stopTimer = window.setTimeout(() => users === 0 && stopNow(), KEEP_MS);
}

/** Start the camera now (from the tap that opens a camera screen). Safe to call repeatedly. */
export function primeCamera() {
  mark("cam:tap");
  void open().catch(() => {});
}

/** The live stream (reused or starting); pair every acquire with a release. */
export function acquireCamera(): Promise<MediaStream> {
  users++;
  clearTimeout(stopTimer);
  return open();
}

export function releaseCamera() {
  users = Math.max(0, users - 1);
  if (users === 0) {
    if (document.visibilityState === "hidden") stopNow();
    else scheduleStop();
  }
}

/** After the first frame: raise the resolution to what this screen needs (no-op if already there). */
export async function upgradeCamera(s: MediaStream, width: number) {
  const track = s.getVideoTracks()[0];
  if (!track || (track.getSettings().width ?? 0) >= width) return;
  try {
    await track.applyConstraints({ facingMode: { ideal: "environment" }, width: { ideal: width }, height: { ideal: Math.round((width * 3) / 4) } });
  } catch {}
}

export const cameraMark = mark;
