"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { noteActivity } from "@/lib/activity";
import { ICON_KEYS } from "@/components/app/spaces/look";
import { logSecurityEvent } from "@/lib/auth/events";
import { checkJoinToken, consumeJoinToken } from "@/lib/auth/invites";
import { hitLimit, MINUTE } from "@/lib/auth/limits";
import { isFresh } from "@/lib/auth/security";
import { authMode } from "@/lib/auth/config";
import { requestHost } from "@/lib/auth/server";
import { AccessError, allows, isAdmin, requireCtx, SPACE_COOKIE, type Ctx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { moveCollection } from "@/lib/db-scoped/spaces";
import {
  addMember,
  createSharedSpace,
  createSpaceInvite,
  deletedSpacesOwnedBy,
  leaveSpace,
  listSpaceInvites,
  membershipOf,
  removeMember,
  restoreSpace,
  revokeSpaceInvite,
  setMemberRole,
  softDeleteSpace,
  SPACE_COLORS,
  SPACE_CURRENCIES,
  spaceMembers,
  transferOwnership,
  updateSpace,
} from "@/lib/spaces";

// R15 C1–C4: spaces, people, invite links. Every action starts with requireCtx; the space acted on is always the
// current one (from the validated cookie), except switching/joining/restoring, which check membership themselves.
// Removing a person, transferring ownership and deleting a space need a sign-in in the last 10 minutes (step-up).

const Id = z.string().min(1).max(64);
const Name = z.string().trim().min(1).max(40);
const Color = z.enum(SPACE_COLORS);
/** R16 D5: one of the identity board's icons (personal spaces keep "user"). */
const Icon = z.enum(ICON_KEYS as [string, ...string[]]);
const Currency = z.enum(SPACE_CURRENCIES);
const InviteRole = z.enum(["member", "viewer"]);

type StepUp = { ok: false; stepUp: true };
const stepUp = (ctx: Ctx): StepUp | null => (isFresh(ctx.session.createdAt) ? null : { ok: false, stepUp: true });

async function setSpaceCookie(spaceId: string) {
  (await cookies()).set(SPACE_COOKIE, spaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: 400 * 86_400,
  });
}

/** Switch the current space (remembered per device). Only to a space you belong to. */
export async function switchSpace(spaceId: string) {
  const ctx = await requireCtx("view");
  const id = Id.parse(spaceId);
  const m = ctx.memberships.find((x) => x.spaceId === id);
  if (!m) throw new AccessError("not_found");
  await setSpaceCookie(id);
  return { id, name: m.name };
}

export async function createSpace(input: { name: string; color: string; currency: string; icon?: string }) {
  const ctx = await requireCtx("view");
  const v = z.object({ name: Name, color: Color, currency: Currency, icon: Icon.optional() }).strict().parse(input);
  if (!(await hitLimit(`space-create:${ctx.user.id}`, 10, 60 * MINUTE))) throw new Error("limit");
  const id = await createSharedSpace(ctx.user.id, v);
  await setSpaceCookie(id);
  return { id };
}

export async function updateCurrentSpace(input: { name?: string; color?: string; currency?: string; icon?: string }) {
  const ctx = await requireCtx("owner");
  const v = z.object({ name: Name.optional(), color: Color.optional(), currency: Currency.optional(), icon: Icon.optional() }).strict().parse(input);
  await updateSpace(ctx.space.id, v);
}

/** Space settings: people, invite links (editors), restorable deleted spaces (owners). */
export async function getSpacePeople() {
  const ctx = await requireCtx("view");
  const [people, invites, deleted] = await Promise.all([
    spaceMembers(ctx.space.id),
    allows(ctx.role, "edit") ? listSpaceInvites(ctx.space.id) : Promise.resolve([]),
    deletedSpacesOwnedBy(ctx.user.id),
  ]);
  // Step-up link: the admin in closed-circle mode signs in again with the admin password (no Google yet).
  const full = authMode(requestHost(await headers())) === "full";
  return { me: ctx.user.id, role: ctx.role, kind: ctx.space.kind, people, invites, deleted, fresh: isFresh(ctx.session.createdAt), adminReauth: !full && isAdmin(ctx) };
}
export type SpacePeople = Awaited<ReturnType<typeof getSpacePeople>>;

export async function changeMemberRole(userId: string, role: string) {
  const ctx = await requireCtx("owner");
  const uid = Id.parse(userId);
  const r = InviteRole.parse(role);
  if (uid === ctx.user.id) throw new AccessError("forbidden");
  const ok = await setMemberRole(ctx.space.id, uid, r);
  if (!ok) throw new AccessError("not_found");
  await logSecurityEvent(uid, "role_changed", { space: ctx.space.id, role: r, by: ctx.user.id }, await headers());
  return { ok: true as const };
}

export async function removeSpaceMember(userId: string): Promise<{ ok: true } | StepUp> {
  const ctx = await requireCtx("owner");
  const uid = Id.parse(userId);
  if (uid === ctx.user.id) throw new AccessError("forbidden");
  const need = stepUp(ctx);
  if (need) return need;
  if (!(await removeMember(ctx.space.id, uid))) throw new AccessError("not_found");
  await logSecurityEvent(uid, "role_changed", { space: ctx.space.id, role: null, by: ctx.user.id }, await headers());
  return { ok: true };
}

export async function leaveCurrentSpace() {
  const ctx = await requireCtx("view");
  const r = await leaveSpace(ctx.space.id, ctx.user.id);
  if (r !== "ok") return { ok: false as const, reason: r };
  (await cookies()).delete(SPACE_COOKIE);
  return { ok: true as const };
}

export async function transferSpaceOwnership(userId: string): Promise<{ ok: true } | StepUp> {
  const ctx = await requireCtx("owner");
  const uid = Id.parse(userId);
  const need = stepUp(ctx);
  if (need) return need;
  if (!(await transferOwnership(ctx.space.id, ctx.user.id, uid))) throw new AccessError("not_found");
  const h = await headers();
  await logSecurityEvent(uid, "role_changed", { space: ctx.space.id, role: "owner", by: ctx.user.id }, h);
  await logSecurityEvent(ctx.user.id, "role_changed", { space: ctx.space.id, role: "member", by: ctx.user.id }, h);
  return { ok: true };
}

/** Owner, typed name, step-up. Soft delete: restorable for 7 days, then the cron purges rows and files. */
export async function deleteCurrentSpace(typedName: string): Promise<{ ok: true; id: string } | StepUp | { ok: false; reason: "name" | "personal" }> {
  const ctx = await requireCtx("owner");
  if (ctx.space.kind === "personal") return { ok: false, reason: "personal" };
  if (z.string().max(80).parse(typedName).trim() !== ctx.space.name.trim()) return { ok: false, reason: "name" };
  const need = stepUp(ctx);
  if (need) return need;
  if (!(await softDeleteSpace(ctx.space.id))) throw new AccessError("not_found");
  (await cookies()).delete(SPACE_COOKIE);
  return { ok: true, id: ctx.space.id };
}

export async function restoreDeletedSpace(spaceId: string) {
  const ctx = await requireCtx("view");
  const id = Id.parse(spaceId);
  if (!(await restoreSpace(id, ctx.user.id))) throw new AccessError("not_found");
  await setSpaceCookie(id);
  return { ok: true as const };
}

/** A new invite link for the current space (owners and members). The token is returned once, never stored. */
export async function createInviteLink(role: string) {
  const ctx = await requireCtx("edit");
  if (ctx.space.kind === "personal") throw new AccessError("forbidden");
  if (!(await hitLimit(`space-invite:${ctx.user.id}`, 20, 60 * MINUTE))) throw new Error("limit");
  const { id, token } = await createSpaceInvite(ctx.space.id, ctx.user.id, InviteRole.parse(role));
  return { id, token };
}

export async function revokeInviteLink(id: string) {
  const ctx = await requireCtx("edit");
  const iid = Id.parse(id);
  // Members may revoke the links they made; owners any link of the space.
  if (ctx.role !== "owner") {
    const mine = (await listSpaceInvites(ctx.space.id)).find((i) => i.id === iid);
    if (!mine || mine.createdBy !== ctx.user.id) throw new AccessError("not_found");
  }
  if (!(await revokeSpaceInvite(ctx.space.id, iid))) throw new AccessError("not_found");
  return { ok: true as const };
}

/** /join/<token> while signed in: become a member with the link's role (or just switch, if already in). */
export async function joinSpace(token: string): Promise<{ ok: true; spaceId: string; already: boolean } | { ok: false; problem: string }> {
  const ctx = await requireCtx("view");
  const tok = z.string().max(100).parse(token);
  if (!(await hitLimit(`join:${ctx.user.id}`, 20, 10 * MINUTE))) return { ok: false, problem: "limit" };
  const check = await checkJoinToken(tok);
  if (!check.ok || check.kind !== "join") return { ok: false, problem: check.ok ? "invalid" : check.problem };
  if (await membershipOf(check.spaceId, ctx.user.id)) {
    await setSpaceCookie(check.spaceId);
    return { ok: true, spaceId: check.spaceId, already: true };
  }
  const used = await consumeJoinToken(check.id);
  if (!used) return { ok: false, problem: "used_up" };
  await addMember(used.spaceId, ctx.user.id, used.role);
  await logSecurityEvent(ctx.user.id, "invite_used", { kind: "join", space: used.spaceId }, await headers());
  noteActivity({ userId: ctx.user.id, spaceId: used.spaceId }, "joined_space");
  await setSpaceCookie(used.spaceId);
  return { ok: true, spaceId: used.spaceId, already: false };
}

/** Move a list/project (and everything under it) to another space where you can edit. */
export async function moveCollectionToSpace(collectionId: string, spaceId: string) {
  const ctx = await requireCtx("edit");
  const target = ctx.memberships.find((m) => m.spaceId === Id.parse(spaceId));
  if (!target || target.spaceId === ctx.space.id || !allows(target.role, "edit")) throw new AccessError("not_found");
  const ids = await moveCollection(scoped(ctx), target.spaceId, Id.parse(collectionId));
  return { ok: true as const, moved: ids.length, from: ctx.space.id };
}

/** Undo of a move: run from the space the list went to, back to where it came from (role checked again). */
export async function moveCollectionBack(collectionId: string, toSpaceId: string, fromSpaceId: string) {
  const ctx = await requireCtx("view");
  const fromM = ctx.memberships.find((m) => m.spaceId === Id.parse(fromSpaceId));
  const toM = ctx.memberships.find((m) => m.spaceId === Id.parse(toSpaceId));
  if (!fromM || !toM || !allows(fromM.role, "edit") || !allows(toM.role, "edit")) throw new AccessError("not_found");
  await moveCollection(scoped({ space: { id: fromM.spaceId }, user: ctx.user }), toM.spaceId, Id.parse(collectionId));
  return { ok: true as const };
}
