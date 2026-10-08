"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ackNewSignIn, createRecoveryCodes, getSecurityState, removePasskey, renameMyPasskey, signOutDevice, signOutOtherDevices, type SecurityState } from "@/app/security-actions";
import { setNotificationsOn } from "@/app/home-actions";
import { DEFAULT_NOTIFY } from "@/lib/home";
import { loadAppData } from "@/app/data-actions";
import { useI18n } from "@/components/providers";
import { authClient } from "@/lib/auth/client";
import { describeUa } from "@/lib/auth/ua";
import { cn } from "@/lib/utils";
import { GoogleMark, PasskeyIcon } from "@/components/auth/brand-art";
import { InvitesAdmin } from "@/components/auth/invites-admin";
import { useStore } from "../store";
import { avatarColor } from "../spaces/space-ui";
import { ReportsSubpage } from "../reports-sheet";
import type { PageProps } from "./shell";
import { Av, I, Li, P, SectionHead, Toggle } from "./ui";

// Settings → Account & security (R16 D1, board Settings-desktop "account"; R15 A5 Security moved in): who you are,
// a security checkup, sign-in methods (Google, passkeys), devices; sub-pages for the activity log + recovery codes,
// invite codes (admin) and your reports.

type Dev = SecurityState["devices"][number];

// R17 A5: the page keeps its last answer on this device (no activity log in it), so it opens in its final layout at
// once and refreshes in place; the very first time, skeleton rows sit where the rows will be. Cleared on logout with the
// offline copy (lib/offline clearOffline).
export const SEC_CACHE = "nexus.sec:";
function cached(userId: string | undefined): SecurityState | null {
  if (!userId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(SEC_CACHE + userId) ?? "null") as SecurityState | null;
    return v && Array.isArray(v.devices) ? { ...v, events: [] } : null;
  } catch {
    return null;
  }
}

function useSecurity(userId?: string) {
  const [st, setSt] = useState<SecurityState | null>(() => cached(userId));
  const [stepUp, setStepUp] = useState(false);
  const [now, setNow] = useState(0);
  const load = useCallback(
    () =>
      getSecurityState().then(
        (v) => {
          setNow(Date.now());
          setSt(v);
          try {
            if (userId) localStorage.setItem(SEC_CACHE + userId, JSON.stringify({ ...v, events: [] }));
          } catch {
            /* private mode / full */
          }
        },
        () => setSt((cur) => cur),
      ),
    [userId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { st, load, stepUp, setStepUp, now };
}

function useWhen(now: number) {
  const { t, locale } = useI18n();
  const s = t.security;
  const loc = locale === "he" ? "he-IL" : "en-US";
  const day = (ms: number | null) => (ms ? new Intl.DateTimeFormat(loc, { month: "short", day: "numeric" }).format(ms) : "");
  const when = (ms: number) => new Intl.DateTimeFormat(loc, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
  const ago = (ms: number) => {
    const m = Math.round((now - ms) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(locale === "he" ? "he" : "en", { numeric: "auto" });
    return m < 3 ? s.activeNow : m < 60 ? rtf.format(-m, "minute") : m < 1440 ? rtf.format(-Math.round(m / 60), "hour") : day(ms);
  };
  return { day, when, ago };
}

const devIcon = (k: Dev["kind"]) => (k === "desktop" ? P.desktop : k === "tablet" ? P.tablet : P.phone);

export function AccountPage({ go, phone }: PageProps) {
  const s = useStore();
  const { t, f } = useI18n();
  const x = t.security;
  const { st, load, stepUp, setStepUp, now: loadedAt } = useSecurity(s.me?.id);
  // A cached answer's times read from now, not from when it was saved.
  const [mountedAt] = useState(() => Date.now());
  const now = loadedAt || mountedAt;
  const { day, when, ago } = useWhen(now);
  const [editing, setEditing] = useState<string | null>(null);
  const [allDevices, setAllDevices] = useState(false);
  const devName = (d: { browser: string | null; os: string | null }) => (d.browser && d.os ? f(x.on, { browser: d.browser, os: d.os }) : d.browser || d.os || x.unknownDevice);
  const [here] = useState(() => describeUa(typeof navigator === "undefined" ? "" : navigator.userAgent));

  const addPasskey = async () => {
    const r = await authClient.passkey.addPasskey().catch((e: unknown) => ({ error: e }));
    const err = r && "error" in r ? (r.error as { code?: string; message?: string } | null) : null;
    if (err) {
      if (/step_up/.test(`${err.code ?? ""}${err.message ?? ""}`)) setStepUp(true);
      else toast.error(t.auth.passkeyOffer.failed);
      return;
    }
    await load();
  };
  const remove = async (id: string) => {
    const r = await removePasskey(id);
    if (r.stepUp) return setStepUp(true);
    await load();
  };
  const rename = async (id: string, cur: string | null) => {
    const name = window.prompt(x.renamePrompt, cur ?? "");
    if (name?.trim()) {
      await renameMyPasskey(id, name.trim());
      await load();
    }
  };
  const saveName = async () => {
    const name = (editing ?? "").trim();
    setEditing(null);
    if (!name || name === s.me?.name) return;
    const r = await authClient.updateUser({ name: name.slice(0, 60) }).catch(() => ({ error: true }));
    if (r && "error" in r && r.error) return void toast.error(t.errors.generic);
    toast.success(t.sx.nameSaved);
    void loadAppData()
      .then((d) => s.replaceData(d, { keepView: true }))
      .catch(() => {});
  };

  const name = s.me?.name || s.me?.email || "";
  // Checkup: a sign-in method; a passkey (when passkeys are on); no unreviewed new sign-in.
  const checks = st ? [st.google || st.passkeys.length > 0, ...(st.full ? [st.passkeys.length > 0] : []), !st.alert] : [];
  const passed = checks.filter(Boolean).length;
  const others = st?.devices.filter((d) => !d.current) ?? [];

  return (
    <>
      <SectionHead title={t.sx.sections.account} />
      <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", padding: "16px 18px", borderRadius: 14, background: "var(--s)", flexWrap: phone ? "wrap" : undefined }} data-account-card>
        <Av name={name} color={avatarColor(s.me?.id ?? "")} size="xl" />
        <span style={{ flex: 1, lineHeight: 1.35, minWidth: 160 }}>
          {editing != null ? (
            <label className="input" style={{ height: 38 }}>
              <input autoFocus value={editing} maxLength={60} placeholder={t.sx.namePh} aria-label={t.sx.namePh} onChange={(e) => setEditing(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? void saveName() : e.key === "Escape" && (e.stopPropagation(), setEditing(null)))} data-account-name-input />
            </label>
          ) : (
            <b style={{ fontSize: 16 }}>{name}</b>
          )}
          <br />
          <span className="sub">{s.me?.email}</span>
        </span>
        {editing != null ? (
          <button type="button" className="btn sm pri" onClick={() => void saveName()} data-account-name-save>
            {t.sx.save}
          </button>
        ) : (
          <button type="button" className="btn sm" onClick={() => setEditing(s.me?.name ?? "")} data-account-name-edit>
            {t.sx.editName}
          </button>
        )}
        {!phone && <div style={{ width: 1, alignSelf: "stretch", background: "var(--line-in)", margin: "0 6px" }} />}
        {!st && (
          <span style={{ display: "flex", alignItems: "center", gap: 12 }} aria-busy="true" data-checkup-skeleton>
            <span className="ring" style={{ "--p": "0%" } as React.CSSProperties}>
              <span />
            </span>
            <span style={{ lineHeight: 1.35, width: 150 }}>
              <b>{t.sx.checkup}</b>
              <br />
              <span className="tiny">&nbsp;</span>
            </span>
          </span>
        )}
        {st && (
          <span style={{ display: "flex", alignItems: "center", gap: 12 }} data-checkup={`${passed}/${checks.length}`}>
            <span className="ring" style={{ "--p": `${Math.round((passed / checks.length) * 100)}%` } as React.CSSProperties}>
              <span>
                {passed}/{checks.length}
              </span>
            </span>
            <span style={{ lineHeight: 1.35, width: 150 }}>
              <b>{t.sx.checkup}</b>
              <br />
              {st.alert ? (
                <a className="link" href="#security-alert" style={{ fontSize: 13, fontWeight: 500 }}>
                  {t.sx.reviewSignIn}
                </a>
              ) : st.full && st.passkeys.length === 0 ? (
                <button type="button" className="link" style={{ fontSize: 13, fontWeight: 500, background: "none", border: 0, padding: 0 }} onClick={addPasskey}>
                  {t.sx.addSecondShort}
                </button>
              ) : (
                <span className="tiny">{t.sx.allGood}</span>
              )}
            </span>
          </span>
        )}
      </div>

      <div className="grid2 stack" data-security>
        <div>
          <p className="sec">{t.sx.signIn}</p>
          <div className="card">
            <Li icon={<GoogleMark />} title="Google" sub={st?.me.email ?? t.sx.mainSignIn}>
              {st?.google && <span className="badge ok">{x.connectedBadge}</span>}
            </Li>
            {st?.full &&
              st.passkeys.map((p) => (
                <Li key={p.id} icon={<PasskeyIcon />} title={f(t.sx.passkey, { name: p.name || x.unknownDevice })} sub={[p.createdAt && f(x.created, { date: day(p.createdAt) }), p.lastUsedAt ? f(x.lastUsed, { date: ago(p.lastUsedAt) }) : x.never].filter(Boolean).join(" · ")} data-passkey="">
                  <button type="button" className="btn sm ghost" onClick={() => rename(p.id, p.name)}>
                    {x.rename}
                  </button>
                  <button type="button" className="btn sm icon ghost" aria-label={x.remove} onClick={() => remove(p.id)}>
                    <I d={P.close} size="sm" />
                  </button>
                </Li>
              ))}
            {st?.full && (
              <button type="button" className="li" style={{ fontWeight: 600, width: "100%", border: 0, borderTop: "1px solid var(--line-in)", background: "transparent", textAlign: "start" }} onClick={addPasskey} data-add-passkey>
                <span className="ic" style={{ background: "transparent" }}>
                  <I d={P.plus} />
                </span>
                {x.addPasskey}
              </button>
            )}
          </div>
        </div>
        <div>
          <p className="sec">{x.devices}</p>
          <div className="card">
            {/* A new sign-in waiting for review sits first, tinted (board: "iPad · new" → Review). */}
            {st?.alert && (
              <div className="li" style={{ background: "var(--warn-t)", flexWrap: "wrap" }} id="security-alert" data-security-alert>
                <span className="ic warn">
                  <I d={devIcon(st.alert.deviceKind)} />
                </span>
                <span className="grow">
                  <b>{f(x.newSignIn, { device: st.alert.os ?? x.unknownDevice })}</b>
                  <br />
                  <span className="tiny">{[st.alert.city, when(st.alert.at)].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" className="btn sm" onClick={() => ackNewSignIn(st.alert!.id).then(load)}>
                  {x.itWasMe}
                </button>
                <button type="button" className="btn sm pri" onClick={() => signOutOtherDevices().then((n) => (toast.success(f(x.signedOutOthers, { n })), ackNewSignIn(st.alert!.id))).then(load)}>
                  {x.notMe}
                </button>
              </div>
            )}
            {/* This device + the 3 newest others; the rest behind "Show all" (no scrolling at 1366 × 768). */}
            {(st?.devices ?? []).slice(0, allDevices ? undefined : st?.alert ? 3 : 4).map((d) => (
              <Li key={d.id} icon={devIcon(d.kind)} title={devName(d)} sub={[d.city, d.current ? x.activeNow : ago(d.lastSeen), d.method && (x.methods as Record<string, string>)[d.method]].filter(Boolean).join(" · ")} data-device={d.current ? "current" : "other"}>
                {d.current ? (
                  <span className="badge ok">{x.thisDevice}</span>
                ) : (
                  <button type="button" className="btn sm ghost" onClick={() => signOutDevice(d.id).then(load)} data-sign-out-device>
                    {x.signOut}
                  </button>
                )}
              </Li>
            ))}
            {!st && (
              <>
                <Li icon={devIcon(here.kind)} title={devName(here)} sub={x.activeNow} data-device="current">
                  <span className="badge ok">{x.thisDevice}</span>
                </Li>
                {[0, 1].map((k) => (
                  <div key={k} className="li" aria-busy="true" style={{ minHeight: 56 }} data-device-skeleton>
                    <span className="ic" />
                    <span className="grow">
                      <span style={{ display: "block", height: 12, width: "55%", borderRadius: 6, background: "var(--line-in)" }} />
                      <span style={{ display: "block", height: 10, width: "35%", borderRadius: 6, background: "var(--line-in)", marginTop: 8 }} />
                    </span>
                  </div>
                ))}
              </>
            )}
            {!allDevices && (st?.devices.length ?? 0) > (st?.alert ? 3 : 4) && (
              <button type="button" className="li link" style={{ width: "100%", border: 0, borderTop: "1px solid var(--line-in)", background: "transparent", minHeight: 40, justifyContent: "center", fontSize: 13 }} onClick={() => setAllDevices(true)} data-devices-all>
                {f(t.sx.showAll, { n: st!.devices.length })}
              </button>
            )}
          </div>
          {others.length > 0 && (
            <button type="button" className="btn sm block" style={{ marginTop: 10, height: 36 }} onClick={() => signOutOtherDevices().then((n) => toast.success(f(x.signedOutOthers, { n }))).then(load)} data-sign-out-others>
              {x.signOutOthers}
            </button>
          )}
        </div>
      </div>

      <NotificationsRow />

      <div className={cn(s.admin ? "grid3" : "grid2", "sx-tiles")} style={{ marginTop: "auto" }} data-account-tiles>
        <MiniCard icon={P.history} title={t.sx.sections.activity} sub={t.sx.activitySub} action={t.sx.open} onClick={() => go("activity")} data="activity" />
        <MiniCard icon={P.inbox} title={t.sx.sections.reports} sub={t.sx.reportsSub} action={t.sx.open} onClick={() => go("reports")} data="reports" />
        {s.admin && <MiniCard icon={P.box} title={t.sx.sections.invites} sub={t.sx.invitesSub} action={t.sx.manage} onClick={() => go("invites")} data="invites" badge="Admin" />}
      </div>
      {stepUp && <StepUp full={!!st?.full} admin={!!st?.admin} onClose={() => setStepUp(false)} />}
    </>
  );
}

/** R17 D3: the one Notifications switch (the per-kind section is gone; Nexus decides what and when). */
function NotificationsRow() {
  const s = useStore();
  const { t } = useI18n();
  const n = s.homePrefs.notify ?? DEFAULT_NOTIFY;
  const set = (on: boolean) => {
    const before = s.homePrefs;
    s.setHomePrefs({ ...before, notify: { ...n, on } });
    setNotificationsOn(on).catch(() => {
      s.setHomePrefs(before);
      toast.error(t.errors.generic);
    });
  };
  return (
    <div className="card">
      <Li icon={P.bell} title={t.sx.notifTitle} sub={n.on ? t.sx.notifOnSub : t.sx.notifOffSub} data-notifications-row>
        <Toggle on={n.on} label={t.sx.notifTitle} onChange={set} data-notifications-on />
      </Li>
    </div>
  );
}

function MiniCard({ icon, title, sub, action, onClick, data, badge }: { icon: string; title: string; sub: string; action: string; onClick: () => void; data: string; badge?: string }) {
  return (
    <div className="card li" style={{ minHeight: 60, paddingInline: 14 }}>
      <span className="ic">
        <I d={icon} />
      </span>
      <span className="grow">
        <b>{title}</b>
        {badge && (
          <span className="badge info" style={{ marginInlineStart: 6, height: 18, fontSize: 11 }}>
            {badge}
          </span>
        )}
        <br />
        <span className="tiny">{sub}</span>
      </span>
      <button type="button" className="btn sm" onClick={onClick} {...{ [`data-settings-${data}`]: "" }}>
        {action}
      </button>
    </div>
  );
}

/** Account → Activity & recovery: the sign-in log (12 newest) and, for the admin, recovery codes. */
export function ActivityPage() {
  const { t, f } = useI18n();
  const x = t.security;
  const { st, load, stepUp, setStepUp, now } = useSecurity();
  const { when } = useWhen(now);
  const [codes, setCodes] = useState<string[] | null>(null);
  const makeCodes = async () => {
    const r = await createRecoveryCodes();
    if (r.stepUp) return setStepUp(true);
    setCodes(r.codes ?? null);
    await load();
  };
  return (
    <>
      <SectionHead title={t.sx.sections.activity} />
      {st?.admin && (
        <section>
          <p className="sec">{x.recoveryTitle}</p>
          <p className="tiny" style={{ margin: "-4px 0 8px" }}>
            {x.recoveryHint}
          </p>
          <div className="card">
            <div className="li">
              <span className="grow sub">{f(x.recoveryLeft, { n: st.recoveryCodesLeft })}</span>
              <button type="button" className="btn sm" onClick={makeCodes} data-recovery-codes>
                {x.recoveryMake}
              </button>
            </div>
            {codes && (
              <div className="li" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="alert warn">{x.recoveryShown}</div>
                <div className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, fontSize: 15 }} data-codes>
                  {codes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
                  {x.recoveryCopy}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      <section>
        <p className="sec">{x.activity}</p>
        <div className="card" style={{ overflow: "hidden" }}>
          {!st ? (
            <div className="li sub" aria-busy="true" />
          ) : st.events.length === 0 ? (
            <div className="li sub">{x.noActivity}</div>
          ) : (
            <table className="tbl" data-activity>
              <tbody>
                {st.events.slice(0, 12).map((e) => (
                  <tr key={e.id}>
                    <td>
                      {(x.kinds as Record<string, string>)[e.kind] ?? e.kind}
                      {e.method && e.kind === "sign_in" ? ` · ${(x.methods as Record<string, string>)[e.method] ?? e.method}` : ""}
                    </td>
                    <td className="sub">{[e.os, e.city].filter(Boolean).join(" · ")}</td>
                    <td className="sub" style={{ textAlign: "end", whiteSpace: "nowrap" }}>
                      {when(e.at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      {stepUp && <StepUp full={!!st?.full} admin={!!st?.admin} onClose={() => setStepUp(false)} />}
    </>
  );
}

export function InvitesPage() {
  const { t } = useI18n();
  return (
    <>
      <SectionHead title={t.sx.sections.invites} />
      <InvitesAdmin />
    </>
  );
}

export function ReportsPage() {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <SectionHead title={t.sx.sections.reports} />
      <ReportsSubpage openId={openId} onOpen={setOpenId} />
    </>
  );
}

function StepUp({ full, admin, onClose }: { full: boolean; admin: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const x = t.security;
  return (
    <div role="dialog" aria-modal="true" aria-label={x.stepUpTitle} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 16 }}>
      <div className="scrim" style={{ position: "fixed" }} onClick={onClose} />
      <div className="modal" style={{ position: "relative", width: "min(420px,100%)" }} data-step-up>
        <div className="mhead">
          <span className="ic">
            <I d="M4 11h16v10H4z M8 11V7a4 4 0 0 1 8 0v4" />
          </span>
          <h2 className="t-h2">{x.stepUpTitle}</h2>
        </div>
        <div className="mbody t-body">{x.stepUpBody}</div>
        <div className="mfoot">
          <button type="button" className="btn" onClick={onClose}>
            {x.cancel}
          </button>
          <a className="btn pri" href={`/login?reauth=1${!full && admin ? "&admin=1" : ""}&next=${encodeURIComponent(window.location.pathname)}`}>
            {x.stepUpGo}
          </a>
        </div>
      </div>
    </div>
  );
}
