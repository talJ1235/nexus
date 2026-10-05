import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/config";
import { fallbackSignIn } from "@/lib/auth/server";

// The admin password fallback (closed-circle mode only, R15 A1): the old form on /login?admin=1 posts here. It signs
// in as the ADMIN_EMAIL user and nobody else (lib/auth/server.ts nexus-fallback), 5/min/IP + 20/day, logged.
// Disabled automatically in full mode or when APP_PASSWORD is shorter than 20 characters (authz allow-list: auth).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "").slice(0, 200);
  const next = safeNext(String(form.get("next") ?? "/"));
  const fail = (code: string) => {
    const url = new URL("/login", req.url);
    url.searchParams.set("admin", "1");
    url.searchParams.set("error", code);
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  };
  // Same-origin form posts only.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin && origin !== process.env.BETTER_AUTH_URL) return fail("1");
  try {
    const r = await fallbackSignIn({ body: { password }, headers: req.headers, returnHeaders: true });
    const res = NextResponse.redirect(new URL(next, req.url), 303);
    for (const c of r.headers.getSetCookie()) res.headers.append("set-cookie", c);
    return res;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return fail(status === 429 ? "limit" : status === 404 ? "off" : "1");
  }
}
