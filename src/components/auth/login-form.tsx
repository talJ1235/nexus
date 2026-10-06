"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { installClientErrorCapture } from "@/lib/client-errors";
import { useI18n } from "@/components/providers";
import { GoogleMark, PasskeyIcon } from "./brand-art";

export type LoginError = "cancelled" | "noAccess" | "unverified" | "generic" | "passkeyFailed" | "badCode" | "expired" | "usedUp" | "revoked" | "limit" | "password" | "fallbackOff";

/** Google, passkey, the invite code (kept through the Google redirect in a signed cookie) and "Lost access?". */
export function LoginForm(props: { full: boolean; next: string; error: LoginError | null; returning: { name: string; email: string } | null; app: string; testIdp?: boolean }) {
  const { t, f } = useI18n();
  // R16 C2: sign-in failures reach the error log too (anonymous: 10 events/hour per IP).
  useEffect(() => installClientErrorCapture(), []);
  const a = t.auth;
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<LoginError | null>(props.error);
  const [showCode, setShowCode] = useState(props.error === "badCode" || props.error === "expired" || props.error === "usedUp" || props.error === "revoked");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Full mode: a new account adds a passkey once (skippable) before the first-run screen.
  const newUser = props.full ? `/passkey?next=${encodeURIComponent("/welcome")}` : "/welcome";

  const google = async (hint?: string, provider = "google") => {
    setBusy(true);
    try {
      if (code.trim()) {
        const r = await fetch("/api/auth-flow/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: LoginError };
        if (!j.ok) {
          setError(j.error ?? "badCode");
          setBusy(false);
          return;
        }
      }
      await authClient.signIn.social({ provider, callbackURL: props.next, newUserCallbackURL: newUser, errorCallbackURL: "/login", ...(hint ? { loginHint: hint } : {}) });
    } catch {
      setError("generic");
      setBusy(false);
    }
  };

  const passkey = async () => {
    setVerifying(true);
    setError(null);
    const r = await authClient.signIn.passkey().catch(() => ({ error: true }));
    if (r && "error" in r && r.error) {
      setVerifying(false);
      setError("passkeyFailed");
      return;
    }
    window.location.assign(props.next);
  };

  return (
    <div className="auth-col fade">
      <div className="auth-desk auth-head">
        <BoxMarkSmall />
        <h1 className="t-title">{props.returning ? a.welcomeBack : f(a.logIn, { app: props.app })}</h1>
      </div>
      <h1 className="sr auth-phone">{f(a.logIn, { app: props.app })}</h1>
      {error && (
        <div className="alert dng" role="alert">
          <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          <span>{a.errors[error]}</span>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {props.returning && !verifying && (
          <>
            <button type="button" className="acct" onClick={() => google(props.returning!.email)} disabled={busy} data-auth="returning">
              <span className="av lg c1">{props.returning.name.slice(0, 1).toUpperCase()}</span>
              <span style={{ flex: 1, lineHeight: 1.3 }}>
                <b>{f(a.continueAs, { name: props.returning.name })}</b>
                <br />
                <span className="sub">{props.returning.email}</span>
              </span>
              <span className="badge last">{a.lastUsed}</span>
            </button>
            <div className="sub" style={{ textAlign: "end" }}>
              <a className="link" href="/api/auth-flow/forget-device">
                {a.notYou}
              </a>
            </div>
            <div className="or" style={{ margin: "6px 0" }}>
              {a.or}
            </div>
          </>
        )}
        {verifying ? (
          <button type="button" className="btn lg block" disabled>
            <span className="spinner" />
            {a.waitingPasskey}
          </button>
        ) : (
          <button type="button" className="btn lg block" onClick={() => google()} disabled={busy} data-auth="google">
            <GoogleMark />
            {a.google}
          </button>
        )}
        {props.testIdp && (
          <button type="button" className="btn lg block" onClick={() => google(undefined, "test-idp")} data-auth="test-idp">
            Test sign-in (local only)
          </button>
        )}
        {props.full && !verifying && (
          <button type="button" className="btn lg block" onClick={passkey} data-auth="passkey">
            <PasskeyIcon />
            {a.passkey}
          </button>
        )}
      </div>
      {showCode ? (
        <div className="field">
          <label className="label" htmlFor="invite-code">
            {a.inviteCode}
          </label>
          <div className="input">
            <input
              id="invite-code"
              className="mono"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))}
              placeholder={a.codePlaceholder}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => e.key === "Enter" && google()}
            />
          </div>
        </div>
      ) : (
        <div className="sub" style={{ textAlign: "center" }}>
          {a.newHere}{" "}
          <button type="button" className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={() => setShowCode(true)}>
            {a.useCode}
          </button>
        </div>
      )}
      {props.full && (
        <div className="sub" style={{ textAlign: "center" }}>
          <a className="link" href="/login/recover" data-auth="recover">
            {a.lostAccess}
          </a>
        </div>
      )}
    </div>
  );
}

function BoxMarkSmall() {
  return (
    <svg viewBox="0 0 64 64" width="36" height="36" aria-hidden="true">
      <path d="M32 8 54 20 32 32 10 20z" fill="#fb7a3c" />
      <path d="M10 20l22 12v24L10 44z" fill="var(--face)" stroke="var(--edge)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M54 20 32 32v24l22-12z" fill="#f59e0b" />
    </svg>
  );
}

export function LangSwitch() {
  const { t, locale, setLocale } = useI18n();
  return (
    <button type="button" className="tiny" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={() => setLocale(locale === "he" ? "en" : "he")} aria-label={t.auth.other}>
      {t.auth.language} ▾
    </button>
  );
}

export function LegalLine() {
  const { t } = useI18n();
  const [before, rest] = t.auth.agree.split("{terms}");
  const [middle, after] = rest.split("{privacy}");
  return (
    <div className="tiny" style={{ textAlign: "center" }}>
      {before}
      <a className="link" style={{ fontWeight: 500 }} href="/terms">
        {t.auth.terms}
      </a>
      {middle}
      <a className="link" style={{ fontWeight: 500 }} href="/privacy">
        {t.auth.privacy}
      </a>
      {after}
    </div>
  );
}
