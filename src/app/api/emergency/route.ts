import { NextResponse, type NextRequest } from "next/server";
import { emergencySignIn } from "@/lib/auth/server";

// R17 E1 — admin-only emergency sign-in (SECURITY.md §2): POST JSON { token, email } with ADMIN_EMERGENCY_TOKEN and an
// address in ADMIN_EMAILS / ADMIN_EMAIL. 404 while the env var isn't set; 3 attempts/h/IP; logged. Never linked from the UI.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: unknown; email?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.slice(0, 400) : "";
  const email = typeof body?.email === "string" ? body.email.slice(0, 254) : "";
  try {
    const r = await emergencySignIn({ body: { token, email }, headers: req.headers, returnHeaders: true });
    const res = NextResponse.json({ ok: true });
    for (const c of r.headers.getSetCookie()) res.headers.append("set-cookie", c);
    return res;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return NextResponse.json({ ok: false }, { status: status === 404 ? 404 : status === 429 ? 429 : 401 });
  }
}
