// Shared harness for browser tests that need the app with data (R17): a throwaway file DB — migrated, then the demo
// catalog (seed-local) and the worst-case spaces (seed-worst) for the admin — a signed session cookie for that admin
// (the test-only sign-in: a session row + Better Auth's cookie signature, no password, no IdP) and the server.
//   const app = await startApp({ db: "clip-test.db", port: 3109 });   // next start (run a build first); dev: true → next dev
//   … app.base, app.cookies(space?, locale?) for context.addCookies, app.admin, app.personal, app.db …
//   app.stop();
import { createClient } from "@libsql/client";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";

export async function startApp({ db: file, port, dev = false, env: extra = {} }) {
  const base = `http://localhost:${port}`;
  const secret = `test-app-secret-${randomBytes(12).toString("hex")}`;
  const adminEmail = "test-admin@example.com";
  const env = {
    ...process.env,
    NODE_ENV: dev ? "development" : "production",
    TURSO_DATABASE_URL: `file:${file}`,
    TURSO_AUTH_TOKEN: "",
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: base,
    AUTH_FULL_LOCAL: "0",
    AUTH_SESSION_CACHE: "0",
    ADMIN_EMAIL: adminEmail,
    ADMIN_EMAILS: adminEmail,
    APP_PASSWORD: "",
    GEMINI_API_KEY: "",
    GROQ_API_KEY: "",
    OPENROUTER_API_KEY: "",
    SERPER_API_KEY: "",
    BRAVE_API_KEY: "",
    BLOB_READ_WRITE_TOKEN: "",
    GOOGLE_CLIENT_ID: "",
    ABLY_API_KEY: "",
    CF_FETCH_URL: "",
    NEXUS_AI_MOCK: "1",
    REALTIME_FAKE: dev ? "1" : "",
    NEXT_DIST_DIR: undefined,
    ...extra,
  };
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f);
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env, stdio: "ignore" });
  execFileSync(process.execPath, ["scripts/seed-local.mjs"], { env, stdio: "ignore" });
  execFileSync(process.execPath, ["scripts/seed-worst.mjs"], { env, stdio: "ignore" });
  const db = createClient({ url: `file:${file}` });
  const admin = (await db.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [adminEmail] })).rows[0].id;
  const personal = (await db.execute({ sql: `SELECT id FROM space WHERE kind = 'personal' AND created_by = ?`, args: [admin] })).rows[0].id;
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [`ts_${token.slice(0, 10)}`, now + 86_400_000, token, now, now, admin] });
  const session = encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`);

  let log = "";
  const args = dev ? ["node_modules/next/dist/bin/next", "dev", "-p", String(port)] : ["node_modules/next/dist/bin/next", "start", "-p", String(port)];
  const server = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const stop = () => {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
      else server.kill();
    } catch {}
  };
  process.on("exit", stop);
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/login`)).status === 200) break;
    } catch {}
    if (i > 240) throw new Error(`server did not start\n${log.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const cookies = (space, locale = "en") => [
    { name: "nexus_session_dev", value: session, url: base },
    ...(space ? [{ name: "nexus_space", value: space, url: base }] : []),
    { name: "nexus_locale", value: locale, url: base },
  ];
  /** R17: a signed session for any user (a session row + Better Auth's cookie signature), as cookies. */
  const sessionFor = async (userId, { ua = null, space = null, locale = "en" } = {}) => {
    const tok = randomBytes(24).toString("base64url");
    const t = Date.now();
    await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [`ts_${tok.slice(0, 10)}`, t + 86_400_000, tok, t, t, userId, ua] });
    const value = encodeURIComponent(`${tok}.${createHmac("sha256", secret).update(tok).digest("base64")}`);
    return { id: `ts_${tok.slice(0, 10)}`, cookies: [{ name: "nexus_session_dev", value, url: base }, ...(space ? [{ name: "nexus_space", value: space, url: base }] : []), { name: "nexus_locale", value: locale, url: base }], header: `nexus_session_dev=${value}; nexus_locale=${locale}${space ? `; nexus_space=${space}` : ""}` };
  };
  return { base, db, admin, personal, adminEmail, cookies, sessionFor, cookieHeader: `nexus_session_dev=${session}`, stop, log: () => log };
}
