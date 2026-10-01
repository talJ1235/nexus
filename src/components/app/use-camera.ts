"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Back camera into a <video>, with torch control where the device supports it. Stops on unmount / `active=false`. */
export function useCamera(active: boolean, opts: { width?: number } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "on" | "denied" | "unavailable">("idle");
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const width = opts.width ?? 1280;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      setState("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: width }, height: { ideal: Math.round((width * 3) / 4) } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.setAttribute("playsinline", "");
          v.muted = true;
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setState("idle");
    };
  }, [active, width]);

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
