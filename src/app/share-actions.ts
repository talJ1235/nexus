"use server";

import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
import { sha256Hex } from "@/lib/guest-session";

const role = z.enum(["viewer", "editor"]);

export type SharingState = {
  invites: { id: string; role: "viewer" | "editor"; createdAt: number }[];
  members: { id: string; name: string; role: "viewer" | "editor"; lastSeenAt: number | null; createdAt: number }[];
};

export async function getSharing(collectionId: string): Promise<SharingState> {
  await assertOwner();
  const invites = await db
    .select({ id: schema.invites.id, role: schema.invites.role, createdAt: schema.invites.createdAt })
    .from(schema.invites)
    .where(and(eq(schema.invites.collectionId, collectionId), isNull(schema.invites.revokedAt)));
  const rows = await db
    .select({ id: schema.members.id, name: schema.members.name, lastSeenAt: schema.members.lastSeenAt, createdAt: schema.members.createdAt, role: schema.grants.role })
    .from(schema.grants)
    .innerJoin(schema.members, eq(schema.members.id, schema.grants.memberId))
    .where(and(eq(schema.grants.collectionId, collectionId), isNull(schema.members.revokedAt)));
  return { invites, members: rows };
}

/** New invite link. The raw token is returned once; only its hash is stored. */
export async function createInvite(collectionId: string, r: "viewer" | "editor", origin: string): Promise<{ url: string; state: SharingState }> {
  await assertOwner();
  role.parse(r);
  const c = await db.query.collections.findFirst({ where: eq(schema.collections.id, collectionId) });
  if (!c) throw new Error("not_found");
  const token = nanoid(32);
  await db.insert(schema.invites).values({ id: nanoid(10), tokenHash: await sha256Hex(token), collectionId, role: r, createdAt: Date.now() });
  return { url: `${z.string().url().parse(origin)}/i/${token}`, state: await getSharing(collectionId) };
}

export async function revokeInvite(inviteId: string, collectionId: string) {
  await assertOwner();
  await db.update(schema.invites).set({ revokedAt: Date.now() }).where(and(eq(schema.invites.id, inviteId), eq(schema.invites.collectionId, collectionId)));
  return getSharing(collectionId);
}

export async function setMemberRole(memberId: string, collectionId: string, r: "viewer" | "editor") {
  await assertOwner();
  role.parse(r);
  await db.update(schema.grants).set({ role: r }).where(and(eq(schema.grants.memberId, memberId), eq(schema.grants.collectionId, collectionId)));
  return getSharing(collectionId);
}

/** Remove a person's access to this collection; if nothing else is shared with them, end their session. */
export async function removeMember(memberId: string, collectionId: string) {
  await assertOwner();
  await db.delete(schema.grants).where(and(eq(schema.grants.memberId, memberId), eq(schema.grants.collectionId, collectionId)));
  const left = await db.select({ id: schema.grants.id }).from(schema.grants).where(eq(schema.grants.memberId, memberId)).limit(1);
  if (!left.length) await db.update(schema.members).set({ revokedAt: Date.now() }).where(eq(schema.members.id, memberId));
  return getSharing(collectionId);
}
