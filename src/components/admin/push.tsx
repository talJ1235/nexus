"use client";

import { useState } from "react";
import { adminTestPush, type getSystem } from "@/app/admin-actions";
import { useI18n } from "@/components/providers";
import { useNow, useTimes } from "./ui";

// R17 S6 U1 — System → Push: where a push gets lost. The dispatcher's last run (warning after 90 min), the last 7 days'
// rows by push state with the age of the oldest waiting row, every registered device (person, phone / computer, label,
// last success, last failure code) and "Send a test push to my devices" with the answer per device. Counts and status
// codes only — never a notification's text or a push address.

type Sys = Awaited<ReturnType<typeof getSystem>>;
type Res = Awaited<ReturnType<typeof adminTestPush>>;

export const DISPATCH_OLD_MS = 90 * 60_000;
export const DUE_OLD_MS = 70 * 60_000;

export function PushPanel({ data, phone }: { data: Sys; phone: boolean }) {
  const { t, f } = useI18n();
  const S = t.adm.sys;
  const { ago, time, num } = useTimes();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const n = data.notify;
  const last = n.last;
  const dispOld = !last || now - last.at > DISPATCH_OLD_MS;
  const dueOld = n.oldestDueAt != null && now - n.oldestDueAt > DUE_OLD_MS;
  const test = async () => {
    setBusy(true);
    setRes(await adminTestPush().catch(() => null));
    setBusy(false);
  };
  const hl = (dot: string, label: string, right: string, extra: Record<string, string> = {}) => (
    <div className="hl" {...extra}>
      <span className={`dot ${dot}`} aria-hidden="true" />
      <span className="grow">{label}</span>
      <span className="r">{right}</span>
    </div>
  );
  return (
    <section className="panel" data-system-push-panel data-dispatch-old={dispOld ? "yes" : "no"} data-due-old={dueOld ? "yes" : "no"}>
      <div className="ph">
        <h2>{S.pushTitle}</h2>
        <span className="tiny">{n.configured ? f(S.pushLine, { p: n.phone, c: n.computer }) : S.pushOff}</span>
      </div>
      <div className="pb" style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))", gap: phone ? 4 : 24, alignItems: "start" }}>
        <div>
          {hl(
            !last ? "dng" : dispOld ? "warn" : "ok",
            S.dispatcher,
            !last ? S.dispNever : dispOld ? f(S.dispOld, { when: ago(last.at, now) }) : f(S.dispRun, { when: `${ago(last.at, now)} ${time(last.at)}`, s: Math.round(last.ms / 1000), n: last.sent, f: last.failed }),
            { "data-push-dispatcher": dispOld ? "old" : "ok" },
          )}
          {hl(dueOld ? "warn" : "ok", n.oldestDueAt != null ? f(S.oldestDue, { when: ago(n.oldestDueAt, now) }) : S.noneDue, num(n.dueNow), { "data-push-oldest": n.oldestDueAt == null ? "none" : String(Math.round((now - n.oldestDueAt) / 60_000)) })}
          <div style={{ paddingTop: 10 }}>
            <button type="button" className="btn sm" onClick={() => void test()} disabled={busy || !n.configured} data-push-test>
              {S.testMine}
            </button>
            {res && (
              <div className="tiny" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }} data-push-test-result={res.results.length}>
                {!res.configured ? S.pushOff : res.results.length === 0 ? S.testNoDevice : res.results.map((r, i) => (
                  <span key={i} data-push-result={r.result}>
                    <span className="bidi">{r.label ?? r.device}</span> · {f(S.res[r.result], { code: r.code })}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div data-push-states>
          <div className="tiny" style={{ padding: "9px 0 2px" }}>{S.week}</div>
          {(["due", "sent", "failed", "skipped", "off"] as const).map((k) =>
            hl(k === "sent" ? "ok" : k === "failed" ? (n.byState.failed ? "warn" : "off") : k === "due" ? (dueOld ? "warn" : "off") : "off", S.states[k], num(n.byState[k]), { key: k, "data-push-state": k }),
          )}
        </div>
        <div data-push-devices={n.devices.length}>
          <div className="tiny" style={{ padding: "9px 0 2px" }}>{S.devices}</div>
          {n.devices.length === 0 && <div className="tiny">{S.noDevices}</div>}
          {n.devices.map((d) => {
            const failedLast = d.lastFailAt != null && (d.lastOkAt == null || d.lastFailAt > d.lastOkAt);
            return (
              <div className="hl" key={d.id} data-push-device={d.device}>
                <span className={`dot ${failedLast ? "warn" : d.lastOkAt ? "ok" : "off"}`} aria-hidden="true" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="bidi" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(d.name || "").trim().split(/\s+/)[0] || "—"} · {d.label ?? d.device}
                  </span>
                </span>
                <span className="r tiny">{failedLast ? f(S.devFail, { code: d.lastCode ?? 0, when: ago(d.lastFailAt!, now) }) : d.lastOkAt ? f(S.devOk, { when: ago(d.lastOkAt, now) }) : S.devNever}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
