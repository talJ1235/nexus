// R17 E1 — test-only sign-in for browser scripts (there is no password sign-in any more):
//   • localhost: a fresh session row for ADMIN_EMAIL in the smoke DB (SMOKE_DB, default smoke.db — scripts/serve-smoke.sh),
//     signed with .env.local's BETTER_AUTH_SECRET — one per sign-in, so a step that logs out ends only its own session.
//     (SMOKE_SESSION=<cookie value> uses a given session instead.)
//   • anywhere: the admin emergency path (SMOKE_ADMIN_TOKEN + SMOKE_ADMIN_EMAIL → POST /api/emergency).
import { createClient } from "@libsql/client";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const local = (base) => /localhost|127\.0\.0\.1/.test(base);
const env = () => {
  try {
    return { ...parseEnv(readFileSync(".env.local", "utf8")), ...process.env };
  } catch {
    return process.env;
  }
};

/** A new signed session cookie for the admin in the local smoke DB (null when there's no DB / secret / admin). */
export async function mintLocalSession() {
  if (process.env.SMOKE_SESSION) return process.env.SMOKE_SESSION;
  const e = env();
  const file = e.SMOKE_DB || "smoke.db";
  if (!existsSync(file) || !e.BETTER_AUTH_SECRET || !e.ADMIN_EMAIL) return null;
  const db = createClient({ url: `file:${file}` });
  try {
    const u = (await db.execute({ sql: `SELECT id FROM "user" WHERE lower(email) = ?`, args: [e.ADMIN_EMAIL.toLowerCase()] })).rows[0];
    if (!u) return null;
    const token = randomBytes(24).toString("base64url");
    const now = Date.now();
    await db.execute({ sql: "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)", args: [`smoke_${token.slice(0, 10)}`, now + 7 * 86_400_000, token, now, now, u.id] });
    return encodeURIComponent(`${token}.${createHmac("sha256", e.BETTER_AUTH_SECRET).update(token).digest("base64")}`);
  } finally {
    db.close();
  }
}

export const canSignIn = (base) => (local(base) && (!!process.env.SMOKE_SESSION || existsSync(env().SMOKE_DB || "smoke.db"))) || !!(process.env.SMOKE_ADMIN_TOKEN && process.env.SMOKE_ADMIN_EMAIL);

/** Signs `page`'s context in and opens `/`. */
export async function signIn(page, base) {
  const s = local(base) ? await mintLocalSession() : null;
  if (s) await page.context().addCookies([{ name: "nexus_session_dev", value: s, url: base }]);
  else if (process.env.SMOKE_ADMIN_TOKEN && process.env.SMOKE_ADMIN_EMAIL) {
    const r = await page.request.post(`${base}/api/emergency`, { data: { token: process.env.SMOKE_ADMIN_TOKEN, email: process.env.SMOKE_ADMIN_EMAIL } });
    if (!r.ok()) throw new Error(`emergency sign-in: ${r.status()}`);
  } else throw new Error("no way to sign in: run scripts/serve-smoke.sh (local) or set SMOKE_ADMIN_TOKEN + SMOKE_ADMIN_EMAIL");
  await page.goto(`${base}/`);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}
