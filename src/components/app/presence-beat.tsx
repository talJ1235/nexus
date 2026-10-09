"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { getShoppingLeft, onShoppingLeft } from "@/lib/presence-client";
import { BEAT_MS, deviceOf, type BeatInput, type ScreenKey } from "@/lib/presence-keys";
import { useOpenItemId, useStore } from "./store";

// R17 G1 — the presence beat: every 30 s while the page is visible, at once on a screen change, and an "away" beacon
// on pagehide / hidden. Carries the device kind, installed or browser, a fixed screen key and the shopping count —
// never what's on the screen. Read only by the admin panel's Live view (no Ably presence set for this).

export function sendBeat(screen: ScreenKey, shoppingLeft: number | null = null) {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const beat: BeatInput = { device: deviceOf(coarse, window.innerWidth), app: installed ? "installed" : "browser", screen, shoppingLeft };
  return fetch("/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ beat }), keepalive: true }).catch(() => {});
}

export function sendAway() {
  const body = JSON.stringify({ away: true });
  if (!navigator.sendBeacon?.("/api/presence", new Blob([body], { type: "text/plain" }))) void fetch("/api/presence", { method: "POST", body, keepalive: true }).catch(() => {});
}

/** Beats for `screen` while mounted (also used by onboarding). */
export function useBeat(screen: ScreenKey | null, shoppingLeft: number | null = null) {
  const cur = useRef({ screen, shoppingLeft });
  useEffect(() => {
    cur.current = { screen, shoppingLeft };
    if (screen && document.visibilityState === "visible") void sendBeat(screen, shoppingLeft);
  }, [screen, shoppingLeft]);
  useEffect(() => {
    const beat = () => {
      const c = cur.current;
      if (c.screen && document.visibilityState === "visible") void sendBeat(c.screen, c.shoppingLeft);
    };
    const id = setInterval(beat, BEAT_MS);
    const vis = () => (document.visibilityState === "visible" ? beat() : sendAway());
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", sendAway);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", sendAway);
    };
  }, []);
}

/** The app's screen right now, as a fixed key. */
export function useScreen(): ScreenKey | null {
  const s = useStore();
  const openItem = useOpenItemId();
  if (s.loading) return null;
  if (s.shop && s.shop !== "pick") return "shopping-mode";
  if (s.settingsSection != null) return "settings";
  if (s.panel === "assistant" || s.panel === "planner") return "assistant";
  if (openItem) return "item";
  switch (s.view.type) {
    case "home":
      return "home";
    case "to_buy":
    case "store":
      return "to-buy";
    case "ordered":
    case "orders":
      return "on-the-way";
    case "history":
      return "history";
    case "projects":
    case "collection":
      return "projects";
    case "spending":
      return "insights";
    default:
      return "other";
  }
}

export function PresenceBeat() {
  const screen = useScreen();
  const [left, setLeft] = useState<number | null>(getShoppingLeft);
  useEffect(() => onShoppingLeft(() => setLeft(getShoppingLeft())), []);
  useBeat(screen, screen === "shopping-mode" ? left : null);
  return null;
}

/** R17 H1: after onboarding (finished or skipped) Home opens once with the "Try it" hint (/?hint=try). */
export function TryHint() {
  const { t } = useI18n();
  const s = useStore();
  useEffect(() => {
    if (s.loading) return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("hint") !== "try") return;
    u.searchParams.delete("hint");
    window.history.replaceState(window.history.state, "", u);
    const phone = window.matchMedia("(pointer: coarse)").matches;
    toast(phone ? t.ob.tryItPhone : t.ob.tryIt, { duration: 8000, id: "try-hint" });
  }, [s.loading, t]);
  return null;
}
