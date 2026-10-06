// R15 E1 bench: Home and Shopping first load (full server response), before (`main`) vs after (`round15`), plus the
// cron's database fan-out. File DBs only (snapshot copies) — never a remote DB.
//   before: a built `main` worktree (MAIN_DIR, default ../nexus-main-bench) on a copy of the prod snapshot (old schema)
//   after:  this checkout's build on a copy of snapshots/rehearsal.db (migrated prod copy + a synthetic 2 000-item space)
// Usage: node --env-file=.env.local scripts/bench-r15.mjs [runs=15]
import { createClient } from "@libsql/client";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const RUNS = Number(process.argv[2] || 15);
const MAIN_DIR = resolve(process.env.MAIN_DIR || "../nexus-main-bench");
const PROD = process.env.BENCH_PROD || `snapshots/${readdirSync("snapshots").filter((f) => /^prod-.*\.db$/.test(f)).sort().pop()}`;
const REH = process.env.BENCH_REHEARSAL || "snapshots/rehearsal.db";
const MAIN_DB = resolve(MAIN_DIR, "bench-main.db");
const R15_DB = "snapshots/bench-r15.db";
copyFileSync(PROD, MAIN_DB);
copyFileSync(REH, R15_DB);
const MAIN_PW = "bench-password-0123456789abcd";
const SECRET = process.env.BETTER_AUTH_SECRET;
if (!SECRET) throw new Error("BETTER_AUTH_SECRET missing (run with --env-file=.env.local)");
const NOAI = { GEMINI_API_KEY: "", GROQ_API_KEY: "", OPENROUTER_API_KEY: "", SERPER_API_KEY: "", BRAVE_API_KEY: "", BLOB_READ_WRITE_TOKEN: "" };

const servers = [];
function start(cwd, port, env) {
  const p = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port)], { cwd, env: { ...process.env, ...NOAI, ...env }, stdio: "ignore" });
  servers.push(p);
}
const stopAll = () => {
  for (const p of servers)
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
      else p.kill();
    } catch {}
};
process.on("exit", stopAll);
async function up(base) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/login`)).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${base} did not start`);
}

// ---- before: main on the old-schema prod copy ----
const MAIN = "http://localhost:3105";
start(MAIN_DIR, 3105, { TURSO_DATABASE_URL: `file:${MAIN_DB}`, TURSO_AUTH_TOKEN: "", APP_PASSWORD: MAIN_PW, SESSION_SECRET: "bench-session-secret-0123456789abcdef" });
// ---- after: round15 on the migrated copy ----
const R15 = "http://localhost:3104";
const db = createClient({ url: `file:${R15_DB}` });
const admin = (await db.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [String(process.env.ADMIN_EMAIL ?? "").toLowerCase()] })).rows[0];
if (!admin) throw new Error("no admin user in the rehearsal copy");
const personal = (await db.execute({ sql: "SELECT id FROM space WHERE kind = 'personal' AND created_by = ? LIMIT 1", args: [admin.id] })).rows[0].id;
const big = (await db.execute({ sql: "SELECT space_id AS id, count(*) AS n FROM items WHERE space_id <> ? GROUP BY space_id ORDER BY n DESC LIMIT 1", args: [personal] })).rows[0];
// The admin needs to be a member of the synthetic space to open it.
if (big) await db.execute({ sql: "INSERT OR IGNORE INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)", args: [`bench_${big.id}`, big.id, admin.id, Date.now()] });
const token = randomBytes(24).toString("base64url");
await db.execute({ sql: "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, 'bench', 'passkey')", args: [`bench_${token.slice(0, 8)}`, Date.now() + 3_600_000, token, Date.now(), Date.now(), admin.id] });
const r15Cookie = `nexus_session_dev=${encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`)}`;
start(".", 3104, { TURSO_DATABASE_URL: `file:${resolve(R15_DB)}`, TURSO_AUTH_TOKEN: "", AUTH_FULL_LOCAL: "0", R15_LOCAL_GUARD: "1" });
await Promise.all([up(MAIN), up(R15)]);

const login = await fetch(`${MAIN}/api/login`, { method: "POST", body: new URLSearchParams({ password: MAIN_PW, next: "/" }), redirect: "manual" });
const mainCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
if (!mainCookie) throw new Error("main login failed");

async function time(base, path, cookie) {
  const t0 = performance.now();
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  const body = await res.text();
  const ms = performance.now() - t0;
  if (res.status !== 200 || !body.includes("data-app-shell")) throw new Error(`${base}${path} → ${res.status}`);
  return ms;
}
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: Math.round(s[Math.floor(s.length / 2)]), p90: Math.round(s[Math.floor(s.length * 0.9)]) };
};
async function bench(label, base, path, cookie) {
  for (let i = 0; i < 3; i++) await time(base, path, cookie); // warm up
  const xs = [];
  // Interleave nothing else: one request at a time.
  for (let i = 0; i < RUNS; i++) xs.push(await time(base, path, cookie));
  return { label, ...stats(xs) };
}

const rows = [];
for (const [name, path] of [["Home", "/"], ["Shopping", "/?v=to_buy"]]) {
  rows.push(await bench(`${name} · before (main, Tal's data)`, MAIN, path, mainCookie));
  rows.push(await bench(`${name} · after (round15, Tal's space)`, R15, path, `${r15Cookie}; nexus_space=${personal}`));
  if (big) rows.push(await bench(`${name} · after (round15, ${big.n}-item space)`, R15, path, `${r15Cookie}; nexus_space=${big.id}`));
}

// ---- cron: the database fan-out (watched links), without the network fetches; same SQL as systemWatchedSources ----
const mainDb = createClient({ url: `file:${MAIN_DB}` });
const WATCH_MAIN = `SELECT s.* FROM sources s INNER JOIN items i ON i.id = s.item_id WHERE i.status = 'to_buy' AND i.watch = 1 AND s.url <> '' ORDER BY s.fetched_at`;
const WATCH_R15 = `SELECT s.*, s.space_id, sp.created_by FROM sources s INNER JOIN items i ON i.id = s.item_id AND i.space_id = +s.space_id INNER JOIN space sp ON sp.id = s.space_id WHERE sp.deleted_at IS NULL AND i.status = 'to_buy' AND i.watch = 1 AND s.url <> '' AND (s.check_fails < 3 OR s.check_fails IS NULL) ORDER BY s.fetched_at`;
async function qtime(c, sql) {
  for (let i = 0; i < 5; i++) await c.execute(sql);
  const xs = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await c.execute(sql);
    xs.push(performance.now() - t0);
  }
  const s = [...xs].sort((a, b) => a - b);
  return { median: +s[25].toFixed(2), p90: +s[45].toFixed(2), rows: (await c.execute(sql)).rows.length };
}
const cronBefore = await qtime(mainDb, WATCH_MAIN);
const cronAfter = await qtime(db, WATCH_R15);

await db.execute("DELETE FROM session WHERE user_agent = 'bench'");
stopAll();
console.log(`\nR15 E1 bench — ${RUNS} runs each after 3 warm-ups, full server response (ms)`);
console.log(`${"".padEnd(48)} ${"median".padStart(7)} ${"p90".padStart(6)}`);
for (const r of rows) console.log(`${r.label.padEnd(48)} ${String(r.median).padStart(7)} ${String(r.p90).padStart(6)}`);
console.log(`cron watched-links query · before (main)        ${String(cronBefore.median).padStart(7)} ${String(cronBefore.p90).padStart(6)}  (${cronBefore.rows} links)`);
console.log(`cron watched-links query · after (all spaces)   ${String(cronAfter.median).padStart(7)} ${String(cronAfter.p90).padStart(6)}  (${cronAfter.rows} links)`);
const pick = (s) => rows.find((r) => r.label.startsWith(s));
for (const n of ["Home", "Shopping"]) {
  const b = pick(`${n} · before`).median;
  const a = pick(`${n} · after (round15, Tal's`).median;
  console.log(`${a <= b * 1.1 ? "OK" : "SLOW"} ${n}: after ${a} ms vs before ${b} ms (${Math.round(((a - b) / b) * 100)}%, limit +10%)`);
}
process.exit(0);
