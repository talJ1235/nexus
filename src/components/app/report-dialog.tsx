"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { createReport } from "@/app/report-actions";
import { useI18n } from "@/components/providers";
import { Button, Textarea } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Spinner } from "@/components/ui/spinner";
import { collectDiag, getLastExchange, type ClientDiag } from "@/lib/client-diag";
import { REPORT_TYPES, type ReportType } from "@/lib/reports";
import { toast } from "@/lib/toast";
import { itemsForView } from "@/lib/views";
import { Segmented } from "./settings-dialog";
import { useStore } from "./store";
import { extensionVersion } from "./use-extension";
import { photoToDataUrl } from "./use-camera";

/**
 * "Report a problem" (Round 9 D1: one simple form). The type switch, one text box, "What did you expect?" for bugs
 * only, an optional screenshot. An assistant draft fills the same form. What's attached is listed (collapsed).
 */
export function ReportDialog() {
  const s = useStore();
  const { t, locale } = useI18n();
  const draft = s.reportDraft;
  const [type, setType] = useState<ReportType>("bug");
  const [text, setText] = useState("");
  const [expected, setExpected] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const assistant = draft?.assistant ?? (draft ? getLastExchange() : null);
  const viewCount = useMemo(() => itemsForView(s.items, s.view).length, [s.items, s.view]);
  // A snapshot of what will be sent, taken when the form opens (shown in "Included automatically").
  const [diag, setDiag] = useState<ClientDiag | null>(null);

  // A new draft (assistant, menu, settings, Me sheet) replaces the form; the assistant's fields fold into the text.
  useEffect(() => {
    if (!draft) return;
    const body = [draft.happened, draft.steps && `${t.report.steps}:\n${draft.steps}`, draft.actual && `${t.report.actual}: ${draft.actual}`].filter(Boolean).join("\n\n");
    /* eslint-disable react-hooks/set-state-in-effect -- reset the form for each newly opened draft */
    setType(draft.type ?? "bug");
    setText(body);
    setExpected(draft.expected ?? "");
    setShot(null);
    setDiag(collectDiag(s.view.type, locale, extensionVersion(), viewCount));
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await createReport({
        type,
        title: draft?.title || undefined,
        happened: text.trim(),
        expected: type === "bug" ? expected.trim() : "",
        diag: collectDiag(s.view.type, locale, extensionVersion(), viewCount),
        assistant,
        screenshot: shot,
      });
      s.closeReport();
      toast.success(t.report.sent, { action: { label: t.report.view, onClick: () => s.setReportsOpen(true) } });
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const none = <span className="text-faint">{t.report.incNone}</span>;
  const included: [string, React.ReactNode][] = diag
    ? [
        [t.report.incScreen, `${diag.view} · ${diag.viewport}`],
        [t.report.incCount, String(diag.viewCount ?? "—")],
        [t.report.incNav, diag.nav?.length ? diag.nav.join(" → ") : none],
        [t.report.incDevice, [diag.device, diag.hw?.memory && `${diag.hw.memory} GB`, diag.hw?.cores && `${diag.hw.cores} cores`].filter(Boolean).join(" · ")],
        [t.report.incLook, `${diag.palette} · ${diag.mode} · ${diag.locale}`],
        [t.report.incNetwork, [diag.online ? "online" : "offline", diag.network?.type, diag.network?.saveData && "data saver"].filter(Boolean).join(" · ")],
        [t.report.incVersion, `${diag.version}${diag.sw ? ` · sw ${diag.sw}` : ""}`],
        [t.report.incExtension, diag.extension ? `v${diag.extension}` : none],
        [t.report.incErrors, diag.errors.length ? diag.errors.slice(-3).map((e) => e.message).join(" · ") : none],
        [t.report.incFailed, diag.failed?.length ? diag.failed.map((f) => `${f.path} ${f.status || "network"}`).join(", ") : none],
        [t.report.incAssistant, assistant ? `“${assistant.question.slice(0, 80)}”` : none],
      ]
    : [];

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
        <Segmented<ReportType> value={type} label={t.report.type} onChange={setType} options={REPORT_TYPES.map((v) => ({ value: v, label: t.report[v] }))} />
        <label className="block space-y-1.5">
          <span className="text-[13px] font-semibold">{type === "idea" ? t.report.tellIdea : t.report.tell}</span>
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={type === "idea" ? t.report.ideaPlaceholder : t.report.tellPlaceholder}
            maxLength={4000}
            required
            className="min-h-[120px] resize-y text-[14px]"
            dir="auto"
            data-report-text
          />
        </label>
        {type === "bug" && (
          <label className="block space-y-1.5">
            <span className="text-[13px] font-semibold">{t.report.expect}</span>
            <Textarea value={expected} onChange={(e) => setExpected(e.target.value)} maxLength={2000} className="min-h-[64px] resize-y text-[14px]" dir="auto" data-report-expected />
          </label>
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
        <details className="rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-muted" data-report-included>
          <summary className="cursor-pointer font-semibold text-ink">{t.report.included}</summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            {included.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-semibold text-ink">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 leading-relaxed">{t.report.incPrivacy}</p>
        </details>
        <Button type="submit" variant="accent" className="h-11 w-full" disabled={busy || !text.trim()} data-report-send>
          {busy ? <Spinner /> : <Send />} {t.report.send}
        </Button>
      </form>
    </Modal>
  );
}
