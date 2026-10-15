"use client";

/**
 * One shared back-camera stream for the barcode scanner and the receipt camera (Round 10 B1: open fast).
 * - `primeCamera()` is called in the tap handler itself, so getUserMedia starts before React renders the viewfinder.
 * - The first request asks for a modest resolution (cameras start faster); `upgradeCamera()` raises it after the first
 *   frame for the screen that needs more.
 * - The camera turns off the moment no screen uses it (closing the scanner / receipt camera, or a photo taken), and
 *   when the page is hidden — Tal's choice: no keep-alive. A start that resolves after the screen closed stops at once.
 * Timings land as performance marks (cam:tap → cam:frame, scan:decoder); <html data-camera="on|off"> shows its state.
 * R18 S4 B2: the main back lens, not whatever `facingMode: environment` gives (on multi-camera Androids that can be the
 * ultra-wide, which can't focus close): after the permission the video inputs are compared (`pickCamera`: continuous
 * focus, zoom range, never "wide" / "ultra") and the choice is remembered on this device; scanning asks for 1920×1080,
 * continuous focus and a slight zoom (`tuneForScan`), tap-to-focus where the lens has points of interest (`focusAt`).
 */
import { pickCamera, scanZoom, type CamInfo } from "./barcode-scan";

const FIRST_WIDTH = 640;
const PICK_KEY = "nexus:camera";
type Caps = MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min?: number; max?: number; step?: number }; torch?: boolean; pointsOfInterest?: unknown };

const remembered = () => {
  try {
    return localStorage.getItem(PICK_KEY);
  } catch {
    return null;
  }
};
let chosenBy: "remembered" | "picked" | "default" = "default";

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
  const base = { width: { ideal: FIRST_WIDTH }, height: { ideal: Math.round((FIRST_WIDTH * 3) / 4) } };
  const id = remembered();
  const env = { audio: false, video: { facingMode: { ideal: "environment" }, ...base } };
  // The remembered lens first; gone (another phone, a new browser profile) → the default back camera.
  const get = id
    ? navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: id }, ...base } }).then(
        (s) => ((chosenBy = "remembered"), s),
        () => {
          forget();
          return navigator.mediaDevices.getUserMedia(env);
        },
      )
    : navigator.mediaDevices.getUserMedia(env);
  pending = get
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

function forget() {
  try {
    localStorage.removeItem(PICK_KEY);
  } catch {}
}

/**
 * After the permission: the main back lens among the video inputs. Returns a stream on that lens when it differs from
 * the one running (the caller swaps it in), else null. Remembered, so the next open goes straight to it.
 */
export async function pickMainCamera(current: MediaStream): Promise<MediaStream | null> {
  if (remembered() || !navigator.mediaDevices?.enumerateDevices) return null;
  const now = current.getVideoTracks()[0];
  const devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput" && d.deviceId);
  const list: CamInfo[] = devices.map((d) => ({ id: d.deviceId, label: d.label, caps: ((d as InputDeviceInfo).getCapabilities?.() as Caps | undefined) ?? null }));
  const pick = pickCamera(list);
  const nowId = now?.getSettings().deviceId;
  if (!pick || !nowId) return null;
  try {
    localStorage.setItem(PICK_KEY, pick);
  } catch {}
  chosenBy = "picked";
  if (pick === nowId) return null;
  try {
    const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: pick }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    current.getTracks().forEach((t) => t.stop());
    stream = next;
    return next;
  } catch {
    forget();
    return null;
  }
}

/** Scanning: 1920×1080, continuous focus and a slight zoom where the lens has them (each step on its own). */
export async function tuneForScan(s: MediaStream) {
  const track = s.getVideoTracks()[0];
  if (!track) return;
  const caps = (track.getCapabilities?.() ?? {}) as Caps;
  await track.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 } }).catch(() => {});
  if (caps.focusMode?.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
  const z = scanZoom(caps.zoom);
  if (z != null) await track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }).catch(() => {});
}

/** Tap-to-focus at (x, y) in 0…1 of the frame, then back to continuous focus. */
export async function focusAt(s: MediaStream, x: number, y: number) {
  const track = s.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as Caps;
  if (!track || !("pointsOfInterest" in caps)) return false;
  const single = caps.focusMode?.includes("single-shot");
  await track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }], ...(single ? { focusMode: "single-shot" } : {}) } as MediaTrackConstraintSet] }).catch(() => {});
  if (single && caps.focusMode?.includes("continuous")) setTimeout(() => void track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {}), 1500);
  return true;
}

/** What /debug/camera prints: the lens in use, how it was chosen, its settings and capabilities, every video input. */
export async function cameraInfo(s: MediaStream | null) {
  const track = s?.getVideoTracks()[0];
  const devices = navigator.mediaDevices?.enumerateDevices ? (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput") : [];
  return {
    label: track?.label ?? null,
    chosenBy,
    remembered: remembered(),
    settings: track?.getSettings?.() ?? null,
    capabilities: (track?.getCapabilities?.() ?? null) as Caps | null,
    inputs: devices.map((d) => ({ id: d.deviceId.slice(0, 8), label: d.label, caps: ((d as InputDeviceInfo).getCapabilities?.() as Caps | undefined) ?? null })),
  };
}

/** Forget the chosen lens (the debug page's "Pick again"). */
export const forgetCamera = forget;
