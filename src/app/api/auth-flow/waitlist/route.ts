import { z } from "zod";
import { ipHash } from "@/lib/auth/crypto";
import { requestIp } from "@/lib/auth/events";
import { addToWaitlist, pendingSignupEmail } from "@/lib/auth/invites";
import { HOUR, hitLimit } from "@/lib/auth/limits";

// R15 A3 (pre-sign-in, authz allow-list): "Add me to the waitlist" after Google said who you are but no invite was
// found. The email comes from the server-side pending ref (never from the form). Rate-limited; Turnstile when set.
export async function POST(req: Request) {
  const ip = requestIp(req.headers) ?? "local";
  if (!(await hitLimit(`waitlist:${ip}`, 5, HOUR))) return Response.json({ ok: false, error: "limit" }, { status: 429 });
  const body = z.object({ ref: z.string().max(60), turnstile: z.string().max(4000).optional() }).strict().safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false }, { status: 400 });
  if (process.env.TURNSTILE_SECRET_KEY) {
    const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: body.data.turnstile ?? "", remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => r.json() as Promise<{ success?: boolean }>)
      .catch(() => ({ success: false }));
    if (!v.success) return Response.json({ ok: false, error: "captcha" }, { status: 400 });
  }
  const email = await pendingSignupEmail(body.data.ref);
  if (email) await addToWaitlist(email, ipHash(ip));
  // Same answer either way (an expired ref just isn't listed).
  return Response.json({ ok: true });
}
