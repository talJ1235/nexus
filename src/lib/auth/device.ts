import "server-only";
import { signValue, verifyValue } from "./crypto";

// The "Continue as Tal · Last used" chip (R15 A2): who last signed in on this device, signed + HttpOnly, 400 days.
export const LAST_ACCOUNT_COOKIE = "nexus_last";
const TTL = 400 * 86_400_000;

export const lastAccountValue = (v: { name: string; email: string }) => signValue(v, TTL);
export const readLastAccount = (raw: string | undefined | null) => verifyValue<{ name: string; email: string }>(raw);
export const LAST_ACCOUNT_MAX_AGE = TTL / 1000;
