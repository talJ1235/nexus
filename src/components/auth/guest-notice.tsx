import Link from "next/link";
import { BoxMark } from "./brand-art";

/** GuestNotice-phone (R15 D1): old guest links (/g, /g/*, /i/<token>) — Nexus now uses accounts. */
export function GuestNotice({ app, title, body, login }: { app: string; title: string; body: string; login: string }) {
  return (
    <main className="page" data-auth="guest-notice">
      <div style={{ height: 44, display: "flex", alignItems: "center" }}>
        <span className="logo">
          <BoxMark size={22} />
          {app}
        </span>
      </div>
      <div style={{ marginTop: 96, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}>
        <span className="ic round" style={{ width: 72, height: 72 }}>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
            <path d="M3 3l18 18" />
          </svg>
        </span>
        <h1 className="t-title" style={{ marginTop: 6 }}>
          {title}
        </h1>
        <p className="t-body">{body}</p>
      </div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        <Link className="btn lg pri block" href="/login" data-guest-login>
          {login}
        </Link>
      </div>
    </main>
  );
}
