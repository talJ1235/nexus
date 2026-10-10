import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import type { SpaceRole } from "@/db/auth-schema";
import { randomToken, sha256 } from "@/lib/auth/crypto";

// Spaces (R15 A4/B1/C): every user has exactly one personal space, plus the shared spaces they own or joined.

export type Membership = { spaceId: string; role: SpaceRole; name: string; kind: "personal" | "shared"; color: string; icon: string; currency: string; photo: string | null; createdAt: Date };

export function firstName(name: string | null | undefined, email: string) {
  const n = (name ?? "").trim().split(/\s+/)[0];
  return (n || email.split("@")[0] || "Me").slice(0, 40);
}

/** Idempotent: returns the user's personal space, creating it (and the owner membership) if missing. */
export async function ensurePersonalSpace(userId: string, displayName: string) {
  const existing = await personalSpaceId(userId);
  if (existing) return existing;
  const id = nanoid();
  await db.batch([
    db.insert(schema.space).values({ id, name: displayName, slug: `p-${id}`, kind: "personal", currency: "ILS", color: "plum", icon: "user", createdBy: userId, createdAt: new Date() }),
    db.insert(schema.member).values({ id: nanoid(), organizationId: id, userId, role: "owner", createdAt: new Date() }),
  ]);
  return id;
}

export async function personalSpaceId(userId: string) {
  const [row] = await db
    .select({ id: schema.space.id })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), eq(schema.space.kind, "personal"), eq(schema.space.createdBy, userId), isNull(schema.space.deletedAt)))
    .orderBy(asc(schema.space.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  const rows = await db
    .select({
      spaceId: schema.space.id,
      role: schema.member.role,
      name: schema.space.name,
      kind: schema.space.kind,
      color: schema.space.color,
      icon: schema.space.icon,
      currency: schema.space.currency,
      // R16 D5: the space photo (Better Auth's `logo` column, unused before).
      photo: schema.space.logo,
      createdAt: schema.space.createdAt,
    })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), isNull(schema.space.deletedAt)))
    .orderBy(asc(schema.space.createdAt));
  // Personal first.
  return (rows as Membership[]).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "personal" ? -1 : 1));
}

export async function addMember(spaceId: string, userId: string, role: SpaceRole) {
  await db
    .insert(schema.member)
    .values({ id: nanoid(), organizationId: spaceId, userId, role, createdAt: new Date() })
    .onConflictDoNothing();
}

// ---- Part C: shared spaces, people, invite links (R15 C1–C3) ----

export const SPACE_COLORS = ["green", "blue", "violet", "amber", "rose", "slate"] as const;
export type SpaceColor = (typeof SPACE_COLORS)[number];
export const SPACE_CURRENCIES = ["ILS", "USD", "EUR"] as const;
export const INVITE_DAYS = 7;
export const INVITE_MAX_USES = 5;
export const DELETE_UNDO_MS = 7 * 86_400_000;

export async function createSharedSpace(userId: string, v: { name: string; color: SpaceColor; currency: string; icon?: string }) {
  const id = nanoid();
  await db.batch([
    db.insert(schema.space).values({ id, name: v.name, slug: `s-${id}`, kind: "shared", currency: v.currency, color: v.color, icon: v.icon ?? "home", createdBy: userId, createdAt: new Date() }),
    db.insert(schema.member).values({ id: nanoid(), organizationId: id, userId, role: "owner", createdAt: new Date() }),
  ]);
  return id;
}

export async function updateSpace(spaceId: string, v: Partial<{ name: string; color: SpaceColor; currency: string; icon: string; logo: string | null }>) {
  await db.update(schema.space).set(v).where(and(eq(schema.space.id, spaceId), isNull(schema.space.deletedAt)));
}

export type SpacePerson = { id: string; name: string; email: string; image: string | null; role: SpaceRole; joinedAt: number; lastActive: number | null };

/** Timestamps from Better Auth columns (Date) or raw SQL (seconds or ms) → ms. */
function toMs(v: number | Date | string) {
  const n = typeof v === "string" ? Date.parse(v) : +v;
  return n < 1e12 ? n * 1000 : n;
}

/** People of one space, owners first; last active = their newest session on any device. */
export async function spaceMembers(spaceId: string): Promise<SpacePerson[]> {
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      role: schema.member.role,
      joinedAt: schema.member.createdAt,
      lastActive: sql<number | null>`(select max(s.updated_at) from session s where s.user_id = ${schema.user.id})`,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    // R17 E4: an account waiting to be deleted is hidden from everyone at once.
    .where(and(eq(schema.member.organizationId, spaceId), isNull(schema.user.deletionRequestedAt)))
    .orderBy(asc(schema.member.createdAt));
  const rank: Record<string, number> = { owner: 0, member: 1, viewer: 2 };
  return rows
    .map((r) => ({ ...r, role: r.role as SpaceRole, joinedAt: toMs(r.joinedAt), lastActive: r.lastActive == null ? null : toMs(r.lastActive) }))
    .sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3));
}

export type Face = { id: string; name: string; image?: string | null };

/** Member counts + up to 3 faces per space (the switcher's facepiles). */
export async function spaceFaces(spaceIds: string[]) {
  const out = new Map<string, { count: number; faces: Face[] }>();
  if (!spaceIds.length) return out;
  const rows = await db
    .select({ spaceId: schema.member.organizationId, id: schema.user.id, name: schema.user.name, email: schema.user.email, image: schema.user.image })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(inArray(schema.member.organizationId, spaceIds), isNull(schema.user.deletionRequestedAt)))
    .orderBy(asc(schema.member.createdAt));
  for (const r of rows) {
    const e = out.get(r.spaceId) ?? { count: 0, faces: [] };
    e.count++;
    if (e.faces.length < 3) e.faces.push({ id: r.id, name: r.name || r.email.split("@")[0], image: r.image });
    out.set(r.spaceId, e);
  }
  return out;
}

export async function membershipOf(spaceId: string, userId: string) {
  const [m] = await db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, spaceId), eq(schema.member.userId, userId)))
    .limit(1);
  return m ? { id: m.id, role: m.role as SpaceRole } : null;
}

async function ownerCount(spaceId: string) {
  const [r] = await db.select({ n: count() }).from(schema.member).where(and(eq(schema.member.organizationId, spaceId), eq(schema.member.role, "owner")));
  return r?.n ?? 0;
}

/** The owner changes someone else's role (member ↔ viewer). Owners are made by transfer only. */
export async function setMemberRole(spaceId: string, userId: string, role: "member" | "viewer") {
  const m = await membershipOf(spaceId, userId);
  if (!m || m.role === "owner") return false;
  await db.update(schema.member).set({ role }).where(eq(schema.member.id, m.id));
  return true;
}

export async function removeMember(spaceId: string, userId: string) {
  const m = await membershipOf(spaceId, userId);
  if (!m || m.role === "owner") return false;
  await db.delete(schema.member).where(eq(schema.member.id, m.id));
  return true;
}

/** Leave a shared space; the last owner can't (transfer first); a personal space can't be left. */
export async function leaveSpace(spaceId: string, userId: string): Promise<"ok" | "last_owner" | "personal" | "not_member"> {
  const [sp] = await db.select({ kind: schema.space.kind }).from(schema.space).where(eq(schema.space.id, spaceId)).limit(1);
  if (!sp) return "not_member";
  if (sp.kind === "personal") return "personal";
  const m = await membershipOf(spaceId, userId);
  if (!m) return "not_member";
  if (m.role === "owner" && (await ownerCount(spaceId)) <= 1) return "last_owner";
  await db.delete(schema.member).where(eq(schema.member.id, m.id));
  return "ok";
}

/** The owner hands the space to another member (who becomes owner); the old owner stays on as a member. */
export async function transferOwnership(spaceId: string, fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) return false;
  const [from, to] = await Promise.all([membershipOf(spaceId, fromUserId), membershipOf(spaceId, toUserId)]);
  if (from?.role !== "owner" || !to) return false;
  await db.batch([db.update(schema.member).set({ role: "owner" }).where(eq(schema.member.id, to.id)), db.update(schema.member).set({ role: "member" }).where(eq(schema.member.id, from.id))]);
  return true;
}

/** Soft delete (shared spaces only); purged by the cron once DELETE_UNDO_MS has passed. */
export async function softDeleteSpace(spaceId: string) {
  const rows = await db
    .update(schema.space)
    .set({ deletedAt: Date.now() })
    .where(and(eq(schema.space.id, spaceId), eq(schema.space.kind, "shared"), isNull(schema.space.deletedAt)))
    .returning({ id: schema.space.id });
  return rows.length === 1;
}

/** Spaces this user owns that are deleted but still restorable (the switcher's "Restore" rows). */
export async function deletedSpacesOwnedBy(userId: string) {
  const rows = await db
    .select({ id: schema.space.id, name: schema.space.name, color: schema.space.color, deletedAt: schema.space.deletedAt })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), eq(schema.member.role, "owner"), isNotNull(schema.space.deletedAt), gt(schema.space.deletedAt, Date.now() - DELETE_UNDO_MS)));
  return rows.map((r) => ({ ...r, deletedAt: r.deletedAt as number }));
}

export async function restoreSpace(spaceId: string, userId: string) {
  const m = await membershipOf(spaceId, userId);
  if (m?.role !== "owner") return false;
  const rows = await db
    .update(schema.space)
    .set({ deletedAt: null })
    .where(and(eq(schema.space.id, spaceId), isNotNull(schema.space.deletedAt), gt(schema.space.deletedAt, Date.now() - DELETE_UNDO_MS)))
    .returning({ id: schema.space.id });
  return rows.length === 1;
}

/** Spaces whose undo window is over (cron purge). */
export async function spacesToPurge(now = Date.now()) {
  return db.select({ id: schema.space.id }).from(schema.space).where(and(isNotNull(schema.space.deletedAt), lt(schema.space.deletedAt, now - DELETE_UNDO_MS)));
}

/** Last step of a purge: invites, prefs, memberships and the space row (data rows go first: db-scoped/purge). */
export async function dropSpaceRows(spaceId: string) {
  await db.batch([
    db.delete(schema.spaceInvite).where(eq(schema.spaceInvite.spaceId, spaceId)),
    db.delete(schema.spacePref).where(eq(schema.spacePref.spaceId, spaceId)),
    db.delete(schema.member).where(eq(schema.member.organizationId, spaceId)),
    db.delete(schema.space).where(eq(schema.space.id, spaceId)),
  ]);
}

// ---- invite links /join/<token>: 32 random bytes stored hashed; member or viewer; 7 days; 5 uses; revocable ----

export async function createSpaceInvite(spaceId: string, createdBy: string, role: "member" | "viewer") {
  const token = randomToken(32);
  const id = nanoid();
  await db.insert(schema.spaceInvite).values({ id, tokenHash: sha256(token), spaceId, role, maxUses: INVITE_MAX_USES, uses: 0, expiresAt: Date.now() + INVITE_DAYS * 86_400_000, createdBy, createdAt: Date.now() });
  return { id, token };
}

export type SpaceInviteRow = { id: string; role: "member" | "viewer"; uses: number; maxUses: number; expiresAt: number; revokedAt: number | null; createdAt: number; createdBy: string; byName: string };

export async function listSpaceInvites(spaceId: string): Promise<SpaceInviteRow[]> {
  const rows = await db
    .select({ inv: schema.spaceInvite, byName: schema.user.name })
    .from(schema.spaceInvite)
    .leftJoin(schema.user, eq(schema.user.id, schema.spaceInvite.createdBy))
    .where(eq(schema.spaceInvite.spaceId, spaceId))
    .orderBy(desc(schema.spaceInvite.createdAt))
    .limit(30);
  return rows.map(({ inv, byName }) => ({ id: inv.id, role: inv.role, uses: inv.uses, maxUses: inv.maxUses, expiresAt: inv.expiresAt, revokedAt: inv.revokedAt, createdAt: inv.createdAt, createdBy: inv.createdBy, byName: byName ?? "" }));
}

export async function revokeSpaceInvite(spaceId: string, id: string) {
  const rows = await db
    .update(schema.spaceInvite)
    .set({ revokedAt: Date.now() })
    .where(and(eq(schema.spaceInvite.id, id), eq(schema.spaceInvite.spaceId, spaceId), isNull(schema.spaceInvite.revokedAt)))
    .returning({ id: schema.spaceInvite.id });
  return rows.length === 1;
}

export type InvitePreview =
  | { ok: true; spaceId: string; name: string; color: string; icon: string; photo: string | null; role: "member" | "viewer"; expiresAt: number; inviter: string | null; inviterId: string; count: number; faces: Face[] }
  | { ok: false; problem: "invalid" | "expired" | "used_up" | "revoked"; inviter: string | null };

/** What /join/<token> shows (no secrets): the space, who invited, people, the role, expiry — or why it's dead. */
export async function invitePreview(token: string): Promise<InvitePreview> {
  if (!/^[\w-]{20,80}$/.test(token)) return { ok: false, problem: "invalid", inviter: null };
  const [row] = await db
    .select({ inv: schema.spaceInvite, sp: schema.space, inviter: schema.user.name })
    .from(schema.spaceInvite)
    .innerJoin(schema.space, eq(schema.space.id, schema.spaceInvite.spaceId))
    .leftJoin(schema.user, eq(schema.user.id, schema.spaceInvite.createdBy))
    .where(eq(schema.spaceInvite.tokenHash, sha256(token)))
    .limit(1);
  if (!row) return { ok: false, problem: "invalid", inviter: null };
  const inviter = row.inviter || null;
  const problem = row.sp.deletedAt || row.inv.revokedAt ? "revoked" : row.inv.expiresAt <= Date.now() ? "expired" : row.inv.uses >= row.inv.maxUses ? "used_up" : null;
  if (problem) return { ok: false, problem, inviter };
  const f = (await spaceFaces([row.sp.id])).get(row.sp.id) ?? { count: 0, faces: [] };
  return { ok: true, spaceId: row.sp.id, name: row.sp.name, color: row.sp.color, icon: row.sp.icon, photo: row.sp.logo, role: row.inv.role, expiresAt: row.inv.expiresAt, inviter, inviterId: row.inv.createdBy, count: f.count, faces: f.faces };
}

/** The switcher's space cards + the current shared space's people (page load). */
export async function spaceShell(memberships: Membership[], current: { id: string; kind: "personal" | "shared" }) {
  const [faces, people] = await Promise.all([
    spaceFaces(memberships.filter((m) => m.kind === "shared").map((m) => m.spaceId)),
    current.kind === "shared" ? spaceMembers(current.id) : Promise.resolve([]),
  ]);
  const spaces = memberships.map((m) => {
    const f = faces.get(m.spaceId);
    return { id: m.spaceId, name: m.name, kind: m.kind, color: m.color, icon: m.icon, photo: m.photo, role: m.role, count: f?.count ?? 1, faces: f?.faces ?? [] };
  });
  return { spaces, people: people.map((p) => ({ id: p.id, name: p.name || p.email.split("@")[0], image: p.image })) };
}
