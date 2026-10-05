import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SESSION_CACHE_MS, sessionCookieName, sessionTooOld } from "./config";
import { auth } from "./server";

// Every request checks the DB session (SECURITY.md §3), cached per server instance for ≤ 60 s so a page with many
// server actions doesn't hit the DB each time. Sign-out / ban / "sign out everywhere" reach other instances within
// that minute; this instance drops its entry at once (forgetSession).

export type SessionUser = {
  user: { id: string; name: string; email: string; image: string | null; role: string | null; banned: boolean | null };
  session: { id: string; createdAt: Date; method: string | null; token: string };
};

const cache = new Map<string, { at: number; value: SessionUser | null }>();
const cacheMs = () => (process.env.AUTH_SESSION_CACHE === "0" ? 0 : SESSION_CACHE_MS);
const COOKIE = sessionCookieName(process.env.BETTER_AUTH_URL);

function cookieKey(headers: Headers) {
  const raw = headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE.replace(/[-]/g, "\\-")}=([^;]+)`));
  return m ? m[1] : null;
}

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const key = cookieKey(headers);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheMs()) return hit.value;
  let value: SessionUser | null = null;
  try {
    const r = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    const banned = !!(r?.user as { banned?: boolean | null } | undefined)?.banned;
    if (r && !banned) {
      if (sessionTooOld(r.session.createdAt)) {
        // Absolute 90-day limit: however active, the session ends.
        await db.delete(schema.session).where(eq(schema.session.id, r.session.id));
      } else {
        value = {
          user: { id: r.user.id, name: r.user.name, email: r.user.email, image: r.user.image ?? null, role: (r.user as { role?: string | null }).role ?? null, banned },
          session: { id: r.session.id, createdAt: new Date(r.session.createdAt), method: (r.session as { method?: string | null }).method ?? null, token: r.session.token },
        };
      }
    }
  } catch {
    value = null;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Drop cached entries (after sign-out / revoke on this instance). */
export function forgetSessions() {
  cache.clear();
}
