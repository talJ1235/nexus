"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers";
import { authClient } from "@/lib/auth/client";

const mask = (email: string) => email.replace(/^(.{1,6})[^@]*@/, (_, a: string) => `${a}•••@`);

/** Recovery-phone (R15 A2): email → "Check your email" with 6 boxes (paste fills all, auto-advance, one-time-code). */
export function RecoverFlow() {
  const { t, f } = useI18n();
  const r = t.auth.recover;
  const [step, setStep] = useState<"email" | "code" | "rc">("email");
  const [rc, setRc] = useState("");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return;
    setBusy(true);
    // The answer is the same whether or not the email has an account.
    await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" }).catch(() => null);
    setBusy(false);
    setStep("code");
    setWait(60);
    setTimeout(() => boxes.current[0]?.focus(), 50);
  };

  const verify = async (code = digits.join("")) => {
    if (code.length !== 6) return;
    setBusy(true);
    setWrong(false);
    const res = await authClient.signIn.emailOtp({ email: email.trim(), otp: code }).catch(() => ({ error: true }));
    if (res && "error" in res && res.error) {
      setBusy(false);
      setWrong(true);
      setDigits(["", "", "", "", "", ""]);
      boxes.current[0]?.focus();
      return;
    }
    // After a recovery sign-in a passkey must be added before anything else.
    window.location.assign("/passkey?forced=1");
  };

  // Admins: a printed one-time recovery code instead of an email code.
  const useRc = async () => {
    setBusy(true);
    setWrong(false);
    const res = await fetch("/api/auth/recovery-code/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), code: rc.trim() }) });
    if (!res.ok) {
      setBusy(false);
      setWrong(true);
      return;
    }
    window.location.assign("/passkey?forced=1");
  };

  const put = (i: number, v: string) => {
    const only = v.replace(/\D/g, "");
    if (only.length > 1) {
      // Paste / autofill: fill every box.
      const next = only.slice(0, 6).split("");
      const full = [...next, ...Array(6 - next.length).fill("")];
      setDigits(full);
      boxes.current[Math.min(5, next.length)]?.focus();
      if (next.length === 6) void verify(next.join(""));
      return;
    }
    const d = [...digits];
    d[i] = only;
    setDigits(d);
    if (only && i < 5) boxes.current[i + 1]?.focus();
    if (d.every(Boolean)) void verify(d.join(""));
  };

  return (
    <main className="page" data-auth="recover">
      <div style={{ height: 44, display: "flex", alignItems: "center" }}>
        <a className="btn icon ghost" aria-label={r.back} href={step !== "email" ? "#" : "/login"} onClick={(e) => step !== "email" && (e.preventDefault(), setStep("email"))}>
          <svg className="i flip" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </a>
      </div>
      {step === "email" ? (
        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <h1 className="t-title" style={{ marginTop: 20 }}>
            {r.title}
          </h1>
          <p className="t-body" style={{ marginTop: 8 }}>
            {r.body}
          </p>
          <div className="field" style={{ marginTop: 28 }}>
            <label className="label" htmlFor="em">
              {r.email}
            </label>
            <div className="input">
              <input id="em" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="sub" style={{ marginTop: 16 }}>
            <button type="button" className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={() => setStep("rc")} data-auth="use-recovery-code">
              {t.security.useRecoveryCode}
            </button>
          </div>
          <div style={{ marginTop: "auto", paddingTop: 24 }}>
            <button type="submit" className="btn lg pri block" disabled={busy}>
              {r.send}
            </button>
          </div>
        </form>
      ) : step === "rc" ? (
        <>
          <h1 className="t-title" style={{ marginTop: 20 }}>
            {r.title}
          </h1>
          <div className="field" style={{ marginTop: 28 }}>
            <label className="label" htmlFor="em2">
              {r.email}
            </label>
            <div className="input">
              <input id="em2" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="label" htmlFor="rc">
              {t.security.recoveryCode}
            </label>
            <div className="input">
              <input id="rc" className="mono" autoComplete="off" spellCheck={false} value={rc} onChange={(e) => setRc(e.target.value)} placeholder="xxxxx-xxxxx" />
            </div>
          </div>
          {wrong && (
            <div className="hint err" role="alert" style={{ marginTop: 10 }}>
              {r.wrong}
            </div>
          )}
          <div style={{ marginTop: "auto", paddingTop: 24 }}>
            <button type="button" className="btn lg pri block" disabled={busy || !rc.trim() || !email.trim()} onClick={useRc}>
              {r.verify}
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="t-title" style={{ marginTop: 20 }}>
            {r.checkTitle}
          </h1>
          <p className="t-body" style={{ marginTop: 8 }}>
            {r.checkBody} <b style={{ color: "var(--ink)" }}>{mask(email.trim())}</b>
          </p>
          <div className={`otp${wrong ? " err" : ""}`} style={{ marginTop: 28 }} dir="ltr">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                value={d}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                aria-label={f(r.digit, { n: i + 1 })}
                maxLength={i === 0 ? 6 : 1}
                onChange={(e) => put(i, e.target.value)}
                onKeyDown={(e) => e.key === "Backspace" && !d && i > 0 && boxes.current[i - 1]?.focus()}
                onPaste={(e) => {
                  e.preventDefault();
                  put(i, e.clipboardData.getData("text"));
                }}
              />
            ))}
          </div>
          {wrong && (
            <div className="hint err" role="alert" style={{ marginTop: 10 }}>
              {r.wrong}
            </div>
          )}
          <div className="sub" style={{ marginTop: 16 }}>
            {r.didntGet}{" "}
            {wait > 0 ? (
              <span className="tiny num">{f(r.resendIn, { t: `0:${String(wait).padStart(2, "0")}` })}</span>
            ) : (
              <button type="button" className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={send}>
                {r.resend}
              </button>
            )}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 24 }}>
            <button type="button" className="btn lg pri block" disabled={busy || digits.some((x) => !x)} onClick={() => verify()}>
              {r.verify}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
