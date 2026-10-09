"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createErrorIssue, listErrorEvents, setErrorStatus } from "@/app/error-actions";
import { useI18n } from "@/components/providers";
import type { ErrorEvent } from "@/db/schema";
import type { Go } from "./admin-app";
import { Failed, PATH, Skeleton, Svg, useLoad, useTimes } from "./ui";

// R17 G6 — Errors (board Admin-desktop "Errors"): the E5 grouped error log inside the panel — kinds as badges,
// collapsible groups (blocked stores per host, viewport checks, Google sign-in), mark fixed. Counts, never people.

type Seg = "open" | "fixed";
type Group = { key: string; badge: string; tone: string; title: string; sub: string | null; rows: ErrorEvent[]; count: number; last: number; grouped: boolean };

export function ErrorsTab({ phone, go }: { phone: boolean; go: Go }) {
  const { t, f } = useI18n();
  const E = t.adm.err;
  const v = t.errorsAdmin;
  const [seg, setSeg] = useState<Seg>("open");
  const { data: open, setData: setOpen, failed, reload } = useLoad(() => listErrorEvents({ status: ["new", "known"], sort: "last" }), []);
  const { data: fixed, reload: reloadFixed } = useLoad(() => listErrorEvents({ status: ["fixed"], sort: "last" }), []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { date, time } = useTimes();

  const when = (ms: number) => {
    const d = new Date(ms);
    const today = new Date();
    return d.toDateString() === today.toDateString() ? `${t.adm.ago.today}, ${time(ms)}` : date(ms, true);
  };
  const kindOf = (r: ErrorEvent): [string, string] => {
    const k = r.kind === "ai" ? "server" : r.kind;
    const label = (E.kinds as Record<string, string>)[k] ?? E.kinds.other;
    const tone = k === "server" || k === "cron" ? "badge dng" : k === "extract" ? "badge warn" : k === "auth" ? "badge info" : "badge";
    return [label, tone];
  };
  const groups = useMemo(() => {
    const rows = (seg === "open" ? open?.rows : fixed?.rows) ?? [];
    const by = new Map<string, Group>();
    for (const r of rows) {
      const [badge, tone] = kindOf(r);
      const key = r.kind === "viewport" ? "g:viewport" : r.kind === "auth" && /^google_/.test(r.code) ? "g:google" : r.kind === "extract" && /^(blocked|fetch|blocked_host)$/.test(r.code) ? "g:stores" : r.fingerprint;
      const g = by.get(key) ?? {
        key,
        badge,
        tone,
        title: key === "g:viewport" ? E.gLayout : key === "g:google" ? E.gGoogle : key === "g:stores" ? E.gStores : r.code,
        sub: key.startsWith("g:") ? null : f(E.on, { where: r.where }),
        rows: [],
        count: 0,
        last: 0,
        grouped: key.startsWith("g:"),
      };
      g.rows.push(r);
      g.count += r.count;
      g.last = Math.max(g.last, r.lastSeen);
      by.set(key, g);
    }
    return [...by.values()].sort((a, b) => b.last - a.last);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labels follow the locale via t
  }, [open, fixed, seg, t]);

  const mark = async (g: Group, status: "fixed" | "new") => {
    try {
      await Promise.all(g.rows.map((r) => setErrorStatus(r.fingerprint, status)));
      if (status === "fixed") setOpen((d) => (d ? { ...d, rows: d.rows.filter((r) => !g.rows.includes(r)) } : d));
      await Promise.all([reload(), reloadFixed()]);
    } catch {
      toast.error(t.adm.retry);
    }
  };
  const issue = async (fp: string) => {
    const n = await createErrorIssue(fp).catch(() => null);
    if (n) toast.success(f(v.issued, { n }));
  };
  const toggle = (k: string) => setExpanded((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  const segs = (
    <span className="seg" style={phone ? { display: "flex" } : { marginInlineStart: "auto" }} role="group">
      {(
        [
          ["open", f(E.open, { n: open?.rows.length ?? 0 })],
          ["fixed", f(E.fixed, { n: fixed?.rows.length ?? 0 })],
        ] as [Seg, string][]
      ).map(([k, label]) => (
        <button key={k} type="button" className={seg === k ? "on" : ""} aria-pressed={seg === k} style={phone ? { flex: 1, justifyContent: "center" } : undefined} onClick={() => setSeg(k)} data-errors-seg={k}>
          {label}
        </button>
      ))}
    </span>
  );

  const list = (
    <section className="panel" style={{ padding: "6px 0", flexShrink: 0 }} data-errors-admin>
      {!open && <div style={{ padding: 14 }}><Skeleton rows={4} h={44} /></div>}
      {open && groups.length === 0 && (
        <div className="empty" data-errors-empty>
          {v.empty}
        </div>
      )}
      {groups.map((g) => {
        const isOpen = expanded.has(g.key);
        return (
          <div key={g.key} data-error-group={g.key}>
            <div className="grp" style={phone ? { flexWrap: "wrap", padding: "10px 14px" } : undefined}>
              <button type="button" className="btn icon ghost sm" aria-expanded={isOpen} aria-label={g.title} onClick={() => toggle(g.key)} style={{ marginInlineStart: -8 }}>
                <Svg d={isOpen ? PATH.down : PATH.chev} className="i sm flip" />
              </button>
              <span className={g.tone}>{g.badge}</span>
              <span className="grow" style={{ minWidth: phone ? "60%" : 0 }}>
                <b style={{ overflowWrap: "anywhere" }}>{g.title}</b> {g.sub && <span className="tiny" style={{ overflowWrap: "anywhere" }}>{g.sub}</span>}
              </span>
              <span className="tiny">{when(g.last)}</span>
              <span className="cnt">{g.count}</span>
              <button type="button" className="btn sm ghost" onClick={() => void mark(g, seg === "open" ? "fixed" : "new")} data-error-fix>
                {seg === "open" ? v.markFixed : v.reopen}
              </button>
            </div>
            {isOpen &&
              g.rows.map((r) => (
                <div key={r.fingerprint} className="ent" style={{ flexDirection: "column", gap: 4, paddingInlineStart: phone ? 18 : 50 }} data-error-row={r.fingerprint}>
                  <span style={{ display: "flex", gap: 12 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{g.grouped ? r.where.replace(/^extract:/, "") : r.code}</span>
                    <span style={{ marginInlineStart: "auto", color: "var(--faint)", whiteSpace: "nowrap" }}>{f(E.times, { n: r.count, when: when(r.lastSeen) })}</span>
                  </span>
                  <pre className="code" dir="ltr" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, maxHeight: 120, overflow: "auto", color: "var(--muted)" }}>
                    {r.sample ?? r.message}
                  </pre>
                  {open?.issues && seg === "open" && (
                    <span>
                      <button type="button" className="btn sm ghost" onClick={() => void issue(r.fingerprint)}>
                        {v.issue}
                      </button>
                    </span>
                  )}
                </div>
              ))}
          </div>
        );
      })}
    </section>
  );

  if (phone)
    return (
      <div className="page" data-errors>
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", marginInlineStart: -8 }} onClick={() => go("more")}>
          <Svg d={PATH.back} className="i sm flip" />
          {t.adm.tabs.more}
        </button>
        <h1 className="lt">{t.adm.tabs.errors}</h1>
        <span className="sub" style={{ marginTop: -8 }}>
          {E.kept}
        </span>
        {segs}
        {failed && <Failed onRetry={reload} />}
        {list}
        <div className="hint">{E.storesFix}</div>
      </div>
    );
  return (
    <>
      <div className="ad-top">
        <h1>{t.adm.tabs.errors}</h1>
        <span className="sub">{E.kept}</span>
        {segs}
      </div>
      <div className="ad-body" data-errors>
        {failed && <Failed onRetry={reload} />}
        {list}
        {open && open.overflow > 0 && <div className="alert warn">{f(v.overflow, { n: open.overflow })}</div>}
        <div className="hint">{E.storesFix}</div>
      </div>
    </>
  );
}
