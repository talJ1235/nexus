import "server-only";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
import { db, schema } from "@/db";
import { STEP_UP_MS } from "./config";
import { sha256 } from "./crypto";
import { describeUa } from "./ua";

// Settings → Security (R15 A5): the signed-in user's own sign-in methods, devices (sessions) and activity.
// Everything is filtered by the caller's user id; ids from the client only ever match the caller's own rows.

export const isFresh = (sessionCreatedAt: Date) => Date.now() - sessionCreatedAt.getTime() <= STEP_UP_MS;

/** R17 A5: one batch = one round trip to the database (was five parallel requests, then one more for the
 *  "was this you" acknowledgement). Only live sessions are devices. `prefKey` reads one user_pref in the same batch. */
export async function securityData(userId: string, currentSessionId: string, prefKey?: string) {
  const [sessions, passkeys, accounts, events, codes, pref] = await db.batch([
    db.select().from(schema.session).where(and(eq(schema.session.userId, userId), gt(schema.session.expiresAt, new Date()))).orderBy(desc(schema.session.updatedAt)),
    db.select().from(schema.passkey).where(eq(schema.passkey.userId, userId)),
    db.select({ providerId: schema.account.providerId }).from(schema.account).where(eq(schema.account.userId, userId)),
    db.select().from(schema.securityEvent).where(eq(schema.securityEvent.userId, userId)).orderBy(desc(schema.securityEvent.createdAt)).limit(30),
    db.select({ id: schema.recoveryCode.id }).from(schema.recoveryCode).where(and(eq(schema.recoveryCode.userId, userId), isNull(schema.recoveryCode.usedAt))),
    db.select({ value: schema.userPref.value }).from(schema.userPref).where(and(eq(schema.userPref.userId, userId), eq(schema.userPref.key, prefKey ?? ""))),
  ]);
  return {
    pref: pref[0]?.value ?? null,
    devices: sessions.map((s) => ({
      id: s.id,
      current: s.id === currentSessionId,
      ...describeUa(s.userAgent),
      city: s.city,
      method: s.method,
      lastSeen: s.updatedAt.getTime(),
      createdAt: s.createdAt.getTime(),
    })),
    passkeys: passkeys.map((p) => ({ id: p.id, name: p.name, deviceType: p.deviceType, backedUp: p.backedUp, createdAt: p.createdAt?.getTime() ?? null, lastUsedAt: p.lastUsedAt?.getTime() ?? null })),
    google: accounts.some((a) => a.providerId === "google"),
    events: events.map((e) => {
      const d = describeUa(e.ua);
      return { id: e.id, kind: e.kind, method: (e.meta?.method as string | undefined) ?? null, city: (e.meta?.city as string | undefined) ?? null, browser: d.browser, os: d.os, deviceKind: d.kind, at: e.createdAt };
    }),
    recoveryCodesLeft: codes.length,
  };
}

/** Delete one of the caller's sessions (never the current one). Returns whether a row was removed. */
export async function revokeSession(userId: string, sessionId: string, currentSessionId: string) {
  if (sessionId === currentSessionId) return false;
  const rows = await db.delete(schema.session).where(and(eq(schema.session.id, sessionId), eq(schema.session.userId, userId))).returning({ id: schema.session.id });
  return rows.length === 1;
}

export async function revokeOtherSessions(userId: string, currentSessionId: string) {
  const rows = await db.delete(schema.session).where(and(eq(schema.session.userId, userId), ne(schema.session.id, currentSessionId))).returning({ id: schema.session.id });
  return rows.length;
}

export async function deletePasskey(userId: string, id: string) {
  const rows = await db.delete(schema.passkey).where(and(eq(schema.passkey.id, id), eq(schema.passkey.userId, userId))).returning({ id: schema.passkey.id });
  return rows.length === 1;
}

export async function renamePasskey(userId: string, id: string, name: string) {
  await db.update(schema.passkey).set({ name }).where(and(eq(schema.passkey.id, id), eq(schema.passkey.userId, userId)));
}

/** Admin recovery codes: 10 new one-time codes (old unused ones are dropped), stored hashed, returned once. */
export async function newRecoveryCodes(userId: string) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: 10 }, () => {
    const b = randomBytes(10);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  await db.delete(schema.recoveryCode).where(eq(schema.recoveryCode.userId, userId));
  await db.insert(schema.recoveryCode).values(codes.map((c) => ({ id: nanoid(), userId, codeHash: sha256(c), createdAt: Date.now() })));
  return codes;
}

/** Use one recovery code: true when an unused code matched (marked used atomically). */
export async function useRecoveryCode(userId: string, code: string) {
  const clean = code.trim().toLowerCase().replace(/\s+/g, "");
  const norm = clean.includes("-") ? clean : `${clean.slice(0, 5)}-${clean.slice(5)}`;
  const rows = await db
    .update(schema.recoveryCode)
    .set({ usedAt: Date.now() })
    .where(and(eq(schema.recoveryCode.userId, userId), eq(schema.recoveryCode.codeHash, sha256(norm)), isNull(schema.recoveryCode.usedAt)))
    .returning({ id: schema.recoveryCode.id });
  return rows.length === 1;
}

/** After a recovery sign-in the user must add a passkey before anything else (SECURITY.md §2). */
export async function needsRecoveryPasskey(userId: string, session: { method: string | null; createdAt: Date }) {
  if (session.method !== "email-otp" && session.method !== "recovery-code") return false;
  const rows = await db.select({ createdAt: schema.passkey.createdAt }).from(schema.passkey).where(eq(schema.passkey.userId, userId));
  return !rows.some((r) => r.createdAt && r.createdAt.getTime() >= session.createdAt.getTime());
}
