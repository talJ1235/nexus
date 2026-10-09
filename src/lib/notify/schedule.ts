// R17 S3 J3 — when a notification is sent (pure, unit-tested in test:notify). All clock reasoning happens in the person's
// own time zone: quiet hours 22:00–07:00 (held until 07:00), batched kinds at their usual active hour (default 09:00),
// the weekly summary on Thursday at that hour.

import { URGENT, type NotifyKind } from "./kinds";

export const QUIET_FROM = 22;
export const QUIET_TO = 7;
export const DEFAULT_TZ = "Asia/Jerusalem";
export const DEFAULT_ACTIVE_HOUR = 9;

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  const hit = fmts.get(tz);
  if (hit) return hit;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
  } catch {
    f = fmt(DEFAULT_TZ);
  }
  fmts.set(tz, f);
  return f;
}

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The local clock at `ts` in `tz`. */
export function local(ts: number, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: WD[p.weekday] ?? 0 };
}

export const isQuiet = (ts: number, tz: string) => {
  const h = local(ts, tz).hour;
  return h >= QUIET_FROM || h < QUIET_TO;
};

/** The first instant ≥ ts (to the minute) whose local time is `hour`:00 (and, if given, on `weekday`). */
export function nextLocal(ts: number, tz: string, hour: number, weekday?: number) {
  let t = Math.ceil(ts / 60_000) * 60_000;
  // Walk in 15-minute steps (half-hour zones land on :00 too); at most 8 days.
  t = Math.ceil(t / 900_000) * 900_000;
  for (let i = 0; i < 8 * 24 * 4; i++, t += 900_000) {
    const l = local(t, tz);
    if (l.hour === hour && l.minute === 0 && (weekday == null || l.weekday === weekday)) return t;
  }
  return ts;
}

/** An instant outside quiet hours: unchanged, or the next 07:00. */
export const afterQuiet = (ts: number, tz: string) => (isQuiet(ts, tz) ? nextLocal(ts, tz, QUIET_TO) : ts);

/** The most common local hour among the person's app opens; outside quiet hours; default 09:00. */
export function activeHour(openTimes: number[], tz: string) {
  const n = new Array(24).fill(0) as number[];
  for (const t of openTimes) n[local(t, tz).hour]++;
  let best = -1;
  for (let h = QUIET_TO; h < QUIET_FROM; h++) if (n[h] > 0 && (best < 0 || n[h] > n[best])) best = h;
  return best < 0 ? DEFAULT_ACTIVE_HOUR : best;
}

/** The next time this person's active hour starts (now, when we are inside it). */
export function nextActive(now: number, tz: string, hour: number) {
  const l = local(now, tz);
  if (l.hour === hour && !isQuiet(now, tz)) return now;
  return nextLocal(now, tz, hour);
}

/**
 * `send_after` for a new/updated row. Urgent kinds: now, or 07:00 after a quiet night. A finished shopping trip during
 * quiet hours is not pushed at all (null — inbox only). Batched kinds: the next active hour. Week: Thursday then.
 */
export function sendAfterFor(kind: NotifyKind, now: number, tz: string, hour: number, opts: { finishedTrip?: boolean } = {}): number | null {
  if (URGENT.has(kind)) {
    if (isQuiet(now, tz)) return opts.finishedTrip ? null : nextLocal(now, tz, QUIET_TO);
    return now;
  }
  if (kind === "week") {
    const l = local(now, tz);
    if (l.weekday === 4 && l.hour === hour) return now;
    return nextLocal(now, tz, hour, 4);
  }
  return nextActive(now, tz, hour);
}

/** Activity pushes: at most one per space per hour — the earliest time this one may go. */
export const activityNotBefore = (sendAfter: number, lastSent: number | null) => (lastSent != null && sendAfter - lastSent < 3_600_000 ? lastSent + 3_600_000 : sendAfter);
