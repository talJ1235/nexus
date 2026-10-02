"use client";

/**
 * One shared back-camera stream for the barcode scanner and the receipt camera (Round 10 B1: open fast).
 * - `primeCamera()` is called in the tap handler itself, so getUserMedia starts before React renders the viewfinder.
 * - The first request asks for a modest resolution (cameras start faster); `upgradeCamera()` raises it after the first
 *   frame for the screen that needs more.
 * - The camera turns off the moment no screen uses it (closing the scanner / receipt camera, or a photo taken), and
 *   when the page is hidden — Tal's choice: no keep-alive. A start that resolves after the screen closed stops at once.
 * Timings land as performance marks (cam:tap → cam:frame, scan:decoder); <html data-camera="on|off"> shows its state.
 */
const FIRST_WIDTH = 640;

let stream: MediaStream | null = null;
let pending: Promise<MediaStream> | null = null;
let users = 0;
let primed = false;
let listening = false;

const mark = (name: string) => {
  try {
    performance.clearMarks(name);
    performance.mark(name);
  } catch {}
};

const live = (s: MediaStream | null) => !!s && s.getVideoTracks().some((t) => t.readyState === "live");
const show = (on: boolean) => (document.documentElement.dataset.camera = on ? "on" : "off");

function stopNow() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  primed = false;
  show(false);
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && stopNow());
  window.addEventListener("pagehide", stopNow);
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
      stream = s;
      show(true);
      // Closed (or never opened) while it was starting: off at once.
      if (users === 0 && !primed) stopNow();
      return s;
    })
    .catch((e) => {
      pending = null;
      primed = false;
      throw e;
    });
  return pending;
}

/** Start the camera now (from the tap that opens a camera screen). The screen's acquire takes it over. */
export function primeCamera() {
  mark("cam:tap");
  primed = true;
  void open().catch(() => {});
  // If no screen claims it shortly (the tap didn't open one), don't leave the camera on.
  setTimeout(() => {
    if (primed && users === 0) stopNow();
  }, 3000);
}

/** The live stream (reused or starting); pair every acquire with a release. */
export function acquireCamera(): Promise<MediaStream> {
  users++;
  primed = false;
  return open();
}

/** The screen is done with the camera: when nothing else uses it, it turns off immediately. */
export function releaseCamera() {
  users = Math.max(0, users - 1);
  if (users === 0) stopNow();
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
