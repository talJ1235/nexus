import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { ipHash } from "./crypto";

export const SECURITY_EVENT_KINDS = [
  "sign_in",
  "new_device",
  "sign_out_device",
  "sign_out_others",
  "passkey_added",
  "passkey_removed",
  "recovery",
  "invite_used",
  "role_changed",
  "fallback_sign_in",
  "fallback_failed",
  "recovery_codes_created",
  "recovery_code_used",
] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export function requestIp(headers: Headers | null | undefined) {
  if (!headers) return null;
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** City only (Vercel's geo header); nothing finer is read or stored. */
export function requestCity(headers: Headers | null | undefined) {
  const c = headers?.get("x-vercel-ip-city");
  if (!c) return null;
  try {
    return decodeURIComponent(c).slice(0, 60);
  } catch {
    return null;
  }
}

export async function logSecurityEvent(userId: string, kind: SecurityEventKind, meta: Record<string, unknown> | null, headers?: Headers | null) {
  await db.insert(schema.securityEvent).values({
    id: nanoid(),
    userId,
    kind,
    meta: meta ?? null,
    ipHash: ipHash(requestIp(headers)),
    ua: headers?.get("user-agent")?.slice(0, 200) ?? null,
    createdAt: Date.now(),
  });
  // Housekeeping: older than 90 days goes (cheap, indexed).
  if (Math.random() < 0.05) await db.delete(schema.securityEvent).where(lt(schema.securityEvent.createdAt, Date.now() - KEEP_MS));
}

export async function listSecurityEvents(userId: string, limit = 50) {
  return db
    .select()
    .from(schema.securityEvent)
    .where(and(eq(schema.securityEvent.userId, userId)))
    .orderBy(desc(schema.securityEvent.createdAt))
    .limit(limit);
}
