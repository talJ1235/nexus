import "server-only";
import { randomBytes } from "node:crypto";
import { userByPref, userPrefGet, userPrefSet } from "./db-scoped/prefs";

// Round 14 C2: the calendar feed's secret and what the feed last served. R15 B3: one token per USER; the feed shows
// every space that user is in.
export const CAL_TOKEN_KEY = "cal:token";
export const CAL_SEQ_KEY = "cal:seq";
export const CAL_SUBSCRIBED_KEY = "cal:subscribed";

const newToken = () => randomBytes(24).toString("base64url");

/** The feed token, created on first use. */
export async function calendarToken(userId: string) {
  const t = await userPrefGet(userId, CAL_TOKEN_KEY);
  if (t) return t;
  const fresh = newToken();
  await userPrefSet(userId, CAL_TOKEN_KEY, fresh);
  return fresh;
}

/** A new token (the old URL stops working) — subscribing again is needed, so the "subscribed" mark is cleared. */
export async function regenerateCalendarToken(userId: string) {
  const fresh = newToken();
  await userPrefSet(userId, CAL_TOKEN_KEY, fresh);
  await userPrefSet(userId, CAL_SUBSCRIBED_KEY, null);
  await userPrefSet(userId, CAL_SEQ_KEY, null);
  return fresh;
}

/** The user a feed token belongs to (null = no such token → 404). Tokens are 192-bit random. */
export async function calendarUser(given: string) {
  return userByPref(CAL_TOKEN_KEY, given);
}

// Best effort per server instance: at most 30 feed requests per client per 10 minutes (calendar apps poll every
// few hours; this only stops hammering / token guessing from one place).
const hits = new Map<string, number[]>();
export function rateLimited(key: string, now = Date.now(), max = 30, windowMs = 600_000) {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}
