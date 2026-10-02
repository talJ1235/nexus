"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { primeCamera } from "@/lib/camera";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, ArrowRight, Check, Flashlight, ImageUp, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { useI18n } from "@/components/providers";
import { Spinner } from "@/components/ui/spinner";
import type { Pt, Quad, Work } from "@/lib/receipt-detect";
import { type Guide, type LiveFrame, QuadTracker, guidance } from "@/lib/receipt-detect/track";
import { cropTo, detectCorners, prepareReceiptPart, quadToCorners, toCanvas, type CornerPoints } from "@/lib/receipt-image";
import { createLiveDetector } from "@/lib/receipt-live";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { haptic, useCamera } from "./use-camera";

type Part = { canvas: HTMLCanvasElement; corners: CornerPoints; thumb: string };
/** A captured photo; `refine`: corners came from a 640 px live frame — re-detect on the full-resolution still. */
type Shot = { canvas: HTMLCanvasElement; corners: CornerPoints; refine?: boolean };
type Tracked = { q: Quad; w: number; h: number };
const KEYS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

const defaultCorners = (w: number, h: number): CornerPoints => ({
  topLeft: { x: w * 0.08, y: h * 0.06 },
  topRight: { x: w * 0.92, y: h * 0.06 },
  bottomRight: { x: w * 0.92, y: h * 0.94 },
  bottomLeft: { x: w * 0.08, y: h * 0.94 },
});

/** The current video frame at ≤ `max` px as an ImageBitmap (transferable to the detection worker). */
async function grabFrame(v: HTMLVideoElement, max: number): Promise<ImageBitmap | null> {
  const k = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.round(v.videoWidth * k);
  const h = Math.round(v.videoHeight * k);
  try {
    return await createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
  } catch {
    // Older Safari: no resize options on video sources.
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    return createImageBitmap(c).catch(() => null);
  }
}

/** Full-screen receipt camera: live outline (worker detector), auto-capture when steady and sharp, corner adjust, multi-part. */
export function ReceiptCamera() {
  const s = useStore();
  const { t } = useI18n();
  const open = s.scanner === "receipt";
  const [parts, setParts] = useState<Part[]>([]);
  const [shot, setShot] = useState<Shot | null>(null);
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
              // The camera is off while adjusting a shot; Retake / Add another part start it again in the tap.
              onRetake={() => {
                primeCamera();
                setShot(null);
              }}
              onAddPart={async (corners) => {
                primeCamera();
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
  onShot: (s: Shot) => void;
  onClose: () => void;
  onUse: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const { videoRef, state, torch, toggleTorch } = useCamera(active, { width: 1920 });
  const [found, setFound] = useState(false);
  const [steady, setSteady] = useState(0);
  const [guide, setGuide] = useState<Guide>("find");
  const [flash, setFlash] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const poly = useRef<SVGPolygonElement>(null);
  // The tracked quad in detection-frame pixels (640 px long side) and that frame's size.
  const target = useRef<Tracked | null>(null);

  const capture = useCallback(
    (q: Tracked | null) => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      haptic(40);
      setFlash(true);
      setPressed(true);
      setTimeout(() => setFlash(false), 260);
      setTimeout(() => setPressed(false), 180);
      const k = q ? c.width / q.w : 1;
      // Live corners show at once; the adjust step re-detects on the full-resolution still.
      onShot({ canvas: c, corners: q ? quadToCorners(q.q.map((p) => ({ x: p.x * k, y: p.y * k }))) : defaultCorners(c.width, c.height), refine: true });
    },
    [videoRef, onShot],
  );

  // Detection loop: one frame at a time in a worker (frames arriving while it's busy are skipped), smoothed by the
  // tracker; steady ≥ 0.7 s and sharp (≥ 70 % of the session's recent best) → automatic capture.
  useEffect(() => {
    if (!active || state !== "on") return;
    let stop = false;
    const det = createLiveDetector();
    const tracker = new QuadTracker();
    const v = videoRef.current;
    const next = () => {
      if (stop || !v) return;
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(() => void tick());
      else requestAnimationFrame(() => void tick());
    };
    const tick = async () => {
      if (stop || !v) return;
      if (!v.videoWidth || v.readyState < 2) return next();
      const frame = await grabFrame(v, 640);
      const r = frame ? await det.detect(frame) : null;
      if (stop) return;
      if (r) {
        const now = performance.now();
        const f: LiveFrame = { quad: r.quad as Quad | null, score: r.score, edge: r.edge, sharp: r.sharp, light: r.light, w: r.w, h: r.h, t: now };
        const shown = tracker.update(f);
        target.current = shown ? { q: shown, w: r.w, h: r.h } : null;
        const st = tracker.steadiness(now);
        setFound(!!shown);
        setSteady(st);
        setGuide(guidance(f, shown));
        if (shown && st >= 1 && tracker.sharpEnough(r.sharp)) {
          capture({ q: shown, w: r.w, h: r.h });
          return;
        }
      }
      next();
    };
    next();
    return () => {
      stop = true;
      det.close();
      target.current = null;
    };
  }, [active, state, videoRef, capture]);

  // The outline glides to the tracked quad every animation frame (no React render per frame).
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let cur: Pt[] | null = null;
    const glide = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0.35;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = videoRef.current;
      const el = box.current;
      const tq = target.current;
      if (!v || !el || !poly.current || !v.videoWidth) return;
      if (!tq) {
        cur = null;
        return;
      }
      // Frame px → video px → screen (the video is object-cover).
      const kv = v.videoWidth / tq.w;
      const sc = Math.max(el.clientWidth / v.videoWidth, el.clientHeight / v.videoHeight);
      const ox = (el.clientWidth - v.videoWidth * sc) / 2;
      const oy = (el.clientHeight - v.videoHeight * sc) / 2;
      const dest = tq.q.map((p) => ({ x: p.x * kv * sc + ox, y: p.y * kv * sc + oy }));
      cur = cur ? cur.map((p, i) => ({ x: p.x + (dest[i].x - p.x) * glide, y: p.y + (dest[i].y - p.y) * glide })) : dest;
      poly.current.setAttribute("points", cur.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, videoRef]);

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
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden data-receipt-outline={found ? "on" : "off"}>
          <polygon
            ref={poly}
            className={cn("fill-[color-mix(in_srgb,var(--spark)_18%,transparent)] stroke-spark transition-opacity duration-200", found ? "opacity-100" : "opacity-0")}
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </svg>
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
        <p className="rounded-full bg-black/55 px-3.5 py-1.5 text-center text-sm font-medium backdrop-blur" aria-live="polite" data-receipt-guide={camOff ? "camera" : guide}>
          {camOff ? t.receiptCam.noCamera : t.receiptCam.guide[guide]}
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
            onClick={() => capture(target.current)}
            className="relative grid size-[76px] place-items-center rounded-full disabled:opacity-40"
            aria-label={t.receiptCam.shutter}
            data-receipt-shutter
          >
            <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90" aria-hidden>
              <circle cx="38" cy="38" r="35" fill="none" stroke="rgb(255 255 255 / 0.5)" strokeWidth="4" />
              <circle cx="38" cy="38" r="35" fill="none" stroke="var(--spark)" strokeWidth="4" strokeDasharray={`${steady * 220} 220`} strokeLinecap="round" className="transition-[stroke-dasharray] duration-150 ease-linear" />
            </svg>
            <span className={cn("size-[58px] rounded-full bg-white transition-transform duration-150 active:scale-90", pressed && "scale-[0.82]")} />
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

const LOUPE = 120; // px
const LOUPE_ZOOM = 2.5;

/**
 * Drag the 4 corners on the captured photo. A still from the camera is re-detected at full quality first; while a
 * corner is dragged a loupe shows it magnified above the finger, and on release it snaps to a strong corner nearby.
 * The straightened preview updates when a corner is released.
 */
function Adjust({ shot, partsCount, busy, onRetake, onAddPart, onUse }: {
  shot: Shot;
  partsCount: number;
  busy: boolean;
  onRetake: () => void;
  onAddPart: (c: CornerPoints) => void;
  onUse: (c: CornerPoints) => void;
}) {
  const { t } = useI18n();
  const [corners, setCorners] = useState(shot.corners);
  const [finding, setFinding] = useState(!!shot.refine);
  const [preview, setPreview] = useState<string | null>(null);
  const [src] = useState(() => shot.canvas.toDataURL("image/jpeg", 0.85));
  const box = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState({ w: 0, h: 0, k: 1, ox: 0, oy: 0 });
  const [drag, setDrag] = useState<{ key: (typeof KEYS)[number]; x: number; y: number } | null>(null);
  const touched = useRef(false);
  const loupe = useRef<HTMLCanvasElement>(null);
  // Small luma copy of the photo for corner snapping (k = work px per photo px).
  const work = useRef<{ g: Work; k: number } | null>(null);

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
    let gone = false;
    void (async () => {
      const small = await toCanvas(shot.canvas, 1000);
      const { prepare } = await import("@/lib/receipt-detect");
      const g = prepare(small.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height), 1000);
      if (!gone) work.current = { g, k: small.width / shot.canvas.width };
      let start = shot.corners;
      if (shot.refine) {
        const found = await detectCorners(shot.canvas).catch(() => null);
        if (gone) return;
        setFinding(false);
        if (found && !touched.current) {
          start = found.corners;
          setCorners(found.corners);
        }
      }
      if (!gone && !touched.current) await refresh(start);
    })();
    return () => {
      gone = true;
    };
  }, [shot, refresh]);

  // Loupe: the photo around the dragged corner, magnified, with a crosshair.
  useEffect(() => {
    const c = loupe.current;
    if (!drag || !c) return;
    const p = corners[drag.key];
    const span = LOUPE / (rect.k * LOUPE_ZOOM); // photo px shown across the loupe
    const dpr = window.devicePixelRatio || 1;
    c.width = LOUPE * dpr;
    c.height = LOUPE * dpr;
    const x = c.getContext("2d")!;
    x.fillStyle = "#000";
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(shot.canvas, p.x - span / 2, p.y - span / 2, span, span, 0, 0, c.width, c.height);
    x.strokeStyle = "rgba(255,255,255,0.9)";
    x.lineWidth = 1.5 * dpr;
    const m = c.width / 2;
    x.beginPath();
    x.moveTo(m - 12 * dpr, m);
    x.lineTo(m + 12 * dpr, m);
    x.moveTo(m, m - 12 * dpr);
    x.lineTo(m, m + 12 * dpr);
    x.stroke();
  }, [drag, corners, rect.k, shot.canvas]);

  const toPhoto = (e: React.PointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(shot.canvas.width, (e.clientX - b.left - rect.ox) / rect.k)),
      y: Math.max(0, Math.min(shot.canvas.height, (e.clientY - b.top - rect.oy) / rect.k)),
    };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag || !box.current) return;
    const p = toPhoto(e);
    const b = box.current.getBoundingClientRect();
    setCorners((c) => ({ ...c, [drag.key]: p }));
    setDrag({ key: drag.key, x: e.clientX - b.left, y: e.clientY - b.top });
  };
  const onUp = () => {
    if (!drag) return;
    let next = corners;
    const w = work.current;
    if (w) {
      // Snap onto the paper within ~2.5 % of the photo (the finger hides the exact spot): the two sides meeting at
      // this corner are refit to the nearby edges.
      const r = Math.round(Math.max(w.g.w, w.g.h) * 0.025);
      const i = KEYS.indexOf(drag.key);
      const quad = KEYS.map((k) => ({ x: corners[k].x * w.k, y: corners[k].y * w.k }));
      import("@/lib/receipt-detect").then(({ snapCorner }) => {
        const s: Pt | null = snapCorner(w.g, quad, i, r);
        if (s) {
          next = { ...corners, [drag.key]: { x: s.x / w.k, y: s.y / w.k } };
          setCorners(next);
          haptic(8);
        }
        void refresh(next);
      });
    } else void refresh(next);
    setDrag(null);
  };
  const scr = (p: { x: number; y: number }) => ({ x: p.x * rect.k + rect.ox, y: p.y * rect.k + rect.oy });

  return (
    <div className="flex flex-1 flex-col" data-receipt-adjust>
      <div className="flex items-center gap-2 p-4 pt-[max(16px,env(safe-area-inset-top))]">
        <button type="button" onClick={onRetake} className="flex h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-semibold">
          <RotateCcw className="size-4" /> {t.receiptCam.retake}
        </button>
        <span className="flex flex-1 items-center justify-center gap-1.5 text-center text-sm text-white/80" aria-live="polite">
          {finding ? (
            <>
              <Spinner /> {t.receiptCam.finding}
            </>
          ) : (
            t.receiptCam.adjust
          )}
        </span>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local preview
          <img src={preview} alt={t.receiptCam.preview} className="h-14 rounded-md border-2 border-white object-contain shadow" />
        )}
      </div>
      <div ref={box} className="relative min-h-0 flex-1 touch-none" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the captured frame */}
        <img src={src} alt="" className="absolute select-none" style={{ left: rect.ox, top: rect.oy, width: rect.w, height: rect.h }} draggable={false} />
        {rect.w > 0 && (
          <svg className="absolute inset-0 size-full" aria-hidden>
            <polygon
              points={KEYS.map((k) => `${scr(corners[k]).x},${scr(corners[k]).y}`).join(" ")}
              className="fill-[color-mix(in_srgb,var(--spark)_14%,transparent)] stroke-spark"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
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
                data-receipt-corner={k}
                onPointerDown={(e) => {
                  touched.current = true;
                  const b = box.current!.getBoundingClientRect();
                  setDrag({ key: k, x: e.clientX - b.left, y: e.clientY - b.top });
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
                className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full"
                style={{ left: p.x, top: p.y }}
              >
                <span className={cn("size-6 rounded-full border-[3px] border-white bg-spark shadow-lg transition-transform", drag?.key === k && "scale-75")} />
              </button>
            );
          })}
        {drag && (
          <canvas
            ref={loupe}
            aria-hidden
            data-receipt-loupe
            className="pointer-events-none absolute rounded-full border-[3px] border-white shadow-2xl"
            style={{
              width: LOUPE,
              height: LOUPE,
              // Above the finger, kept inside the photo area; below it when there's no room above.
              left: Math.max(4, Math.min(rect.w + 2 * rect.ox - LOUPE - 4, drag.x - LOUPE / 2)),
              top: drag.y - LOUPE - 48 >= 4 ? drag.y - LOUPE - 48 : drag.y + 48,
            }}
          />
        )}
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
