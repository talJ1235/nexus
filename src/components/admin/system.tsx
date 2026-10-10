"use client";

import { getSystem } from "@/app/admin-actions";
import { useI18n } from "@/components/providers";
import type { Go } from "./admin-app";
import { Failed, PATH, Skeleton, Svg, useLoad, useNow, useTimes } from "./ui";

// R17 G7 — System (board Admin-desktop "System"): services (DB ping, the last AI success per provider, live sync, price
// checks in the last hour, the store reader), the daily job's last run (steps + counts), DB size + rows per table,
// and the keys — set / missing, names only (never a value).

const DAY = 86_400_000;
const PROVIDER_KEY: Record<string, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY" };
const PROVIDER_NAME: Record<string, string> = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter" };

export function SystemTab({ phone, go }: { phone: boolean; go: Go }) {
  const { t, f } = useI18n();
  const S = t.adm.sys;
  const { data, failed, reload } = useLoad(() => getSystem(), []);
  const { ago, time, num } = useTimes();
  const now = useNow();

  const content = !data ? (
    <Skeleton rows={3} h={160} />
  ) : (
    (() => {
      const keySet = (n: string) => data.keys.find((k) => k.name === n)?.set ?? false;
      const cron = data.cron as (Record<string, unknown> & { at: number; ms?: number }) | null;
      const cronOld = !cron || now - cron.at > DAY + 2 * 3_600_000;
      const anyAi = Object.values(PROVIDER_KEY).some(keySet);
      const healthy = data.db.ping < 1500 && !cronOld && anyAi;
      const ai = (["gemini", "groq", "openrouter"] as const).filter((p) => keySet(PROVIDER_KEY[p]));
      const last = (p: string) => data.db.ai.find((a) => a.provider === p);
      const n = (k: string) => {
        const v = cron?.[k];
        return typeof v === "number" ? v : v && typeof v === "object" ? ((v as Record<string, number>).changed ?? (v as Record<string, number>).repaired ?? 0) : 0;
      };
      const maxRows = Math.max(1, ...data.db.rows.map((r) => r.rows));
      const size = data.db.bytes ? (data.db.bytes > 1e6 ? `${(data.db.bytes / 1e6).toFixed(1)} MB` : `${Math.round(data.db.bytes / 1e3)} KB`) : null;
      const hl = (dot: string, label: string, right: string, key?: string) => (
        <div className="hl" key={key ?? label}>
          <span className={`dot ${dot}`} aria-hidden="true" />
          <span className="grow">{label}</span>
          <span className="r">{right}</span>
        </div>
      );
      return (
        <>
          <span className={`badge ${healthy ? "ok" : "warn"}`} style={{ alignSelf: "flex-start", display: phone ? undefined : "none" }}>
            {healthy ? S.healthy : S.attention}
          </span>
          <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))", gap: 16, alignItems: "start" }} data-system data-healthy={healthy ? "yes" : "no"}>
            <section className="panel">
              <div className="ph">
                <h2>{S.services}</h2>
              </div>
              <div className="pb">
                {hl(data.db.ping < 500 ? "ok" : data.db.ping < 1500 ? "warn" : "dng", S.database, `${data.db.ping} ms`)}
                {ai.length === 0 && hl("dng", f(S.aiOf, { p: "—" }), S.missing)}
                {ai.map((p, k) => {
                  const l = last(p);
                  return hl(
                    l ? "ok" : "off",
                    f(k === 0 ? S.aiOf : S.aiBackup, { p: PROVIDER_NAME[p] }),
                    l ? (k === 0 ? `${(l.ms / 1000).toFixed(1)} s · ${ago(l.at, now)}` : now - l.at < DAY ? ago(l.at, now) : S.standingBy) : k === 0 ? S.notUsed : S.standingBy,
                    p,
                  );
                })}
                {hl(data.realtime ? "ok" : "warn", S.live, data.realtime ? S.liveOn : S.liveOff)}
                {hl("ok", S.checks, f(S.linksHour, { n: num(data.db.checksHour) }))}
                {hl(data.storeReader ? "ok" : "off", S.reader, data.storeReader ? S.on : S.notSetUp)}
                {/* R17 S3 N3: counts only — devices, sent / failed today, due now. */}
                {hl(!data.notify.configured ? "off" : data.notify.failedToday > data.notify.sentToday ? "warn" : "ok", S.push, data.notify.configured ? f(S.pushLine, { p: data.notify.phone, c: data.notify.computer }) : S.pushOff, "push")}
                {data.notify.configured && (
                  <div className="tiny" style={{ paddingInlineStart: 18, marginTop: -4 }} data-system-push>
                    {f(S.pushToday, { s: data.notify.sentToday, f: data.notify.failedToday, d: data.notify.dueNow })}
                  </div>
                )}
              </div>
            </section>
            <section className="panel">
              <div className="ph">
                <h2>{S.job}</h2>
                <span className="tiny">{cron ? f(S.jobWhen, { when: `${ago(cron.at, now)} ${time(cron.at)}`, s: Math.round((cron.ms ?? 0) / 1000) }) : S.never}</span>
              </div>
              <div className="pb" data-system-cron>
                {cron ? (
                  <>
                    {hl(cronOld ? "warn" : "ok", S.jPrices, f(S.jChecked, { n: n("checked") }))}
                    {hl("ok", S.jShort, f(S.jRenamed, { n: n("shortNames") }))}
                    {hl("ok", S.jAccounts, f(S.jRemoved, { n: n("accountsPurged") }))}
                    {hl("ok", S.jSpaces, f(S.jRemoved, { n: n("purged") }))}
                    {hl("ok", S.jErrors, f(S.jRemoved, { n: n("errorsPurged") }))}
                    {cron.presence != null && hl("ok", S.jPresence, f(S.jRemoved, { n: n("presence") }))}
                  </>
                ) : (
                  <div className="tiny">{S.never}</div>
                )}
              </div>
            </section>
            <section className="panel">
              <div className="ph">
                <h2>{S.dbTitle}</h2>
                {size && <span className="tiny">{size}</span>}
              </div>
              <div className="pb" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-system-tables>
                {data.db.rows.map((r) => (
                  <div key={r.table} style={{ display: "grid", gridTemplateColumns: "100px minmax(0,1fr) 54px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(S.tables as Record<string, string>)[r.table] ?? r.table}</span>
                    <div className="hbar">
                      <i style={{ width: `${(r.rows / maxRows) * 100}%` }} />
                    </div>
                    <span className="num tiny" style={{ textAlign: "end" }}>
                      {num(r.rows)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="panel" data-system-keys>
            <div className="ph">
              <h2>{S.keys}</h2>
              <span className="tiny">{S.keysHint}</span>
            </div>
            <div className="pb" style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))", columnGap: 24 }}>
              {data.keys.map((k) => (
                <div key={k.name} className="hl" style={{ borderTop: "1px solid var(--line-in)" }} data-key={k.name} data-set={k.set ? "yes" : "no"}>
                  <span className={`dot ${k.set ? "ok" : "off"}`} aria-hidden="true" />
                  <span className="grow code" dir="ltr" style={{ fontSize: 12.5 }}>
                    {k.name}
                  </span>
                  <span className="r">{k.set ? S.set : S.missing}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      );
    })()
  );

  if (phone)
    return (
      <div className="page" data-system-page>
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", marginInlineStart: -8 }} onClick={() => go("more")}>
          <Svg d={PATH.back} className="i sm flip" />
          {t.adm.tabs.more}
        </button>
        <h1 className="lt">{t.adm.tabs.system}</h1>
        {failed && <Failed onRetry={reload} />}
        {content}
      </div>
    );
  return (
    <>
      <div className="ad-top">
        <h1>{t.adm.tabs.system}</h1>
        {data && <HealthBadge data={data} />}
      </div>
      <div className="ad-body" data-system-page>
        {failed && <Failed onRetry={reload} />}
        {content}
      </div>
    </>
  );
}

function HealthBadge({ data }: { data: Awaited<ReturnType<typeof getSystem>> }) {
  const { t } = useI18n();
  const now = useNow();
  const cron = data.cron as { at: number } | null;
  const anyAi = data.keys.some((k) => /^(GEMINI|GROQ|OPENROUTER)_API_KEY$/.test(k.name) && k.set);
  const ok = data.db.ping < 1500 && !!cron && now - cron.at < DAY + 2 * 3_600_000 && anyAi;
  return <span className={`badge ${ok ? "ok" : "warn"}`}>{ok ? t.adm.sys.healthy : t.adm.sys.attention}</span>;
}
