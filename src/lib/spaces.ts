import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import type { SpaceRole } from "@/db/auth-schema";

// Spaces (R15 A4/B1): every user has exactly one personal space; shared spaces come in Part C.

export type Membership = { spaceId: string; role: SpaceRole; name: string; kind: "personal" | "shared"; color: string; icon: string; currency: string };

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
