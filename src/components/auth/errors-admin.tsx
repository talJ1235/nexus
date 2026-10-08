"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createErrorIssue, listErrorEvents, setErrorStatus } from "@/app/error-actions";
import { useI18n } from "@/components/providers";
import type { ErrorEvent } from "@/db/schema";

type Status = ErrorEvent["status"];

// /admin/errors (R16 C2, admin only): the automatic error log — by last seen or count, filter by status, set a status,
// optionally open a GitHub issue. Shows counts and redacted samples; never users.
export function ErrorsAdmin() {
  const { t, f, locale } = useI18n();
  const v = t.errorsAdmin;
  const [filter, setFilter] = useState<Status | "all">("new");
  const [sort, setSort] = useState<"last" | "count">("last");
  const [data, setData] = useState<Awaited<ReturnType<typeof listErrorEvents>> | null>(null);
  const load = useCallback(() => listErrorEvents({ status: filter === "all" ? undefined : [filter], sort }).then(setData, () => setData(null)), [filter, sort]);
  useEffect(() => {
    void load();
  }, [load]);
  const day = (ms: number) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
  const set = async (fp: string, s: Status) => {
    await setErrorStatus(fp, s);
    await load();
  };
  const issue = async (fp: string) => {
    const n = await createErrorIssue(fp);
    if (n) toast.success(f(v.issued, { n }));
    await load();
  };
  const tone: Record<Status, string> = { new: "badge dng", known: "badge warn", fixed: "badge ok" };
  type Row = NonNullable<typeof data>["rows"][number];
  // R17 E5: the noisy kinds are grouped — viewport diagnostics, Google sign-in (FedCM sheet / status), and blocked stores
  // per host — so one store or one browser quirk is one line with its rows inside.
  const groupOf = (r: Row): string | null =>
    r.kind === "viewport" ? v.gViewport : r.kind === "auth" && /^google_/.test(r.code) ? v.gGoogle : r.kind === "extract" && /^(blocked|fetch|blocked_host)$/.test(r.code) ? f(v.gBlocked, { host: r.where.replace(/^extract:/, "") }) : null;
  const groups = new Map<string, Row[]>();
  const single: Row[] = [];
  for (const r of data?.rows ?? []) {
    const g = groupOf(r);
    if (!g) single.push(r);
    else groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const grouped = [...groups.entries()].map(([label, rows]) => ({ label, rows, count: rows.reduce((a, r) => a + r.count, 0) })).sort((a, b) => b.count - a.count);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-errors-admin>
      <p className="sub" style={{ margin: 0 }}>
        {v.intro}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <div className="tabs" role="tablist" style={{ flex: 1, minWidth: 0 }}>
          {(["new", "known", "fixed", "all"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)} data-errors-filter={k}>
              {v[k]}
            </button>
          ))}
        </div>
        <div className="tabs" role="tablist">
          {(["last", "count"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={sort === k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>
              {k === "last" ? v.byLast : v.byCount}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <div className="sub" aria-busy="true" style={{ padding: 24 }} />
      ) : !data.rows.length ? (
        <div className="sub" style={{ padding: 24, textAlign: "center" }} data-errors-empty>
          {v.empty}
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {grouped.map((g) => (
            <li key={g.label} className="card" style={{ padding: 0 }} data-error-group={g.label}>
              <details>
                <summary style={{ padding: 14, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <b>{g.label}</b>
                  <span className="sub" style={{ marginInlineStart: "auto", fontSize: 12 }}>
                    {f(v.gCount, { n: g.count, r: g.rows.length })}
                  </span>
                </summary>
                <ul style={{ listStyle: "none", margin: 0, padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {g.rows.map((r) => row(r))}
                </ul>
              </details>
            </li>
          ))}
          {single.map((r) => row(r))}
        </ul>
      )}
      {data && data.overflow > 0 && <div className="alert warn">{f(v.overflow, { n: data.overflow })}</div>}
    </div>
  );

  function row(r: Row) {
    return (
            <li key={r.fingerprint} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }} data-error-row={r.fingerprint}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className={tone[r.status]}>{v[r.status]}</span>
                <span className="badge">{r.kind}</span>
                <b className="mono" style={{ fontSize: 13 }}>
                  {r.code}
                </b>
                <span className="sub mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                  {r.where}
                </span>
                <span className="sub" style={{ marginInlineStart: "auto", fontSize: 12 }}>
                  {f(v.seen, { n: r.count, u: r.users })}
                </span>
              </div>
              <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, maxHeight: 140, overflow: "auto" }} dir="ltr">
                {r.sample ?? r.message}
              </pre>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className="tiny">
                  {f(v.first, { date: day(r.firstSeen) })} · {f(v.last, { date: day(r.lastSeen) })}
                  {r.release ? ` · ${r.release.slice(0, 7)}` : ""}
                </span>
                <span style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
                  {r.status !== "known" && (
                    <button type="button" className="btn sm" onClick={() => void set(r.fingerprint, "known")}>
                      {v.markKnown}
                    </button>
                  )}
                  {r.status !== "fixed" ? (
                    <button type="button" className="btn sm" onClick={() => void set(r.fingerprint, "fixed")} data-error-fix>
                      {v.markFixed}
                    </button>
                  ) : (
                    <button type="button" className="btn sm" onClick={() => void set(r.fingerprint, "new")}>
                      {v.reopen}
                    </button>
                  )}
                  {data?.issues && (
                    <button type="button" className="btn sm" onClick={() => void issue(r.fingerprint)}>
                      {v.issue}
                    </button>
                  )}
                </span>
              </div>
            </li>
    );
  }
}
