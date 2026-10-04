"use client";

import { Fragment, useEffect, useState } from "react";
import { ArrowLeft, Bug, ClipboardCopy, ExternalLink, Lightbulb, MessageSquareWarning, X } from "lucide-react";
import { listReports, setReportStatus, type ReportView } from "@/app/report-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { Spinner } from "@/components/ui/spinner";
import { REPORT_STATUSES, reportMarkdown, type ReportDiag, type ReportStatus, type ReportType } from "@/lib/reports";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Segmented } from "./settings-dialog";
import { useStore } from "./store";

const TYPE_ICON: Record<ReportType, typeof Bug> = { bug: Bug, complaint: MessageSquareWarning, idea: Lightbulb };
const STATUS_TONE: Record<ReportStatus, string> = {
  open: "bg-tint text-tint-ink",
  in_progress: "bg-info/15 text-info",
  fixed: "bg-ok/15 text-ok",
  wont_fix: "bg-surface-2 text-muted",
};

/** Report rows, loaded each time `open` turns true. */
function useReportRows(open: boolean) {
  const [rows, setRows] = useState<ReportView[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let gone = false;
    listReports()
      .then((r) => !gone && setRows(r))
      .catch(() => !gone && setRows([]));
    return () => {
      gone = true;
    };
  }, [open]);
  return [rows, setRows] as const;
}

/** Owner screen "Reports" (Round 8 D3): list with status chips → detail, change status, copy for Claude Code. A side
 *  sheet from the Me sheet / command menu / toasts; inside Settings it is a sub-page (`ReportsSubpage`, Round 11 B1). */
export function ReportsSheet() {
  const s = useStore();
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = s.reportsOpen;
  const [rows, setRows] = useReportRows(open);

  // Deep link from the Telegram message: /?panel=reports.
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("panel") !== "reports") return;
    u.searchParams.delete("panel");
    window.history.replaceState(null, "", u);
    s.setReportsOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = rows?.find((r) => r.id === openId) ?? null;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        s.setReportsOpen(o);
        if (!o) setOpenId(null);
      }}
      title={t.report.reports}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 max-sm:pt-1" data-sheet-grip data-reports>
        {current ? (
          <Button variant="ghost" size="icon-sm" onClick={() => setOpenId(null)} aria-label={t.report.back}>
            <ArrowLeft className="rtl:-scale-x-100" />
          </Button>
        ) : null}
        <h2 className="flex-1 text-[17px] font-extrabold">{current ? current.title : t.report.reports}</h2>
        {!current && (
          <Button variant="outline" size="sm" className="h-9" onClick={() => s.openReport()} data-reports-new>
            {t.report.menu}
          </Button>
        )}
        <SheetClose className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label={t.phone.closeMenu}>
          <X className="size-5" />
        </SheetClose>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ReportsBody rows={rows} setRows={setRows} current={current} onOpen={setOpenId} />
      </div>
    </Sheet>
  );
}

/** Reports as a sub-page of Settings: the Settings modal shows its back arrow (detail → list → Settings). */
export function ReportsSubpage({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const s = useStore();
  const { t } = useI18n();
  const [rows, setRows] = useReportRows(true);
  const current = rows?.find((r) => r.id === openId) ?? null;
  return (
    <div className="space-y-4" data-reports data-settings-subpage="reports">
      {current ? (
        <h3 className="bidi text-[17px] font-extrabold">{current.title}</h3>
      ) : (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="h-9" onClick={() => s.openReport()}>
            {t.report.menu}
          </Button>
        </div>
      )}
      <ReportsBody rows={rows} setRows={setRows} current={current} onOpen={onOpen} />
    </div>
  );
}

function ReportsBody({
  rows,
  setRows,
  current,
  onOpen,
}: {
  rows: ReportView[] | null;
  setRows: React.Dispatch<React.SetStateAction<ReportView[] | null>>;
  current: ReportView | null;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const date = (ms: number) => new Date(ms).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const changeStatus = async (r: ReportView, status: ReportStatus) => {
    setRows((xs) => xs?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? xs);
    const saved = await setReportStatus(r.id, status).catch(() => null);
    if (!saved) {
      setRows((xs) => xs?.map((x) => (x.id === r.id ? r : x)) ?? xs);
      toast.error(t.errors.generic);
    }
  };
  const copy = async (r: ReportView) => {
    try {
      await navigator.clipboard.writeText(reportMarkdown(r));
      toast.success(t.report.copied);
    } catch {
      toast.error(t.errors.generic);
    }
  };

  if (!rows)
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  if (current) return <ReportDetail r={current} date={date} onStatus={(st) => void changeStatus(current, st)} onCopy={() => void copy(current)} />;
  if (rows.length === 0) return <p className="rounded-[20px] border border-dashed border-line-strong px-5 py-12 text-center text-sm text-muted">{t.report.empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const Icon = TYPE_ICON[r.type];
        return (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 rounded-[18px] border border-line bg-surface p-3 text-start transition hover:bg-surface-2" data-report-row={r.status}>
              <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-surface-2">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{r.title}</span>
                <span className="block text-xs text-muted">
                  {t.report[r.type]} · {date(r.createdAt)}
                </span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold", STATUS_TONE[r.status])}>{t.report[r.status]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ReportDetail({ r, date, onStatus, onCopy }: { r: ReportView; date: (ms: number) => string; onStatus: (s: ReportStatus) => void; onCopy: () => void }) {
  const { t, f } = useI18n();
  const d = (r.diagnostics ?? {}) as ReportDiag;
  const repo = "talJ1235/nexus";
  return (
    <div className="space-y-4" data-report-detail>
      <p className="text-[13px] text-muted">
        {t.report[r.type]} · {date(r.createdAt)}
        {r.githubIssue && (
          <>
            {" · "}
            <a href={`https://github.com/${repo}/issues/${r.githubIssue}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink underline underline-offset-2">
              {f(t.report.github, { n: r.githubIssue })} <ExternalLink className="size-3" />
            </a>
          </>
        )}
      </p>
      <div className="space-y-1.5">
        <span className="text-[13px] font-semibold">{t.report.statusLabel}</span>
        <Segmented<ReportStatus> value={r.status} label={t.report.statusLabel} size="sm" onChange={onStatus} options={REPORT_STATUSES.map((v) => ({ value: v, label: t.report[v] }))} />
      </div>
      <div className="space-y-3 rounded-[18px] border border-line p-4 text-[14px] leading-relaxed">
        {r.body ? (
          r.body.split("\n\n").map((block, i) => {
            const [head, ...rest] = block.split("\n");
            const h = head.match(/^\*\*(.+)\*\*$/);
            return (
              <div key={i}>
                {h ? <div className="text-[12.5px] font-bold uppercase tracking-wide text-muted">{h[1]}</div> : <p className="whitespace-pre-wrap bidi">{head}</p>}
                {rest.length > 0 && <p className="whitespace-pre-wrap bidi">{rest.join("\n")}</p>}
              </div>
            );
          })
        ) : (
          <p className="text-muted">—</p>
        )}
      </div>
      {r.screenshot && (
        // eslint-disable-next-line @next/next/no-img-element -- stored data URL
        <img src={r.screenshot} alt="" className="max-h-80 w-full rounded-[18px] border border-line object-contain" />
      )}
      <details className="rounded-[18px] bg-surface-2 p-4 text-[12.5px]" open>
        <summary className="cursor-pointer font-semibold">{t.report.details}</summary>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted">
          {d.client && (
            <>
              {[
                ["View", `${d.client.view} · ${d.client.device} · ${d.client.viewport}`],
                ["Theme", `${d.client.palette} ${d.client.mode} · ${d.client.locale}`],
                ["App", d.server?.commit?.slice(0, 12) ?? d.client.version],
                ["Extension", d.client.extension ? `v${d.client.extension}` : "—"],
              ].map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="font-semibold text-ink">{k}</dt>
                  <dd className="truncate">{v}</dd>
                </Fragment>
              ))}
            </>
          )}
        </dl>
        {!!d.client?.errors.length && (
          <>
            <div className="mt-3 font-semibold text-ink">{f(t.report.errors, { n: d.client.errors.length })}</div>
            <ul className="mt-1 space-y-0.5 font-mono text-[11.5px]">
              {d.client.errors.slice(-8).map((e, i) => (
                <li key={i} className="break-words">
                  {e.kind}: {e.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
      <Button variant="accent" className="h-11 w-full" onClick={onCopy} data-report-copy>
        <ClipboardCopy /> {t.report.copy}
      </Button>
    </div>
  );
}
