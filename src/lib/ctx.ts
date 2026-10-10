import "server-only";
import { isListedAdmin } from "@/lib/auth/config";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { SpaceRole } from "@/db/auth-schema";
import type { SpaceInfo } from "@/lib/types";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { ensurePersonalSpace, firstName, listMemberships, type Membership } from "@/lib/spaces";

// R15 B3 — the one gate. Every server action and route starts with requireCtx(need) (test:authz-coverage enforces it).
// Current space = cookie nexus_space, validated against the user's memberships on every request; anything else
// (missing, forged, a space you left) falls back to your personal space.

export const SPACE_COOKIE = "nexus_space";
export type Need = "view" | "edit" | "owner";

export type Ctx = {
  user: SessionUser["user"];
  session: SessionUser["session"];
  space: { id: string; name: string; kind: "personal" | "shared"; currency: string; color: string; icon: string; photo: string | null; createdAt: number };
  role: SpaceRole;
  memberships: Membership[];
};

export class AccessError extends Error {
  constructor(readonly code: "unauthorized" | "forbidden" | "not_found") {
    super(code);
  }
}

export function allows(role: SpaceRole, need: Need) {
  if (need === "view") return role === "owner" || role === "member" || role === "viewer";
  if (need === "edit") return role === "owner" || role === "member";
  return role === "owner";
}

/** Pure resolution (unit-tested): which membership is current, given the cookie. */
export function pickSpace(memberships: Membership[], wanted: string | undefined | null) {
  return memberships.find((m) => m.spaceId === wanted) ?? memberships.find((m) => m.kind === "personal") ?? memberships[0] ?? null;
}

const resolve = cache(async (): Promise<Ctx | null> => {
  const su = await getSessionUser(await headers());
  if (!su) return null;
  let memberships = await listMemberships(su.user.id);
  if (!memberships.some((m) => m.kind === "personal")) {
    await ensurePersonalSpace(su.user.id, firstName(su.user.name, su.user.email));
    memberships = await listMemberships(su.user.id);
  }
  const m = pickSpace(memberships, (await cookies()).get(SPACE_COOKIE)?.value);
  if (!m) return null;
  return {
    user: su.user,
    session: su.session,
    space: { id: m.spaceId, name: m.name, kind: m.kind, currency: m.currency, color: m.color, icon: m.icon, photo: m.photo, createdAt: +m.createdAt },
    role: m.role,
    memberships,
  };
});

export async function requireCtx(need: Need): Promise<Ctx> {
  const ctx = await resolve();
  if (!ctx) throw new AccessError("unauthorized");
  if (!allows(ctx.role, need)) throw new AccessError("forbidden");
  return ctx;
}

/** For pages: null when signed out (the page redirects). */
export async function currentCtx() {
  return resolve();
}

/** Route handlers: the ctx, or the JSON error response to return. 404 for not-found, never 403 for foreign ids. */
export async function routeCtx(need: Need): Promise<Ctx | Response> {
  try {
    return await requireCtx(need);
  } catch (e) {
    return accessResponse(e);
  }
}

export function accessResponse(e: unknown) {
  if (e instanceof AccessError) {
    const status = e.code === "unauthorized" ? 401 : e.code === "forbidden" ? 403 : 404;
    return Response.json({ error: e.code }, { status });
  }
  throw e;
}

/** What the client needs about the current space (AppData.space). */
export function spaceInfo(ctx: Ctx): SpaceInfo {
  return { ...ctx.space, role: ctx.role };
}

export function meInfo(ctx: Ctx) {
  return { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, image: ctx.user.image, admin: isAdmin(ctx) };
}

/** R17 P8: the stored role, or an address in ADMIN_EMAILS / ADMIN_EMAIL (in at once, before the next sign-in stores it). */
export function isAdmin(ctx: Ctx) {
  return ctx.user.role === "admin" || isListedAdmin(ctx.user.email);
}
