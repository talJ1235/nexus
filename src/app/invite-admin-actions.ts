"use server";

import { z } from "zod";
import { adminInvitesData, inviteWaitlisted } from "@/lib/auth/invite-admin";
import { createSignupCode, revokeSignupCode } from "@/lib/auth/invites";
import { isAdmin, requireCtx } from "@/lib/ctx";

// Settings → Invite codes (R15 A3): ADMIN_EMAIL's user only. Codes are shown once at creation (only a hash is kept).

async function admin() {
  const ctx = await requireCtx("view");
  if (!isAdmin(ctx)) throw new Error("forbidden");
  return ctx;
}

export async function getInviteAdmin() {
  await admin();
  return adminInvitesData();
}
export type InviteAdminState = Awaited<ReturnType<typeof getInviteAdmin>>;

export async function createInviteCode(raw: { note?: string; maxUses?: number; days?: number }) {
  const ctx = await admin();
  const p = z.object({ note: z.string().max(80).optional(), maxUses: z.number().int().min(1).max(50).optional(), days: z.number().int().min(1).max(90).optional() }).strict().parse(raw);
  return createSignupCode(ctx.user.id, p);
}

export async function revokeInviteCode(id: string) {
  await admin();
  await revokeSignupCode(z.string().min(1).max(64).parse(id));
}

/** One-tap "Invite" from the waitlist: a 1-use code with the person's email as its note; marks them invited. */
export async function inviteFromWaitlist(email: string) {
  const ctx = await admin();
  const e = z.string().email().max(254).parse(email);
  const made = await createSignupCode(ctx.user.id, { note: e, maxUses: 1 });
  await inviteWaitlisted(e);
  return made;
}
