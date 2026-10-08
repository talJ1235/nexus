// R17 E1 — test-only sign-in for browser scripts (there is no password sign-in any more):
//   • localhost: the session scripts/serve-smoke.sh seeded (SMOKE_SESSION, or .next/smoke-session.txt),
//   • anywhere: the admin emergency path (SMOKE_ADMIN_TOKEN + SMOKE_ADMIN_EMAIL → POST /api/emergency).
import { readFileSync } from "node:fs";

const local = (base) => /localhost|127\.0\.0\.1/.test(base);
export function localSession() {
  if (process.env.SMOKE_SESSION) return process.env.SMOKE_SESSION;
  try {
    return readFileSync(".next/smoke-session.txt", "utf8").trim();
  } catch {
    return "";
  }
}
export const canSignIn = (base) => (local(base) && !!localSession()) || !!(process.env.SMOKE_ADMIN_TOKEN && process.env.SMOKE_ADMIN_EMAIL);

/** Signs `page`'s context in and opens `/`. */
export async function signIn(page, base) {
  const s = local(base) ? localSession() : "";
  if (s) await page.context().addCookies([{ name: "nexus_session_dev", value: s, url: base }]);
  else if (process.env.SMOKE_ADMIN_TOKEN && process.env.SMOKE_ADMIN_EMAIL) {
    const r = await page.request.post(`${base}/api/emergency`, { data: { token: process.env.SMOKE_ADMIN_TOKEN, email: process.env.SMOKE_ADMIN_EMAIL } });
    if (!r.ok()) throw new Error(`emergency sign-in: ${r.status()}`);
  } else throw new Error("no way to sign in: run scripts/serve-smoke.sh (local) or set SMOKE_ADMIN_TOKEN + SMOKE_ADMIN_EMAIL");
  await page.goto(`${base}/`);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}
