import { NextResponse, type NextRequest } from "next/server";
import { testIdpEnabled } from "@/lib/auth/config";
import { getSessionUser } from "@/lib/auth/session";

// R15 A1: everything needs a valid DB session (checked here, cached ≤ 60 s), except these public paths — each of
// them authenticates inside the route/page instead:
//   /login, /join/* (sign-in and invite screens) · /api/auth/* (Better Auth, allow-listed in lib/auth/server.ts)
//   /api/login (admin password fallback) · /s/* (public read-only list token) · /api/cal/* (calendar feed token)
//   /api/cron/* (CRON_SECRET) · /api/reports/export (REPORTS_TOKEN) · /privacy, /terms (static)
//   /g, /i/*, /api/invite/*, /api/ext/*, /api/telegram (retired: notice pages / 410) · /api/csp-report (counts only)
const PUBLIC_PREFIXES = [
  "/login",
  "/join/",
  "/api/auth/",
  "/api/login",
  "/s/",
  "/api/cal/",
  "/api/cron/",
  "/api/reports/export",
  "/privacy",
  "/terms",
  "/g",
  "/i/",
  "/api/invite/",
  "/api/ext/",
  "/api/telegram",
  "/api/csp-report",
  "/manifest.webmanifest",
  "/sw.js",
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic =
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`) || (p.endsWith("/") && pathname === p.slice(0, -1))) ||
    (testIdpEnabled() && pathname.startsWith("/api/test-idp/"));
  if (isPublic) return NextResponse.next();

  if (await getSessionUser(request.headers)) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // scanic-ml/: the receipt camera's ML detector (public MIT model + WASM runtime, see scripts/copy-scanic-ml.mjs).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|scanic-ml/|.*\\.(?:png|svg|jpg|jpeg|webp|ico|woff2?)$).*)"],
};
