import { NextResponse, type NextRequest } from "next/server";
import { LAST_ACCOUNT_COOKIE } from "@/lib/auth/device";

// "Not you?" on the sign-in screen: forget the returning-account chip on this device (authz allow-list: no data).
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(LAST_ACCOUNT_COOKIE);
  return res;
}
