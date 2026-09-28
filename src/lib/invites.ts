import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sha256Hex } from "./guest-session";

export async function findInvite(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const inv = await db.query.invites.findFirst({ where: and(eq(schema.invites.tokenHash, await sha256Hex(token)), isNull(schema.invites.revokedAt)) });
  if (!inv) return null;
  const collection = await db.query.collections.findFirst({ where: eq(schema.collections.id, inv.collectionId) });
  return collection ? { invite: inv, collection } : null;
}
