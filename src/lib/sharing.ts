import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

/** Called when a collection is deleted. */
export async function dropCollectionSharing(collectionId: string) {
  const memberIds = (await db.select({ m: schema.grants.memberId }).from(schema.grants).where(eq(schema.grants.collectionId, collectionId))).map((r) => r.m);
  await db.delete(schema.grants).where(eq(schema.grants.collectionId, collectionId));
  await db.update(schema.invites).set({ revokedAt: Date.now() }).where(eq(schema.invites.collectionId, collectionId));
  if (memberIds.length) {
    const still = new Set((await db.select({ m: schema.grants.memberId }).from(schema.grants).where(inArray(schema.grants.memberId, memberIds))).map((r) => r.m));
    const orphaned = memberIds.filter((m) => !still.has(m));
    if (orphaned.length) await db.update(schema.members).set({ revokedAt: Date.now() }).where(inArray(schema.members.id, orphaned));
  }
}
