import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, createSessionValue, safeEqual } from "@/lib/session";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  const expected = process.env.APP_PASSWORD;
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!expected || !safeEqual(password, expected)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    if (safeNext !== "/") url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url, 303);
  }

  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
