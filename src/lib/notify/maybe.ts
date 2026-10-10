import "server-only";
import { kvLease, kvSet } from "../kv";
import { dispatch } from "./dispatch";
import { runNotifySweeps } from "./senders";

// R17 S6 U3 — don't depend on GitHub's schedule alone. Any signed-in request that already runs server code (the
// presence beat, the app's boot call) calls maybeDispatch() in after(): at most once per 5 minutes (a kv lease — two
// requests at once never both run it) it runs the time sweeps (idle trips, deliveries today, budget, the weekly
// summary) and sends every due row. Claiming stays idempotent (claimDue), so the hourly job and the in-request sends
// can overlap safely. hourly.yml (nights, nobody online) and the Vercel daily cron stay as safety nets.

export const LEASE_KEY = "lease:notify";
export const LAST_NOTIFY_KEY = "pref:last_notify";
export const DISPATCH_EVERY_MS = 5 * 60_000;

/** The sweeps + the send, and the run's summary for the admin's Push view (`by`: who ran it). */
export async function runDispatcher(by: "cron" | "app", now = Date.now()) {
  const sweeps = await runNotifySweeps(now).catch(() => null);
  const sent = await dispatch(Math.max(now, Date.now()));
  const summary = { at: Date.now(), ms: Date.now() - now, by, sweeps, ...sent };
  await kvSet(LAST_NOTIFY_KEY, JSON.stringify(summary));
  return summary;
}

/** Runs the dispatcher when this request wins the 5-minute lease; otherwise does nothing. Never throws.
 *  NOTIFY_AUTO_DISPATCH=0 turns it off for app requests (seeded test servers); `force` = a direct call (test:push). */
export async function maybeDispatch(now = Date.now(), force = false) {
  if (!force && process.env.NOTIFY_AUTO_DISPATCH === "0") return null;
  try {
    if (!(await kvLease(LEASE_KEY, DISPATCH_EVERY_MS, now))) return null;
    return await runDispatcher("app", now);
  } catch {
    return null;
  }
}
