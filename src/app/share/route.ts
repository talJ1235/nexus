import { NextResponse, type NextRequest } from "next/server";
import { extractUrls } from "@/lib/utils";

// Android share sheet target (see manifest share_target). Shared links often arrive in "text".
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const found = extractUrls([p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" "))[0];
  const dest = new URL(found ? `/add?url=${encodeURIComponent(found)}` : "/", req.url);
  return NextResponse.redirect(dest, 303);
}
