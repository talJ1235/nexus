"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ackNewSignIn, createRecoveryCodes, getSecurityState, removePasskey, renameMyPasskey, signOutDevice, signOutOtherDevices, type SecurityState } from "@/app/security-actions";
import { useI18n } from "@/components/providers";
import { authClient } from "@/lib/auth/client";
import { GoogleMark, PasskeyIcon } from "./brand-art";

// Settings → Security (R15 A5) — mockups Security-desktop / Security-phone. Sign-in methods (Google, passkeys),
// devices with sign-out, recent activity, the "Was this you?" banner, admin recovery codes.

type Dev = SecurityState["devices"][number];

const DeviceIcon = ({ kind }: { kind: "phone" | "tablet" | "desktop" }) => (
  <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
    {kind === "desktop" ? (
      <>
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ) : kind === "tablet" ? (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ) : (
      <>
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    )}
  </svg>
);

export function SecurityPanel() {
  const { t, f, locale } = useI18n();
  const s = t.security;
  const [st, setSt] = useState<SecurityState | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  // "now" is taken when the data arrives (render stays pure).
  const [now, setNow] = useState(0);
  const load = useCallback(
    () =>
      getSecurityState().then(
        (v) => {
          setNow(Date.now());
          setSt(v);
        },
        () => setSt(null),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const day = (ms: number | null) => (ms ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric" }).format(ms) : "");
  const when = (ms: number) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
  const ago = (ms: number) => {
    const m = Math.round((now - ms) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(locale === "he" ? "he" : "en", { numeric: "auto" });
    return m < 3 ? s.activeNow : m < 60 ? rtf.format(-m, "minute") : m < 1440 ? rtf.format(-Math.round(m / 60), "hour") : day(ms);
  };
  const devName = (d: { browser: string | null; os: string | null }) => (d.browser && d.os ? f(s.on, { browser: d.browser, os: d.os }) : d.browser || d.os || s.unknownDevice);

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
    const name = window.prompt(s.renamePrompt, cur ?? "");
    if (name?.trim()) {
      await renameMyPasskey(id, name.trim());
      await load();
    }
  };
  const makeCodes = async () => {
    const r = await createRecoveryCodes();
    if (r.stepUp) return setStepUp(true);
    setCodes(r.codes ?? null);
    await load();
  };

  if (!st) return <div className="sub" style={{ padding: 24 }} aria-busy="true" />;
  const others = st.devices.filter((d) => !d.current);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }} data-security>
      {st.alert && (
        <div className="card" style={{ padding: 14, borderColor: "color-mix(in srgb,var(--warn) 35%,var(--line))" }} data-security-alert>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span className="ic warn">
              <DeviceIcon kind={st.alert.deviceKind} />
            </span>
            <span style={{ flex: 1, lineHeight: 1.35 }}>
              <b>{f(s.newSignIn, { device: st.alert.os ?? s.unknownDevice })}</b>
              <br />
              <span className="tiny">{[st.alert.city, when(st.alert.at)].filter(Boolean).join(" · ")}</span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn sm" style={{ flex: 1 }} onClick={() => ackNewSignIn(st.alert!.id).then(load)}>
              {s.itWasMe}
            </button>
            <button type="button" className="btn sm pri" style={{ flex: 1 }} onClick={() => signOutOtherDevices().then((n) => (toast.success(f(s.signedOutOthers, { n })), ackNewSignIn(st.alert!.id))).then(load)}>
              {s.notMe}
            </button>
          </div>
        </div>
      )}

      {st.full && st.passkeys.length < 2 && (
        <div className="alert info">
          <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span style={{ flex: 1 }}>{s.addSecond}</span>
          <button type="button" className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={addPasskey}>
            {s.addPasskey}
          </button>
        </div>
      )}

      {st.full && (
        <section>
          <h3 className="t-h3">{s.passkeys}</h3>
          <div className="card" style={{ marginTop: 10 }}>
            {st.passkeys.length === 0 && (
              <div className="row">
                <span className="sub">{s.noPasskeys}</span>
              </div>
            )}
            {st.passkeys.map((p) => (
              <div className="row" key={p.id} data-passkey>
                <span className="ic">
                  <PasskeyIcon />
                </span>
                <span className="grow">
                  <b>{p.name || s.unknownDevice}</b>
                  <br />
                  <span className="tiny">{[p.createdAt && f(s.created, { date: day(p.createdAt) }), p.lastUsedAt ? f(s.lastUsed, { date: ago(p.lastUsedAt) }) : s.never].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" className="btn sm ghost" onClick={() => rename(p.id, p.name)}>
                  {s.rename}
                </button>
                <button type="button" className="btn sm ghost" onClick={() => remove(p.id)}>
                  {s.remove}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={addPasskey} data-add-passkey>
            <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {s.addPasskey}
          </button>
        </section>
      )}

      <section>
        <h3 className="t-h3">{s.connected}</h3>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row">
            <span className="ic">
              <GoogleMark />
            </span>
            <span className="grow">
              <b>Google</b>
              <br />
              <span className="tiny">{st.me.email}</span>
            </span>
            {st.google && <span className="badge ok">{s.connectedBadge}</span>}
          </div>
        </div>
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 className="t-h3" style={{ flex: 1 }}>
            {s.devices}
          </h3>
          {others.length > 0 && (
            <button type="button" className="btn sm ghost" onClick={() => signOutOtherDevices().then((n) => toast.success(f(s.signedOutOthers, { n }))).then(load)} data-sign-out-others>
              {s.signOutOthers}
            </button>
          )}
        </div>
        <div className="card" style={{ marginTop: 10 }}>
          {st.devices.map((d: Dev) => (
            <div className="row" key={d.id} data-device={d.current ? "current" : "other"}>
              <span className="ic">
                <DeviceIcon kind={d.kind} />
              </span>
              <span className="grow">
                <b>{devName(d)}</b>
                {d.current && (
                  <span className="badge ok" style={{ marginInlineStart: 6 }}>
                    {s.thisDevice}
                  </span>
                )}
                <br />
                <span className="tiny">{[d.city, d.current ? s.activeNow : ago(d.lastSeen), d.method && (s.methods as Record<string, string>)[d.method]].filter(Boolean).join(" · ")}</span>
              </span>
              {!d.current && (
                <button type="button" className="btn sm ghost" onClick={() => signOutDevice(d.id).then(load)} data-sign-out-device>
                  {s.signOut}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {st.admin && (
        <section>
          <h3 className="t-h3">{s.recoveryTitle}</h3>
          <p className="tiny" style={{ marginTop: 4 }}>
            {s.recoveryHint}
          </p>
          <div className="card" style={{ marginTop: 10 }}>
            <div className="row">
              <span className="grow sub">{f(s.recoveryLeft, { n: st.recoveryCodesLeft })}</span>
              <button type="button" className="btn sm" onClick={makeCodes} data-recovery-codes>
                {s.recoveryMake}
              </button>
            </div>
            {codes && (
              <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="alert warn">{s.recoveryShown}</div>
                <div className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, fontSize: 15 }} data-codes>
                  {codes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
                  {s.recoveryCopy}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h3 className="t-h3">{s.activity}</h3>
        <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
          {st.events.length === 0 ? (
            <div className="row sub">{s.noActivity}</div>
          ) : (
            <table className="tbl" data-activity>
              <tbody>
                {st.events.slice(0, 12).map((e) => (
                  <tr key={e.id}>
                    <td>
                      {(s.kinds as Record<string, string>)[e.kind] ?? e.kind}
                      {e.method && e.kind === "sign_in" ? ` · ${(s.methods as Record<string, string>)[e.method] ?? e.method}` : ""}
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

      {stepUp && (
        <div role="dialog" aria-modal="true" aria-label={s.stepUpTitle} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 16 }}>
          <div className="scrim" style={{ position: "fixed" }} onClick={() => setStepUp(false)} />
          <div className="modal" style={{ position: "relative", width: "min(420px,100%)" }} data-step-up>
            <div className="mhead">
              <span className="ic">
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </span>
              <h2 className="t-h2">{s.stepUpTitle}</h2>
            </div>
            <div className="mbody t-body">{s.stepUpBody}</div>
            <div className="mfoot">
              <button type="button" className="btn" onClick={() => setStepUp(false)}>
                {s.cancel}
              </button>
              <a className="btn pri" href={`/login?reauth=1${!st.full && st.admin ? "&admin=1" : ""}&next=${encodeURIComponent(window.location.pathname)}`}>
                {s.stepUpGo}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
