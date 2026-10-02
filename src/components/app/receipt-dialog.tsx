"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Camera, FileText, ReceiptText, RotateCcw, Trash2, Upload } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { applyReceipt, createReceipt, deleteReceipt, listReceipts, readReceipt, undoReceipt, type ApplyReceiptInput, type ReceiptView } from "@/app/receipt-actions";
import { useI18n } from "@/components/providers";
import { Button, Textarea } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { ReceiptReview, type LineState, type ReviewPhase } from "./receipt-review";
import { prepareReceiptPart } from "@/lib/receipt-image";
import { useStore } from "./store";

type Phase =
  | { step: "pick" }
  | { step: "busy"; label: string }
  | { step: "failed"; message: string; receiptId: string | null }
  | ReviewPhase;

const ACCEPT = /^(image\/|application\/pdf$)/;

/** Upload a receipt / order confirmation (or paste the email), review the proposed matches, apply with undo. */
export function ReceiptDialog() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const open = s.panel === "receipt";
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<ReceiptView[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const seedAt = useRef(0);

  const refreshSaved = useCallback(() => {
    listReceipts().then(setSaved, () => setSaved([]));
  }, []);

  const hintCollection = s.view.type === "collection" ? s.view.id : null;
  const read = useCallback(
    async (id: string) => {
      setPhase({ step: "busy", label: t.scan.reading });
      const res = await readReceipt(id).catch(() => ({ error: "failed" as const }));
      if ("error" in res) {
        setPhase({ step: "failed", message: res.error === "no_ai" ? t.scan.noAi : t.scan.failed, receiptId: id });
        return;
      }
      setPhase({
        step: "review",
        read: res,
        kind: res.data.kind,
        lines: res.data.lines.map((l, i) => {
          const m = res.matches[i];
          return { ...l, mode: m.allocations.length ? "match" : "new", allocations: m.allocations.map(({ itemId, qty }) => ({ itemId, qty })), ranked: m.ranked.map((r) => r.itemId), collectionId: hintCollection } satisfies LineState;
        }),
      });
    },
    [t, hintCollection],
  );

  /** Upload ready parts (JPEG tiles / a PDF) as ONE receipt — first file + the rest as parts, in order — then read it. */
  const uploadParts = useCallback(
    async (blobs: Blob[], name: string) => {
      setPhase({ step: "busy", label: t.scan.uploading });
      let id: string;
      try {
        const safe = name.replace(/[^\w.\-]+/g, "_").slice(-60) || "receipt";
        const urls: string[] = [];
        for (const [i, b] of blobs.entries()) {
          const ext = b.type === "application/pdf" ? "pdf" : "jpg";
          const res = await upload(`receipts/inbox/${safe.replace(/\.\w+$/, "")}-${i + 1}.${ext}`, b, { access: "public", handleUploadUrl: "/api/blob/upload", contentType: b.type || undefined });
          urls.push(res.url);
        }
        id = (await createReceipt({ file: { url: urls[0], name, contentType: blobs[0].type || null, size: blobs[0].size }, parts: urls.slice(1) })).id;
      } catch {
        toast.error(t.scan.uploadFailed);
        setPhase({ step: "pick" });
        return;
      }
      await read(id);
    },
    [read, t],
  );

  const fromFile = useCallback(
    async (file: File) => {
      if (!ACCEPT.test(file.type) || file.size > 20 * 1024 * 1024) {
        toast.error(t.scan.uploadFailed);
        return;
      }
      // Photos: straighten, crop, clean up and split very tall ones in the browser (smaller, sharper uploads).
      let blobs: Blob[] = [file];
      if (file.type.startsWith("image/")) {
        setPhase({ step: "busy", label: t.scan.preparing });
        blobs = await prepareReceiptPart(file, { autoCrop: true }).catch(() => [file]);
      }
      await uploadParts(blobs, file.name);
    },
    [uploadParts, t],
  );

  const fromText = async () => {
    setPhase({ step: "busy", label: t.scan.reading });
    try {
      const r = await createReceipt({ text: text.trim() });
      setText("");
      await read(r.id);
    } catch {
      setPhase({ step: "failed", message: t.scan.failed, receiptId: null });
    }
  };

  // Opened: list receipts waiting to be applied; a file dropped on the app is read right away.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset per opening */
    const seed = s.receiptSeed;
    if (seed && seed.at !== seedAt.current) {
      seedAt.current = seed.at;
      if (seed.parts?.length) void uploadParts(seed.parts, "receipt.jpg");
      else if (seed.file) void fromFile(seed.file);
    } else if (phase.step !== "busy") setPhase({ step: "pick" });
    /* eslint-enable react-hooks/set-state-in-effect */
    refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, s.receiptSeed]);

  const close = () => s.setPanel(null);

  const apply = async (p: Extract<Phase, { step: "review" }>, opts: { skipPictures?: boolean } = {}) => {
    const { data, receipt } = p.read;
    const input: ApplyReceiptInput = {
      receiptId: receipt.id,
      kind: p.kind,
      currency: data.currency ?? s.currency,
      orderNumber: data.orderNumber,
      orderDate: data.orderDate,
      lines: p.lines.map((l) =>
        l.mode === "match" && l.allocations.length
          ? { mode: "match" as const, unitPrice: l.unitPrice, allocations: l.allocations }
          : l.mode === "new"
            ? {
                mode: "new" as const,
                name: l.name,
                qty: l.qty,
                unitPrice: l.unitPrice,
                image: l.image ?? null,
                category: l.category ?? null,
                collectionId: l.collectionId ?? null,
                imageSource: l.imageSource ?? null,
                // Confirm approves the pictures; "Skip pictures" keeps Nexus's best guesses marked "check".
                imageCheck: opts.skipPictures ? !!l.imageCheck : false,
                candidates: l.candidates?.length ? l.candidates.map(({ url, source, title, domain }) => ({ url, source, title: title ?? null, domain: domain ?? null })) : null,
                info: l.info ?? null,
              }
            : { mode: "ignore" as const },
      ),
    };
    setPhase({ step: "busy", label: t.scan.reading });
    const res = await applyReceipt(input).catch(() => ({ error: "invalid" as const }));
    if ("error" in res) {
      toast.error(t.errors.generic);
      setPhase(p);
      return;
    }
    s.upsertItems(res.items);
    s.fillImages(res.items.filter((i) => !i.imageUrl).map((i) => i.id));
    close();
    toast.success(f(t.scan.applied, { n: res.items.length }), {
      action: {
        label: t.item.undo,
        onClick: async () => {
          const back = await undoReceipt(res.undo);
          s.removeItems(back.removedIds);
          s.upsertItems(back.items);
        },
      },
    });
  };

  const wide = phase.step === "review";
  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title={t.scan.title} description={wide ? undefined : t.scan.intro} className={wide ? "max-w-3xl" : undefined}>
      <div data-receipt-dialog={phase.step}>
        {phase.step === "pick" && (
          <div className="flex flex-col gap-3">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && void fromFile(e.target.files[0])} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void fromFile(file);
              }}
              className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-[22px] border border-dashed border-line-strong px-3 py-4 text-sm text-muted transition hover:border-accent hover:text-fg"
            >
              <Upload className="size-5" />
              <span className="font-medium text-fg">{t.scan.pick}</span>
              <span className="text-xs">{t.scan.drop}</span>
            </button>
            <Button variant="outline" className="h-11" onClick={() => { close(); s.setScanner("receipt"); }} data-receipt-camera-open>
              <Camera />
              {t.receiptCam.camera}
            </Button>
            <label className="text-xs font-medium text-muted" htmlFor="receipt-text">
              {t.scan.paste}
            </label>
            <Textarea id="receipt-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.scan.pastePlaceholder} className="resize-y" />
            <Button variant="accent" disabled={text.trim().length < 10} onClick={() => void fromText()}>
              <ReceiptText />
              {t.scan.read}
            </Button>
            {saved.length > 0 && (
              <div className="mt-1 border-t border-line pt-3">
                <div className="mb-1.5 text-xs font-medium text-muted">{t.scan.saved}</div>
                <ul className="flex flex-col gap-1">
                  {saved.map((r) => (
                    <li key={r.id} className="flex min-h-10 items-center gap-2 text-sm">
                      <FileText className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate bidi">{r.name}</span>
                      <span className="tabular shrink-0 text-xs text-faint">{new Date(r.createdAt).toLocaleDateString(locale)}</span>
                      <Button size="icon" variant="ghost" className="size-10" aria-label={t.scan.retry} title={t.scan.retry} onClick={() => void read(r.id)}>
                        <RotateCcw />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-10"
                        aria-label={t.scan.discard}
                        title={t.scan.discard}
                        onClick={async () => {
                          await deleteReceipt(r.id);
                          refreshSaved();
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase.step === "busy" && (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted" aria-live="polite">
            <Spinner />
            {phase.label}
          </div>
        )}

        {phase.step === "failed" && (
          <div className="flex flex-col gap-3" data-receipt-error>
            <p className="text-sm text-muted">{phase.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPhase({ step: "pick" })}>
                {t.scan.back}
              </Button>
              {phase.receiptId && (
                <Button variant="accent" onClick={() => void read(phase.receiptId!)}>
                  <RotateCcw />
                  {t.scan.retry}
                </Button>
              )}
            </div>
          </div>
        )}

        {phase.step === "review" && <ReceiptReview phase={phase} setPhase={setPhase} onApply={(o) => void apply(phase, o)} onBack={() => setPhase({ step: "pick" })} />}
      </div>
    </Modal>
  );
}
