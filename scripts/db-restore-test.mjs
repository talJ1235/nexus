// R15 0.1 — proves the backup path: /api/backup's JSON (buildBackup) restored into an empty file DB gives the same counts.
// Source = a file DB (default: newest snapshots/prod-*.db, else local.db). Never touches a remote DB.
// Usage: node scripts/db-restore-test.mjs [--source snapshots/prod-2026-10-05.db]
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const i = process.argv.indexOf("--source");
const newestProd = existsSync("snapshots")
  ? readdirSync("snapshots").filter((f) => /^prod-.*\.db$/.test(f)).sort().pop()
  : undefined;
const source = i > 0 ? process.argv[i + 1] : newestProd ? `snapshots/${newestProd}` : "local.db";
mkdirSync("snapshots", { recursive: true });
// Work on a copy so even the read path can't change the source file.
const srcCopy = "snapshots/restore-src.db";
const target = "snapshots/restore-test.db";
const json = "snapshots/restore-test.json";
for (const f of [srcCopy, target, json]) if (existsSync(f)) rmSync(f);
copyFileSync(source, srcCopy);

// The R15 migration step needs ADMIN_EMAIL (owner of the backfilled rows). Take it from the environment or .env.local —
// only that one name; the prod URL/token in .env.local are never passed to the children.
const localEnv = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
const adminEmail = process.env.ADMIN_EMAIL || localEnv.ADMIN_EMAIL;
if (!adminEmail) {
  console.error("FAIL: ADMIN_EMAIL not set (environment or .env.local) — the R15 migration needs it");
  process.exit(1);
}
const childEnv = { ...process.env, ADMIN_EMAIL: adminEmail, TURSO_AUTH_TOKEN: "" };
for (const k of Object.keys(childEnv)) if (k.startsWith("PROD_TURSO_")) delete childEnv[k];

const tsx = ["node_modules/tsx/dist/cli.mjs", "--conditions=react-server"];
const run = (url, args) =>
  execFileSync(process.execPath, [...tsx, ...args], { env: { ...childEnv, TURSO_DATABASE_URL: `file:${url}` }, encoding: "utf8" })
    .trim()
    .split("\n")
    .pop();

// Bring the copy to the current schema first (the backup reads through today's Drizzle schema).
run(srcCopy, ["src/db/migrate.ts"]);
const dumped = JSON.parse(run(srcCopy, ["scripts/lib/backup-cli.ts", "dump", json]));
run(target, ["src/db/migrate.ts"]);
const restored = JSON.parse(run(target, ["scripts/lib/backup-cli.ts", "restore", json]));

const db = createClient({ url: `file:${target}` });
const SQL_NAME = { pricePoints: "price_points", altGroups: "alt_groups", storeSettings: "store_settings", conversationMessages: "conversation_messages", spacePrefs: "space_pref", userPrefs: "user_pref" };
let ok = true;
console.log(`${"table".padEnd(22)} ${"backup".padStart(7)} ${"restored".padStart(8)} ${"in DB".padStart(7)}`);
for (const [name, n] of Object.entries(dumped)) {
  const tbl = SQL_NAME[name] ?? name;
  const where = name === "kv" ? " WHERE key LIKE 'pref:%' OR key IN ('fx_rates','telegram_bot')" : "";
  const inDb = Number((await db.execute(`SELECT count(*) AS n FROM "${tbl}"${where}`)).rows[0].n);
  const good = n === restored[name] && (name === "kv" || n === inDb);
  ok &&= good;
  console.log(`${name.padEnd(22)} ${String(n).padStart(7)} ${String(restored[name]).padStart(8)} ${String(inDb).padStart(7)}${good ? "" : "  MISMATCH"}`);
}
const integrity = String((await db.execute("PRAGMA integrity_check")).rows[0][0]);
db.close();
console.log(`integrity_check: ${integrity}`);
ok &&= integrity === "ok";
console.log(ok ? `OK backup → restore (${source})` : "FAIL backup → restore");
process.exit(ok ? 0 : 1);
