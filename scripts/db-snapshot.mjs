// R15 0.1 — read-only copy of the prod Turso DB into snapshots/prod-<date>.db (gitignored, never committed).
// Reads PROD_TURSO_DATABASE_URL + PROD_TURSO_READ_TOKEN from .env.local (the only script allowed to use them).
// Every statement sent to the source goes through readOnly(), which refuses anything but SELECT / PRAGMA.
// Usage: node --env-file=.env.local scripts/db-snapshot.mjs [--out snapshots/x.db] [--source file:local.db]
//   --source: snapshot another DB instead of prod (used by tests / the synthetic rehearsal).
import { createClient } from "@libsql/client";
import { mkdirSync, existsSync, rmSync } from "node:fs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const sourceUrl = arg("--source") ?? process.env.PROD_TURSO_DATABASE_URL;
const token = arg("--source") ? undefined : process.env.PROD_TURSO_READ_TOKEN;
if (!sourceUrl) {
  console.error("FAIL no PROD_TURSO_DATABASE_URL (see docs/ROUND15.md, Before you run, step 2)");
  process.exit(2);
}
const date = new Date().toISOString().slice(0, 10);
const out = arg("--out") ?? `snapshots/prod-${date}.db`;

const READ_ONLY = /^\s*(SELECT|PRAGMA)\b/i;
const sent = [];
const src = createClient({ url: sourceUrl, authToken: token });
/** The only way this script talks to the source. */
async function readOnly(sql, args = []) {
  if (!READ_ONLY.test(sql) || /;\s*\S/.test(sql)) throw new Error(`refused non-read statement: ${sql.slice(0, 40)}`);
  sent.push(sql);
  return src.execute({ sql, args });
}

mkdirSync(out.replace(/[\\/][^\\/]+$/, "") || ".", { recursive: true });
if (existsSync(out)) rmSync(out);
const dst = createClient({ url: `file:${out}` });
// Tables are copied in name order (account before user): the local copy checks foreign keys only at the end.
await dst.execute("PRAGMA foreign_keys = OFF");

const objects = (
  await readOnly("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC, name")
).rows;
const tables = objects.filter((o) => o.type === "table").map((o) => String(o.name));

for (const o of objects.filter((o) => o.type === "table")) await dst.execute(String(o.sql));

const counts = [];
const PAGE = 500;
for (const t of tables) {
  const q = `"${t.replace(/"/g, '""')}"`;
  const total = Number((await readOnly(`SELECT count(*) AS n FROM ${q}`)).rows[0].n);
  let copied = 0;
  for (let off = 0; off < total; off += PAGE) {
    const rs = await readOnly(`SELECT * FROM ${q} ORDER BY rowid LIMIT ? OFFSET ?`, [PAGE, off]);
    if (!rs.rows.length) break;
    const cols = rs.columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
    const marks = rs.columns.map(() => "?").join(",");
    await dst.batch(
      rs.rows.map((r) => ({ sql: `INSERT INTO ${q} (${cols}) VALUES (${marks})`, args: rs.columns.map((c) => r[c]) })),
      "write",
    );
    copied += rs.rows.length;
  }
  const local = Number((await dst.execute(`SELECT count(*) AS n FROM ${q}`)).rows[0].n);
  counts.push({ table: t, source: total, copy: local, ok: total === local && copied === total });
}
// Indexes / triggers / views after the data (faster inserts).
for (const o of objects.filter((o) => o.type !== "table")) await dst.execute(String(o.sql));

const integrity = String((await dst.execute("PRAGMA integrity_check")).rows[0][0]);
const fkProblems = (await dst.execute("PRAGMA foreign_key_check")).rows.length;
if (fkProblems) console.log(`note: ${fkProblems} foreign-key mismatches in the source data (copied as they are)`);
dst.close();
src.close();

if (sent.some((s) => !READ_ONLY.test(s))) throw new Error("a non-read statement was sent");
const w = Math.max(...counts.map((c) => c.table.length), 5);
console.log(`${"table".padEnd(w)}  ${"source".padStart(7)}  ${"copy".padStart(7)}`);
for (const c of counts) console.log(`${c.table.padEnd(w)}  ${String(c.source).padStart(7)}  ${String(c.copy).padStart(7)}${c.ok ? "" : "  MISMATCH"}`);
console.log(`statements sent to source: ${sent.length} (all SELECT/PRAGMA)`);
console.log(`integrity_check: ${integrity}`);
const ok = integrity === "ok" && counts.every((c) => c.ok);
console.log(ok ? `OK snapshot → ${out}` : "FAIL snapshot");
process.exit(ok ? 0 : 1);
