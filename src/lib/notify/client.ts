"use client";
// R17 S3 J2 — this browser's push: environment, permission, subscribe / re-check / save. Browser-only.
// iPhone: push exists only for a Home Screen app (standalone) — in Safari tabs the API is missing or never fires.

import { deviceOf } from "../presence-keys";

export type PushEnv = { supported: boolean; iphone: boolean; standalone: boolean; device: "phone" | "computer" };
export type PermState = "granted" | "denied" | "default" | "unsupported" | "iphone-browser";

export function pushEnv(): PushEnv {
  if (typeof window === "undefined") return { supported: false, iphone: false, standalone: false, device: "computer" };
  const ua = navigator.userAgent;
  const iphone = /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  return { supported, iphone, standalone, device: deviceOf(window.matchMedia("(pointer: coarse)").matches, window.innerWidth) };
}

export function permState(env = pushEnv()): PermState {
  if (env.iphone && !env.standalone) return "iphone-browser";
  if (!env.supported) return "unsupported";
  return Notification.permission as PermState;
}

/** "Chrome · Android" — browser + OS words only, never versions or anything finer. */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [b, os].filter(Boolean).join(" · ");
}

const KEY = "nexus.push";
const DAY = 86_400_000;

function b64ToBytes(b64: string) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const remembered = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as { ep: string; at: number } | null;
  } catch {
    return null;
  }
};

/**
 * Permission granted → make sure this browser has a push address for our key and the server has it. Re-saves when the
 * endpoint changed (or once a day, so a server-side deletion heals). Returns what happened, for the UI.
 */
export async function ensureSubscribed(publicKey: string | null, force = false): Promise<"ok" | "no-key" | "not-allowed" | "unsupported" | "failed"> {
  const env = pushEnv();
  if (permState(env) !== "granted") return env.supported ? "not-allowed" : "unsupported";
  if (!publicKey) return "no-key";
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = b64ToBytes(publicKey);
    // A subscription made with another key (keys rotated) can't receive our messages: replace it.
    const same = sub?.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).every((v, i) => v === key[i]);
    if (sub && !same) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const last = remembered();
    if (!force && last?.ep === sub.endpoint && Date.now() - last.at < DAY) return "ok";
    const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
    const r = await fetch("/api/notify/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: j.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth }, device: env.device, label: deviceLabel() }),
    });
    if (!r.ok) return "failed";
    localStorage.setItem(KEY, JSON.stringify({ ep: sub.endpoint, at: Date.now() }));
    return "ok";
  } catch {
    return "failed";
  }
}

/** The browser's own question — only ever called from a tap on "Turn on". */
export async function askPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window)) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}
