"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/providers";

type Choice = "household" | "me" | "link";

/** Welcome-phone (R15 A2): first run — personal space ready → household / just me / I have an invite link. */
export function WelcomeChoice({ app }: { app: string }) {
  const { t, f } = useI18n();
  const w = t.auth.welcome;
  const [choice, setChoice] = useState<Choice>("household");
  const [link, setLink] = useState("");
  const go = () => {
    if (choice === "me") return window.location.assign("/");
    // Shared spaces are created from the switcher (Part C); Home opens that dialog for this choice.
    if (choice === "household") return window.location.assign("/?welcome=household");
    const m = link.match(/\/join\/([\w-]{20,80})/);
    if (m) window.location.assign(`/join/${m[1]}`);
  };
  const opts: [Choice, string, string, React.ReactNode][] = [
    ["household", w.household, w.householdSub, <path key="h" d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />],
    ["me", w.me, w.meSub, [<circle key="c" cx="12" cy="8" r="4" />, <path key="p" d="M4 21a8 8 0 0 1 16 0" />]],
    ["link", w.link, w.linkSub, [<path key="a" d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />, <path key="b" d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />]],
  ];
  return (
    <main className="page" data-auth="welcome">
      <div style={{ height: 44, display: "flex", alignItems: "center", gap: 12 }}>
        <div className="meter" style={{ flex: 1 }}>
          <i style={{ width: "33%" }} />
        </div>
        <Link className="btn sm ghost" href="/">
          {w.skip}
        </Link>
      </div>
      <h1 className="t-title" style={{ marginTop: 28 }}>
        {f(w.title, { app })}
      </h1>
      <div role="radiogroup" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        {opts.map(([k, title, sub, icon]) => (
          <button key={k} type="button" role="radio" aria-checked={choice === k} className={`opt${choice === k ? " on" : ""}`} onClick={() => setChoice(k)}>
            <span className="ic">
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                {icon}
              </svg>
            </span>
            <span style={{ flex: 1, lineHeight: 1.35 }}>
              <b>{title}</b>
              <br />
              <span className="sub">{sub}</span>
            </span>
            <span className="radio" />
          </button>
        ))}
      </div>
      {choice === "link" && (
        <div className="input" style={{ marginTop: 12 }}>
          <input aria-label={w.paste} placeholder={w.paste} value={link} onChange={(e) => setLink(e.target.value)} autoFocus />
        </div>
      )}
      <div style={{ marginTop: "auto", paddingTop: 24 }}>
        <button type="button" className="btn lg pri block" onClick={go}>
          {w.continue}
        </button>
      </div>
    </main>
  );
}
