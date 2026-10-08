"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { joinSpace } from "@/app/space-actions";
import { useI18n } from "@/components/providers";
import { avatarColor } from "@/components/app/spaces/colors";
import { SpaceTile } from "@/components/app/spaces/tile";
import { authClient } from "@/lib/auth/client";
import type { InvitePreview } from "@/lib/spaces";
import { BoxMark } from "./brand-art";
import { initialOf } from "@/lib/initial";

type State = "preview" | "joining" | "joined" | "dead";

/** Join-phone (R15 C2). Signed in → "Accept invite" joins; signed out → Google, then back here with ?go=1. */
export function JoinFlow({ token, preview, days, signedIn, auto, app, provider }: { token: string; preview: InvitePreview; days: number; signedIn: boolean; auto: boolean; app: string; provider: string }) {
  const { t, f } = useI18n();
  const j = t.spaces;
  const [state, setState] = useState<State>(preview.ok ? "preview" : "dead");
  const [problem, setProblem] = useState<string | null>(preview.ok ? null : preview.problem);
  const started = useRef(false);

  const join = async () => {
    setState("joining");
    const r = await joinSpace(token).catch(() => ({ ok: false as const, problem: "invalid" }));
    if (r.ok) {
      if (r.already) return window.location.replace("/");
      setState("joined");
    } else {
      setProblem(r.problem);
      setState("dead");
    }
  };
  const google = async () => {
    setState("joining");
    const r = await fetch("/api/auth-flow/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!body.ok) {
      setProblem(body.error ?? "invalid");
      return setState("dead");
    }
    const back = `/join/${token}?go=1`;
    await authClient.signIn.social({ provider, callbackURL: back, newUserCallbackURL: back, errorCallbackURL: "/login" });
  };

  // Back from Google (or already signed in and asked to go on): join without another tap.
  useEffect(() => {
    if (!auto || !signedIn || !preview.ok || started.current) return;
    started.current = true;
    void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const name = preview.ok ? preview.name : "";
  const inviter = preview.inviter || j.someone;
  return (
    <main className="page" data-auth="join" data-join-state={state}>
      <div style={{ height: 44, display: "flex", alignItems: "center" }}>
        <span className="logo">
          <BoxMark size={22} />
          {app}
        </span>
      </div>

      {preview.ok && (state === "preview" || state === "joining") && (
        <>
          <div style={{ marginTop: 72, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16 }}>
            <div style={{ position: "relative" }}>
              {/* R16 D5: the space's icon or photo, as in the switcher. */}
              <SpaceTile name={name} color={preview.color} icon={preview.icon} photo={preview.photo} size={72} style={{ borderRadius: 18 }} />
              {preview.inviter && (
                <span className="av" style={{ position: "absolute", insetInlineEnd: -8, bottom: -6, boxShadow: "0 0 0 3px var(--raised)", background: avatarColor(preview.inviterId ?? "x") }}>
                  {preview.inviter.trim()[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <p className="t-body" style={{ marginTop: 6 }}>
              {f(j.invitedYou, { name: "\u0000" })
                .split("\u0000")
                .flatMap((part, i) => (i === 0 ? [part] : [<b key="n" style={{ color: "var(--ink)" }}>{inviter}</b>, part]))}
            </p>
            <h1 className="t-title" style={{ marginTop: -8 }} data-join-space>
              {name}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }} className="sub">
              <div className="pile">
                {preview.faces.map((p) => (
                  <span key={p.id} className="av xs" style={{ background: avatarColor(p.id) }}>
                    {initialOf(p.name, "")}
                  </span>
                ))}
              </div>
              {f(j.membersN, { n: preview.count })} · {j.roles[preview.role]} — {j.roleHints[preview.role].toLowerCase()}
            </div>
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {signedIn ? (
              <button type="button" className="btn lg pri block" onClick={() => void join()} disabled={state === "joining"} data-join-accept>
                {j.accept}
              </button>
            ) : (
              <button type="button" className="btn lg pri block" onClick={() => void google()} disabled={state === "joining"} data-join-google>
                {j.joinGoogle}
              </button>
            )}
            <div className="tiny" style={{ textAlign: "center" }}>
              {f(signedIn ? j.joinHintIn : j.joinHint, { days })}
            </div>
          </div>
        </>
      )}

      {state === "joined" && (
        <>
          <div className="fade" style={{ marginTop: 96, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}>
            <span className="ic round ok" style={{ width: 72, height: 72 }}>
              <svg className="i xl" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <h1 className="t-title" style={{ marginTop: 6 }} data-join-joined>
              {f(j.joined, { space: name })}
            </h1>
          </div>
          <div style={{ marginTop: "auto" }}>
            <Link className="btn lg pri block" href="/" data-join-open>
              {f(j.openSpace, { space: name })}
            </Link>
          </div>
        </>
      )}

      {state === "dead" && (
        <>
          <div style={{ marginTop: 96, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }} data-join-dead={problem ?? ""}>
            <span className="ic round" style={{ width: 72, height: 72 }}>
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                <path d="M3 3l18 18" />
              </svg>
            </span>
            <h1 className="t-title" style={{ marginTop: 6 }}>
              {problem === "expired" ? j.expiredTitle : j.invalidTitle}
            </h1>
            <p className="t-body">{preview.inviter ? f(j.askNew, { name: preview.inviter }) : j.askNewAnon}</p>
          </div>
          <div style={{ marginTop: "auto" }}>
            <Link className="btn lg block" href={signedIn ? "/" : "/login"}>
              {f(j.goApp, { app })}
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
