"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { authClient } from "@/lib/auth/client";
import { installClientErrorCapture, reportAuthFailure } from "@/lib/client-errors";
import { useI18n } from "@/components/providers";
import { GoogleMark, PasskeyIcon } from "./brand-art";

export type LoginError = "cancelled" | "noAccess" | "unverified" | "generic" | "passkeyFailed" | "badCode" | "expired" | "usedUp" | "revoked" | "limit" | "password" | "fallbackOff" | "slow" | "offline";
type Which = "google" | "returning" | "test-idp";

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
  // R16 G2/G3: which Google button is opening (spinner + "Opening Google…" in the same frame as the tap).
  const [busy, setBusy] = useState<Which | null>(null);
  const last = useRef<{ hint?: string; provider: string; which: Which }>({ provider: "google", which: "google" });
  const attempt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const navigating = useRef(false);
  // Full mode: a new account adds a passkey once (skippable) before the first-run screen.
  const newUser = props.full ? `/passkey?next=${encodeURIComponent("/welcome")}` : "/welcome";

  /** Forget the attempt in flight: the button works again. */
  const reset = useCallback(() => {
    attempt.current++;
    window.clearTimeout(timer.current);
    navigating.current = false;
    setBusy(null);
  }, []);
  const fail = useCallback(
    (shown: LoginError, code?: Parameters<typeof reportAuthFailure>[0], detail?: string) => {
      reset();
      setError(shown);
      if (code) reportAuthFailure(code, detail ?? shown);
    },
    [reset],
  );

  // Back from Google (bfcache restores this page as it was) or back to the tab: never a dead button.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && reset();
    const onVisible = () => document.visibilityState === "visible" && navigating.current && reset();
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reset]);

  // Warm the path: a cheap auth request wakes the function and its DB connection (the rate-limit row); the
  // browser opens its connection to Google ahead of the tap. Again on hover / touch, at most every 20 s.
  const warmedAt = useRef(0);
  const warm = useCallback(() => {
    if (Date.now() - warmedAt.current < 20_000) return;
    warmedAt.current = Date.now();
    preconnect("https://accounts.google.com");
    void fetch("/api/auth/ok", { cache: "no-store" }).catch(() => {});
  }, []);
  useEffect(() => warm(), [warm]);

  const google = async (hint?: string, provider = "google", which: Which = "google") => {
    if (busy) return;
    const mine = ++attempt.current;
    last.current = { hint, provider, which };
    setBusy(which);
    setError(null);
    if (!navigator.onLine) return fail("offline");
    const abort = new AbortController();
    window.clearTimeout(timer.current);
    // Google hasn't started loading within 6 s → cancel and say so (the page is still here, so it hasn't).
    timer.current = window.setTimeout(() => {
      if (attempt.current !== mine) return;
      abort.abort();
      if (navigating.current) window.stop();
      fail("slow", "google_timeout", navigating.current ? "navigation not started after 6 s" : "sign-in start took over 6 s");
    }, 6000);
    try {
      // The invite check and the sign-in start run side by side; we only leave once both are fine.
      const invite = code.trim()
        ? fetch("/api/auth-flow/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), signal: abort.signal }).then(
            (r) => r.json().catch(() => ({})) as Promise<{ ok?: boolean; error?: LoginError }>,
          )
        : Promise.resolve({ ok: true } as { ok?: boolean; error?: LoginError });
      const start = authClient.signIn.social({
        provider,
        callbackURL: props.next,
        newUserCallbackURL: newUser,
        errorCallbackURL: "/login",
        disableRedirect: true,
        ...(hint ? { loginHint: hint } : {}),
        fetchOptions: { signal: abort.signal },
      });
      const [j, r] = await Promise.all([invite, start]);
      if (attempt.current !== mine) return;
      if (!j.ok) return fail(j.error ?? "badCode");
      // Better Auth's client returns failures as { error } (it doesn't throw).
      const url = r.data && "url" in r.data ? r.data.url : undefined;
      if (r.error || !url) {
        const status = r.error?.status ?? 0;
        return status === 429 ? fail("limit", "google_limit", "status 429") : fail("generic", "google_status", `status ${status}`);
      }
      navigating.current = true;
      window.location.assign(url);
    } catch (e) {
      if (attempt.current !== mine) return;
      if (!navigator.onLine) return fail("offline");
      fail("generic", "google_network", (e as Error)?.name === "AbortError" ? "aborted" : "network error");
    }
  };
  const retryable = error === "generic" || error === "slow" || error === "limit" || error === "offline" || error === "cancelled";

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
        <div className="alert dng" role="alert" data-auth="error">
          <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          <span style={{ flex: 1 }}>{a.errors[error]}</span>
          {retryable && (
            <button type="button" className="link" style={{ background: "none", border: 0, padding: "0 4px", minHeight: 40, fontWeight: 600, alignSelf: "center", flexShrink: 0 }} onClick={() => google(last.current.hint, last.current.provider, last.current.which)} data-auth="retry">
              {a.tryAgain}
            </button>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {props.returning && !verifying && (
          <>
            <button type="button" className="acct" onClick={() => google(props.returning!.email, "google", "returning")} onPointerEnter={warm} onTouchStart={warm} disabled={!!busy} aria-busy={busy === "returning"} data-auth="returning">
              <span className="av lg c1">{busy === "returning" ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden="true" /> : props.returning.name.slice(0, 1).toUpperCase()}</span>
              <span style={{ flex: 1, lineHeight: 1.3 }}>
                <b>{busy === "returning" ? a.openingGoogle : f(a.continueAs, { name: props.returning.name })}</b>
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
          <button type="button" className="btn lg block" onClick={() => google()} onPointerEnter={warm} onTouchStart={warm} disabled={!!busy} aria-busy={busy === "google"} data-auth="google">
            {busy === "google" ? <span className="spinner" style={{ width: 20, height: 20 }} aria-hidden="true" /> : <GoogleMark />}
            {busy === "google" ? a.openingGoogle : a.google}
          </button>
        )}
        {props.testIdp && (
          <button type="button" className="btn lg block" onClick={() => google(undefined, "test-idp", "test-idp")} disabled={!!busy} aria-busy={busy === "test-idp"} data-auth="test-idp">
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
