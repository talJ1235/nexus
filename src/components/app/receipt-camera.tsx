"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, ArrowRight, Check, Flashlight, ImageUp, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { useI18n } from "@/components/providers";
import { Spinner } from "@/components/ui/spinner";
import { cropTo, detectCorners, prepareReceiptPart, sharpness, toCanvas, type CornerPoints } from "@/lib/receipt-image";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { haptic, useCamera } from "./use-camera";

type Part = { canvas: HTMLCanvasElement; corners: CornerPoints; thumb: string };
const KEYS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
const STABLE_MS = 800;

const defaultCorners = (w: number, h: number): CornerPoints => ({
  topLeft: { x: w * 0.08, y: h * 0.06 },
  topRight: { x: w * 0.92, y: h * 0.06 },
  bottomRight: { x: w * 0.92, y: h * 0.94 },
  bottomLeft: { x: w * 0.08, y: h * 0.94 },
});
const scaleCorners = (c: CornerPoints, k: number): CornerPoints => Object.fromEntries(KEYS.map((key) => [key, { x: c[key].x * k, y: c[key].y * k }])) as unknown as CornerPoints;
const moved = (a: CornerPoints, b: CornerPoints, diag: number) => Math.max(...KEYS.map((k) => Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y))) / diag;
const poly = (c: CornerPoints) => KEYS.map((k) => `${c[k].x},${c[k].y}`).join(" ");

/** Full-screen receipt camera: live outline (scanic), auto-capture when steady and sharp, corner adjust, multi-part. */
export function ReceiptCamera() {
  const s = useStore();
  const { t } = useI18n();
  const open = s.scanner === "receipt";
  const [parts, setParts] = useState<Part[]>([]);
  const [shot, setShot] = useState<{ canvas: HTMLCanvasElement; corners: CornerPoints } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => {
    s.setScanner(null);
    setParts([]);
    setShot(null);
  }, [s]);

  const use = async (all: Part[]) => {
    setBusy(true);
    try {
      const blobs: Blob[] = [];
      for (const p of all) blobs.push(...(await prepareReceiptPart(p.canvas, { corners: p.corners })));
      close();
      s.openReceipt(null, blobs);
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const keep = async (canvas: HTMLCanvasElement, corners: CornerPoints) => {
    const cropped = await cropTo(canvas, corners);
    const th = await toCanvas(cropped, 160);
    return { canvas, corners, thumb: th.toDataURL("image/jpeg", 0.7) };
  };

  return (
    <D.Root open={open} onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Content className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none overlay-in" aria-describedby={undefined} data-receipt-camera>
          <D.Title className="sr-only">{t.phone.receipt}</D.Title>
          {shot ? (
            <Adjust
              shot={shot}
              partsCount={parts.length}
              busy={busy}
              onRetake={() => setShot(null)}
              onAddPart={async (corners) => {
                setParts([...parts, await keep(shot.canvas, corners)]);
                setShot(null);
              }}
              onUse={async (corners) => void use([...parts, await keep(shot.canvas, corners)])}
            />
          ) : (
            <Live
              active={open && !shot}
              parts={parts}
              onParts={setParts}
              onShot={setShot}
              onClose={close}
              onUse={() => void use(parts)}
              busy={busy}
            />
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Live({ active, parts, onParts, onShot, onClose, onUse, busy }: {
  active: boolean;
  parts: Part[];
  onParts: (p: Part[]) => void;
  onShot: (s: { canvas: HTMLCanvasElement; corners: CornerPoints }) => void;
  onClose: () => void;
  onUse: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const { videoRef, state, torch, toggleTorch } = useCamera(active, { width: 1920 });
  const [outline, setOutline] = useState<CornerPoints | null>(null);
  const [steady, setSteady] = useState(0);
  const [flash, setFlash] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const last = useRef<{ c: CornerPoints; since: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const capture = useCallback(
    (corners: CornerPoints | null) => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      haptic(40);
      setFlash(true);
      setTimeout(() => setFlash(false), 260);
      last.current = null;
      onShot({ canvas: c, corners: corners ?? defaultCorners(c.width, c.height) });
    },
    [videoRef, onShot],
  );

  // Live outline: detect on a small frame every ~250 ms; steady (corners move < 2 %) for 0.8 s and sharp → capture.
  useEffect(() => {
    if (!active || state !== "on") return;
    let stop = false;
    let timer = 0;
    const small = document.createElement("canvas");
    const loop = async () => {
      const v = videoRef.current;
      if (stop) return;
      if (v && v.videoWidth) {
        const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        small.width = Math.round(v.videoWidth * k);
        small.height = Math.round(v.videoHeight * k);
        small.getContext("2d")!.drawImage(v, 0, 0, small.width, small.height);
        const found = await detectCorners(small, 640).catch(() => null);
        if (stop) return;
        if (found) {
          const full = scaleCorners(found.corners, 1 / k);
          setOutline(full);
          const diag = Math.hypot(v.videoWidth, v.videoHeight);
          const now = Date.now();
          if (last.current && moved(last.current.c, full, diag) < 0.02) {
            const held = now - last.current.since;
            setSteady(Math.min(1, held / STABLE_MS));
            if (held >= STABLE_MS && sharpness(v) > 35) {
              capture(full);
              return;
            }
          } else last.current = { c: full, since: now };
        } else {
          setOutline(null);
          setSteady(0);
          last.current = null;
        }
      }
      timer = window.setTimeout(loop, 250);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [active, state, videoRef, capture]);

  // Map video pixels → screen (the video is object-cover).
  const v = videoRef.current;
  const vw = v?.videoWidth || 1;
  const vh = v?.videoHeight || 1;
  const sc = Math.max(view.w / vw, view.h / vh);
  const ox = (view.w - vw * sc) / 2;
  const oy = (view.h - vh * sc) / 2;
  const toScreen = (c: CornerPoints) => Object.fromEntries(KEYS.map((k) => [k, { x: c[k].x * sc + ox, y: c[k].y * sc + oy }])) as unknown as CornerPoints;
  const camOff = state === "denied" || state === "unavailable";

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const c = await toCanvas(file, 3000);
    const found = await detectCorners(c).catch(() => null);
    onShot({ canvas: c, corners: found?.corners ?? defaultCorners(c.width, c.height) });
  };

  return (
    <>
      <div ref={box} className="absolute inset-0">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted />
        {outline && view.w > 0 && (
          <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
            <polygon points={poly(toScreen(outline))} className="fill-[color-mix(in_srgb,var(--spark)_18%,transparent)] stroke-spark transition-[points] duration-200" strokeWidth={3} strokeLinejoin="round" />
          </svg>
        )}
        <div className={cn("pointer-events-none absolute inset-0 bg-white transition-opacity duration-200", flash ? "opacity-80" : "opacity-0")} />
      </div>

      <div className="relative z-10 flex items-center gap-2 p-4 pt-[max(16px,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full bg-black/45 backdrop-blur" aria-label={t.phone.closeMenu}>
          <X className="size-5" />
        </button>
        <span className="flex-1 text-center text-[15px] font-bold">{t.phone.receipt}</span>
        {torch.supported ? (
          <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} aria-label={t.barcode.torch} className={cn("grid size-11 place-items-center rounded-full backdrop-blur", torch.on ? "bg-white text-black" : "bg-black/45")}>
            <Flashlight className="size-5" />
          </button>
        ) : (
          <span className="size-11" />
        )}
      </div>

      <div className="relative z-10 mt-auto flex flex-col items-center gap-4 p-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        <p className="rounded-full bg-black/45 px-3 py-1.5 text-center text-sm backdrop-blur">
          {camOff ? t.receiptCam.noCamera : outline ? (steady > 0.3 ? t.receiptCam.hold : t.receiptCam.found) : t.receiptCam.hint}
        </p>
        <div className="flex w-full items-center justify-between">
          {/* Parts taken so far (long receipts): a small stack; tap to reorder / remove. */}
          <div className="relative w-24">
            {parts.length > 0 && (
              <button type="button" onClick={() => setStackOpen(!stackOpen)} className="relative block h-16 w-12" aria-label={`${parts.length}`} data-receipt-parts={parts.length}>
                {parts.slice(-3).map((p, i, arr) => (
                  // eslint-disable-next-line @next/next/no-img-element -- local data URL thumbnail
                  <img key={i} src={p.thumb} alt="" className="absolute inset-0 size-full rounded-md border-2 border-white object-cover shadow" style={{ transform: `rotate(${(i - arr.length + 1) * 6}deg)` }} />
                ))}
                <span className="tabular absolute -end-2 -top-2 grid size-6 place-items-center rounded-full bg-spark text-xs font-bold text-black">{parts.length}</span>
              </button>
            )}
            {stackOpen && parts.length > 0 && (
              <div className="absolute bottom-20 start-0 flex gap-2 rounded-[18px] bg-black/70 p-2 backdrop-blur">
                {parts.map((p, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data URL thumbnail */}
                    <img src={p.thumb} alt="" className="h-16 w-12 rounded-md object-cover" />
                    <div className="flex gap-0.5">
                      <button type="button" disabled={i === 0} onClick={() => onParts(swap(parts, i, i - 1))} className="grid size-7 place-items-center rounded-full bg-white/15 disabled:opacity-30" aria-label="←">
                        <ArrowLeft className="size-3.5 rtl:-scale-x-100" />
                      </button>
                      <button type="button" onClick={() => onParts(parts.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-full bg-white/15" aria-label={t.receiptCam.remove}>
                        <X className="size-3.5" />
                      </button>
                      <button type="button" disabled={i === parts.length - 1} onClick={() => onParts(swap(parts, i, i + 1))} className="grid size-7 place-items-center rounded-full bg-white/15 disabled:opacity-30" aria-label="→">
                        <ArrowRight className="size-3.5 rtl:-scale-x-100" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Shutter (manual capture is always available); the ring fills while the outline holds steady. */}
          <button
            type="button"
            disabled={state !== "on"}
            onClick={() => capture(outline)}
            className="relative grid size-[76px] place-items-center rounded-full disabled:opacity-40"
            aria-label={t.receiptCam.shutter}
            data-receipt-shutter
          >
            <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90" aria-hidden>
              <circle cx="38" cy="38" r="35" fill="none" stroke="rgb(255 255 255 / 0.5)" strokeWidth="4" />
              <circle cx="38" cy="38" r="35" fill="none" stroke="var(--spark)" strokeWidth="4" strokeDasharray={`${steady * 220} 220`} strokeLinecap="round" />
            </svg>
            <span className="size-[58px] rounded-full bg-white transition-transform active:scale-90" />
          </button>
          <div className="flex w-24 justify-end">
            {parts.length > 0 ? (
              <button type="button" onClick={onUse} disabled={busy} className="flex h-12 items-center gap-1.5 rounded-full bg-brand px-4 font-bold text-on-brand" data-receipt-use>
                {busy ? <Spinner /> : <Check className="size-4" />} {t.receiptCam.use}
              </button>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="grid size-12 place-items-center rounded-full bg-black/45 backdrop-blur" aria-label={t.receiptCam.pick} data-receipt-pick>
                <ImageUp className="size-5" />
              </button>
            )}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
        {camOff && (
          <button type="button" onClick={() => fileRef.current?.click()} className="h-12 rounded-full bg-white px-5 font-bold text-black">
            {t.receiptCam.pick}
          </button>
        )}
      </div>
    </>
  );
}

const swap = <T,>(arr: T[], a: number, b: number) => {
  const out = arr.slice();
  [out[a], out[b]] = [out[b], out[a]];
  return out;
};

/** Drag the 4 corners on the captured photo; a straightened preview updates when a corner is released. */
function Adjust({ shot, partsCount, busy, onRetake, onAddPart, onUse }: {
  shot: { canvas: HTMLCanvasElement; corners: CornerPoints };
  partsCount: number;
  busy: boolean;
  onRetake: () => void;
  onAddPart: (c: CornerPoints) => void;
  onUse: (c: CornerPoints) => void;
}) {
  const { t } = useI18n();
  const [corners, setCorners] = useState(shot.corners);
  const [preview, setPreview] = useState<string | null>(null);
  const [src] = useState(() => shot.canvas.toDataURL("image/jpeg", 0.85));
  const box = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState({ w: 0, h: 0, k: 1, ox: 0, oy: 0 });
  const drag = useRef<(typeof KEYS)[number] | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const k = Math.min(el.clientWidth / shot.canvas.width, el.clientHeight / shot.canvas.height);
      setRect({ w: shot.canvas.width * k, h: shot.canvas.height * k, k, ox: (el.clientWidth - shot.canvas.width * k) / 2, oy: (el.clientHeight - shot.canvas.height * k) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shot.canvas]);

  const refresh = useCallback(async (c: CornerPoints) => {
    const out = await cropTo(shot.canvas, c);
    setPreview((await toCanvas(out, 360)).toDataURL("image/jpeg", 0.8));
  }, [shot.canvas]);
  useEffect(() => {
    void refresh(shot.corners);
  }, [refresh, shot.corners]);

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(shot.canvas.width, (e.clientX - b.left - rect.ox) / rect.k));
    const y = Math.max(0, Math.min(shot.canvas.height, (e.clientY - b.top - rect.oy) / rect.k));
    setCorners((c) => ({ ...c, [drag.current!]: { x, y } }));
  };
  const scr = (p: { x: number; y: number }) => ({ x: p.x * rect.k + rect.ox, y: p.y * rect.k + rect.oy });

  return (
    <div className="flex flex-1 flex-col" data-receipt-adjust>
      <div className="flex items-center gap-2 p-4 pt-[max(16px,env(safe-area-inset-top))]">
        <button type="button" onClick={onRetake} className="flex h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-semibold">
          <RotateCcw className="size-4" /> {t.receiptCam.retake}
        </button>
        <span className="flex-1 text-center text-sm text-white/80">{t.receiptCam.adjust}</span>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local preview
          <img src={preview} alt={t.receiptCam.preview} className="h-14 rounded-md border-2 border-white object-contain shadow" />
        )}
      </div>
      <div
        ref={box}
        className="relative min-h-0 flex-1 touch-none"
        onPointerMove={onMove}
        onPointerUp={() => {
          if (drag.current) void refresh(corners);
          drag.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the captured frame */}
        <img src={src} alt="" className="absolute select-none" style={{ left: rect.ox, top: rect.oy, width: rect.w, height: rect.h }} draggable={false} />
        {rect.w > 0 && (
          <svg className="absolute inset-0 size-full" aria-hidden>
            <polygon points={KEYS.map((k) => `${scr(corners[k]).x},${scr(corners[k]).y}`).join(" ")} className="fill-[color-mix(in_srgb,var(--spark)_14%,transparent)] stroke-spark" strokeWidth={2.5} strokeLinejoin="round" />
          </svg>
        )}
        {rect.w > 0 &&
          KEYS.map((k) => {
            const p = scr(corners[k]);
            return (
              <button
                key={k}
                type="button"
                aria-label={k}
                onPointerDown={(e) => {
                  drag.current = k;
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
                className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full"
                style={{ left: p.x, top: p.y }}
              >
                <span className="size-6 rounded-full border-[3px] border-white bg-spark shadow-lg" />
              </button>
            );
          })}
      </div>
      <div className="flex gap-2 p-4 pb-[max(20px,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => onAddPart(corners)} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/15 text-sm font-bold" data-receipt-add-part>
          <Plus className="size-4" /> {t.receiptCam.addPart}
        </button>
        <button type="button" disabled={busy} onClick={() => onUse(corners)} className="flex h-12 flex-[1.3] items-center justify-center gap-1.5 rounded-full bg-brand text-sm font-bold text-on-brand disabled:opacity-60" data-receipt-use>
          {busy ? <Spinner /> : <Check className="size-4" />} {partsCount ? `${t.receiptCam.use} (${partsCount + 1})` : t.receiptCam.use}
        </button>
      </div>
    </div>
  );
}
