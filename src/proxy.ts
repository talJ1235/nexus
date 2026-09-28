import { NextResponse, type NextRequest } from "next/server";
import { GUEST_COOKIE, verifyGuestValue } from "@/lib/guest-session";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

// Authenticated inside the route/page instead: /api/ext/* (extension token), /api/cron/* (CRON_SECRET),
// /i/* + /api/invite/* (invite token), /s/* (public read-only share token).
const PUBLIC_PREFIXES = ["/login", "/api/login", "/s/", "/i/", "/api/invite/", "/api/share/", "/api/ext/", "/api/cron/", "/manifest.webmanifest", "/sw.js", "/nexus-extension.zip"];

const isGuestPath = (p: string) => p === "/g" || p.startsWith("/g/");

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const owner = await verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (owner) {
    // The owner's app is "/"; the guest view is for people the owner shared with.
    if (isGuestPath(pathname)) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  // Shared-access guests: only the guest app (and its server actions, which re-check permissions).
  const guest = await verifyGuestValue(request.cookies.get(GUEST_COOKIE)?.value);
  if (guest) {
    if (isGuestPath(pathname)) return NextResponse.next();
    if (pathname === "/" || pathname === "/add") return NextResponse.redirect(new URL("/g", request.url));
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/" && !isGuestPath(pathname)) url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|jpg|jpeg|webp|ico|woff2?)$).*)"],
};
