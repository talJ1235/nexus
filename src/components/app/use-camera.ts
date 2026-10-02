"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acquireCamera, cameraMark, releaseCamera, upgradeCamera } from "@/lib/camera";

/**
 * Back camera into a <video>, with torch control where the device supports it. The stream is the shared one from
 * lib/camera (started at the tap, kept a minute after closing); it's upgraded to `width` after the first frame.
 */
export function useCamera(active: boolean, opts: { width?: number } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "on" | "denied" | "unavailable">("idle");
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const width = opts.width ?? 1280;
  const torchOn = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let video: HTMLVideoElement | null = null; // read after the await: a portalled <video> mounts a commit later
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      setState("starting");
      try {
        const stream = await acquireCamera();
        if (cancelled) return;
        streamRef.current = stream;
        // A reused stream resolves at once, possibly before the portalled <video> exists: give it a few frames.
        for (let i = 0; !videoRef.current && i < 10 && !cancelled; i++) await new Promise((r) => requestAnimationFrame(r));
        if (cancelled) return;
        const v = (video = videoRef.current);
        if (v) {
          v.srcObject = stream;
          v.setAttribute("playsinline", "");
          v.muted = true;
          const first = () => {
            cameraMark("cam:frame");
            void upgradeCamera(stream, width);
          };
          // loadeddata = the first frame is decoded (rVFC would wait for a composited frame, and the viewfinder only
          // fades the video in once it plays).
          if (v.readyState >= 2) first();
          else v.addEventListener("loadeddata", first, { once: true });
          await v.play().catch(() => {});
        }
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorch({ supported: !!caps.torch, on: false });
        setState("on");
      } catch (e) {
        if (cancelled) return;
        setState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "unavailable");
      }
    };
    void start();
    return () => {
      cancelled = true;
      // The torch goes off with the screen; the stream itself is released to the shared keeper.
      const track = streamRef.current?.getVideoTracks()[0];
      if (track && torchOn.current) void track.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {});
      torchOn.current = false;
      const v = video;
      if (v) v.srcObject = null;
      streamRef.current = null;
      releaseCamera();
      setState("idle");
    };
  }, [active, width]);
  useEffect(() => {
    torchOn.current = torch.on;
  }, [torch.on]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch((t) => ({ ...t, on }));
    } catch {}
  }, [torch.on]);

  return { videoRef, state, torch, toggleTorch };
}

/** A short haptic tick where supported (Android); silent elsewhere. */
export const haptic = (ms = 25) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

/** Shrink a photo to a JPEG data URL (long side ≤ `max`). */
export async function photoToDataUrl(file: Blob, max = 1280, quality = 0.82): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", quality);
}
