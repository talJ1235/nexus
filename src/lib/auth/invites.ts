import "server-only";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { encrypt, newInviteCode, normalizeInviteCode, sha256, signValue, verifyValue } from "./crypto";

// R15 A3: invite-only sign-up. The code (or a /join/<token> link) survives the Google redirect in a short-lived,
// signed, HttpOnly cookie; the user row is created only when it is still valid (validateUserInfo in server.ts).
export const INVITE_COOKIE = "nexus_invite";
export const INVITE_COOKIE_TTL_MS = 10 * 60 * 1000;
export const INVITE_DEFAULT_DAYS = 14;

export type InviteCookie = { code?: string; join?: string };
export type InviteProblem = "invalid" | "expired" | "used_up" | "revoked";
export type InviteCheck = { ok: true; kind: "code"; id: string } | { ok: true; kind: "join"; id: string; spaceId: string; role: "member" | "viewer" } | { ok: false; problem: InviteProblem };

export function inviteCookieValue(v: InviteCookie) {
  return signValue(v, INVITE_COOKIE_TTL_MS);
}

export function readInviteCookie(raw: string | undefined | null) {
  return verifyValue<InviteCookie>(raw);
}

export async function checkSignupCode(code: string, now = Date.now()): Promise<InviteCheck> {
  const norm = normalizeInviteCode(code);
  if (!norm) return { ok: false, problem: "invalid" };
  const [row] = await db.select().from(schema.signupInvite).where(eq(schema.signupInvite.codeHash, sha256(norm))).limit(1);
  if (!row) return { ok: false, problem: "invalid" };
  if (row.revokedAt) return { ok: false, problem: "revoked" };
  if (row.expiresAt <= now) return { ok: false, problem: "expired" };
  if (row.uses >= row.maxUses) return { ok: false, problem: "used_up" };
  return { ok: true, kind: "code", id: row.id };
}

export async function checkJoinToken(token: string, now = Date.now()): Promise<InviteCheck> {
  if (!/^[\w-]{20,80}$/.test(token)) return { ok: false, problem: "invalid" };
  const [row] = await db.select().from(schema.spaceInvite).where(eq(schema.spaceInvite.tokenHash, sha256(token))).limit(1);
  if (!row) return { ok: false, problem: "invalid" };
  if (row.revokedAt) return { ok: false, problem: "revoked" };
  if (row.expiresAt <= now) return { ok: false, problem: "expired" };
  if (row.uses >= row.maxUses) return { ok: false, problem: "used_up" };
  const [sp] = await db.select({ deletedAt: schema.space.deletedAt }).from(schema.space).where(eq(schema.space.id, row.spaceId)).limit(1);
  if (!sp || sp.deletedAt) return { ok: false, problem: "revoked" };
  return { ok: true, kind: "join", id: row.id, spaceId: row.spaceId, role: row.role };
}

export async function checkInviteCookie(c: InviteCookie | null): Promise<InviteCheck> {
  if (c?.join) return checkJoinToken(c.join);
  if (c?.code) return checkSignupCode(c.code);
  return { ok: false, problem: "invalid" };
}

/** Atomically use one sign-up code: only while it still has uses left, isn't revoked or expired. */
export async function consumeSignupCode(id: string, userId: string, now = Date.now()) {
  const rows = await db
    .update(schema.signupInvite)
    .set({ uses: sql`${schema.signupInvite.uses} + 1`, usedBy: sql`json_insert(${schema.signupInvite.usedBy}, '$[#]', ${userId})` })
    .where(
      and(
        eq(schema.signupInvite.id, id),
        isNull(schema.signupInvite.revokedAt),
        gt(schema.signupInvite.expiresAt, now),
        lt(schema.signupInvite.uses, schema.signupInvite.maxUses),
      ),
    )
    .returning({ id: schema.signupInvite.id });
  return rows.length === 1;
}

export async function consumeJoinToken(id: string, now = Date.now()) {
  const rows = await db
    .update(schema.spaceInvite)
    .set({ uses: sql`${schema.spaceInvite.uses} + 1` })
    .where(and(eq(schema.spaceInvite.id, id), isNull(schema.spaceInvite.revokedAt), gt(schema.spaceInvite.expiresAt, now), lt(schema.spaceInvite.uses, schema.spaceInvite.maxUses)))
    .returning({ id: schema.spaceInvite.id, spaceId: schema.spaceInvite.spaceId, role: schema.spaceInvite.role });
  return rows[0] ?? null;
}

// ---- admin (Settings → Invite codes) ----

export async function createSignupCode(createdBy: string, opts: { note?: string | null; maxUses?: number; days?: number }) {
  const code = newInviteCode();
  const days = Math.min(Math.max(opts.days ?? INVITE_DEFAULT_DAYS, 1), 90);
  const row = {
    id: nanoid(),
    codeHash: sha256(code),
    hint: code.slice(-4),
    codeEnc: encrypt(code),
    note: opts.note?.trim().slice(0, 80) || null,
    maxUses: Math.min(Math.max(opts.maxUses ?? 1, 1), 50),
    expiresAt: Date.now() + days * 86_400_000,
    createdBy,
  };
  await db.insert(schema.signupInvite).values(row);
  return { code, id: row.id };
}

export async function listSignupCodes() {
  return db.select().from(schema.signupInvite).orderBy(desc(schema.signupInvite.createdAt)).limit(200);
}

export async function revokeSignupCode(id: string) {
  await db.update(schema.signupInvite).set({ revokedAt: Date.now() }).where(and(eq(schema.signupInvite.id, id), isNull(schema.signupInvite.revokedAt)));
}

/** The Google email of a refused sign-up (kept 10 min under an opaque ref — never in the URL). */
export async function pendingSignupEmail(ref: string | null | undefined) {
  if (!ref || !/^[\w-]{10,40}$/.test(ref)) return null;
  const [row] = await db.select().from(schema.verification).where(eq(schema.verification.identifier, `pending-signup:${ref}`)).limit(1);
  return row && row.expiresAt.getTime() > Date.now() ? row.value : null;
}

export async function addToWaitlist(email: string, ipHash: string | null) {
  await db.insert(schema.waitlist).values({ email: email.toLowerCase(), ipHash, createdAt: Date.now() }).onConflictDoNothing();
}
