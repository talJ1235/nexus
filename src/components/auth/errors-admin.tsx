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
          {data.rows.map((r) => (
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
                  {data.issues && (
                    <button type="button" className="btn sm" onClick={() => void issue(r.fingerprint)}>
                      {v.issue}
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && data.overflow > 0 && <div className="alert warn">{f(v.overflow, { n: data.overflow })}</div>}
    </div>
  );
}
