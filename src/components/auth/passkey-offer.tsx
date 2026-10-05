"use client";

import { useState } from "react";
import { useI18n } from "@/components/providers";
import { authClient } from "@/lib/auth/client";
import { PasskeyIcon } from "./brand-art";

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : null;
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, br].filter(Boolean).join(" · ") || null;
}

/** Passkey-phone (R15 A2): offer → the browser's own prompt → "Passkey created". `forced` (after a recovery) has no "Not now". */
export function PasskeyOffer({ forced, next }: { forced: boolean; next: string }) {
  const { t } = useI18n();
  const p = t.auth.passkeyOffer;
  const [state, setState] = useState<"offer" | "waiting" | "done">("offer");
  const [failed, setFailed] = useState(false);
  const [name] = useState(() => (typeof navigator === "undefined" ? null : deviceName()));

  const create = async () => {
    setFailed(false);
    setState("waiting");
    const r = await authClient.passkey.addPasskey({ name: name ?? undefined }).catch(() => ({ error: true }));
    if (!r || ("error" in r && r.error)) {
      setState("offer");
      setFailed(true);
      return;
    }
    setState("done");
  };

  return (
    <main className="page" data-auth="passkey">
      <div style={{ height: 44 }} />
      {state !== "done" ? (
        <>
          <div style={{ marginTop: 64, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}>
            <span className="ic round" style={{ width: 72, height: 72, background: "var(--s2)" }}>
              <PasskeyIcon className="i xl" />
            </span>
            <h1 className="t-title" style={{ marginTop: 6 }}>
              {p.title}
            </h1>
            <p className="t-body" style={{ maxWidth: 290 }}>
              {forced ? p.forced : p.body}
            </p>
            {failed && (
              <div className="hint err" role="alert">
                {p.failed}
              </div>
            )}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" className="btn lg pri block" onClick={create} disabled={state === "waiting"} data-auth="create-passkey">
              {state === "waiting" ? <span className="spinner" /> : null}
              {p.continue}
            </button>
            {!forced && (
              <a className="btn lg ghost block" href={next} data-auth="not-now">
                {p.notNow}
              </a>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 64, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }} className="fade">
            <span className="ic round ok" style={{ width: 72, height: 72 }}>
              <svg className="i xl" viewBox="0 0 24 24" style={{ strokeWidth: 2.4 }} aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <h1 className="t-title" style={{ marginTop: 6 }}>
              {p.doneTitle}
            </h1>
            <p className="t-body">{p.doneBody}</p>
          </div>
          <div className="card" style={{ marginTop: 32 }}>
            <div className="row">
              <span className="ic">
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="2" width="12" height="20" rx="2" />
                  <path d="M11 18h2" />
                </svg>
              </span>
              <span className="grow">
                <b>{name ?? p.thisDevice}</b>
              </span>
            </div>
          </div>
          <div style={{ marginTop: "auto", paddingTop: 24 }}>
            <a className="btn lg pri block" href={next} data-auth="passkey-done">
              {p.done}
            </a>
          </div>
        </>
      )}
    </main>
  );
}
