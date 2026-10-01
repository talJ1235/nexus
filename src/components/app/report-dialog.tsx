"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { createReport } from "@/app/report-actions";
import { useI18n } from "@/components/providers";
import { Button, Input, Textarea } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Spinner } from "@/components/ui/spinner";
import { collectDiag, getLastExchange } from "@/lib/client-diag";
import { REPORT_TYPES, type ReportFields, type ReportType } from "@/lib/reports";
import { toast } from "@/lib/toast";
import { Segmented } from "./settings-dialog";
import { useStore } from "./store";
import { extensionVersion } from "./use-extension";
import { photoToDataUrl } from "./use-camera";

const EMPTY: ReportFields = { type: "bug", title: "", happened: "", steps: "", expected: "", actual: "" };

/** "Report a problem" (Round 8 D3): editable fields (drafted by the assistant or empty), optional screenshot; the
 * diagnostics are attached automatically and listed so the user knows what goes along. */
export function ReportDialog() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const draft = s.reportDraft;
  const [fields, setFields] = useState<ReportFields>(EMPTY);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const assistant = draft?.assistant ?? (draft ? getLastExchange() : null);

  // A new draft (from the assistant, the menu or settings) replaces the form.
  useEffect(() => {
    if (!draft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form for each newly opened draft
    setFields({ ...EMPTY, ...Object.fromEntries(Object.entries(draft).filter(([k, v]) => k in EMPTY && typeof v === "string")) } as ReportFields);
    setShot(null);
  }, [draft]);

  const set = (k: keyof ReportFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((x) => ({ ...x, [k]: e.target.value }));
  const send = async () => {
    if (!fields.title.trim()) return;
    setBusy(true);
    try {
      await createReport({ ...fields, diag: collectDiag(s.view.type, locale, extensionVersion()), assistant, screenshot: shot });
      s.closeReport();
      toast.success(t.report.sent, { action: { label: t.report.view, onClick: () => s.setReportsOpen(true) } });
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };
  const area = "min-h-[76px] resize-y text-[14px]";

  return (
    <Modal open={!!draft} onOpenChange={(o) => !o && s.closeReport()} title={t.report.title} className="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="space-y-3.5"
        data-report-form
      >
        <Segmented<ReportType> value={fields.type} label={t.report.type} onChange={(type) => setFields((x) => ({ ...x, type }))} options={REPORT_TYPES.map((v) => ({ value: v, label: t.report[v] }))} />
        <label className="block space-y-1.5">
          <span className="text-[13px] font-semibold">{t.report.titleField}</span>
          <Input value={fields.title} onChange={set("title")} placeholder={t.report.titlePlaceholder} maxLength={120} required data-report-title />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[13px] font-semibold">{t.report.happened}</span>
          <Textarea value={fields.happened} onChange={set("happened")} placeholder={t.report.happenedPlaceholder} maxLength={4000} className={area} />
        </label>
        {fields.type !== "idea" && (
          <>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-semibold">{t.report.steps}</span>
              <Textarea value={fields.steps} onChange={set("steps")} placeholder={t.report.stepsPlaceholder} maxLength={2000} className={area} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-[13px] font-semibold">{t.report.expected}</span>
                <Textarea value={fields.expected} onChange={set("expected")} maxLength={2000} className={area} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-semibold">{t.report.actual}</span>
                <Textarea value={fields.actual} onChange={set("actual")} maxLength={2000} className={area} />
              </label>
            </div>
          </>
        )}
        <div className="flex items-center gap-3">
          {shot ? (
            <span className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={shot} alt="" className="h-16 rounded-lg border border-line object-cover" />
              <button type="button" onClick={() => setShot(null)} className="absolute -end-2 -top-2 grid size-6 place-items-center rounded-full bg-ink text-bg" aria-label={t.report.screenshotRemove}>
                <X className="size-3.5" />
              </button>
            </span>
          ) : (
            <Button type="button" variant="outline" className="h-10" onClick={() => fileRef.current?.click()}>
              <ImagePlus /> {t.report.screenshot}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setShot(await photoToDataUrl(file, 1280, 0.8).catch(() => null));
            }}
          />
        </div>
        <details className="rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-muted">
          <summary className="cursor-pointer font-semibold text-ink">{t.report.attached}</summary>
          <p className="mt-1.5 leading-relaxed">{f(t.report.attachedHint, { assistant: assistant ? t.report.withAssistant : "" })}</p>
        </details>
        <Button type="submit" variant="accent" className="h-11 w-full" disabled={busy || !fields.title.trim()} data-report-send>
          {busy ? <Spinner /> : <Send />} {t.report.send}
        </Button>
      </form>
    </Modal>
  );
}
