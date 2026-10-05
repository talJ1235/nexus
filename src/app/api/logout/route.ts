import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";
import { forgetSessions } from "@/lib/auth/session";

// Sign out this device: the DB session is deleted (Better Auth) and the cookie cleared (authz allow-list: auth).
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  try {
    const r = await auth.api.signOut({ headers: req.headers, returnHeaders: true });
    for (const c of r.headers.getSetCookie()) res.headers.append("set-cookie", c);
  } catch {
    /* no session — still go to /login */
  }
  forgetSessions();
  return res;
}
