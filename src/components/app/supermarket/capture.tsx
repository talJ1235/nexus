"use client";

import "./sm.css";
import { useEffect, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Check, Clock, Flashlight, Info, Keyboard, ListChecks, Minus, Package, Plus, ReceiptText, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useBackClose } from "@/components/ui/sheet-drag";
import { Spinner } from "@/components/ui/spinner";
import { addToSupermarket, smAiAllowance, smPhoto, smScan, undoSupermarketAdd, type CaptureProduct, type PhotoKind, type PhotoResult, type ScanResult } from "@/app/supermarket-actions";
import { createItem } from "@/app/actions";
import { classifyLocal } from "@/lib/grocery/classify";
import { SECTION_KEYS, sectionName } from "@/lib/grocery/sections";
import { unitKgFor } from "@/lib/grocery/weights";
import { getBarcodeReader, prewarmScanners } from "@/lib/barcode-reader";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useBarcodeReader } from "../barcode-scanner";
import { useStore } from "../store";
import { haptic, photoToDataUrl, useCamera } from "../use-camera";
import { ProductTile, SectionIcon } from "./art";
import { useSmHome } from "./data";
import { asItem } from "./numbers";
import { qtyLabel } from "./qty";

// R18 S2 B3 — scan + photo for the supermarket (board Capture-phone). Barcode: the home's own product (found / already on
// the list, with the merged count), a public one, or an unknown barcode named once (section guess; the barcode stays with
// the home's row, so next time it's found at once). Photo: read by the AI (counts in the person's quota, feature
// `grocery`), matched to the home's product, else three choices; at the daily limit, typing and the barcode still work.
// R18 S3 C2: the same one read says what the photo is — a product, a receipt (→ the receipt review) or a list (→ the
// Paste review with its lines) — with a switch to the other two; a product that isn't a grocery goes to Products.

type Sheet = { kind: "loading" } | ScanResult | PhotoResult | { kind: "reading" };
const isScan = (x: Sheet): x is ScanResult => "state" in x && (x.state === "found" || x.state === "unknown");

type OnType = (text?: string, hint?: "camera" | "list") => void;

export function Capture({ open, mode: start, onClose, onType }: { open: boolean; mode: "scan" | "photo"; onClose: () => void; onType: OnType }) {
  // R18 S3 A3: the phone's Back closes the camera instead of leaving the page.
  useBackClose(open, onClose);
  const { t } = useI18n();
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Content className="sm-rise overlay-in fixed inset-0 z-50 flex flex-col bg-black text-white outline-none" aria-describedby={undefined} data-sm-capture>
          <D.Title className="sr-only">{t.sm.cap.title}</D.Title>
          {open && <CaptureBody start={start} onClose={onClose} onType={onType} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function CaptureBody({ start, onClose, onType }: { start: "scan" | "photo"; onClose: () => void; onType: OnType }) {
  const s = useStore();
  const { t, f } = useI18n();
  // The last photo: the small copy the AI read and a sharper one for the receipt review.
  const shot = useRef<{ image: string; full: Blob | null } | null>(null);
  const [mode, setMode] = useState(start);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [allow, setAllow] = useState<{ used: number; limit: number | null } | null>(null);
  const { videoRef, state: cam, torch, toggleTorch } = useCamera(true);
  const camOff = cam === "denied" || cam === "unavailable";
  const fileRef = useRef<HTMLInputElement>(null);
  // R18 S3 C1: camera permission refused → the Add screen with a one-line hint (no camera at all keeps the code field).
  useEffect(() => {
    if (cam === "denied") onType(undefined, "camera");
  }, [cam, onType]);

  useEffect(() => {
    prewarmScanners();
    void getBarcodeReader().catch(() => null);
  }, []);
  useEffect(() => {
    if (mode !== "photo") return;
    let live = true;
    void smAiAllowance().then((a) => live && setAllow({ used: a.used, limit: a.limit }), () => {});
    return () => {
      live = false;
    };
  }, [mode]);

  const scan = async (code: string) => {
    haptic();
    setSheet({ kind: "loading" });
    try {
      setSheet(await smScan(code));
    } catch {
      setSheet(null);
      toast.error(t.sm.cap.failed);
    }
  };
  useBarcodeReader(videoRef, mode === "scan" && cam === "on" && !sheet && !typing, (c) => void scan(c));

  const read = async (image: string, full: Blob | null = null) => {
    shot.current = { image, full };
    setSheet({ kind: "reading" });
    try {
      const r = await smPhoto({ image });
      setSheet(r.state === "failed" ? null : r);
      if (r.state === "failed") toast.error(t.sm.cap.failed);
      void smAiAllowance().then((a) => setAllow({ used: a.used, limit: a.limit }), () => {});
    } catch {
      setSheet(null);
      toast.error(t.sm.cap.failed);
    }
  };
  const shoot = async () => {
    haptic();
    const v = videoRef.current;
    if (v && v.videoWidth) {
      const c = document.createElement("canvas");
      const k = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const image = c.toDataURL("image/jpeg", 0.82);
      // A receipt needs more pixels than the read: the frame up to 2048 px, kept in case it is one.
      const big = document.createElement("canvas");
      const kb = Math.min(1, 2048 / Math.max(v.videoWidth, v.videoHeight));
      big.width = Math.round(v.videoWidth * kb);
      big.height = Math.round(v.videoHeight * kb);
      big.getContext("2d")!.drawImage(v, 0, 0, big.width, big.height);
      const full = await new Promise<Blob | null>((r) => big.toBlob(r, "image/jpeg", 0.9));
      return read(image, full);
    }
    fileRef.current?.click();
  };

  const seg = (on: boolean) => cn("h-9 flex-1 rounded-[10px] text-[14px] font-bold transition-colors duration-200", on ? "bg-white text-black" : "text-white/80");
  return (
    <>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_45%,rgb(255_255_255/0.08),transparent_70%)]" />
      <video ref={videoRef} className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", cam === "on" ? "opacity-100" : "opacity-0")} playsInline muted data-cam-state={cam} />
      <div className="pointer-events-none absolute inset-0 grid place-items-center pb-24">
        <div className={cn("relative rounded-[22px] shadow-[0_0_0_100vmax_rgb(0_0_0/0.4)] transition-[width,height] duration-300 ease-[var(--ease-out)]", mode === "scan" ? "h-[30vw] max-h-[180px] w-[76vw] max-w-[420px]" : "h-[min(110vw,520px)] w-[80vw] max-w-[420px]")}>
          {["start-0 top-0 border-s-4 border-t-4 rounded-ss-[22px]", "end-0 top-0 border-e-4 border-t-4 rounded-se-[22px]", "start-0 bottom-0 border-s-4 border-b-4 rounded-es-[22px]", "end-0 bottom-0 border-e-4 border-b-4 rounded-ee-[22px]"].map((c) => (
            <span key={c} className={cn("absolute size-8 border-white", c)} />
          ))}
          {sheet && "kind" in sheet && sheet.kind === "reading" && (
            <span className="absolute inset-x-6 top-1/2 flex -translate-y-1/2 items-center justify-center gap-2 rounded-full bg-black/60 px-4 py-2 text-[14px] font-bold backdrop-blur">
              <Sparkles className="size-4 text-spark" />
              {t.sm.cap.reading}
            </span>
          )}
        </div>
      </div>
      <div className="relative z-10 flex items-center gap-2 p-4 pt-[max(16px,env(safe-area-inset-top))]">
        <D.Close className="grid size-11 place-items-center rounded-full bg-black/45 backdrop-blur" aria-label={t.sm.cap.close}>
          <X className="size-5" />
        </D.Close>
        <div className="mx-auto flex w-[min(220px,52vw)] gap-1 rounded-[13px] bg-white/15 p-1 backdrop-blur" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "scan"} className={seg(mode === "scan")} onClick={() => (setMode("scan"), setSheet(null))} data-cap-mode="scan">
            {t.sm.cap.barcode}
          </button>
          <button type="button" role="tab" aria-selected={mode === "photo"} className={seg(mode === "photo")} onClick={() => (setMode("photo"), setSheet(null))} data-cap-mode="photo">
            {t.sm.cap.photo}
          </button>
        </div>
        {torch.supported ? (
          <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} aria-label={t.sm.cap.torch} className={cn("grid size-11 place-items-center rounded-full backdrop-blur", torch.on ? "bg-white text-black" : "bg-black/45")}>
            <Flashlight className="size-5" />
          </button>
        ) : (
          <span className="size-11" />
        )}
      </div>
      <div className="relative z-10 mt-auto flex flex-col gap-3 p-4 pb-[max(20px,env(safe-area-inset-bottom))]">
        {!sheet && (
          <p className="text-center text-[14px] font-semibold text-white/85">{mode === "photo" ? t.sm.cap.pointPhoto : camOff ? t.sm.cap.noCamera : t.sm.cap.pointBarcode}</p>
        )}
        {!sheet && mode === "scan" && (typing || camOff ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) void scan(typed.trim());
            }}
          >
            <input autoFocus inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t.sm.cap.typeCode} aria-label={t.sm.cap.typeCode} className="h-12 min-w-0 flex-1 rounded-full bg-white px-5 text-[16px] text-black outline-none" data-cap-code />
            <button type="submit" className="h-12 rounded-full bg-white px-5 font-bold text-black" data-cap-lookup>
              {t.sm.cap.lookup}
            </button>
          </form>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            {/* "Type instead": the Add screen, to type the product's name. */}
            <button type="button" className="h-11 justify-self-start px-2 text-[15px] font-bold" onClick={() => onType()} data-cap-type>
              {t.sm.cap.type}
            </button>
            <button type="button" onClick={() => setTyping(true)} className="flex h-11 items-center gap-2 rounded-full bg-black/45 px-4 text-sm font-semibold backdrop-blur" data-cap-type-code>
              <Keyboard className="size-4" /> {t.sm.cap.typeCode}
            </button>
            <span />
          </div>
        ))}
        {!sheet && mode === "photo" && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            <button type="button" className="h-11 justify-self-start px-2 text-[15px] font-bold" onClick={() => onType()} data-cap-type>
              {t.sm.cap.type}
            </button>
            <button type="button" className="grid size-[76px] place-items-center rounded-full border-4 border-white transition-transform duration-150 ease-[var(--ease-out)] active:scale-95" onClick={() => void shoot()} aria-label={t.sm.cap.shutter} data-cap-shutter>
              <span className="size-[60px] rounded-full bg-white" />
            </button>
            {allow?.limit != null ? (
              <span className="flex items-center gap-1 justify-self-end text-[13px] font-semibold text-white/80" data-cap-allowance>
                <Sparkles className="size-3.5 text-spark" />
                {f(t.sm.cap.aiLeft, { n: allow.used, limit: allow.limit })}
              </span>
            ) : (
              <span />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void read(await photoToDataUrl(file, 1024), file);
              }}
              data-cap-file
            />
          </div>
        )}
        {sheet && !("kind" in sheet && sheet.kind === "reading") && (
          <ResultSheet
            sheet={sheet}
            onAgain={() => {
              setSheet(null);
              setTyped("");
            }}
            onDone={onClose}
            onPhoto={() => (setMode("photo"), setSheet(null))}
            onScan={() => (setMode("scan"), setSheet(null))}
            onType={onType}
            onReceipt={async () => {
              const last = shot.current;
              if (!last) return;
              const blob = last.full ?? (await (await fetch(last.image)).blob());
              onClose();
              s.openReceipt(new File([blob], "receipt.jpg", { type: blob.type || "image/jpeg" }));
            }}
          />
        )}
      </div>
    </>
  );
}

function ResultSheet({ sheet, onAgain, onDone, onPhoto, onScan, onType, onReceipt }: { sheet: Sheet; onAgain: () => void; onDone: () => void; onPhoto: () => void; onScan: () => void; onType: OnType; onReceipt: () => void }) {
  const { t, f } = useI18n();
  const card = "rounded-[24px] bg-surface p-4 text-ink shadow-pop animate-pop-in";
  if ("kind" in sheet && sheet.kind === "loading")
    return (
      <div className={cn(card, "flex items-center justify-center gap-2 py-6 text-[14px] font-semibold text-muted")} data-cap-sheet="loading">
        <Spinner className="size-4" /> {t.sm.cap.looking}
      </div>
    );
  if (isScan(sheet)) {
    if (sheet.state === "found") return <Found product={sheet.product} listed={sheet.listed} known={sheet.known} code={sheet.code} onAgain={onAgain} onDone={onDone} />;
    return <Unknown code={sheet.code} onPhoto={onPhoto} onDone={onDone} />;
  }
  const r = sheet as PhotoResult;
  if (r.state === "read") return <PhotoRead r={r} onAgain={onAgain} onDone={onDone} onType={onType} onReceipt={onReceipt} />;
  return (
    <div className={card} data-cap-sheet="limit">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-warn-soft text-warn">
          <Clock className="size-5" />
        </span>
        <div>
          <h2 className="text-[18px] font-extrabold">{f(t.sm.cap.limitTitle, { limit: 40 })}</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">{t.sm.cap.limitSub}</p>
        </div>
      </div>
      <button type="button" className="mt-3 flex h-12 w-full items-center gap-2 rounded-[14px] border border-line-strong px-3.5 text-start text-[15px] text-muted" onClick={() => onType()} data-cap-limit-type>
        <Plus className="size-[18px]" />
        {t.sm.cap.typeProduct}
      </button>
      <button type="button" className="mt-2 h-12 w-full rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={onScan} data-cap-limit-scan>
        {t.sm.cap.scanBarcode}
      </button>
    </div>
  );
}

type PhotoRead = Extract<PhotoResult, { state: "read" }>;
const KINDS = ["product", "receipt", "list"] as const;

/**
 * C2: what the photo looks like ("Looks like a list · 9 items") over a Product · Receipt · List switch; the card under it
 * follows the switch (a short cross-fade, the switch and the line above it stay still). "Not sure" starts with nothing
 * picked.
 */
function PhotoRead({ r, onAgain, onDone, onType, onReceipt }: { r: PhotoRead; onAgain: () => void; onDone: () => void; onType: OnType; onReceipt: () => void }) {
  const { t, f } = useI18n();
  const [kind, setKind0] = useState<PhotoKind>(r.kind);
  // The first card pops in with the sheet; a switch cross-fades (seg-in).
  const [moved, setMoved] = useState(false);
  const setKind = (k: PhotoKind) => (setKind0(k), setMoved(true));
  const n = r.lines.length;
  const seen =
    r.kind === "receipt" ? t.sm.cap.seenReceipt : r.kind === "list" ? (n === 1 ? t.sm.cap.seenListOne : n ? f(t.sm.cap.seenList, { n }) : t.sm.cap.seenListNone) : r.kind === "unsure" ? t.sm.cap.seenUnsure : null;
  const label = { product: t.sm.cap.kindProduct, receipt: t.sm.cap.kindReceipt, list: t.sm.cap.kindList };
  const card = "rounded-[24px] bg-surface p-4 text-ink shadow-pop";
  const body = (k: PhotoKind) =>
    k === "unsure" ? (
      <div className={card} data-cap-sheet="what">
        <h2 className="text-[19px] font-extrabold">{t.sm.cap.seenUnsure}</h2>
        <p className="mt-0.5 text-[13.5px] text-muted">{t.sm.cap.unsureSub}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {KINDS.map((x) => {
            const Icon = x === "product" ? Package : x === "receipt" ? ReceiptText : ListChecks;
            return (
              <button key={x} type="button" onClick={() => setKind(x)} className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-[14px] border border-line-strong text-[14px] font-bold active:scale-[0.97]" data-cap-what={x}>
                <Icon className="size-5" />
                <span className="max-w-full truncate px-1">{label[x]}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="mt-3 h-12 w-full rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={onAgain} data-cap-again>
          {t.sm.cap.notThis}
        </button>
      </div>
    ) : k === "receipt" ? (
      <div className={card} data-cap-sheet="receipt">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-surface-2">
            <ReceiptText className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[18px] font-extrabold">{t.sm.cap.kindReceipt}</h2>
            <p className="mt-0.5 text-[13.5px] text-muted">{t.sm.cap.receiptSub}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2.5">
          <button type="button" className="h-12 flex-1 rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={onAgain} data-cap-again>
            {t.sm.cap.notThis}
          </button>
          <button type="button" className="h-12 flex-[1.6] rounded-[14px] bg-ink text-[15px] font-bold text-bg" onClick={onReceipt} data-cap-receipt>
            {t.sm.cap.readReceipt}
          </button>
        </div>
      </div>
    ) : k === "list" ? (
      <div className={card} data-cap-sheet="list">
        <h2 className="text-[18px] font-extrabold">{t.sm.cap.kindList}</h2>
        <p className="mt-0.5 text-[13.5px] text-muted">{n ? t.sm.cap.listSub : t.sm.cap.listNone}</p>
        {n > 0 && (
          <ul className="mt-3 overflow-hidden rounded-[14px] border border-line-strong" data-cap-lines>
            {r.lines.slice(0, 4).map((l, i) => (
              <li key={i} className="bidi truncate border-line px-3 py-2 text-[14.5px] [&+&]:border-t">
                {l}
              </li>
            ))}
            {n > 4 && <li className="border-t border-line px-3 py-2 text-[13px] text-muted">+{n - 4}</li>}
          </ul>
        )}
        <div className="mt-3 flex gap-2.5">
          <button type="button" className="h-12 flex-1 rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={onAgain} data-cap-again>
            {t.sm.cap.notThis}
          </button>
          <button type="button" className="h-12 flex-[1.6] rounded-[14px] bg-ink text-[15px] font-bold text-bg" onClick={() => onType(r.lines.join("\n"), "list")} data-cap-list>
            {n ? (n === 1 ? t.sm.cap.reviewListOne : f(t.sm.cap.reviewList, { n })) : t.sm.cap.typeList}
          </button>
        </div>
      </div>
    ) : !r.product ? (
      <div className={card} data-cap-sheet="noproduct">
        <p className="text-[14.5px] font-semibold">{t.sm.cap.productNone}</p>
        <button type="button" className="mt-3 flex h-12 w-full items-center gap-2 rounded-[14px] border border-line-strong px-3.5 text-start text-[15px] text-muted" onClick={() => onType()} data-cap-none>
          <Plus className="size-[18px]" />
          {t.sm.cap.typeProduct}
        </button>
      </div>
    ) : r.product.state === "matched" ? (
      <Found product={r.product.product} listed={r.product.listed} known="photo" code={null} onAgain={onAgain} onDone={onDone} />
    ) : r.product.state === "other" ? (
      <Other title={r.product.title} onAgain={onAgain} onDone={onDone} />
    ) : (
      <div className={card} data-cap-sheet="unsure">
        <h2 className="text-[19px] font-extrabold">{t.sm.cap.which}</h2>
        <p className="mt-0.5 text-[13.5px] text-muted">{t.sm.cap.whichSub}</p>
        <div className="mt-3 overflow-hidden rounded-[16px] border border-line-strong">
          {r.product.choices.map((p) => (
            <Choice key={p.productKey} p={p} onDone={onDone} />
          ))}
        </div>
        <button type="button" className="mt-3 h-12 w-full rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={() => onType()} data-cap-none>
          {t.sm.cap.noneType}
        </button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5 animate-pop-in" data-cap-read={r.kind}>
      {seen && (
        <p className="flex items-center justify-center gap-1.5 text-[14px] font-bold text-white" data-cap-seen>
          <Sparkles className="size-4 shrink-0 text-spark" />
          <span className="bidi truncate">{seen}</span>
        </p>
      )}
      <div className="mx-auto flex w-full max-w-[340px] gap-1 rounded-[13px] bg-white/15 p-1 backdrop-blur" role="tablist" aria-label={t.sm.cap.kindSwitch}>
        {KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn("h-10 min-w-0 flex-1 truncate rounded-[10px] px-2 text-[14px] font-bold transition-colors duration-200", kind === k ? "bg-white text-black" : "text-white/80")} data-cap-kind={k}>
            {label[k]}
          </button>
        ))}
      </div>
      {/* Every reading in one grid cell: the area keeps the tallest card's height, so the line and the switch above it
          never move (the sheet grows up from the bottom); the hidden ones are inert. */}
      <div className="grid items-start [&>*]:[grid-area:1/1]">
        {(r.kind === "unsure" ? (["unsure", ...KINDS] as const) : KINDS).map((k) => (
          <div key={k} className={k === kind ? (moved ? "seg-in" : undefined) : "invisible"} aria-hidden={k !== kind || undefined} inert={k !== kind} data-cap-pane={k}>
            {body(k)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A product the supermarket doesn't sell (the model says so, neither the home nor the dictionary knows it) → Products. */
function Other({ title, onAgain, onDone }: { title: string; onAgain: () => void; onDone: () => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [grocery, setGrocery] = useState(false);
  const [busy, setBusy] = useState(false);
  if (grocery) {
    const c = classifyLocal(title);
    return <Found product={{ title, productKey: c.productKey, section: c.section, art: c.art, gtin: null, mine: false, count: 0 }} listed={null} known="photo" code={null} onAgain={onAgain} onDone={onDone} />;
  }
  return (
    <div className="rounded-[24px] bg-surface p-4 text-ink shadow-pop" data-cap-sheet="other">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-surface-2">
          <Package className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[18px] font-extrabold">{t.sm.cap.otherTitle}</h2>
          <p className="bidi mt-0.5 text-[13.5px] text-muted">{f(t.sm.cap.otherSub, { title })}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2.5">
        <button type="button" className="h-12 flex-1 rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={() => setGrocery(true)} data-cap-grocery>
          {t.sm.cap.itsGrocery}
        </button>
        <button
          type="button"
          disabled={busy}
          className="h-12 flex-[1.6] rounded-[14px] bg-ink text-[15px] font-bold text-bg disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            try {
              const it = await createItem({ title, brand: null, imageUrl: null, category: null, tags: [], collectionId: null, source: null });
              s.upsertItem(it);
              s.fillImages([it.id]);
              toast.success(f(t.sm.cap.addedProducts, { title: it.title }));
              onDone();
            } catch {
              toast.error(t.sm.add.failed);
              setBusy(false);
            }
          }}
          data-cap-to-products
        >
          {t.sm.cap.addToProducts}
        </button>
      </div>
    </div>
  );
}

/** Add one captured product (with its barcode, so the home knows it next time); merged into its row when listed. */
function useAddCaptured() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  return async (p: { title: string; productKey?: string; section?: string; gtin: string | null }, qty: number) => {
    try {
      const r = await addToSupermarket({ title: p.title, qty, ...(p.productKey ? { productKey: p.productKey } : {}), ...(p.section ? { section: p.section } : {}), ...(p.gtin ? { gtin: p.gtin } : {}) });
      s.upsertSm([asItem(r.item)]);
      const undo = { label: t.sm.add.undo, onClick: () => void undoSupermarketAdd(r.item.id, r.before).then((u) => (u.item ? s.upsertSm([asItem(u.item)]) : s.removeSm(r.item.id))) };
      toast(r.merged ? r.item.title : f(t.sm.cap.added, { title: r.item.title }), { ...(r.merged ? { description: f(t.sm.add.merged, { qty: qtyLabel(r.item, locale, unitKgFor(r.item.productKey, home?.unitKg)) }) } : {}), action: undo });
      return true;
    } catch {
      toast.error(t.sm.add.failed);
      return false;
    }
  };
}

function Found({ product, listed, known, code, onAgain, onDone }: { product: CaptureProduct; listed: ScanResultListed; known: "home" | "public" | "photo"; code: string | null; onAgain: () => void; onDone: () => void }) {
  const { t, f, locale } = useI18n();
  const add = useAddCaptured();
  const [qty, setQty] = useState(1);
  const after = listed ? (listed.unit ? qtyLabel({ ...listed }, locale) : `×${listed.quantity + qty}`) : null;
  return (
    <div className="rounded-[24px] bg-surface p-4 text-ink shadow-pop animate-pop-in" data-cap-sheet={listed ? "onlist" : "found"}>
      {known === "photo" && (
        <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
          <Sparkles className="size-3.5 text-spark" />
          {t.sm.cap.looksLike}
        </p>
      )}
      <div className="flex items-center gap-3">
        <ProductTile art={product.art} section={product.section} size={56} />
        <div className="min-w-0 flex-1">
          <b className="bidi block truncate text-[18px] font-extrabold">{product.title}</b>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
            {product.mine ? (
              <>
                <span className="rounded-[6px] bg-ok-soft px-1.5 py-px text-[12px] font-bold text-ok">{t.sm.cap.known}</span>
                {known === "photo" ? (product.count > 1 ? f(t.sm.cap.boughtN, { n: product.count }) : t.sm.cap.boughtOnce) : f(t.sm.cap.atHome, { title: product.title })}
              </>
            ) : (
              t.sm.cap.newHere
            )}
          </span>
        </div>
      </div>
      {listed && (
        <p className="mt-3 flex items-center gap-2 rounded-[12px] bg-info-soft px-3 py-2.5 text-[13.5px] text-ink" data-cap-onlist>
          <Info className="size-4 shrink-0 text-info" />
          {f(t.sm.cap.onListNote, { now: qtyLabel(listed, locale), after: after ?? "" })}
        </p>
      )}
      <div className="mt-3 flex h-14 items-center gap-1 rounded-[14px] border border-line-strong p-1">
        <button type="button" className="grid size-11 place-items-center rounded-[11px] bg-surface-2 active:scale-90 disabled:opacity-40" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label={t.sm.qty.less}>
          <Minus className="size-5" />
        </button>
        <b className="tabular flex-1 text-center text-[19px] font-extrabold" data-cap-qty>
          {qty}
        </b>
        <button type="button" className="grid size-11 place-items-center rounded-[11px] bg-surface-2 active:scale-90" onClick={() => setQty(qty + 1)} aria-label={t.sm.qty.more}>
          <Plus className="size-5" />
        </button>
      </div>
      <div className="mt-3 flex gap-2.5">
        <button type="button" className="h-12 flex-1 rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={onAgain} data-cap-again>
          {known === "photo" ? t.sm.cap.notThis : t.sm.cap.scanAnother}
        </button>
        <button
          type="button"
          className="h-12 flex-[1.6] rounded-[14px] bg-ink text-[15px] font-bold text-bg"
          onClick={async () => {
            if (await add({ title: product.title, productKey: product.productKey, section: product.section, gtin: code }, qty)) (known === "photo" ? onDone : onAgain)();
          }}
          data-cap-add
        >
          {listed && after ? f(t.sm.cap.addNow, { qty: after }) : t.sm.cap.add}
        </button>
      </div>
    </div>
  );
}
type ScanResultListed = { quantity: number; amount?: number | null; unit?: string | null; count?: number | null } | null;

function Unknown({ code, onPhoto, onDone }: { code: string; onPhoto: () => void; onDone: () => void }) {
  const { t, f, locale } = useI18n();
  const add = useAddCaptured();
  const [name, setName] = useState("");
  const guessed = name.trim() ? classifyLocal(name.trim()).section : null;
  const options = [...new Set([guessed && guessed !== "other" ? guessed : null, "snack", "bfast", "dry"].filter(Boolean) as string[])].slice(0, 3);
  const [picked, setPicked] = useState<string | null>(null);
  const section = picked && SECTION_KEYS.includes(picked as never) ? picked : options[0];
  return (
    <div className="rounded-[24px] bg-surface p-4 text-ink shadow-pop animate-pop-in" data-cap-sheet="unknown">
      <h2 className="text-[19px] font-extrabold">{t.sm.cap.newBarcode}</h2>
      <p className="mt-0.5 text-[13.5px] text-muted">{t.sm.cap.nameOnce}</p>
      <label className="mt-3 block text-[13px] font-bold">
        {t.sm.cap.name}
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-[16px] font-normal outline-none focus:border-ink" data-cap-name />
      </label>
      <div className="mt-3 flex items-center justify-between">
        <b className="text-[13px]">{t.sm.cap.section}</b>
        <span className="flex items-center gap-1 text-[12px] text-muted">
          <Sparkles className="size-3 text-spark" />
          {t.sm.cap.guess}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((k) => (
          <button key={k} type="button" onClick={() => setPicked(k)} className={cn("flex h-10 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-bold", section === k ? "border-ink bg-ink text-bg" : "border-line-strong")} aria-pressed={section === k} data-cap-section={k}>
            {section === k ? <Check className="size-4" /> : <SectionIcon section={k} size={22} />}
            {sectionName(k, locale)}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-muted">{f(t.sm.cap.kept, { code })}</p>
      <div className="mt-3 flex gap-2.5">
        <button type="button" className="h-12 flex-1 rounded-[14px] border border-line-strong text-[15px] font-bold" onClick={onPhoto} data-cap-photo-instead>
          {t.sm.cap.photoInstead}
        </button>
        <button
          type="button"
          disabled={!name.trim()}
          className="h-12 flex-[1.6] rounded-[14px] bg-ink text-[15px] font-bold text-bg disabled:opacity-40"
          onClick={async () => {
            if (await add({ title: name.trim(), section, gtin: code }, 1)) onDone();
          }}
          data-cap-add
        >
          {t.sm.cap.add}
        </button>
      </div>
    </div>
  );
}

function Choice({ p, onDone }: { p: CaptureProduct; onDone: () => void }) {
  const { t, f } = useI18n();
  const add = useAddCaptured();
  return (
    <div className="gro-hit flex min-h-[60px] items-center gap-3 px-3 py-2" data-cap-choice={p.productKey}>
      <ProductTile art={p.art} section={p.section} size={44} />
      <span className="min-w-0 flex-1">
        <b className="bidi block truncate text-[15px] font-bold">{p.title}</b>
        <span className="block text-[12.5px] text-muted">{p.mine ? f(t.sm.cap.yoursSub, { n: p.count }) : t.sm.cap.newSub}</span>
      </span>
      <button type="button" className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-surface-2 active:scale-90" aria-label={`${t.sm.cap.add}: ${p.title}`} onClick={async () => (await add({ title: p.title, productKey: p.productKey, section: p.section, gtin: null }, 1)) && onDone()} data-cap-choice-add>
        <Plus className="size-5" />
      </button>
    </div>
  );
}
