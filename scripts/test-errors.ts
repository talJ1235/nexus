// R16 C2 acceptance — the automatic error log can't be abused and holds no user content.
//   unit (fresh file DB): redaction (email / query string / long number / quoted names), 2 000 distinct fingerprints →
//     the table stays at 1 000 + the overflow counter, a thrown error in an action (onRequestError) appears once with
//     count 3 after 3 calls, expected errors (no access, validation) aren't logged, distinct users counted via hashes.
//   http (the built app, `next start` on a throwaway DB): 200 events from one user in a minute → 30 stored, the rest 429;
//     signed out → 10 per IP; another origin → 403; > 8 KB → 413; > 10 events → 400; /api/csp-report shares the limits.
// Usage: npm run build once, then `npm run test:errors` (PORT=3106).
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";

const DB = "errors-test.db";
const PORT = Number(process.env.PORT || 3106);
const BASE = `http://localhost:${PORT}`;
const SECRET = "errors-test-secret-0123456789abcdef-xyz-1";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.BETTER_AUTH_SECRET = SECRET;
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: { ...process.env, ADMIN_EMAIL: "" }, stdio: "ignore" });

let fails = 0;
const ok = (c: boolean, m: string, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};

async function unit() {
  // R17 S5 S1: which DB failures get one more try (reads only, never SQL errors).
  const { isReadStatement, isTransientDbError } = await import("../src/db/transient");
  const failed = (cause: unknown) => Object.assign(new Error("Failed query: select 1\nparams: x"), { cause });
  ok(isTransientDbError(failed(new TypeError("fetch failed"))), "S1 transient: fetch failed (in the cause) → retry");
  ok(isTransientDbError(failed({ code: "SERVER_ERROR", message: "Server returned HTTP status 503" })), "S1 transient: HTTP 503 → retry");
  ok(isTransientDbError(failed({ code: "STREAM_EXPIRED", message: "Hrana stream expired" })), "S1 transient: stream expired → retry");
  ok(!isTransientDbError(failed({ code: "SQLITE_UNKNOWN", message: "SQLite error: no such table: member" })), "S1 transient: no such table → no retry");
  ok(!isTransientDbError(failed({ code: "SQLITE_CONSTRAINT", message: "UNIQUE constraint failed" })), "S1 transient: constraint → no retry");
  ok(!isTransientDbError(new Error("Failed query: select 1")), "S1 transient: no cause → no retry");
  ok(isReadStatement(`select "id" from "space"`) && isReadStatement("  PRAGMA busy_timeout = 5000") && !isReadStatement(`insert into "x" values (1)`) && !isReadStatement("with a as (select 1) delete from x"), "S1 retry: reads only");
  const { redact, normalise, shape } = await import("../src/lib/errors/shape");
  const { recordError } = await import("../src/lib/errors/record");
  const { db, schema } = await import("../src/db");
  const { errorOverflow, MAX_FINGERPRINTS } = await import("../src/lib/db-scoped/errors");
  const { count, eq } = await import("drizzle-orm");

  // Redaction: no emails, no query strings, no long numbers, no quoted names; ≤ 500 chars.
  const r = redact('Failed for noa.jacoby@gmail.com at https://shop.example/p/drill?ref=abc&session=123 order 123456789 item "Bosch drill 18V" in “Jacoby Home” ' + "x".repeat(900));
  ok(!r.includes("@gmail") && !r.includes("ref=") && !r.includes("123456789") && !r.includes("Bosch") && !r.includes("Jacoby") && r.includes("https://shop.example/p/drill") && r.length <= 500, "redaction: email, query string, long number, quoted names go; ≤ 500 chars", r.slice(0, 160));
  ok(normalise("Item 123 not found (id abcdef1234567890)") === normalise("Item 9 not found (id 0011223344556677)"), "same error with other numbers / ids → one fingerprint");
  ok(shape({ kind: "server", code: "TypeError", where: "action:x", message: 'a "b"' }).sample.length <= 500, "samples are capped");

  // onRequestError: a thrown error in an action → one row, count 3 after 3 calls; expected errors aren't logged.
  process.env.NEXT_RUNTIME = "nodejs";
  const { onRequestError } = await import("../src/instrumentation");
  const ctx = { routerKind: "App Router", routePath: "/", routeType: "action", renderSource: "react-server-components", revalidateReason: undefined, renderType: "dynamic" } as unknown as Parameters<typeof onRequestError>[2];
  const req = (cookie: string) => ({ path: "/", method: "POST", headers: { "next-action": "abc123def456", cookie } });
  for (const who of ["nexus_session=AAA", "nexus_session=AAA", "nexus_session=BBB"]) await onRequestError(new TypeError("Cannot read properties of undefined (reading 'price')"), req(who), ctx);
  const access = Object.assign(new Error("not_found"), { name: "AccessError" });
  await onRequestError(access, req("x"), ctx);
  await onRequestError(Object.assign(new Error("bad"), { name: "ZodError" }), req("x"), ctx);
  const rows = await db.select().from(schema.errorEvent);
  const thrown = rows.filter((x) => x.kind === "server");
  ok(thrown.length === 1 && thrown[0].count === 3 && thrown[0].users === 2 && thrown[0].where === "action:abc123def456", "a thrown error in an action appears once with count 3 (2 distinct people); access / validation errors aren't logged", JSON.stringify(thrown.map((x) => [x.code, x.count, x.users, x.where])));
  ok(!JSON.stringify(rows).includes("AAA") && !JSON.stringify(await db.select().from(schema.errorUser)).includes("AAA"), "no user id / session is stored (hashes only)");

  // 2 000 distinct fingerprints → the table stays at 1 000, the rest only count.
  for (let k = 0; k < 2000; k++) await recordError({ kind: "client", code: "error", where: `/p${k}`, message: `boom ${k} ${"q".repeat(k % 7)}` });
  const [{ n }] = await db.select({ n: count() }).from(schema.errorEvent);
  const over = await errorOverflow();
  ok(n === MAX_FINGERPRINTS && over >= 2000 - (MAX_FINGERPRINTS - 1), "2 000 distinct fingerprints → table at 1 000 + overflow counter", `${n} rows, overflow ${over}`);
  // A fixed error that comes back is "new" again.
  await db.update(schema.errorEvent).set({ status: "fixed" }).where(eq(schema.errorEvent.fingerprint, thrown[0].fingerprint));
  await onRequestError(new TypeError("Cannot read properties of undefined (reading 'price')"), req("nexus_session=CCC"), ctx);
  const [back] = await db.select().from(schema.errorEvent).where(eq(schema.errorEvent.fingerprint, thrown[0].fingerprint));
  ok(back.status === "new" && back.count === 4, "a fixed error that comes back is new again");
}

async function http() {
  const { createClient } = await import("@libsql/client");
  const db = createClient({ url: `file:${DB}` });
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("DELETE FROM error_event");
  await db.execute("DELETE FROM kv");
  const now = Date.now();
  const uid = "u_" + randomBytes(8).toString("hex");
  await db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, 'E', 'e@errors.test', 1, 'user', ?, ?)`, args: [uid, now, now] });
  const sp = "sp_" + randomBytes(8).toString("hex");
  await db.execute({ sql: `INSERT INTO space (id, name, slug, kind, created_by, created_at) VALUES (?, 'P', ?, 'personal', ?, ?)`, args: [sp, `p-${sp}`, uid, now] });
  await db.execute({ sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`, args: ["m_" + sp, sp, uid, now] });
  const token = randomBytes(24).toString("base64url");
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: ["s_" + sp, now + 86_400_000, token, now, now, uid] });
  const cookie = `nexus_session_dev=${encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`)}`;

  const env = { ...process.env, TURSO_DATABASE_URL: `file:${DB}`, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, AUTH_FULL_LOCAL: "0", AUTH_SESSION_CACHE: "0", ADMIN_EMAIL: "", APP_PASSWORD: "" };
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: "ignore" });
  const stop = () => {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
      else server.kill();
    } catch {}
  };
  try {
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`${BASE}/login`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const post = (body: unknown, headers: Record<string, string> = {}, path = "/api/errors") =>
      fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const events = (k: number, n = 10) => ({ events: Array.from({ length: n }, (_, j) => ({ kind: "client", code: "error", where: "/", message: `boom ${k}-${j}` })) });
    // 200 events from one signed-in user within a minute (20 requests × 10) → 30 stored, the rest refused (429).
    let stored = 0;
    const statuses: number[] = [];
    for (let k = 0; k < 20; k++) {
      const r = await post(events(k), { cookie });
      statuses.push(r.status);
      stored += ((await r.json()) as { stored: number }).stored;
    }
    const rows = Number((await db.execute("SELECT coalesce(sum(count), 0) n FROM error_event WHERE kind = 'client'")).rows[0].n);
    ok(stored === 30 && rows === 30 && statuses.slice(3).every((s) => s === 429), "200 events from one user in a minute → 30 stored, the rest 429", JSON.stringify({ stored, rows, statuses: statuses.slice(0, 5) }));
    // Signed out: 10 per IP.
    let anon = 0;
    for (let k = 0; k < 3; k++) anon += ((await (await post(events(100 + k), { "x-real-ip": "203.0.113.9" })).json()) as { stored: number }).stored;
    ok(anon === 10, "signed out: 10 events per hour per IP", String(anon));
    ok((await post(events(200, 1), { origin: "https://evil.example", "x-real-ip": "203.0.113.10" })).status === 403, "another origin → 403");
    ok((await post(JSON.stringify({ events: [{ kind: "client", code: "error", where: "/", message: "x".repeat(300) }], pad: "y".repeat(9000) }), { "x-real-ip": "203.0.113.11" })).status === 413, "body over 8 KB → 413");
    ok((await post(events(300, 11), { "x-real-ip": "203.0.113.12" })).status === 400, "more than 10 events → 400 (strict shape)");
    ok((await post({ events: [{ kind: "client", code: "error", where: "/", message: "x", extra: 1 }] }, { "x-real-ip": "203.0.113.13" })).status === 400, "unknown fields → 400 (strict)");
    // /api/csp-report: the same per-IP quota (10/hour signed out), then 429.
    const csp = [];
    for (let k = 0; k < 11; k++) csp.push((await post({ "csp-report": { "effective-directive": "img-src" } }, { "x-real-ip": "203.0.113.14", "content-type": "application/csp-report" }, "/api/csp-report")).status);
    ok(csp.slice(0, 10).every((s) => s === 204) && csp[10] === 429, "/api/csp-report shares the limits (10/hour per IP signed out)", JSON.stringify(csp));
  } finally {
    stop();
    db.close();
  }
}

(async () => {
  await unit();
  if (process.env.ERRORS_UNIT_ONLY !== "1") await http();
  console.log(fails ? `FAIL errors: ${fails}` : "OK errors");
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.log(`FAIL errors crashed — ${String(e?.message ?? e).split("\n")[0]}`);
  process.exit(1);
});
void assert;
