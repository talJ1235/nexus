"use client";

import { useMemo, useRef, useState } from "react";
import { Check, FileSpreadsheet, Upload, Wand2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { refetchSource } from "@/app/actions";
import { importRows, needsDetails, type ImportRow } from "@/app/import-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { useExtension } from "./use-extension";

type Field = keyof ImportRow;
const FIELDS: Field[] = ["title", "url", "quantity", "price", "currency", "notes", "collection", "priority"];

const SYNONYMS: Record<Field, RegExp> = {
  title: /^(name|title|item|product|description|part|component|שם|מוצר|פריט|תיאור|רכיב)/i,
  url: /(link|url|href|קישור|לינק)/i,
  quantity: /^(qty|quantity|amount|count|pcs|כמות|יח)/i,
  price: /(price|cost|מחיר|עלות)/i,
  currency: /(currency|מטבע)/i,
  notes: /(note|comment|remark|spec|הער)/i,
  collection: /(project|list|category|group|פרויקט|רשימה|קטגוריה)/i,
  priority: /(priority|עדיפות)/i,
};

function autoMap(columns: string[], rows: string[][]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  // A column where most values are links is the link column, whatever its header says.
  const linkCol = columns.findIndex((_, i) => {
    const vals = rows.slice(0, 30).map((r) => r[i]).filter(Boolean);
    return vals.length > 0 && vals.filter((v) => /^https?:\/\//i.test(v)).length / vals.length > 0.6;
  });
  if (linkCol >= 0) {
    map.url = linkCol;
    used.add(linkCol);
  }
  for (const f of FIELDS) {
    if (map[f] != null) continue;
    const idx = columns.findIndex((c, i) => !used.has(i) && SYNONYMS[f].test(c.trim()));
    if (idx >= 0) {
      map[f] = idx;
      used.add(idx);
    }
  }
  return map;
}

type Parsed = { columns: string[]; rows: string[][]; total: number };
type Phase = { step: "pick" } | { step: "map"; parsed: Parsed; fileName: string } | { step: "done"; created: string[]; skipped: number };

export function ImportDialog() {
  const s = useStore();
  const { t, f } = useI18n();
  const ext = useExtension();
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  const [map, setMap] = useState<Partial<Record<Field, number>>>({});
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fill, setFill] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = s.panel === "import";
  const close = () => {
    if (busy || (fill && fill.done < fill.total)) return;
    s.setPanel(null);
    setTimeout(() => {
      setPhase({ step: "pick" });
      setFill(null);
    }, 200);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (!json.rows.length) throw new Error("empty");
      setMap(autoMap(json.columns, json.rows));
      setTarget(s.view.type === "collection" ? s.view.id : "");
      setPhase({ step: "map", parsed: json, fileName: file.name });
    } catch (e) {
      const code = String((e as Error).message);
      toast.error(code === "unsupported" ? t.io.unsupported : code === "too_large" ? t.io.tooLarge : t.io.unreadable);
    } finally {
      setBusy(false);
    }
  };

  const mapped = useMemo(() => {
    if (phase.step !== "map") return [];
    return phase.parsed.rows.map((r) => {
      const o: ImportRow = {};
      for (const fld of FIELDS) {
        const idx = map[fld];
        if (idx != null && r[idx]) o[fld] = r[idx];
      }
      return o;
    });
  }, [phase, map]);
  const usable = mapped.filter((r) => r.title || r.url).length;

  const runImport = async () => {
    setBusy(true);
    try {
      const res = await importRows({ rows: mapped, collectionId: target || null, defaultCurrency: s.currency });
      res.collections.forEach(s.upsertCollection);
      s.upsertItems(res.items);
      setPhase({ step: "done", created: res.items.map((i) => i.id), skipped: res.skipped });
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const fillDetails = async (ids: string[]) => {
    const todo = await needsDetails(ids);
    setFill({ done: 0, total: todo.length });
    let done = 0;
    const queue = todo.slice();
    const worker = async () => {
      while (queue.length) {
        const job = queue.shift()!;
        try {
          const payload = ext.available ? await ext.resolve(job.url) : null;
          s.upsertItem(await refetchSource(job.sourceId, payload));
        } catch {
          /* keep going; the item stays editable */
        }
        done++;
        setFill({ done, total: todo.length });
      }
    };
    await Promise.all([worker(), worker()]);
    toast.success(t.io.filled);
  };

  const fieldLabel: Record<Field, string> = {
    title: t.io.fTitle,
    url: t.io.fUrl,
    quantity: t.io.fQty,
    price: t.io.fPrice,
    currency: t.io.fCurrency,
    notes: t.io.fNotes,
    collection: t.io.fCollection,
    priority: t.io.fPriority,
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title={t.io.importTitle} description={phase.step === "pick" ? t.io.importHint : undefined} className="max-w-2xl">
      {phase.step === "pick" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFile(e.dataTransfer.files[0]);
          }}
          className={cn(
            "grid place-items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition",
            dragOver ? "border-accent bg-accent-soft/50" : "border-line-strong bg-bg/40",
          )}
        >
          <FileSpreadsheet className="size-9 text-faint" strokeWidth={1.4} />
          <p className="mt-3 text-sm text-muted">{t.io.drop}</p>
          <Button variant="accent" className="mt-4" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : <Upload />}
            {t.io.choose}
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <p className="mt-3 text-xs text-faint">CSV · Excel (.xlsx)</p>
        </div>
      )}

      {phase.step === "map" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">{phase.fileName}</span> · {f(t.io.rowsFound, { n: phase.parsed.total })}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
            {FIELDS.map((fld) => (
              <label key={fld} className="block">
                <span className="mb-1 block text-xs text-muted">{fieldLabel[fld]}</span>
                <select
                  value={map[fld] ?? ""}
                  onChange={(e) => setMap((m) => ({ ...m, [fld]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  className={cn("h-9 w-full rounded-lg border bg-bg px-2 text-sm outline-none focus:border-accent", map[fld] != null ? "border-accent/50" : "border-line-strong text-muted")}
                >
                  <option value="">—</option>
                  {phase.parsed.columns.map((c, i) => (
                    <option key={i} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-sunken/50 text-xs text-faint">
                  <th className="px-3 py-2 text-start font-medium">{t.io.fTitle}</th>
                  <th className="px-3 py-2 text-start font-medium">{t.io.fUrl}</th>
                  <th className="px-3 py-2 text-end font-medium">{t.io.fQty}</th>
                  <th className="px-3 py-2 text-end font-medium">{t.io.fPrice}</th>
                </tr>
              </thead>
              <tbody>
                {mapped.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="max-w-[220px] truncate px-3 py-2 bidi">
                      {r.title || <span className="text-faint">{r.url ? t.io.fromLink : "—"}</span>}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted" dir="ltr">
                      {r.url?.replace(/^https?:\/\/(www\.)?/, "") || "—"}
                    </td>
                    <td className="tabular px-3 py-2 text-end">{r.quantity || 1}</td>
                    <td className="tabular px-3 py-2 text-end">{r.price ? `${r.price} ${r.currency ?? ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t.io.into}</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 min-w-48 rounded-lg border border-line-strong bg-bg px-2 text-sm outline-none focus:border-accent">
                <option value="">{t.nav.unsorted}</option>
                {s.collections
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPhase({ step: "pick" })} disabled={busy}>
                {t.io.back}
              </Button>
              <Button variant="accent" onClick={runImport} disabled={busy || !usable}>
                {busy ? <Spinner /> : <Check />}
                {f(t.io.importN, { n: usable })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase.step === "done" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-ok/40 bg-ok-soft/60 p-4">
            <Check className="mt-0.5 size-5 shrink-0 text-ok" />
            <div className="text-sm">
              <p className="font-medium">{f(t.io.imported, { n: phase.created.length })}</p>
              {phase.skipped > 0 && <p className="mt-0.5 text-muted">{f(t.io.skipped, { n: phase.skipped })}</p>}
            </div>
          </div>
          {fill ? (
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">{fill.done < fill.total ? t.io.filling : t.io.filled}</span>
                <span className="tabular text-muted">
                  {fill.done}/{fill.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${fill.total ? (fill.done / fill.total) * 100 : 100}%` }} />
              </div>
            </div>
          ) : (
            phase.created.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
                <p className="text-sm text-muted">{ext.available ? t.io.fillHintExt : t.io.fillHint}</p>
                <Button variant="subtle" size="sm" onClick={() => void fillDetails(phase.created)}>
                  <Wand2 />
                  {t.io.fill}
                </Button>
              </div>
            )
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={close} disabled={!!fill && fill.done < fill.total}>
              {t.io.done}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
