"use client";

import { useRef, useState } from "react";
import { getLive } from "@/app/admin-actions";
import { useI18n } from "@/components/providers";
import type { LiveData, LiveEvent } from "@/lib/db-scoped/admin";
import { LIVE_POLL_MS } from "@/lib/presence-keys";
import type { Go, Nav } from "./admin-app";
import { Av, beatHere, DevChip, Failed, Skeleton, useScreenLabel, useTimes, useVisiblePoll } from "./ui";

// R17 G1 — Live (board Admin-desktop "Live" tab / Admin-phone "Live" page): online now (device, where, for how long —
// or the amber "Shopping, N left"), earlier today, people online by hour, the activity stream (kinds + counts only).
// Polls every 5 s while visible (the admin's own presence and the nav counts ride on the same request); hidden = 0.

type Data = LiveData & { nav: Nav };

export function LiveTab({ phone, go, onNav }: { phone: boolean; go: Go; onNav: (n: Nav) => void }) {
  const { t, f } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  // New events enter with the board's 380 ms rise — not the ones on first paint.
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useVisiblePoll(async () => {
    try {
      const d = await getLive(beatHere("admin"));
      const ids = new Set(d.events.map((e) => e.id));
      if (seen.current) setFresh(new Set([...ids].filter((id) => !seen.current!.has(id))));
      seen.current = new Set([...(seen.current ?? []), ...ids]);
      setData(d);
      onNav(d.nav);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, LIVE_POLL_MS);

  const title = (
    <>
      {phone ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <h1 className="lt" style={{ flex: 1 }}>
            {t.adm.tabs.live}
          </h1>
          {data && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ok)", fontWeight: 700, fontSize: 15, paddingBottom: 4 }} data-live-online={data.stats.online}>
              <span className="ping" aria-hidden="true" />
              {f(t.adm.live.online, { n: data.stats.online })}
            </span>
          )}
        </div>
      ) : (
        <div className="ad-top">
          <h1>{t.adm.tabs.live}</h1>
          {data && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--ok)", fontWeight: 600 }} data-live-online={data.stats.online}>
              <span className="ping" aria-hidden="true" />
              {f(t.adm.live.onlineNow, { n: data.stats.online })}
            </span>
          )}
          <span className="sub" style={{ marginInlineStart: "auto" }}>
            {t.adm.live.updates}
          </span>
        </div>
      )}
    </>
  );

  if (!data)
    return phone ? (
      <div className="page">
        {title}
        {failed ? <Failed onRetry={() => window.location.reload()} /> : <Skeleton rows={5} />}
      </div>
    ) : (
      <>
        {title}
        <div className="ad-body">{failed ? <Failed onRetry={() => window.location.reload()} /> : <Skeleton rows={6} h={64} />}</div>
      </>
    );

  return phone ? <LivePhone data={data} title={title} fresh={fresh} go={go} /> : <LiveDesktop data={data} title={title} fresh={fresh} go={go} />;
}

function Split({ phone, computer }: { phone: number; computer: number }) {
  return (
    <div className="split" aria-hidden="true">
      {phone + computer === 0 ? (
        <i className="c-idle" style={{ flexGrow: 1 }} />
      ) : (
        <>
          {phone > 0 && <i className="c-phone" style={{ flexGrow: phone }} />}
          {computer > 0 && <i className="c-desk" style={{ flexGrow: computer }} />}
        </>
      )}
    </div>
  );
}

function useEventText() {
  const { t, f } = useI18n();
  const ev = t.adm.ev as Record<string, string>;
  return (e: LiveEvent) => {
    const one = ev[`${e.kind}1`];
    if (e.n === 1 && one) return one;
    return f(ev[e.kind] ?? e.kind, { n: e.n });
  };
}

function useWhere() {
  const { t } = useI18n();
  return (space: string | null, personal: boolean) => (personal ? t.adm.live.personal : space) ?? "";
}

function LiveDesktop({ data, title, fresh, go }: { data: Data; title: React.ReactNode; fresh: Set<number>; go: Go }) {
  const { t, f } = useI18n();
  const screen = useScreenLabel();
  const { dur, ago, since } = useTimes();
  const text = useEventText();
  const where = useWhere();
  const s = data.stats;
  const max = Math.max(1, ...data.hours);
  return (
    <>
      {title}
      <div className="ad-body fill" data-live>
        <div className="strip stg" style={{ gridTemplateColumns: "repeat(6,minmax(0,1fr))" }} data-live-stats>
          <div className="stat">
            <span className="v num">{s.online}</span>
            <span className="k">{t.adm.live.statOnline}</span>
            <div style={{ marginTop: 8 }}>
              <Split phone={s.phone} computer={s.computer} />
            </div>
            <span className="tiny" style={{ marginTop: 4 }}>
              {f(t.adm.live.split, { p: s.phone, c: s.computer })}
            </span>
          </div>
          <div className="stat">
            <span className="v num" data-live-shopping={s.shopping}>
              {s.shopping}
            </span>
            <span className="k">{t.adm.live.statShopping}</span>
          </div>
          <div className="stat">
            <span className="v num">
              {s.activeToday}{" "}
              <span className="tiny" style={{ fontSize: 13, letterSpacing: 0 }}>
                {f(t.adm.live.ofAll, { n: s.people })}
              </span>
            </span>
            <span className="k">{t.adm.live.statActive}</span>
          </div>
          <div className="stat">
            <span className="v num">{s.aiToday}</span>
            <span className="k">{t.adm.live.statAi}</span>
          </div>
          <div className="stat">
            <span className={`v num${s.reports ? " warnv" : ""}`}>{s.reports}</span>
            <span className="k">{t.adm.live.statReports}</span>
          </div>
          <div className="stat" data-live-notify={s.notifySent}>
            <span className="v num">{s.notifySent}</span>
            <span className="k">{t.adm.live.statNotify}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
            <section className="panel" style={{ minHeight: 0, overflow: "hidden", flex: "0 1 auto" }}>
              <div className="ph">
                <h2>{t.adm.live.statOnline}</h2>
                <div className="lgd">
                  <span>
                    <i className="c-phone" />
                    {t.adm.live.phone}
                  </span>
                  <span>
                    <i className="c-desk" />
                    {t.adm.live.computer}
                  </span>
                </div>
              </div>
              <div className="th-t live-cols">
                <span>{t.adm.live.person}</span>
                <span>{t.adm.live.device}</span>
                <span>{t.adm.live.where}</span>
                <span>{t.adm.live.for}</span>
              </div>
              <div style={{ overflowY: "auto", minHeight: 0 }}>
                {data.online.length === 0 && <div className="empty">{t.adm.live.nobody}</div>}
                {data.online.map((u) => (
                  <button key={u.userId} type="button" className="row-t live-cols" onClick={() => go("people", u.userId)} data-live-row={u.userId} data-device={u.device} data-screen={u.screen}>
                    <span className="who-c">
                      <Av id={u.userId} name={u.name} ring="on" />
                      <span className="nm">
                        <b className="bidi" title={u.name}>{u.name}</b>
                        <span title={where(u.space, u.personal)}>{where(u.space, u.personal)}</span>
                      </span>
                    </span>
                    <span>
                      <DevChip device={u.device} />
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {u.screen === "shopping-mode" ? (
                        <span className="shopping" data-live-shopping-chip={u.shoppingLeft ?? 0}>
                          <span className="ping amber" aria-hidden="true" />
                          {f(t.adm.live.shoppingLeft, { n: u.shoppingLeft ?? 0 })}
                        </span>
                      ) : (
                        <span className="scr" title={screen(u.screen)}>
                          {screen(u.screen)}
                        </span>
                      )}
                    </span>
                    <span className="sub num">{dur(data.now - u.since)}</span>
                  </button>
                ))}
              </div>
              <div className="th-t" style={{ paddingTop: 12, borderTop: "1px solid var(--line-in)" }}>
                <span>{t.adm.live.earlier}</span>
              </div>
              <div style={{ display: "flex", gap: 18, padding: "0 18px 14px", alignItems: "center", flexWrap: "wrap" }} data-live-earlier>
                {data.earlier.length === 0 && <span className="tiny">{t.adm.live.noEarlier}</span>}
                {data.earlier.slice(0, 8).map((e) => (
                  <button key={e.userId} type="button" className="sub" style={{ display: "inline-flex", gap: 8, alignItems: "center", border: 0, background: "none", padding: 0 }} onClick={() => go("people", e.userId)} data-live-earlier-row={e.userId}>
                    <Av id={e.userId} name={e.name} size="sm" ring="idle" />
                    {f(t.adm.live.earlierWho, { name: e.name, ago: ago(e.at, data.now) })}
                  </button>
                ))}
              </div>
            </section>
            <section className="panel" style={{ flex: "1 0 auto", minHeight: 120 }}>
              <div className="ph">
                <h2>{t.adm.live.byHour}</h2>
                <span className="tiny">{t.adm.ago.today}</span>
              </div>
              {/* Time runs left to right in both languages. */}
              <div className="pb" style={{ flex: 1, display: "flex", flexDirection: "column" }} dir="ltr">
                <div className="cols" style={{ flex: 1, height: "auto", minHeight: 60 }} data-live-hours>
                  {data.hours.map((v, k) => (
                    <i key={k} className={k === data.hourNow ? "hi" : ""} style={{ height: `${k > data.hourNow ? 0 : Math.max(4, (v / max) * 100)}%` }} title={`${String(k).padStart(2, "0")}:00 · ${v}`} />
                  ))}
                </div>
                <div className="xaxis">
                  <span>00:00</span>
                  <span>06:00</span>
                  <span>12:00</span>
                  <span>18:00</span>
                  <span>23:00</span>
                </div>
              </div>
            </section>
          </div>
          <section className="panel" style={{ minHeight: 0, overflow: "hidden" }}>
            <div className="ph">
              <h2>{t.adm.live.activity}</h2>
              <span className="tiny">{t.adm.live.countsOnly}</span>
            </div>
            <div className="pb stream" data-live-events>
              {data.events.length === 0 && <div className="tiny">{t.adm.live.noActivity}</div>}
              {data.events.map((e) => (
                <div key={e.id} className={`evr${fresh.has(e.id) ? " ev" : ""}`} data-event={e.kind}>
                  <Av id={e.userId} name={e.name} size="sm" />
                  <span style={{ minWidth: 0 }}>
                    <b>{e.name}</b> {text(e)}
                    {(e.space || e.personal) && (
                      <>
                        <br />
                        <span className="tiny">{where(e.space, e.personal)}</span>
                      </>
                    )}
                  </span>
                  <span className="r">{since(e.at, data.now)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function LivePhone({ data, title, fresh, go }: { data: Data; title: React.ReactNode; fresh: Set<number>; go: Go }) {
  const { t, f } = useI18n();
  const screen = useScreenLabel();
  const { dur, since } = useTimes();
  const text = useEventText();
  const s = data.stats;
  return (
    <div className="page" data-live>
      {title}
      <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <Split phone={s.phone} computer={s.computer} />
        <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--muted)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <i className="c-phone" style={{ width: 9, height: 9, borderRadius: 3, display: "inline-block" }} />
            {f(t.adm.live.onPhone, { n: s.phone })}
          </span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <i className="c-desk" style={{ width: 9, height: 9, borderRadius: 3, display: "inline-block" }} />
            {f(t.adm.live.onComputer, { n: s.computer })}
          </span>
          <span style={{ marginInlineStart: "auto" }}>{f(t.adm.live.todayN, { n: s.activeToday })}</span>
        </div>
      </div>
      <div className="card stg">
        {data.online.length === 0 && <div className="empty">{t.adm.live.nobody}</div>}
        {data.online.map((u) => (
          <button key={u.userId} type="button" className="uc tap" onClick={() => go("people", u.userId)} data-live-row={u.userId} data-device={u.device} data-screen={u.screen}>
            <Av id={u.userId} name={u.name} size="lg" ring="on" />
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
              <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</b>
              <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0 }}>
                <DevChip device={u.device} small />
                {u.screen === "shopping-mode" ? (
                  <span className="shopping" style={{ height: 20, fontSize: 11 }} data-live-shopping-chip={u.shoppingLeft ?? 0}>
                    <span className="ping amber" style={{ width: 7, height: 7 }} aria-hidden="true" />
                    {f(t.adm.live.shoppingLeft, { n: u.shoppingLeft ?? 0 })}
                  </span>
                ) : (
                  <span className="tiny" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {screen(u.screen)}
                  </span>
                )}
              </span>
            </span>
            <span className="tiny num">{dur(data.now - u.since)}</span>
          </button>
        ))}
      </div>
      <div className="label" style={{ padding: "4px 2px 0" }}>
        {t.adm.live.activity}
      </div>
      <div className="card stream" style={{ flex: "none", maxHeight: 420 }} data-live-events>
        {data.events.length === 0 && <div className="empty">{t.adm.live.noActivity}</div>}
        {data.events.slice(0, 12).map((e) => (
          <div key={e.id} className={`evr${fresh.has(e.id) ? " ev" : ""}`} data-event={e.kind}>
            <Av id={e.userId} name={e.name} size="sm" />
            <span style={{ minWidth: 0 }}>
              <b>{e.name}</b> {text(e)}
            </span>
            <span className="r">{since(e.at, data.now)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
