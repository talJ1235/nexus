// R15 0.1 — proves the backup path: /api/backup's JSON (buildBackup) restored into an empty file DB gives the same counts.
// Source = a file DB (default: newest snapshots/prod-*.db, else local.db). Never touches a remote DB.
// Usage: node scripts/db-restore-test.mjs [--source snapshots/prod-2026-10-05.db]
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, mkdirSync, copyFileSync } from "node:fs";

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

const tsx = ["node_modules/tsx/dist/cli.mjs", "--conditions=react-server"];
const run = (url, args) =>
  execFileSync(process.execPath, [...tsx, ...args], { env: { ...process.env, TURSO_DATABASE_URL: `file:${url}`, TURSO_AUTH_TOKEN: "" }, encoding: "utf8" })
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
