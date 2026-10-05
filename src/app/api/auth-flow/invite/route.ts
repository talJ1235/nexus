import { z } from "zod";
import { requestIp } from "@/lib/auth/events";
import { checkSignupCode, INVITE_COOKIE, INVITE_COOKIE_TTL_MS, inviteCookieValue } from "@/lib/auth/invites";
import { hitLimit, MINUTE } from "@/lib/auth/limits";
import { normalizeInviteCode } from "@/lib/auth/crypto";

// R15 A3 (pre-sign-in, authz allow-list): check a typed invite code and keep it through the Google redirect in a
// short-lived, signed, HttpOnly cookie. The account is only created if it is still valid at the callback.
export async function POST(req: Request) {
  const ip = requestIp(req.headers) ?? "local";
  if (!(await hitLimit(`invite-check:${ip}`, 10, MINUTE))) return Response.json({ ok: false, error: "limit" }, { status: 429 });
  const body = z.object({ code: z.string().max(20) }).strict().safeParse(await req.json().catch(() => null));
  const code = body.success ? normalizeInviteCode(body.data.code) : null;
  if (!code) return Response.json({ ok: false, error: "badCode" });
  const check = await checkSignupCode(code);
  if (!check.ok) {
    const error = { invalid: "badCode", expired: "expired", used_up: "usedUp", revoked: "revoked" }[check.problem];
    return Response.json({ ok: false, error });
  }
  const secure = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${INVITE_COOKIE}=${inviteCookieValue({ code })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${INVITE_COOKIE_TTL_MS / 1000}${secure ? "; Secure" : ""}`);
  return res;
}
