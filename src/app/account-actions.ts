"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { isFresh } from "@/lib/auth/security";
import { logSecurityEvent } from "@/lib/auth/events";
import { requireCtx } from "@/lib/ctx";
import { markAccountDeletion, restoreAccount, soleOwnerBlocks } from "@/lib/db-scoped/account";

// R17 E4 — Settings → Account → Delete account (and the restore screen). Personal: any role in the current space.

export type DeleteResult = { ok: true } | { stepUp: true } | { blocked: { id: string; name: string }[] } | { mismatch: true };

/** What would stop it (shared spaces this person alone owns, with other members) — for the flow's first screen. */
export async function deletionBlocks(): Promise<{ id: string; name: string }[]> {
  const ctx = await requireCtx("view");
  return soleOwnerBlocks(ctx.user.id);
}

/** Typed confirmation = the account's email. Step-up (signed in within the last 10 minutes) like every destructive
 *  account change. Then: hidden at once, every session ends (this one too), 7 days to undo. */
export async function requestAccountDeletion(typed: string): Promise<DeleteResult> {
  const ctx = await requireCtx("view");
  if (z.string().max(254).parse(typed).trim().toLowerCase() !== ctx.user.email.toLowerCase()) return { mismatch: true };
  if (!isFresh(ctx.session.createdAt)) return { stepUp: true };
  const blocked = await soleOwnerBlocks(ctx.user.id);
  if (blocked.length) return { blocked };
  await logSecurityEvent(ctx.user.id, "account_deletion_requested", null, await headers());
  await markAccountDeletion(ctx.user.id);
  return { ok: true };
}

/** "Restore your account?" → yes (within the 7 days). */
export async function restoreMyAccount(): Promise<boolean> {
  const ctx = await requireCtx("view");
  const ok = await restoreAccount(ctx.user.id);
  if (ok) await logSecurityEvent(ctx.user.id, "account_restored", null, await headers());
  return ok;
}
