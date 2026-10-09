"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers";
import { initialOf } from "@/lib/initial";
import type { BeatInput, Device } from "@/lib/presence-keys";
import { deviceOf } from "@/lib/presence-keys";

// R17 G — small pieces shared by the admin panel's tabs (boards Admin-desktop / Admin-phone).

export const PATH = {
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2",
  computer: "M2 4h20v13H2z M8 21h8 M12 17v4",
  live: "M2 12h4l3-8 4 16 3-8h6",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  invites: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z M13 5v2 M13 11v2 M13 17v2",
  ai: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  reports: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
  errors: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
  system: "M2 4h20v6H2z M2 14h20v6H2z M6 7h.01 M6 17h.01",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  back: "m15 18-6-6 6-6",
  chev: "m9 18 6-6-6-6",
  down: "m6 9 6 6 6-6",
  close: "M18 6 6 18 M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  lock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4",
  logo: "M12 2 3 7v10l9 5 9-5V7z M3 7l9 5 9-5 M12 12v10",
};

export function Svg({ d, className = "i sm" }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** The board's avatar colours c1–c6, stable per person. */
export function avClass(id: string) {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
  return `c${(h % 6) + 1}`;
}

export function Av({ id, name, size = "", ring }: { id: string; name: string; size?: "" | "sm" | "lg" | "xl"; ring?: "on" | "idle" | null }) {
  return (
    <span className={`av ${size} ${avClass(id)}${ring ? ` ring-${ring}` : ""}`} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

export function DevChip({ device, small }: { device: Device; small?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="dev" style={small ? { height: 20, fontSize: 11 } : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={device === "phone" ? PATH.phone : PATH.computer} />
      </svg>
      {device === "phone" ? t.adm.live.phone : t.adm.live.computer}
    </span>
  );
}

/** "Shopping list" / "Getting started, step 2 of 6" — from the fixed screen key. */
export function useScreenLabel() {
  const { t, f } = useI18n();
  return (screen: string) => {
    const m = screen.match(/^onboarding-(\d)$/);
    if (m) return Number(m[1]) >= 7 ? t.adm.screens.onboardingDone : f(t.adm.screens.onboarding, { n: m[1] });
    return (t.adm.screens as Record<string, string>)[screen] ?? t.adm.screens.other;
  };
}

/** Relative times: "now", "4 min", "2 h" (durations) and "18 min ago", "Yesterday" (last seen). */
export function useTimes() {
  const { t, f, locale } = useI18n();
  const a = t.adm.ago;
  const dur = (ms: number) => {
    const m = Math.floor(ms / 60_000);
    if (m < 1) return a.now;
    if (m < 60) return f(a.min, { n: m });
    const h = Math.floor(m / 60);
    return h < 48 ? f(a.h, { n: h }) : f(a.d, { n: Math.floor(h / 24) });
  };
  const ago = (at: number, now = Date.now()) => {
    const m = Math.floor((now - at) / 60_000);
    if (m < 1) return a.now;
    if (m < 60) return f(a.minAgo, { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return f(a.hAgo, { n: h });
    const d = Math.floor(h / 24);
    return d === 1 ? a.yesterday : f(a.dAgo, { n: d });
  };
  /** Stream times: "now", "35 s", "4 min", "2 h". */
  const since = (at: number, now = Date.now()) => {
    const s = Math.floor((now - at) / 1000);
    if (s < 10) return a.now;
    if (s < 60) return f(a.s, { n: s });
    return dur(now - at);
  };
  const date = (ms: number, withTime = false) =>
    new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", withTime ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }).format(ms);
  const time = (ms: number) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(ms);
  const num = (n: number) => new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US").format(n);
  return { dur, ago, since, date, time, num };
}

/** Runs `fn` now and every `ms` while the page is visible; nothing while hidden; at once when it shows again. */
export function useVisiblePoll(fn: () => void | Promise<unknown>, ms: number, deps: unknown[] = []) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      timer = null;
      if (stopped || document.visibilityState !== "visible") return;
      try {
        await ref.current();
      } finally {
        if (!stopped && document.visibilityState === "visible") timer = setTimeout(tick, ms);
      }
    };
    const vis = () => {
      if (document.visibilityState === "visible") {
        if (!timer) void tick();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    void tick();
    document.addEventListener("visibilitychange", vis);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass their own deps
  }, [ms, ...deps]);
}

/** This browser's beat (the admin page sends it with its polls instead of a separate request). */
export function beatHere(screen: BeatInput["screen"] = "admin"): BeatInput {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return { device: deviceOf(coarse, window.innerWidth), app: installed ? "installed" : "browser", screen, shoppingLeft: null };
}

/** Loading / failed states for a tab. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const run = useRef(load);
  useEffect(() => {
    run.current = load;
  });
  const reload = async () => {
    try {
      setData(await run.current());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass their own deps
  }, deps);
  return { data, setData, failed, reload };
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="alert warn" role="alert" style={{ alignItems: "center" }}>
      <span style={{ flex: 1 }}>{t.adm.retry}</span>
      <button type="button" className="btn sm" onClick={onRetry}>
        {t.adm.tryAgain}
      </button>
    </div>
  );
}

export function Skeleton({ rows = 4, h = 52 }: { rows?: number; h?: number }) {
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: rows }, (_, k) => (
        <span key={k} style={{ display: "block", height: h, borderRadius: 12, background: "var(--s2)", opacity: 0.7 }} />
      ))}
    </div>
  );
}

/** "Now" for relative times, refreshed every `ms` (render stays pure). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
