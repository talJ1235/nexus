import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { kvGet, kvSet } from "./kv";

// Round 14 C2: the calendar feed's secret (per owner; one owner today — kv) and what the feed last served.
export const CAL_TOKEN_KEY = "cal:token";
export const CAL_SEQ_KEY = "cal:seq";
export const CAL_SUBSCRIBED_KEY = "cal:subscribed";

const newToken = () => randomBytes(24).toString("base64url");

/** The feed token, created on first use. */
export async function calendarToken() {
  const t = await kvGet(CAL_TOKEN_KEY);
  if (t) return t;
  const fresh = newToken();
  await kvSet(CAL_TOKEN_KEY, fresh);
  return fresh;
}

/** A new token (the old URL stops working) — subscribing again is needed, so the "subscribed" mark is cleared. */
export async function regenerateCalendarToken() {
  const fresh = newToken();
  await kvSet(CAL_TOKEN_KEY, fresh);
  await kvSet(CAL_SUBSCRIBED_KEY, null);
  await kvSet(CAL_SEQ_KEY, null);
  return fresh;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
/** Constant-time check of a token from the URL. */
export async function calendarTokenMatches(given: string) {
  const t = await kvGet(CAL_TOKEN_KEY);
  return !!t && timingSafeEqual(digest(given), digest(t));
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
