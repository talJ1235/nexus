import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { GUEST_COOKIE, GUEST_MAX_AGE_S, createGuestValue, verifyGuestValue } from "@/lib/guest-session";
import { findInvite } from "@/lib/invites";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  const found = await findInvite(token);
  if (!found || !name) return NextResponse.redirect(new URL(`/i/${encodeURIComponent(token)}?error=1`, req.url), 303);
  const { invite } = found;

  // Same browser accepting another invite → same member, one more grant.
  const existingId = await verifyGuestValue(req.cookies.get(GUEST_COOKIE)?.value);
  let memberId = existingId
    ? (await db.query.members.findFirst({ where: and(eq(schema.members.id, existingId), isNull(schema.members.revokedAt)) }))?.id ?? null
    : null;
  if (!memberId) {
    memberId = nanoid(14);
    await db.insert(schema.members).values({ id: memberId, name, createdAt: Date.now(), lastSeenAt: Date.now() });
  } else {
    await db.update(schema.members).set({ name, lastSeenAt: Date.now() }).where(eq(schema.members.id, memberId));
  }

  const grant = await db.query.grants.findFirst({ where: and(eq(schema.grants.memberId, memberId), eq(schema.grants.collectionId, invite.collectionId)) });
  if (!grant) {
    await db.insert(schema.grants).values({ id: nanoid(12), memberId, collectionId: invite.collectionId, role: invite.role, createdAt: Date.now() });
  } else if (grant.role === "viewer" && invite.role === "editor") {
    await db.update(schema.grants).set({ role: "editor" }).where(eq(schema.grants.id, grant.id));
  }

  const res = NextResponse.redirect(new URL(`/g?c=${invite.collectionId}`, req.url), 303);
  res.cookies.set(GUEST_COOKIE, await createGuestValue(memberId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_MAX_AGE_S,
  });
  return res;
}
