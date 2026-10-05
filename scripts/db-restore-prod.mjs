// R15 0.1 — EMERGENCY ONLY (Part G rollback): write a snapshot (scripts/db-snapshot.mjs) back to the prod Turso DB.
// The target becomes exactly the snapshot: every table not in the snapshot is dropped, every snapshot table is
// recreated and refilled, all in one transaction. The full-access token is typed at the prompt, never read from a file.
// Usage: node --env-file=.env.local scripts/db-restore-prod.mjs <snapshot.db> --i-am-tal-and-prod-is-broken
//   --target <libsql-url>: restore somewhere else (tests use a throwaway file DB — never prod in R15).
import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const snapshot = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--target");
const ti = args.indexOf("--target");
const targetUrl = ti >= 0 ? args[ti + 1] : process.env.PROD_TURSO_DATABASE_URL;
if (!args.includes("--i-am-tal-and-prod-is-broken")) {
  console.error("Refusing: this overwrites the production database. Re-run with --i-am-tal-and-prod-is-broken.");
  process.exit(2);
}
if (!snapshot || !existsSync(snapshot)) {
  console.error("Usage: db-restore-prod.mjs <snapshot.db> --i-am-tal-and-prod-is-broken");
  process.exit(2);
}
if (!targetUrl) {
  console.error("No target: PROD_TURSO_DATABASE_URL is not set (or pass --target).");
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => {
  process.stdout.write(q);
  const { value, done } = await lines.next();
  return done ? "" : String(value).trim();
};

const src = createClient({ url: `file:${snapshot}` });
const objects = (await src.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")).rows;
const tables = objects.filter((o) => o.type === "table").map((o) => String(o.name));
const q = (n) => `"${String(n).replace(/"/g, '""')}"`;
const counts = {};
for (const t of tables) counts[t] = Number((await src.execute(`SELECT count(*) AS n FROM ${q(t)}`)).rows[0].n);
const integrity = String((await src.execute("PRAGMA integrity_check")).rows[0][0]);
if (integrity !== "ok") {
  console.error(`Snapshot integrity_check failed: ${integrity}`);
  process.exit(1);
}

console.log(`Target: ${targetUrl.replace(/\?.*$/, "")}`);
console.log("Rows that will be written (the target's current data is replaced):");
for (const t of tables) console.log(`  ${t.padEnd(26)} ${String(counts[t]).padStart(7)}`);

const token = targetUrl.startsWith("file:") ? (await ask("Full-access token (blank for a file DB): "), undefined) : await ask("Full-access token: ");
if (!targetUrl.startsWith("file:") && !token) {
  console.error("No token — nothing written.");
  process.exit(1);
}
if ((await ask('Type "restore" to overwrite the target: ')) !== "restore") {
  console.error("Not confirmed — nothing written.");
  process.exit(1);
}
rl.close();

const dst = createClient({ url: targetUrl, authToken: token });
const existing = (await dst.execute("SELECT type, name FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%'")).rows;
const stmts = [];
for (const o of existing.filter((o) => o.type !== "table")) stmts.push(`DROP ${o.type === "view" ? "VIEW" : "TRIGGER"} IF EXISTS ${q(o.name)}`);
for (const o of existing.filter((o) => o.type === "table")) stmts.push(`DROP TABLE IF EXISTS ${q(o.name)}`);
for (const o of objects.filter((o) => o.type === "table")) stmts.push(String(o.sql));
for (const t of tables) {
  const rs = await src.execute(`SELECT * FROM ${q(t)}`);
  if (!rs.rows.length) continue;
  const cols = rs.columns.map(q).join(",");
  const per = Math.max(1, Math.floor(400 / rs.columns.length));
  for (let i = 0; i < rs.rows.length; i += per) {
    const chunk = rs.rows.slice(i, i + per);
    stmts.push({
      sql: `INSERT INTO ${q(t)} (${cols}) VALUES ${chunk.map(() => `(${rs.columns.map(() => "?").join(",")})`).join(",")}`,
      args: chunk.flatMap((r) => rs.columns.map((c) => r[c])),
    });
  }
}
for (const o of objects.filter((o) => o.type !== "table")) stmts.push(String(o.sql));
// One batch = one transaction: either the whole snapshot lands or nothing changes.
await dst.batch(stmts, "write");

let ok = true;
for (const t of tables) {
  const n = Number((await dst.execute(`SELECT count(*) AS n FROM ${q(t)}`)).rows[0].n);
  if (n !== counts[t]) {
    ok = false;
    console.log(`MISMATCH ${t}: ${n} ≠ ${counts[t]}`);
  }
}
dst.close();
src.close();
console.log(ok ? `OK restored ${tables.length} tables from ${snapshot}` : "FAIL counts differ after restore");
process.exit(ok ? 0 : 1);
