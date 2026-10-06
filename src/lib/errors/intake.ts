import "server-only";
import { hitLimit, HOUR } from "@/lib/auth/limits";
import { currentCtx } from "@/lib/ctx";

// R16 C2 — the limits every browser-sent report goes through (/api/errors, /api/csp-report), so they can't take the
// system down: same origin, body ≤ 8 KB, per signed-in user 30 events/hour, anonymous 10 events/hour per IP.

export const MAX_BODY = 8 * 1024;
export const USER_PER_HOUR = 30;
export const ANON_PER_HOUR = 10;

/** The request comes from a page of this site (browsers always send Origin on POST / beacons). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Body text within the cap, or null. */
export async function boundedBody(req: Request): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return null;
  const text = await req.text();
  return text.length > MAX_BODY ? null : text;
}

const ipOf = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

/** Who is reporting (user id or null) and a per-event quota check: true = this event may be stored. */
export async function reporter(req: Request, bucket: string) {
  const ctx = await currentCtx().catch(() => null);
  const userId = ctx?.user.id ?? null;
  const key = userId ? `${bucket}:u:${userId}` : `${bucket}:ip:${ipOf(req)}`;
  const max = userId ? USER_PER_HOUR : ANON_PER_HOUR;
  return { userId, take: () => hitLimit(key, max, HOUR) };
}
