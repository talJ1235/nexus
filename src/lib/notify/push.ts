import "server-only";
import webpush from "web-push";
import { dropSubscription, subscriptionFailed, subscriptionOk, subscriptionsOf } from "../db-scoped/notify";
import { reportError } from "../errors/record";

// R17 S3 J2 — Web Push (VAPID). The payload is encrypted for the browser (RFC 8291); the push service only sees the
// endpoint and the size. 404/410 = the browser dropped that address → deleted; other failures count up (5 in a row →
// the daily cron deletes it). Nothing about the content is logged — failures are recorded as status codes only.

export type PushPayload = {
  /** The notification row id (or "group") — the service worker passes it back on a click. */
  id: string;
  title: string;
  body: string;
  /** Same-origin path the click opens. */
  url: string;
  /** = group_key: the same group replaces itself on the device. */
  tag: string;
  actions?: { action: "open" | "received"; title: string }[];
  lang: "en" | "he";
  dir: "ltr" | "rtl";
  /** In-place update (shopping finished): no second sound. */
  renotify?: boolean;
};

export type SendResult = { sent: number; failed: number; gone: number; devices: number };

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

// Browser push services only (an endpoint is input from the browser — never let it point the server anywhere else).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/];

/** test:push runs a fake push service on loopback (never in production). */
const testLoopback = () => process.env.PUSH_TEST_LOOPBACK === "1" && process.env.NODE_ENV !== "production" && !process.env.VERCEL;

export function allowedEndpoint(endpoint: string) {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (endpoint.length > 1000 || u.username || u.password) return false;
  if (testLoopback() && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return true;
  return u.protocol === "https:" && (!u.port || u.port === "443") && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

let warned = false;

/** Send one payload to every working address of this person. */
export async function sendToUser(userId: string, payload: PushPayload, ttlSec: number): Promise<SendResult> {
  const res: SendResult = { sent: 0, failed: 0, gone: 0, devices: 0 };
  if (!pushConfigured()) {
    if (!warned) {
      warned = true;
      reportError({ kind: "notify", code: "push_not_configured", where: "notify:push", message: "VAPID keys missing — inbox only" });
    }
    return res;
  }
  const subs = await subscriptionsOf(userId);
  res.devices = subs.length;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      if (!allowedEndpoint(s.endpoint)) {
        await dropSubscription(s.id);
        res.gone++;
        return;
      }
      try {
        const req = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: ttlSec,
          urgency: ttlSec <= 3600 ? "high" : "normal",
          topic: topicOf(payload.tag),
          vapidDetails: { subject: process.env.VAPID_SUBJECT || "https://nexus-ashen-beta.vercel.app", publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
        });
        const r = await fetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>, body: req.body as unknown as BodyInit, redirect: "manual", signal: AbortSignal.timeout(10_000) });
        if (r.status === 404 || r.status === 410) {
          await dropSubscription(s.id);
          res.gone++;
        } else if (r.status >= 200 && r.status < 300) {
          await subscriptionOk(s.id);
          res.sent++;
        } else {
          await subscriptionFailed(s.id);
          res.failed++;
          reportError({ kind: "notify", code: `push_${r.status}`, where: "notify:push", message: `push service answered ${r.status}` });
        }
      } catch (e) {
        await subscriptionFailed(s.id);
        res.failed++;
        reportError({ kind: "notify", code: "push_error", where: "notify:push", message: String((e as Error)?.name ?? "error") });
      }
    }),
  );
  return res;
}

/** The Topic header (≤ 32 URL-safe chars) lets the push service replace a still-queued message of the same group. */
function topicOf(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return `g${(h >>> 0).toString(36)}`.slice(0, 32);
}
