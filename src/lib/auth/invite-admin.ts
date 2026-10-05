import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt } from "./crypto";
import { listSignupCodes } from "./invites";

// The admin's view of sign-up codes + waitlist (counts and emails of people who asked — no space content).
export async function adminInvitesData() {
  const codes = await listSignupCodes();
  const userIds = [...new Set(codes.flatMap((c) => c.usedBy ?? []))];
  const users = userIds.length ? await db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email }).from(schema.user).where(inArray(schema.user.id, userIds)) : [];
  const waitlist = await db.select().from(schema.waitlist).orderBy(desc(schema.waitlist.createdAt)).limit(200);
  const now = Date.now();
  return {
    codes: codes.map((c) => ({
      id: c.id,
      hint: c.hint,
      code: decrypt(c.codeEnc),
      note: c.note,
      uses: c.uses,
      maxUses: c.maxUses,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
      status: c.revokedAt ? ("revoked" as const) : c.expiresAt <= now ? ("expired" as const) : c.uses >= c.maxUses ? ("used_up" as const) : ("active" as const),
      usedBy: (c.usedBy ?? []).map((id) => users.find((u) => u.id === id)).filter(Boolean).map((u) => ({ name: u!.name, email: u!.email })),
    })),
    waitlist: waitlist.map((w) => ({ email: w.email, createdAt: w.createdAt, invitedAt: w.invitedAt })),
  };
}

export async function inviteWaitlisted(email: string) {
  await db.update(schema.waitlist).set({ invitedAt: Date.now() }).where(eq(schema.waitlist.email, email.toLowerCase()));
}
