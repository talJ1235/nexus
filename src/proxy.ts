import { NextResponse, type NextRequest } from "next/server";
import { testIdpEnabled } from "@/lib/auth/config";
import { getSessionUser } from "@/lib/auth/session";

// R15 A1: everything needs a valid DB session (checked here, cached ≤ 60 s), except these public paths — each of
// them authenticates inside the route/page instead:
//   /login, /join/* (sign-in and invite screens) · /api/auth/* (Better Auth, allow-listed in lib/auth/server.ts)
//   /api/auth-flow/* (invite code + waitlist before sign-in) · /api/login (410, R17) · /api/emergency (admin emergency sign-in, R17 E1) · /s/* (public read-only list token) · /api/cal/* (calendar feed token)
//   /api/cron/* (CRON_SECRET) · /api/reports/export (REPORTS_TOKEN) · /privacy, /terms (static)
//   /i/*, /api/invite/*, /api/ext/*, /api/telegram (retired: notice pages / 410) · /api/csp-report (counts only) · /api/errors (R16 C2: error reports, rate-limited; /export needs REPORTS_TOKEN)
const PUBLIC_PREFIXES = [
  "/login",
  "/join/",
  "/api/auth/",
  "/api/auth-flow/",
  "/api/login",
  "/api/emergency",
  "/s/",
  "/api/cal/",
  "/api/cron/",
  "/api/reports/export",
  "/privacy",
  "/terms",
  "/i/",
  "/api/invite/",
  "/api/ext/",
  "/api/telegram",
  "/api/csp-report",
  // R16 C2: browser error reports, also from the sign-in pages (own limits: lib/errors/intake); /export is REPORTS_TOKEN.
  "/api/errors",
  "/manifest.webmanifest",
  "/sw.js",
];

// R15 B4: an enforced CSP with a fresh nonce per request (SECURITY.md §5). Next.js puts the nonce on its own scripts
// (it reads the policy from the request); our three inline scripts read it from x-nonce. Styles may be inline
// (React/motion style attributes); scripts never. WASM (barcode/receipt detectors) needs 'wasm-unsafe-eval'.
// R16 B5: Ably's realtime endpoints (ably-js 2.x defaults: main.realtime.ably.net + its five fallbacks, the
// connectivity check) — exact hosts, https + wss, connect-src only.
const ABLY_HOSTS = ["main.realtime.ably.net", ..."abcde".split("").map((x) => `main.${x}.fallback.ably-realtime.com`), "internet-up.ably-realtime.com"];
const ABLY_CONNECT = ABLY_HOSTS.flatMap((h) => [`https://${h}`, `wss://${h}`]).join(" ");
// Hotfix 2026-10-07: Google Identity Services for the in-app (FedCM) sign-in — the paths Google documents for GIS:
// the script (needed only by browsers without 'strict-dynamic'), its stylesheet, its frames and its fetches (FedCM's
// config / accounts / assertion requests are checked against connect-src). Nothing else of Google's.
const GIS = "https://accounts.google.com/gsi/";

function csp(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  const turnstile = process.env.TURNSTILE_SITE_KEY ? " https://challenges.cloudflare.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}${turnstile} ${GIS}client`,
    `style-src 'self' 'unsafe-inline' ${GIS}style`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://*.blob.vercel-storage.com https://blob.vercel-storage.com https://vercel.com ${ABLY_CONNECT} ${GIS}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `frame-src 'self'${turnstile} ${GIS}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://accounts.google.com",
    "report-uri /api/csp-report",
  ].join("; ");
}

function next(request: NextRequest, nonce: string, policy: string) {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const policy = csp(nonce);
  const isPublic =
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`) || (p.endsWith("/") && pathname === p.slice(0, -1))) ||
    (testIdpEnabled() && pathname.startsWith("/api/test-idp/"));
  if (isPublic) return next(request, nonce, policy);

  if (await getSessionUser(request.headers)) return next(request, nonce, policy);

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
