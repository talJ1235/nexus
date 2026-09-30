"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { FileText, ReceiptText, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { applyReceipt, createReceipt, deleteReceipt, listReceipts, readReceipt, undoReceipt, type ApplyReceiptInput, type ReceiptRead, type ReceiptView } from "@/app/receipt-actions";
import { useI18n } from "@/components/providers";
import { Button, Input, Textarea } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImage } from "./item-card";
import { useStore } from "./store";

type Mode = "match" | "new" | "ignore";
type LineState = { name: string; qty: number; unitPrice: number | null; mode: Mode; allocations: { itemId: string; qty: number }[]; ranked: string[] };
type Phase =
  | { step: "pick" }
  | { step: "busy"; label: string }
  | { step: "failed"; message: string; receiptId: string | null }
  | { step: "review"; read: ReceiptRead; kind: "receipt" | "order"; lines: LineState[] };

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
          return { ...l, mode: m.allocations.length ? "match" : "ignore", allocations: m.allocations.map(({ itemId, qty }) => ({ itemId, qty })), ranked: m.ranked.map((r) => r.itemId) };
        }),
      });
    },
    [t],
  );

  const fromFile = useCallback(
    async (file: File) => {
      if (!ACCEPT.test(file.type) || file.size > 20 * 1024 * 1024) {
        toast.error(t.scan.uploadFailed);
        return;
      }
      setPhase({ step: "busy", label: t.scan.uploading });
      let id: string;
      try {
        const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "receipt";
        const blob = await upload(`receipts/inbox/${safe}`, file, { access: "public", handleUploadUrl: "/api/blob/upload", contentType: file.type || undefined });
        id = (await createReceipt({ file: { url: blob.url, name: file.name, contentType: file.type || null, size: file.size } })).id;
      } catch {
        toast.error(t.scan.uploadFailed);
        setPhase({ step: "pick" });
        return;
      }
      await read(id);
    },
    [read, t],
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
      void fromFile(seed.file);
    } else if (phase.step !== "busy") setPhase({ step: "pick" });
    /* eslint-enable react-hooks/set-state-in-effect */
    refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, s.receiptSeed]);

  const close = () => s.setPanel(null);

  const apply = async (p: Extract<Phase, { step: "review" }>) => {
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
            ? { mode: "new" as const, name: l.name, qty: l.qty, unitPrice: l.unitPrice }
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
    <Modal open={open} onOpenChange={(o) => !o && close()} title={t.scan.title} description={wide ? undefined : t.scan.intro} className={wide ? "max-w-2xl" : undefined}>
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
              className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong px-3 py-4 text-sm text-muted transition hover:border-accent hover:text-fg"
            >
              <Upload className="size-5" />
              <span className="font-medium text-fg">{t.scan.pick}</span>
              <span className="text-xs">{t.scan.drop}</span>
            </button>
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

        {phase.step === "review" && <Review phase={phase} setPhase={setPhase} onApply={() => void apply(phase)} />}
      </div>
    </Modal>
  );
}

function Review({ phase, setPhase, onApply }: { phase: Extract<Phase, { step: "review" }>; setPhase: (p: Phase) => void; onApply: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { data } = phase.read;
  const currency = data.currency ?? s.currency;
  const byId = useMemo(() => new Map(s.items.map((i) => [i.id, i])), [s.items]);
  const setLine = (i: number, patch: Partial<LineState>) => setPhase({ ...phase, lines: phase.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const used = new Set(phase.lines.flatMap((l, i) => (l.mode === "match" ? l.allocations.map((a) => `${a.itemId}|${i}`) : [])));
  const taken = (itemId: string, line: number) => [...used].some((k) => k.startsWith(`${itemId}|`) && k !== `${itemId}|${line}`);
  const count = phase.lines.filter((l) => (l.mode === "match" && l.allocations.length) || l.mode === "new").length;
  const meta = [data.store, data.orderNumber && f(t.scan.orderNo, { n: data.orderNumber }), data.orderDate && new Date(data.orderDate).toLocaleDateString(locale), f(t.scan.lines, { n: phase.lines.length })].filter(Boolean);

  return (
    <div className="flex flex-col gap-3" data-receipt-review>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm text-muted bidi">{meta.join(" · ")}</p>
        <div className="flex items-center gap-2 text-xs text-muted">
          {t.scan.markAs}
          <div role="radiogroup" aria-label={t.scan.markAs} className="grid grid-cols-2 rounded-lg border border-line-strong bg-bg p-0.5 text-[13px]">
            {(["receipt", "order"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={phase.kind === k}
                onClick={() => setPhase({ ...phase, kind: k })}
                className={cn("min-h-9 rounded-md px-3", phase.kind === k ? "bg-surface font-medium text-fg shadow-card" : "text-muted")}
              >
                {k === "receipt" ? t.scan.received : t.scan.ordered}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {phase.lines.map((l, i) => (
          <LineRow key={i} line={l} index={i} currency={currency} byId={byId} taken={taken} onChange={(p) => setLine(i, p)} />
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <span className="tabular text-xs text-faint">{data.total != null ? formatMoney(data.total, currency, locale) : ""}</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setPhase({ step: "pick" })}>
            {t.scan.back}
          </Button>
          <Button variant="accent" disabled={!count} onClick={onApply} data-receipt-apply>
            {t.scan.apply} {count > 0 && <span className="tabular">({count})</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LineRow({ line, index, currency, byId, taken, onChange }: { line: LineState; index: number; currency: string; byId: Map<string, ItemWithSources>; taken: (id: string, line: number) => boolean; onChange: (p: Partial<LineState>) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (!picking) return [];
    const needle = q.trim().toLowerCase();
    const open = s.items.filter((i) => i.status !== "purchased" && !taken(i.id, index));
    const ranked = line.ranked.map((id) => open.find((i) => i.id === id)).filter(Boolean) as ItemWithSources[];
    const pool = needle ? open.filter((i) => i.title.toLowerCase().includes(needle)) : ranked.length ? ranked : open;
    return pool.slice(0, 6);
  }, [picking, q, s.items, line.ranked, taken, index]);

  const choose = (item: ItemWithSources) => {
    onChange({ mode: "match", allocations: [{ itemId: item.id, qty: Math.min(line.qty, item.quantity) }] });
    setPicking(false);
    setQ("");
  };
  const modes: { value: Mode; label: string; disabled?: boolean }[] = [
    { value: "match", label: t.scan.matched, disabled: !line.allocations.length },
    { value: "new", label: t.scan.asNew },
    { value: "ignore", label: t.scan.ignore },
  ];

  return (
    <li className="flex flex-col gap-2 p-3" data-receipt-line={line.mode}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("min-w-0 text-sm font-medium bidi", line.mode === "ignore" && "text-faint line-through")}>{line.name}</span>
        <span className="tabular shrink-0 text-xs text-muted">
          {line.qty} × {line.unitPrice != null ? formatMoney(line.unitPrice, currency, locale) : "—"}
        </span>
      </div>

      {!line.allocations.length && !picking && <span className="text-xs text-faint">{t.scan.noMatch}</span>}
      {line.mode === "match" &&
        line.allocations.map((a) => {
          const item = byId.get(a.itemId);
          if (!item) return null;
          return (
            <div key={a.itemId} className="flex items-center gap-2 rounded-lg bg-sunken/60 p-1.5">
              <ProductImage src={item.imageUrl} alt="" className="size-8 shrink-0 rounded-md" iconClass="size-4" />
              <span className="min-w-0 flex-1 truncate text-[13px] bidi">{item.title}</span>
              {a.qty < item.quantity && <span className="tabular shrink-0 text-xs text-accent-ink">{f(t.scan.partOf, { n: a.qty, total: item.quantity })}</span>}
            </div>
          );
        })}

      {picking && (
        <div className="flex flex-col gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.scan.search} className="ps-8" />
          </div>
          {results.map((item) => (
            <button key={item.id} type="button" onClick={() => choose(item)} className="flex min-h-10 items-center gap-2 rounded-lg px-1.5 text-start text-[13px] hover:bg-sunken">
              <ProductImage src={item.imageUrl} alt="" className="size-7 shrink-0 rounded-md" iconClass="size-3.5" />
              <span className="min-w-0 flex-1 truncate bidi">{item.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <div role="radiogroup" aria-label={line.name} className="flex rounded-lg border border-line bg-bg p-0.5 text-[12.5px]">
          {modes.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={line.mode === m.value}
              disabled={m.disabled}
              onClick={() => onChange({ mode: m.value })}
              className={cn("min-h-9 rounded-md px-2.5 disabled:opacity-40", line.mode === m.value ? "bg-surface font-medium text-fg shadow-card" : "text-muted")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="min-h-10" onClick={() => setPicking((v) => !v)}>
          <Search />
          {t.scan.change}
        </Button>
      </div>
    </li>
  );
}
