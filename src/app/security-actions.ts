"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { authMode } from "@/lib/auth/config";
import { LAST_ACCOUNT_COOKIE, LAST_ACCOUNT_MAX_AGE, lastAccountValue } from "@/lib/auth/device";
import { logSecurityEvent } from "@/lib/auth/events";
import { deletePasskey, isFresh, newRecoveryCodes, renamePasskey, revokeOtherSessions, revokeSession, securityData } from "@/lib/auth/security";
import { requestHost } from "@/lib/auth/server";
import { forgetSessions } from "@/lib/auth/session";
import { userPrefGet, userPrefSet } from "@/lib/db-scoped/prefs";
import { isAdmin, requireCtx } from "@/lib/ctx";

// Settings → Security (R15 A5). Every action is the signed-in user's own: sessions, passkeys and events are filtered by
// the user id from the session; adding/removing a passkey and making recovery codes need a sign-in in the last 10 min.

const ACK_KEY = "sec:ack";
const Id = z.string().min(1).max(64);

export async function getSecurityState() {
  const ctx = await requireCtx("view");
  const { pref: ack, ...data } = await securityData(ctx.user.id, ctx.session.id, ACK_KEY);
  // "Was this you?" — the newest new-device sign-in that isn't this device and wasn't answered yet.
  const fresh = data.events.find((e) => e.kind === "new_device");
  const alert = fresh && fresh.id !== ack && Date.now() - fresh.at < 14 * 86_400_000 ? fresh : null;
  return {
    me: { name: ctx.user.name, email: ctx.user.email },
    full: authMode(requestHost(await headers())) === "full",
    admin: isAdmin(ctx),
    fresh: isFresh(ctx.session.createdAt),
    alert,
    ...data,
  };
}
export type SecurityState = Awaited<ReturnType<typeof getSecurityState>>;

export async function signOutDevice(sessionId: string) {
  const ctx = await requireCtx("view");
  const ok = await revokeSession(ctx.user.id, Id.parse(sessionId), ctx.session.id);
  if (ok) {
    forgetSessions();
    await logSecurityEvent(ctx.user.id, "sign_out_device", null, await headers());
  }
  return ok;
}

export async function signOutOtherDevices() {
  const ctx = await requireCtx("view");
  const n = await revokeOtherSessions(ctx.user.id, ctx.session.id);
  forgetSessions();
  if (n) await logSecurityEvent(ctx.user.id, "sign_out_others", { n }, await headers());
  return n;
}

/** "Yes, it was me" on the new-sign-in banner. */
export async function ackNewSignIn(eventId: string) {
  const ctx = await requireCtx("view");
  await userPrefSet(ctx.user.id, ACK_KEY, Id.parse(eventId));
}

export async function removePasskey(id: string): Promise<{ ok: boolean; stepUp?: true }> {
  const ctx = await requireCtx("view");
  if (!isFresh(ctx.session.createdAt)) return { ok: false, stepUp: true };
  const ok = await deletePasskey(ctx.user.id, Id.parse(id));
  if (ok) await logSecurityEvent(ctx.user.id, "passkey_removed", null, await headers());
  return { ok };
}

export async function renameMyPasskey(id: string, name: string) {
  const ctx = await requireCtx("view");
  await renamePasskey(ctx.user.id, Id.parse(id), z.string().trim().min(1).max(60).parse(name));
}

/** Admins only, step-up: 10 new one-time codes, shown once. */
export async function createRecoveryCodes(): Promise<{ codes?: string[]; stepUp?: true }> {
  const ctx = await requireCtx("view");
  if (!isAdmin(ctx)) throw new Error("forbidden");
  if (!isFresh(ctx.session.createdAt)) return { stepUp: true };
  const codes = await newRecoveryCodes(ctx.user.id);
  await logSecurityEvent(ctx.user.id, "recovery_codes_created", null, await headers());
  return { codes };
}

/** The "Continue as …" chip on this device's sign-in screen (first name + email, signed, HttpOnly). */
export async function rememberThisDevice() {
  const ctx = await requireCtx("view");
  const jar = await cookies();
  jar.set(LAST_ACCOUNT_COOKIE, lastAccountValue({ name: (ctx.user.name || ctx.user.email).split(/\s+/)[0].slice(0, 40), email: ctx.user.email }), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: LAST_ACCOUNT_MAX_AGE,
  });
}
