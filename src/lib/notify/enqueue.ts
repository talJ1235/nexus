import "server-only";
import { after } from "next/server";
import { lastActivitySent, notificationByGroup, openTimes, upsertNotification } from "../db-scoped/notify";
import { userPrefGetMany, userPrefSet } from "../db-scoped/prefs";
import { NOTIFY_KEY } from "../home-prefs";
import { URGENT, type NotifyKind } from "./kinds";
import { activeHour, activityNotBefore, afterQuiet, DEFAULT_TZ, sendAfterFor, validTz } from "./schedule";

// R17 S3 J3 — the one entry point every sender uses. Writes or updates the inbox row (one per person per group_key),
// decides when it may be pushed, and sends urgent ones within the same request. The person who caused the event is
// never notified. The account switch Off → the row is written, nothing is sent.

export const TZ_KEY = "pref:tz";
const ACTIVE_WINDOW_MS = 14 * 86_400_000;

export type Prefs = { on: boolean; tz: string; hour: number };

export async function notifyPrefs(userId: string, now = Date.now()): Promise<Prefs> {
  const kv = await userPrefGetMany(userId, [NOTIFY_KEY, TZ_KEY]);
  let on = true;
  try {
    on = (JSON.parse(kv[NOTIFY_KEY] ?? "{}") as { on?: unknown }).on !== false;
  } catch {}
  const tz = validTz(kv[TZ_KEY]) ? kv[TZ_KEY] : DEFAULT_TZ;
  return { on, tz, hour: activeHour(await openTimes(userId, now - ACTIVE_WINDOW_MS), tz) };
}

export type NotifyOpts = {
  /** Who caused it (never notified). null = the system (price checks, the weekly summary). */
  actor: string | null;
  spaceId: string | null;
  now?: number;
  /** A trip that finished: in quiet hours it isn't pushed at all. */
  finishedTrip?: boolean;
  /** A fixed time (delivery today at 08:00 local) — still never inside quiet hours. */
  at?: (p: Prefs) => number;
  /** Inbox only (no push for this update). */
  silent?: boolean;
};

type DataOf = object | ((prev: unknown) => unknown);

export async function notify(userIds: string[], kind: NotifyKind, groupKey: string, data: DataOf, o: NotifyOpts) {
  const now = o.now ?? Date.now();
  const due: string[] = [];
  for (const userId of [...new Set(userIds)]) {
    if (!userId || userId === o.actor) continue;
    const p = await notifyPrefs(userId, now);
    const prev = typeof data === "function" ? await notificationByGroup(userId, groupKey) : null;
    const value = typeof data === "function" ? (data as (x: unknown) => unknown)(prev ? safe(prev.data) : null) : data;
    let sendAfter: number | null = null;
    if (!o.silent && p.on) {
      sendAfter = o.at ? afterQuiet(o.at(p), p.tz) : sendAfterFor(kind, now, p.tz, p.hour, { finishedTrip: o.finishedTrip });
      if (sendAfter != null && kind === "activity" && o.spaceId) sendAfter = afterQuiet(activityNotBefore(sendAfter, await lastActivitySent(userId, o.spaceId)), p.tz);
    }
    const pushState = o.silent ? null : !p.on ? "off" : sendAfter == null ? "skipped" : "due";
    await upsertNotification({ userId, spaceId: o.spaceId, kind, groupKey, data: value, sendAfter, pushState, now });
    if (sendAfter != null && sendAfter <= now && URGENT.has(kind)) due.push(userId);
  }
  // Urgent: out within this request (after the response); the hourly dispatcher is the safety net.
  if (due.length) {
    const run = async () => {
      const { dispatch } = await import("./dispatch");
      for (const u of due) await dispatch(Date.now(), { userId: u }).catch(() => {});
    };
    try {
      after(run);
    } catch {
      await run();
    }
  }
  return due.length;
}

const safe = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** J3: the person's time zone, from the browser (the app's `nexus_tz` cookie) — saved when it changes. */
export async function rememberTz(userId: string, tz: string | null) {
  if (!tz || !validTz(tz)) return;
  const kv = await userPrefGetMany(userId, [TZ_KEY]);
  if (kv[TZ_KEY] !== tz) await userPrefSet(userId, TZ_KEY, tz);
}
