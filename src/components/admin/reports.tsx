"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getAdminReport, listAdminReports, setAdminReportStatus } from "@/app/admin-actions";
import { openReportIssue } from "@/app/report-actions";
import { useI18n } from "@/components/providers";
import type { AdminReport, AdminReportRow } from "@/lib/db-scoped/admin-health";
import type { Go } from "./admin-app";
import { Av, Failed, PATH, Skeleton, Svg, useLoad, useNow, useScreenLabel, useTimes } from "./ui";

// R17 G5 — Reports (boards Admin-desktop "Reports" / Admin-phone "Reports"): Open / In progress / Fixed, a list and the
// report: who sent it, the space, the screen (viewport, theme, language), installed or browser, the build, the
// screenshot, the client errors from the 10 minutes before. The report's own text is shown — the person sent it to
// the admin; the assistant exchange isn't (chat).

type Seg = "open" | "in_progress" | "fixed";
const segOf = (s: string): Seg => (s === "fixed" || s === "wont_fix" ? "fixed" : s === "in_progress" ? "in_progress" : "open");

export function ReportsTab({ phone, go, report }: { phone: boolean; go: Go; report: string | null }) {
  const { t, f } = useI18n();
  const R = t.adm.rep;
  const { data: all, setData: setAll, failed, reload } = useLoad(() => listAdminReports(), []);
  const data = all?.rows ?? null;
  const sys = all?.issues ?? false;
  const [seg, setSeg] = useState<Seg>("open");
  const { ago } = useTimes();
  const screen = useScreenLabel();
  const now = useNow();
  const rows = useMemo(() => (data ?? []).filter((r) => segOf(r.status) === seg), [data, seg]);
  const count = (s: Seg) => (data ?? []).filter((r) => segOf(r.status) === s).length;
  const sel = report ?? (!phone ? rows[0]?.id ?? null : null);
  const viewName = (v: string | null) => (v ? screen(viewKey(v)) : "");

  const segs = (
    <span className="seg" style={phone ? { display: "flex" } : { marginInlineStart: 12 }} role="group">
      {(
        [
          ["open", f(R.open, { n: count("open") })],
          ["in_progress", f(R.progress, { n: count("in_progress") })],
          ["fixed", f(R.fixed, { n: count("fixed") })],
        ] as [Seg, string][]
      ).map(([k, label]) => (
        <button key={k} type="button" className={seg === k ? "on" : ""} aria-pressed={seg === k} style={phone ? { flex: 1, justifyContent: "center" } : undefined} onClick={() => setSeg(k)} data-reports-seg={k}>
          {label}
        </button>
      ))}
    </span>
  );
  const onStatus = (r: AdminReport) => setAll((d) => (d ? { ...d, rows: d.rows.map((x) => (x.id === r.id ? { ...x, status: r.status } : x)) } : d));
  const item = (r: AdminReportRow) => (
    <button key={r.id} type="button" className={`rep${sel === r.id && !phone ? " on" : ""}`} onClick={() => go("reports", r.id, { replace: !phone })} data-report-row={r.id}>
      <Av id={r.reporter.id ?? r.id} name={r.reporter.name ?? R.someone} size="sm" />
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
        <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</b>
        <span className="tiny">{f(R.who, { name: r.reporter.name ?? R.someone, screen: viewName(r.view), ago: ago(r.createdAt, now) }).replace(/, ,/, ",")}</span>
      </span>
      <Badge status={r.status} />
    </button>
  );

  if (phone && report) return <ReportView key={report} id={report} phone issues={!!sys} onBack={() => window.history.back()} onStatus={onStatus} />;

  if (phone)
    return (
      <div className="page" data-reports>
        <h1 className="lt">{t.adm.tabs.reports}</h1>
        {segs}
        {failed && <Failed onRetry={reload} />}
        {!data ? (
          <Skeleton rows={4} h={64} />
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            {rows.length === 0 && <div className="empty">{R.empty}</div>}
            {rows.map(item)}
          </div>
        )}
      </div>
    );

  return (
    <>
      <div className="ad-top">
        <h1>{t.adm.tabs.reports}</h1>
        {segs}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", padding: "0 28px 24px", gap: 16 }} data-reports>
        <section className="panel" style={{ width: 360, flexShrink: 0, overflowY: "auto" }}>
          {failed && <Failed onRetry={reload} />}
          {!data && <div style={{ padding: 14 }}><Skeleton rows={4} h={56} /></div>}
          {data && rows.length === 0 && <div className="empty">{R.empty}</div>}
          {rows.map(item)}
        </section>
        {sel ? <ReportView key={sel} id={sel} phone={false} issues={!!sys} onBack={() => go("reports")} onStatus={onStatus} /> : <section className="panel" style={{ flex: 1, display: "grid", placeItems: "center" }}><span className="sub">{data ? R.pick : ""}</span></section>}
      </div>
    </>
  );
}

/** "home" / "to_buy" (the client's view names) → the presence screen keys used for labels. */
function viewKey(v: string) {
  const k = v.replace(/_/g, "-").replace(/^ordered$/, "on-the-way");
  return k === "shopping" ? "shopping-mode" : k;
}

function Badge({ status }: { status: string }) {
  const { t } = useI18n();
  const R = t.adm.rep;
  const s = segOf(status);
  return <span className={`badge ${s === "open" ? "warn" : s === "fixed" ? "ok" : "info"}`}>{s === "open" ? R.sOpen : s === "fixed" ? (status === "wont_fix" ? R.sWont : R.sFixed) : R.sProgress}</span>;
}

function ReportView({ id, phone, issues, onBack, onStatus }: { id: string; phone: boolean; issues: boolean; onBack: () => void; onStatus: (r: AdminReport) => void }) {
  const { t, f } = useI18n();
  const R = t.adm.rep;
  const { data: r, setData, failed, reload } = useLoad(() => getAdminReport(id), [id]);
  const { ago, time } = useTimes();
  const screen = useScreenLabel();
  const [busy, setBusy] = useState(false);
  const status = async (s: "open" | "in_progress" | "fixed") => {
    setBusy(true);
    try {
      const n = await setAdminReportStatus(id, s);
      if (n) {
        setData(n);
        onStatus(n);
      }
    } catch {
      toast.error(t.adm.retry);
    } finally {
      setBusy(false);
    }
  };
  const issue = async () => {
    setBusy(true);
    const n = await openReportIssue(id).catch(() => null);
    setBusy(false);
    if (n) {
      setData((d) => (d ? { ...d, githubIssue: n } : d));
      toast.success(f(R.issue, { n }));
    } else toast.error(t.adm.retry);
  };
  if (failed) return <Failed onRetry={reload} />;
  if (!r) return <section className="panel" style={{ flex: 1, padding: 20 }}><Skeleton rows={4} /></section>;
  const s = r.screen;
  const screenLine = s ? [s.view ? screen(viewKey(s.view)) : null, s.viewport, s.mode ? (s.mode === "dark" ? R.dark : R.light) : null, s.locale ? (s.locale === "he" ? R.he : R.en) : null].filter(Boolean).join(", ") : "—";
  const appLine = [r.installed == null ? null : r.installed ? R.installed : R.inBrowser, r.build ? f(R.build, { b: r.build }) : null].filter(Boolean).join(", ") || "—";
  const seg = segOf(r.status);
  const buttons = (
    <>
      {seg !== "in_progress" && seg !== "fixed" && (
        <button type="button" className={`btn sm${phone ? " block" : ""}`} disabled={busy} onClick={() => void status("in_progress")} data-report-progress>
          {R.markProgress}
        </button>
      )}
      {seg !== "fixed" ? (
        <button type="button" className={`btn sm pri${phone ? " block" : ""}`} disabled={busy} onClick={() => void status("fixed")} data-report-fixed>
          {R.markFixed}
        </button>
      ) : (
        <button type="button" className={`btn sm${phone ? " block" : ""}`} disabled={busy} onClick={() => void status("open")} data-report-reopen>
          {R.reopen}
        </button>
      )}
    </>
  );
  const details = (
    <dl className="kv">
      <dt>{R.space}</dt>
      <dd>{r.space ?? "—"}</dd>
      <dt>{R.screen}</dt>
      <dd>{screenLine}</dd>
      <dt>{R.app}</dt>
      <dd>{appLine}</dd>
      <dt>{R.errors}</dt>
      <dd>
        {r.errors.length === 0
          ? R.noErrors
          : r.errors.map((e, k) => (
              <span key={k} className="code" style={{ display: "block", fontSize: 12, overflowWrap: "anywhere" }} dir="ltr">
                {time(e.at)} {e.kind}: {e.message}
              </span>
            ))}
      </dd>
    </dl>
  );
  const shot = r.screenshot ? (
    // eslint-disable-next-line @next/next/no-img-element -- a stored data URL
    <img src={r.screenshot} alt={R.screenshot} style={{ width: "100%", borderRadius: 12, border: "1px solid var(--line)", objectFit: "contain", maxHeight: phone ? 320 : 260, background: "var(--s)" }} />
  ) : (
    <div className="shot" style={{ height: phone ? 120 : 240 }}>
      {R.noShot}
    </div>
  );
  const issueBtn = issues && (
    <div style={{ display: "flex", gap: 8 }}>
      {r.githubIssue ? (
        <span className="badge">{f(R.issue, { n: r.githubIssue })}</span>
      ) : (
        <button type="button" className="btn sm" disabled={busy} onClick={() => void issue()} data-report-issue>
          {R.openIssue}
        </button>
      )}
    </div>
  );
  const name = r.reporter.name ?? R.someone;

  if (phone)
    return (
      <>
        <div className="bar">
          <button type="button" className="btn icon ghost" onClick={onBack} aria-label={R.back}>
            <Svg d={PATH.back} className="i flip" />
          </button>
          <span className="sub">{R.back}</span>
        </div>
        <div className="page push under-bar" data-report={id}>
          <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Av id={r.reporter.id ?? r.id} name={name} />
              <span style={{ flex: 1, lineHeight: 1.3, minWidth: 0 }}>
                <b>{name}</b>
                <br />
                <span className="tiny">{[s?.view ? screen(viewKey(s.view)) : null, ago(r.createdAt)].filter(Boolean).join(", ")}</span>
              </span>
              <Badge status={r.status} />
            </div>
            <b style={{ fontSize: 16 }}>{r.title}</b>
            <div style={{ fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} data-report-body>
              {r.body}
            </div>
            {shot}
            {details}
            {issueBtn}
            <div style={{ display: "flex", gap: 8 }}>{buttons}</div>
          </div>
        </div>
      </>
    );

  return (
    <section className="panel" style={{ flex: 1, padding: "20px 24px", gap: 16, overflowY: "auto", minWidth: 0 }} data-report={id}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Av id={r.reporter.id ?? r.id} name={name} size="lg" />
        <span style={{ flex: 1, lineHeight: 1.3, minWidth: 0 }}>
          <b style={{ fontSize: 17, overflowWrap: "anywhere" }}>{r.title}</b>
          <br />
          <span className="sub">
            {name}, {ago(r.createdAt)}
          </span>
        </span>
        {buttons}
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "60ch", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} data-report-body>
        {r.body}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr)", gap: 20 }}>
        {shot}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {details}
          {issueBtn}
        </div>
      </div>
    </section>
  );
}
