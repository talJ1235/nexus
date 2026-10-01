"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Camera, Check, ExternalLink, Flashlight, Keyboard, Package, PackageCheck, ScanLine, Truck, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { addScannedItem, identifyProductPhoto, lookupBarcode, type BarcodeResult } from "@/app/barcode-actions";
import { useI18n } from "@/components/providers";
import { Spinner } from "@/components/ui/spinner";
import type { LookupHit } from "@/lib/barcode";
import { normalizeCategory } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { ProductImage, useStatusFlow } from "./item-card";
import { useStore } from "./store";
import { haptic, photoToDataUrl, useCamera } from "./use-camera";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
  }
}

/** Reads barcodes from the live video: native BarcodeDetector where available, else zxing-wasm (lazy, self-hosted). */
function useBarcodeReader(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean, onCode: (code: string) => void) {
  const cb = useRef(onCode);
  useEffect(() => {
    cb.current = onCode;
  }, [onCode]);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer = 0;
    let last = "";
    let lastAt = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const emit = (code: string) => {
      // Two matching reads in a row (≤1.2 s apart) before acting: no half-seen misreads.
      const now = Date.now();
      if (code === last && now - lastAt < 1200) {
        last = "";
        cb.current(code);
      } else {
        last = code;
        lastAt = now;
      }
    };
    (async () => {
      let read: (v: HTMLVideoElement) => Promise<string | null>;
      const native = window.BarcodeDetector && (await window.BarcodeDetector.getSupportedFormats?.().catch((): string[] => []))?.includes("ean_13");
      if (native) {
        const det = new window.BarcodeDetector!({ formats: FORMATS });
        read = async (v) => (await det.detect(v).catch(() => []))[0]?.rawValue ?? null;
      } else {
        const z = await import("zxing-wasm/reader");
        z.setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/vendor/zxing_reader.wasm" : prefix + path) });
        read = async (v) => {
          const w = 720;
          const h = Math.round((v.videoHeight / v.videoWidth) * w) || 540;
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(v, 0, 0, w, h);
          const r = await z.readBarcodes(ctx.getImageData(0, 0, w, h), { formats: ["EAN13", "EAN8", "UPCA", "UPCE", "Code128"], tryHarder: true, maxNumberOfSymbols: 1 });
          return r.find((x) => x.isValid)?.text ?? null;
        };
      }
      const loop = async () => {
        if (stop) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2 && v.videoWidth) {
          const code = await read(v).catch(() => null);
          if (code && !stop) emit(code);
        }
        timer = window.setTimeout(loop, native ? 120 : 200);
      };
      void loop();
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [active, videoRef]);
}

/** Full-screen live camera with a scan frame. `onCode` set → continuous mode (shopping); otherwise look up + result. */
export function BarcodeScanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode?: (code: string) => void }) {
  const { t } = useI18n();
  const [result, setResult] = useState<BarcodeResult | "loading" | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const { videoRef, state: camState, torch, toggleTorch } = useCamera(open);
  const paused = !!result;
  const handle = async (code: string) => {
    haptic();
    if (onCode) return onCode(code);
    setResult("loading");
    try {
      setResult(await lookupBarcode(code));
    } catch {
      setResult(null);
      toast.error(t.errors.generic);
    }
  };
  useBarcodeReader(videoRef, open && camState === "on" && !paused && !typing, (c) => void handle(c));
  useEffect(() => {
    if (!open) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- reset when closed */
      setResult(null);
      setTyping(false);
      setTyped("");
    }
  }, [open]);
  const camOff = camState === "denied" || camState === "unavailable";

  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Content className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none overlay-in" aria-describedby={undefined} data-barcode-scanner>
          <D.Title className="sr-only">{t.barcode.title}</D.Title>
          <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted />
          {/* Frame */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative h-[34vw] max-h-[200px] w-[78vw] max-w-[440px] rounded-[26px] shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)]">
              {["start-0 top-0 border-s-4 border-t-4 rounded-ss-[26px]", "end-0 top-0 border-e-4 border-t-4 rounded-se-[26px]", "start-0 bottom-0 border-s-4 border-b-4 rounded-es-[26px]", "end-0 bottom-0 border-e-4 border-b-4 rounded-ee-[26px]"].map((c) => (
                <span key={c} className={cn("absolute size-9 border-white", c)} />
              ))}
              {!paused && camState === "on" && <span className="scan-line absolute inset-x-5 top-1/2 h-0.5 rounded-full bg-spark shadow-[0_0_14px_var(--spark)]" />}
            </div>
          </div>
          {/* Top bar */}
          <div className="relative z-10 flex items-center gap-2 p-4 pt-[max(16px,env(safe-area-inset-top))]">
            <D.Close className="grid size-11 place-items-center rounded-full bg-black/45 backdrop-blur" aria-label={t.phone.closeMenu}>
              <X className="size-5" />
            </D.Close>
            <span className="flex-1 text-center text-[15px] font-bold">{t.barcode.title}</span>
            {torch.supported ? (
              <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} aria-label={t.barcode.torch} className={cn("grid size-11 place-items-center rounded-full backdrop-blur", torch.on ? "bg-white text-black" : "bg-black/45")}>
                <Flashlight className="size-5" />
              </button>
            ) : (
              <span className="size-11" />
            )}
          </div>
          <div className="relative z-10 mt-auto flex flex-col gap-3 p-4 pb-[max(20px,env(safe-area-inset-bottom))]">
            {!result && (
              <p className="text-center text-sm text-white/85">
                {camOff ? t.barcode.noCamera : camState === "on" ? t.barcode.hint : <Spinner className="inline-block size-4" />}
              </p>
            )}
            {!result && (typing || camOff ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typed.trim()) void handle(typed.trim());
                }}
              >
                <input
                  autoFocus
                  inputMode="numeric"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={t.barcode.typeCode}
                  aria-label={t.barcode.typeCode}
                  data-barcode-input
                  className="h-12 min-w-0 flex-1 rounded-full bg-white px-5 text-[16px] text-black outline-none"
                />
                <button type="submit" className="h-12 rounded-full bg-brand px-5 font-bold text-on-brand">
                  {t.barcode.lookup}
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setTyping(true)} className="mx-auto flex h-11 items-center gap-2 rounded-full bg-black/45 px-4 text-sm font-semibold backdrop-blur" data-barcode-type>
                <Keyboard className="size-4" /> {t.barcode.typeCode}
              </button>
            ))}
            {result && !onCode && <ResultCard result={result} onNext={() => { setResult(null); setTyped(""); }} onDone={onClose} />}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ResultCard({ result, onNext, onDone }: { result: BarcodeResult | "loading"; onNext: () => void; onDone: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  const flow = useStatusFlow();
  const [hit, setHit] = useState<LookupHit | null>(result === "loading" ? null : result.hit);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(s.view.type === "collection" ? s.view.id : null);
  const photo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- follow the latest lookup */
    setHit(result === "loading" ? null : result.hit);
  }, [result]);

  const card = "rounded-[26px] bg-surface p-4 text-ink shadow-pop animate-pop-in";
  if (result === "loading")
    return (
      <div className={cn(card, "flex items-center gap-3")}>
        <Spinner /> {t.barcode.looking}
      </div>
    );
  const item = result.item ? (s.items.find((i) => i.id === result.item!.id) ?? result.item) : null;

  if (item) {
    return (
      <div className={card} data-barcode-result="own">
        <div className="flex items-center gap-3">
          <ProductImage src={item.imageUrl} alt="" className="size-14 shrink-0 rounded-[17px]" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-ok">{t.barcode.onList}</div>
            <div className="truncate font-bold bidi">{item.title}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {item.status !== "purchased" && (
            <button type="button" className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-brand text-sm font-bold text-on-brand" onClick={() => void flow.setTo(item, "purchased").then(onNext)}>
              <PackageCheck className="size-4" /> {t.barcode.markBought}
            </button>
          )}
          {item.status === "to_buy" && (
            <button type="button" className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-surface-2 text-sm font-bold" onClick={() => void flow.setTo(item, "ordered").then(onNext)}>
              <Truck className="size-4" /> {t.barcode.markOrdered}
            </button>
          )}
          <button type="button" className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-surface-2 text-sm font-bold" onClick={() => { onDone(); s.openItem(item.id); }}>
            <ExternalLink className="size-4" /> {t.barcode.open}
          </button>
          <button type="button" className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-surface-2 text-sm font-bold" onClick={onNext}>
            <ScanLine className="size-4" /> {t.barcode.next}
          </button>
        </div>
      </div>
    );
  }

  const add = async (status: "to_buy" | "purchased") => {
    if (!hit) return;
    setBusy(true);
    try {
      const created = await addScannedItem({ title: hit.title, brand: hit.brand ?? null, image: hit.image ?? null, category: hit.category ?? null, collectionId, code: result.code, status });
      s.upsertItem(created);
      s.markFresh(created.id);
      toast.success(status === "purchased" ? t.barcode.addedBought : t.barcode.added, {
        description: created.title,
        action: { label: t.barcode.open, onClick: () => s.openItem(created.id) },
      });
      onNext();
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async (file: File | undefined) => {
    if (!file) return;
    setNaming(true);
    try {
      const image = await photoToDataUrl(file, 1024);
      const named = await identifyProductPhoto({ image, code: result.code });
      if (named) setHit(named);
      else toast.error(t.errors.generic);
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setNaming(false);
    }
  };

  if (!hit) {
    return (
      <div className={card} data-barcode-result="none">
        <div className="flex items-center gap-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-[17px] bg-surface-2 text-muted">
            <Package className="size-6" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="font-bold">{result.cls.kind === "store" ? t.barcode.storeCode : t.barcode.notFound}</div>
            <div className="text-sm text-muted">{t.barcode.photoHint}</div>
          </div>
        </div>
        <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void takePhoto(e.target.files?.[0])} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!result.canPhoto || naming} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-brand text-sm font-bold text-on-brand disabled:opacity-50" onClick={() => photo.current?.click()}>
            {naming ? <Spinner /> : <Camera className="size-4" />} {naming ? t.barcode.naming : t.barcode.takePhoto}
          </button>
          <button type="button" className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-surface-2 text-sm font-bold" onClick={onNext}>
            <ScanLine className="size-4" /> {t.barcode.next}
          </button>
        </div>
      </div>
    );
  }

  const cat = normalizeCategory(hit.category);
  const collections = s.collections.filter((c) => !c.archived);
  return (
    <div className={card} data-barcode-result="found">
      <div className="flex items-center gap-3">
        <ProductImage src={hit.image ?? null} alt="" className="size-14 shrink-0 rounded-[17px]" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-muted">
            {t.barcode.found} · {t.barcode.from[hit.source]}
          </div>
          <div className="line-clamp-2 font-bold leading-snug bidi">{hit.title}</div>
          {(hit.brand || cat) && <div className="truncate text-xs text-muted">{[hit.brand, cat && t.categories[cat]].filter(Boolean).join(" · ")}</div>}
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <span className="shrink-0 text-muted">{t.barcode.list}</span>
        <select value={collectionId ?? ""} onChange={(e) => setCollectionId(e.target.value || null)} className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-3 text-sm outline-none" data-barcode-collection>
          <option value="">{t.barcode.none}</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-brand text-sm font-bold text-on-brand disabled:opacity-60" onClick={() => void add("to_buy")} data-barcode-add>
          {busy ? <Spinner /> : <Check className="size-4" />} {t.barcode.addToList}
        </button>
        <button type="button" disabled={busy} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-surface-2 text-sm font-bold" onClick={() => void add("purchased")}>
          <PackageCheck className="size-4" /> {t.barcode.boughtIt}
        </button>
      </div>
      <button type="button" className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-full text-sm font-semibold text-muted" onClick={onNext}>
        <ScanLine className="size-4" /> {t.barcode.next}
      </button>
    </div>
  );
}
