import { z } from "zod";
import { requestIp } from "@/lib/auth/events";
import { checkJoinToken, INVITE_COOKIE, INVITE_COOKIE_TTL_MS, inviteCookieValue } from "@/lib/auth/invites";
import { hitLimit, MINUTE } from "@/lib/auth/limits";

// R15 C2 (pre-sign-in, authz allow-list): "Continue with Google to join" — keep the /join/<token> link through the
// Google redirect in the short-lived, signed, HttpOnly invite cookie. It also counts as the sign-up invite; the
// account and the membership are only created if the link is still valid at the callback (lib/auth/server.ts).
export async function POST(req: Request) {
  const ip = requestIp(req.headers) ?? "local";
  if (!(await hitLimit(`join-check:${ip}`, 10, MINUTE))) return Response.json({ ok: false, error: "limit" }, { status: 429 });
  const body = z.object({ token: z.string().max(100) }).strict().safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, error: "invalid" });
  const check = await checkJoinToken(body.data.token);
  if (!check.ok) return Response.json({ ok: false, error: check.problem });
  const secure = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${INVITE_COOKIE}=${inviteCookieValue({ join: body.data.token })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${INVITE_COOKIE_TTL_MS / 1000}${secure ? "; Secure" : ""}`);
  return res;
}
