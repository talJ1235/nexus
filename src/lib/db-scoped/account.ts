import "server-only";
import { and, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildBackup } from "./backup";
import { Scoped } from "./index";
import { purgeSpaceData } from "./spaces";
import { dropSpaceRows } from "../spaces";

// R17 E4 — "Delete account": hidden at once (every session revoked, left out of people lists), 7 days to undo (signing
// in again offers "Restore your account?"), then the daily cron purges: personal spaces (+ their files), shared spaces
// with nobody else in them, the person's chats / memory / prefs / AI usage / security log, memberships, sign-in
// methods and the user row. Items they added to spaces shared with others stay — shown as added by "Former member"
// (the item keeps the old user id; no person matches it any more). A sole owner of a shared space that has other
// members must transfer or delete it first.

export const ACCOUNT_UNDO_MS = 7 * 86_400_000;

/** Shared spaces that stop a deletion: this person is their only owner and other people are members. */
export async function soleOwnerBlocks(userId: string) {
  const owned = await db
    .select({ id: schema.space.id, name: schema.space.name })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), eq(schema.member.role, "owner"), eq(schema.space.kind, "shared"), sql`${schema.space.deletedAt} IS NULL`));
  const out: { id: string; name: string }[] = [];
  for (const sp of owned) {
    const others = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, sp.id), ne(schema.member.userId, userId)));
    if (others.length && !others.some((o) => o.role === "owner")) out.push(sp);
  }
  return out;
}

export async function deletionRequestedAt(userId: string): Promise<number | null> {
  const [u] = await db.select({ at: schema.user.deletionRequestedAt }).from(schema.user).where(eq(schema.user.id, userId));
  return u?.at ?? null;
}

/** Hide the account now: the request time, and every session (this device too) ends. */
export async function markAccountDeletion(userId: string, now = Date.now()) {
  await db.batch([
    db.update(schema.user).set({ deletionRequestedAt: now }).where(eq(schema.user.id, userId)),
    db.delete(schema.session).where(eq(schema.session.userId, userId)),
    db.delete(schema.presence).where(eq(schema.presence.userId, userId)),
  ]);
}

/** Undo within the 7 days (the restore screen after signing in again). */
export async function restoreAccount(userId: string, now = Date.now()) {
  const at = await deletionRequestedAt(userId);
  if (at == null || now - at >= ACCOUNT_UNDO_MS) return false;
  await db.update(schema.user).set({ deletionRequestedAt: null }).where(eq(schema.user.id, userId));
  return true;
}

export async function accountsToPurge(now = Date.now()) {
  return db.select({ id: schema.user.id }).from(schema.user).where(and(isNotNull(schema.user.deletionRequestedAt), lt(schema.user.deletionRequestedAt, now - ACCOUNT_UNDO_MS)));
}

/** The purge (cron, after the undo window). Returns the blob URLs to delete. */
export async function purgeAccount(userId: string): Promise<string[]> {
  const urls: string[] = [];
  const mine = await db
    .select({ id: schema.space.id, kind: schema.space.kind })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId));
  for (const sp of mine) {
    const others = await db.select({ u: schema.member.userId }).from(schema.member).where(and(eq(schema.member.organizationId, sp.id), ne(schema.member.userId, userId)));
    if (sp.kind === "personal" || others.length === 0) {
      urls.push(...(await purgeSpaceData(sp.id)));
      await dropSpaceRows(sp.id);
    }
  }
  // Their own chats and memory anywhere (shared spaces keep their items).
  const convs = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.userId, userId));
  const convIds = convs.map((c) => c.id);
  await db.batch([
    ...(convIds.length ? [db.delete(schema.conversationMessages).where(inArray(schema.conversationMessages.conversationId, convIds)), db.delete(schema.conversations).where(inArray(schema.conversations.id, convIds))] : []),
    db.delete(schema.memories).where(eq(schema.memories.userId, userId)),
    db.delete(schema.userPref).where(eq(schema.userPref.userId, userId)),
    db.delete(schema.aiUsage).where(eq(schema.aiUsage.userId, userId)),
    // R17 G1: their presence rows and activity counts.
    db.delete(schema.presence).where(eq(schema.presence.userId, userId)),
    db.delete(schema.activity).where(eq(schema.activity.userId, userId)),
    db.delete(schema.securityEvent).where(eq(schema.securityEvent.userId, userId)),
    db.delete(schema.recoveryCode).where(eq(schema.recoveryCode.userId, userId)),
    db.update(schema.reports).set({ userId: null }).where(eq(schema.reports.userId, userId)),
    db.delete(schema.member).where(eq(schema.member.userId, userId)),
    db.delete(schema.passkey).where(eq(schema.passkey.userId, userId)),
    db.delete(schema.account).where(eq(schema.account.userId, userId)),
    db.delete(schema.session).where(eq(schema.session.userId, userId)),
    db.delete(schema.user).where(eq(schema.user.id, userId)),
  ] as never);
  return [...new Set(urls)];
}

/** "Download my data": every space this person owns (its full backup) + their own chats and memory. Nothing else. */
export async function exportMyData(userId: string) {
  const [u] = await db.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  const owned = await db
    .select({ id: schema.space.id, name: schema.space.name, kind: schema.space.kind })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), eq(schema.member.role, "owner"), sql`${schema.space.deletedAt} IS NULL`));
  const spaces = [];
  for (const sp of owned) spaces.push({ id: sp.id, name: sp.name, kind: sp.kind, ...(await buildBackup(new Scoped({ spaceId: sp.id, userId }))) });
  const convs = await db.select().from(schema.conversations).where(eq(schema.conversations.userId, userId));
  const msgs = convs.length ? await db.select().from(schema.conversationMessages).where(inArray(schema.conversationMessages.conversationId, convs.map((c) => c.id))) : [];
  const memories = await db.select().from(schema.memories).where(eq(schema.memories.userId, userId));
  return { exportedAt: Date.now(), user: u ?? null, spaces, chats: convs.map((c) => ({ ...c, messages: msgs.filter((m) => m.conversationId === c.id) })), memories };
}
