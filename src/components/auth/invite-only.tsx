"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers";
import { authClient } from "@/lib/auth/client";
import { BoxMark } from "./brand-art";
import type { LoginError } from "./login-form";

/** InviteOnly-phone (R15 A3): Google said who you are, but there's no valid invite → code, waitlist, or switch account. */
export function InviteOnly(props: { email: string | null; pendingRef: string | null; error: LoginError | null; app: string; next: string; provider?: string; turnstileSiteKey?: string | null }) {
  const provider = props.provider ?? "google";
  const { t, f } = useI18n();
  const a = t.auth;
  const [code, setCode] = useState("");
  const [error, setError] = useState<LoginError | null>(props.error);
  const [listed, setListed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Cloudflare Turnstile on the waitlist (only when keys are configured).
  const [captcha, setCaptcha] = useState<string | null>(null);
  const widget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = props.turnstileSiteKey;
    if (!key || !widget.current) return;
    type T = { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void }) => void };
    const draw = () => (window as unknown as { turnstile?: T }).turnstile?.render(widget.current!, { sitekey: key, callback: setCaptcha });
    if ((window as unknown as { turnstile?: T }).turnstile) return draw();
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    sc.async = true;
    sc.onload = draw;
    document.head.appendChild(sc);
  }, [props.turnstileSiteKey]);

  const withCode = async () => {
    setBusy(true);
    const r = await fetch("/api/auth-flow/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: LoginError };
    if (!j.ok) {
      setError(j.error ?? "badCode");
      setBusy(false);
      return;
    }
    await authClient.signIn.social({ provider, callbackURL: props.next, newUserCallbackURL: "/welcome", errorCallbackURL: "/login", ...(props.email ? { loginHint: props.email } : {}) });
  };
  const waitlist = async () => {
    setBusy(true);
    const r = await fetch("/api/auth-flow/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: props.pendingRef ?? "", ...(captcha ? { turnstile: captcha } : {}) }) });
    setBusy(false);
    if (r.ok) setListed(true);
    else setError(r.status === 429 ? "limit" : "generic");
  };
  const switchAccount = () => authClient.signIn.social({ provider, callbackURL: props.next, newUserCallbackURL: "/welcome", errorCallbackURL: "/login" });

  return (
    <main className="page" data-auth="invite-only">
      <div style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="logo">
          <BoxMark size={22} />
          {props.app}
        </span>
        {props.email && <span className="av sm c6">{props.email.slice(0, 1).toUpperCase()}</span>}
      </div>
      {listed ? (
        <>
          <div style={{ marginTop: 96, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }} className="fade">
            <span className="ic round ok" style={{ width: 72, height: 72 }}>
              <svg className="i xl" viewBox="0 0 24 24" style={{ strokeWidth: 2.4 }} aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <h1 className="t-title" style={{ marginTop: 6 }}>
              {a.invite.listedTitle}
            </h1>
            <p className="t-body">{a.invite.listedBody}</p>
          </div>
          <div style={{ marginTop: "auto" }}>
            <a className="btn lg block" href="/login">
              {a.invite.close}
            </a>
          </div>
        </>
      ) : (
        <>
          <h1 className="t-title" style={{ marginTop: 40 }}>
            {a.invite.title}
          </h1>
          <p className="t-body" style={{ marginTop: 8 }}>
            {f(a.invite.body, { app: props.app })}
          </p>
          {error && (
            <div className="alert dng" role="alert" style={{ marginTop: 16 }}>
              <span>{a.errors[error]}</span>
            </div>
          )}
          <div className="field" style={{ marginTop: 28 }}>
            <label className="label" htmlFor="c">
              {a.inviteCode}
            </label>
            <div className="input">
              <input id="c" className="mono" placeholder={a.codePlaceholder} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))} autoComplete="off" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && code && withCode()} />
            </div>
          </div>
          <button type="button" className="btn lg pri block" style={{ marginTop: 12 }} disabled={busy || !code.trim()} onClick={withCode}>
            {a.continue}
          </button>
          {props.pendingRef && (
            <>
              <div className="or" style={{ margin: "20px 0" }}>
                {a.or}
              </div>
              {props.turnstileSiteKey && <div ref={widget} style={{ marginBottom: 10 }} />}
              <button type="button" className="btn lg block" disabled={busy || (!!props.turnstileSiteKey && !captcha)} onClick={waitlist} data-auth="waitlist">
                {a.invite.waitlist}
              </button>
            </>
          )}
          <div style={{ marginTop: "auto", paddingTop: 24, textAlign: "center" }} className="sub">
            {props.email && <>{f(a.invite.signedAs, { email: props.email })} · </>}
            <button type="button" className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={switchAccount}>
              {a.invite.switch}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
