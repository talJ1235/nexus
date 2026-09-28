import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

// /api/ext/* authenticates with the extension token and /api/cron/* with CRON_SECRET, inside the routes.
const PUBLIC_PREFIXES = ["/login", "/api/login", "/s/", "/api/share/", "/api/ext/", "/api/cron/", "/manifest.webmanifest", "/sw.js", "/nexus-extension.zip"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const ok = await verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|jpg|jpeg|webp|ico|woff2?)$).*)"],
};
