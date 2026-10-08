// Pure auth rules (R15 A1) — no DB, no Next imports, so they are unit-tested directly (scripts/test-auth-config.ts).
// SECURITY.md §2–§3, MULTIUSER.md §4.1.

type Env = Record<string, string | undefined>;

export const SESSION_IDLE_S = 30 * 24 * 60 * 60; // sliding: every use within 30 days extends it
export const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000; // never older than 90 days, however active
export const SESSION_CACHE_MS = 60_000; // per-instance cache of a DB session check (≤ 60 s, SECURITY.md §3)
export const STEP_UP_MS = 10 * 60 * 1000; // sensitive actions need a sign-in within the last 10 minutes

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Host without port, lowercased. */
export function hostName(host: string | null | undefined) {
  if (!host) return "";
  const h = host.trim().toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}

export function isLocalHost(host: string | null | undefined) {
  return LOCAL_HOSTS.has(hostName(host));
}

/**
 * "full" = passkeys + email-code recovery visible; "closed" = closed-circle mode (Google only + admin password fallback).
 * Full needs the final domain (passkeys are bound to it) and Resend (codes must reach people). Localhost counts as full
 * when AUTH_FULL_LOCAL=1 so every path is tested before the domain exists.
 */
export function authMode(host: string | null | undefined, env: Env = process.env): "full" | "closed" {
  if (env.AUTH_FULL_LOCAL === "1" && isLocalHost(host)) return "full";
  const app = env.NEXT_PUBLIC_APP_URL;
  if (!app || !env.RESEND_API_KEY) return "closed";
  let appHost = "";
  try {
    appHost = new URL(app).host.toLowerCase();
  } catch {
    return "closed";
  }
  return host && host.trim().toLowerCase() === appHost ? "full" : "closed";
}

/** R17 E1: the admin-only emergency sign-in exists only while ADMIN_EMERGENCY_TOKEN is set (≥ 32 characters). There is
 *  no password sign-in for anyone any more. */
export const EMERGENCY_MIN_TOKEN = 32;
export function emergencyEnabled(env: Env = process.env) {
  return (env.ADMIN_EMERGENCY_TOKEN?.length ?? 0) >= EMERGENCY_MIN_TOKEN && emergencyEmails(env).length > 0;
}
/** Who may use it: ADMIN_EMAILS (comma-separated) plus ADMIN_EMAIL. */
export function emergencyEmails(env: Env = process.env) {
  return [...new Set([...(env.ADMIN_EMAILS ?? "").split(","), env.ADMIN_EMAIL ?? ""].map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)))];
}

export function adminEmail(env: Env = process.env) {
  const e = env.ADMIN_EMAIL?.trim().toLowerCase();
  return e && /^[^@\s]+@[^@\s]+$/.test(e) ? e : null;
}

export function isAdminEmail(email: string | null | undefined, env: Env = process.env) {
  const a = adminEmail(env);
  return !!a && !!email && email.trim().toLowerCase() === a;
}

/** Absolute session age (SECURITY.md §3): reject sessions created more than 90 days ago even if they kept sliding. */
export function sessionTooOld(createdAt: Date | number, now = Date.now()) {
  const t = typeof createdAt === "number" ? createdAt : createdAt.getTime();
  return !Number.isFinite(t) || now - t > SESSION_ABSOLUTE_MS;
}

/** Same-site relative path only (open-redirect guard for ?next=). */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/** https → `__Host-` cookie (Secure, Path=/, no Domain); plain-http localhost → a dev name without the prefix. */
export function sessionCookieName(baseURL: string | undefined) {
  return baseURL?.startsWith("https://") ? "__Host-nexus_session" : "nexus_session_dev";
}

/** The test-only OIDC stub: never in production (the build refuses the combination, scripts/check-env.mjs). */
export function testIdpEnabled(env: Env = process.env) {
  return env.AUTH_TEST_IDP === "1" && env.NODE_ENV !== "production";
}
