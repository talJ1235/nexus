"use client";

import { useState } from "react";
import { getAiStats } from "@/app/admin-actions";
import { useI18n } from "@/components/providers";
import type { AiStats } from "@/lib/db-scoped/admin";
import type { Go } from "./admin-app";
import { Av, Failed, PATH, Skeleton, Svg, useLoad, useTimes } from "./ui";

// R17 G4 — AI usage (board Admin-desktop "AI usage") from ai_usage: calls today, the period (+ change vs the one
// before), failure rate (every failure fell back to rules), "if it were paid", calls per day stacked by provider +
// failed, by feature, closest to the limit today.

/**
 * "If it were paid": approximate list prices in USD per million tokens (input, output) for the models Nexus calls, from
 * each provider's public pricing page (ai.google.dev/gemini-api/docs/pricing, groq.com/pricing, openrouter.ai/models)
 * as remembered when R17 was built (2026-10-09) — not checked live; update the table when a provider changes prices.
 * Free-tier models on OpenRouter cost 0. A row without a token count is estimated as 1 200 input +
 * 300 output tokens (a typical Nexus prompt). Approximate on purpose: the point is the order of magnitude.
 */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /gemini.*flash-lite/i, input: 0.1, output: 0.4 },
  { match: /gemini.*flash/i, input: 0.3, output: 2.5 },
  { match: /gemini.*pro/i, input: 1.25, output: 10 },
  { match: /llama-3\.3-70b|70b/i, input: 0.59, output: 0.79 },
  { match: /llama.*8b|8b-instant/i, input: 0.05, output: 0.08 },
  { match: /:free$/i, input: 0, output: 0 },
];
const EST_IN = 1200;
const EST_OUT = 300;

function paidPerMonth(s: AiStats, days: number) {
  let usd = 0;
  for (const m of s.models) {
    const p = PRICES.find((x) => x.match.test(m.model)) ?? (m.provider === "openrouter" ? { input: 0, output: 0 } : { input: 0.3, output: 2.5 });
    const tokens = m.tokens || m.n * (EST_IN + EST_OUT);
    const share = m.tokens ? 0.8 : EST_IN / (EST_IN + EST_OUT);
    usd += (tokens * share * p.input + tokens * (1 - share) * p.output) / 1e6;
  }
  return (usd / days) * 30;
}

const PROVIDERS = [
  ["gemini", "p-gem", "Gemini"],
  ["groq", "p-groq", "Groq"],
  ["openrouter", "p-or", "OpenRouter"],
] as const;

export function AiTab({ phone, go }: { phone: boolean; go: Go }) {
  const { t, f, locale } = useI18n();
  const A = t.adm.ai;
  const [days, setDays] = useState<7 | 30>(30);
  const { data, failed, reload } = useLoad(() => getAiStats(days), [days]);
  const { date, num } = useTimes();

  const seg = (
    <span className="seg" style={{ marginInlineStart: phone ? undefined : "auto" }} role="group">
      {([7, 30] as const).map((d) => (
        <button key={d} type="button" className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)} data-ai-days={d}>
          {d === 7 ? A.d7 : A.d30}
        </button>
      ))}
    </span>
  );

  const change = (s: AiStats) => {
    if (!s.previous) return null;
    const p = Math.round(((s.period - s.previous) / s.previous) * 100);
    return Math.abs(p) < 3 ? A.same : p > 0 ? f(A.up, { p }) : f(A.down, { p: -p });
  };
  const usd = (v: number) => `≈ ${new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: v < 10 ? 2 : 0 }).format(v)}`;

  const content = !data ? (
    <Skeleton rows={4} h={90} />
  ) : (
    <>
      <div className="strip" style={{ gridTemplateColumns: phone ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))" }} data-ai-stats>
        <div className="stat">
          <span className="v num" data-ai-today={data.today}>
            {num(data.today)}
          </span>
          <span className="k">{A.today}</span>
        </div>
        <div className="stat" style={phone ? { borderInlineStart: "1px solid var(--line-in)" } : undefined}>
          <span className="v num">{num(data.period)}</span>
          <span className="k">
            {f(A.period, { d: days })}
            {change(data) ? `, ${change(data)}` : ""}
          </span>
        </div>
        <div className="stat" style={phone ? { borderInlineStart: 0, borderTop: "1px solid var(--line-in)" } : undefined}>
          <span className="v num">{data.period ? `${((data.failed / data.period) * 100).toFixed(1)}%` : "0%"}</span>
          <span className="k">{A.failed}</span>
        </div>
        <div className="stat" style={phone ? { borderTop: "1px solid var(--line-in)" } : undefined}>
          <span className="v num">{usd(paidPerMonth(data, days))}</span>
          <span className="k">{A.paid}</span>
        </div>
      </div>
      <section className="panel">
        <div className="ph">
          <h2>{A.perDay}</h2>
          <div className="lgd" style={{ flexWrap: "wrap" }}>
            {PROVIDERS.map(([, cls, name]) => (
              <span key={cls}>
                <i className={cls} />
                {name}
              </span>
            ))}
            <span>
              <i className="p-fail" />
              {A.failedL}
            </span>
          </div>
        </div>
        <div className="pb" dir="ltr">
          {data.period === 0 ? (
            <div className="tiny" dir="auto">{A.noCalls}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: days === 7 ? 10 : phone ? 2 : 4, height: 130 }} data-ai-days-chart>
                {(() => {
                  const max = Math.max(1, ...data.days.map((d) => Object.values(d.byProvider).reduce((a, b) => a + b, 0) + d.failed));
                  return data.days.map((d) => {
                    const by = d.byProvider;
                    const other = Object.entries(by).filter(([k]) => !PROVIDERS.some(([p]) => p === k)).reduce((a, [, v]) => a + v, 0);
                    const tot = Object.values(by).reduce((a, b) => a + b, 0) + d.failed;
                    const pc = (v: number) => `${tot ? (v / tot) * 100 : 0}%`;
                    return (
                      <div key={d.day} className="stack" style={{ height: `${Math.max(tot ? 3 : 0, (tot / max) * 100)}%` }} title={`${d.day} · ${tot}`}>
                        <i className="p-gem" style={{ height: pc((by.gemini ?? 0) + other) }} />
                        <i className="p-groq" style={{ height: pc(by.groq ?? 0) }} />
                        <i className="p-or" style={{ height: pc(by.openrouter ?? 0) }} />
                        <i className="p-fail" style={{ height: pc(d.failed) }} />
                      </div>
                    );
                  });
                })()}
              </div>
              {/* The chart runs left → right (time), its labels read in their own language (R17 P2). */}
              <div className="xaxis">
                <span dir="auto">{date(Date.parse(data.days[0].day))}</span>
                {days === 30 && !phone && <span dir="auto">{date(Date.parse(data.days[14].day))}</span>}
                <span dir="auto">{t.adm.ago.today}</span>
              </div>
            </>
          )}
        </div>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
        <section className="panel">
          <div className="ph">
            <h2>{A.byFeature}</h2>
          </div>
          <div className="pb" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-ai-features>
            {data.features.length === 0 && <div className="tiny">{A.noCalls}</div>}
            {data.features.slice(0, 8).map((x) => (
              <div key={x.feature} style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr) 40px", gap: 10, alignItems: "center", fontSize: 13 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(A.features as Record<string, string>)[x.feature] ?? x.feature}</span>
                <div className="hbar">
                  <i style={{ width: `${(x.n / data.features[0].n) * 100}%` }} />
                </div>
                <span className="num tiny" style={{ textAlign: "end" }}>
                  {num(x.n)}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="ph">
            <h2>{A.closest}</h2>
          </div>
          <div className="pb" data-ai-closest>
            {data.closest.length === 0 && <div className="tiny">{A.noneToday}</div>}
            {data.closest.map((c) => (
              <button key={c.userId} type="button" className="hl" style={{ width: "100%", border: 0, background: "none", textAlign: "start", color: "inherit" }} onClick={() => go("people", c.userId)}>
                <Av id={c.userId} name={c.name} size="sm" />
                <span className="grow bidi">{c.name}</span>
                <span className={`qbar${c.limit != null && c.used >= c.limit ? " full" : ""}`}>
                  <i style={{ width: `${Math.min(100, c.limit == null ? (c.used / 40) * 100 : c.limit ? (c.used / c.limit) * 100 : 100)}%` }} />
                </span>
                <span className="r">{c.limit == null ? f(t.adm.people.noLimit, { n: c.used }) : f(t.adm.people.ofLimit, { n: c.used, l: c.limit })}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );

  if (phone)
    return (
      <div className="page" data-ai>
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", marginInlineStart: -8 }} onClick={() => go("more")}>
          <Svg d={PATH.back} className="i sm flip" />
          {t.adm.tabs.more}
        </button>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <h1 className="lt" style={{ flex: 1 }}>
            {t.adm.tabs.ai}
          </h1>
          {seg}
        </div>
        {failed && <Failed onRetry={reload} />}
        {content}
      </div>
    );
  return (
    <>
      <div className="ad-top">
        <h1>{t.adm.tabs.ai}</h1>
        {seg}
      </div>
      <div className="ad-body" data-ai>
        {failed && <Failed onRetry={reload} />}
        {content}
      </div>
    </>
  );
}
