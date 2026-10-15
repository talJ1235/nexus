"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers";
import { cameraInfo, forgetCamera } from "@/lib/camera";
import { decoderInUse, getBarcodeReader } from "@/lib/barcode-reader";
import { useBarcodeReader } from "../barcode-scanner";
import { useCamera } from "../use-camera";

// R18 S4 B2: /debug/camera — the live viewfinder of the scanner's camera (same hook, same tuning) and everything about
// it as text: lens label + how it was chosen, settings, capabilities, the video inputs, the decoder, the last read and
// how long it took. "Pick again" forgets the remembered lens.
export function DebugCamera() {
  const { t } = useI18n();
  const { videoRef, state, stream, torch, toggleTorch } = useCamera(true, { scan: true });
  const [info, setInfo] = useState<Awaited<ReturnType<typeof cameraInfo>> | null>(null);
  const [read, setRead] = useState<{ code: string; format: string; ms: number } | null>(null);
  const [t0] = useState(() => performance.now());
  useEffect(() => {
    void getBarcodeReader().catch(() => null);
    if (state !== "on") return;
    const id = setInterval(() => void cameraInfo(stream()).then(setInfo), 1500);
    void cameraInfo(stream()).then(setInfo);
    return () => clearInterval(id);
  }, [state, stream]);
  useBarcodeReader(videoRef, state === "on", (code, seen) => setRead({ code, format: seen.format, ms: Math.round(performance.now() - t0) }));
  const caps = info?.capabilities as Record<string, unknown> | null | undefined;
  const set = info?.settings as Record<string, unknown> | null | undefined;
  const pick = (o: Record<string, unknown> | null | undefined, keys: string[]) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o![k]]));
  const KEYS = ["width", "height", "frameRate", "focusMode", "focusDistance", "zoom", "torch", "pointsOfInterest", "facingMode", "exposureMode", "whiteBalanceMode"];
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-3 bg-bg p-4 text-ink" data-debug-camera>
      <h1 className="text-[20px] font-extrabold">{t.sm.debugCam.title}</h1>
      <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-black">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="h-11 rounded-[12px] border border-line-strong px-4 font-bold" onClick={() => (forgetCamera(), location.reload())} data-debug-camera-forget>
          {t.sm.debugCam.pickAgain}
        </button>
        {torch.supported && (
          <button type="button" className="h-11 rounded-[12px] border border-line-strong px-4 font-bold" onClick={() => void toggleTorch()}>
            {t.sm.cap.torch}
          </button>
        )}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] bg-surface-2 p-3 text-[12px] leading-snug" dir="ltr" data-debug-camera-info>
        {JSON.stringify(
          {
            state,
            lens: info?.label,
            chosenBy: info?.chosenBy,
            decoder: decoderInUse(),
            settings: pick(set, KEYS),
            capabilities: pick(caps, KEYS),
            lastRead: read,
            inputs: info?.inputs.map((d) => ({ label: d.label, focus: (d.caps as Record<string, unknown> | null)?.focusMode ?? null, zoom: (d.caps as Record<string, unknown> | null)?.zoom ?? null })),
          },
          null,
          2,
        )}
      </pre>
    </main>
  );
}
