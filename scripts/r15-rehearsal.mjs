// R15 B2 rehearsal: run the R15 migration on a COPY of a snapshot (newest snapshots/prod-*.db, else the given file),
// twice, and check: row counts per table equal before/after, no NULL space_id, integrity ok, the second run changes
// nothing, and the To buy / On the way / History counts + this month's budget are the same as before. Then adds a
// synthetic 2 000-item second space (for the E1 speed checks). Numbers only — no content is printed.
//   node --env-file=.env.local scripts/r15-rehearsal.mjs [--source snapshots/x.db] [--keep]
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";

const i = process.argv.indexOf("--source");
const prod = existsSync("snapshots") ? readdirSync("snapshots").filter((f) => /^prod-.*\.db$/.test(f)).sort().pop() : null;
const source = i > 0 ? process.argv[i + 1] : prod ? `snapshots/${prod}` : "snapshots/local-before-r15.db";
if (!existsSync(source)) {
  console.error(`FAIL no snapshot at ${source}`);
  process.exit(2);
}
const COPY = "snapshots/rehearsal.db";
for (const f of [COPY, `${COPY}-journal`]) if (existsSync(f)) rmSync(f);
copyFileSync(source, COPY);
if (!process.env.ADMIN_EMAIL) {
  console.error("FAIL ADMIN_EMAIL is needed (today's rows are given to the admin's personal space)");
  process.exit(2);
}
const env = { ...process.env, TURSO_DATABASE_URL: `file:${COPY}`, TURSO_AUTH_TOKEN: "", VERCEL: "" };
const db = createClient({ url: `file:${COPY}` });
const DATA = ["collections", "items", "sources", "price_points", "attachments", "alerts", "alt_groups", "store_settings", "receipts", "reports", "conversations", "conversation_messages", "memories", "members", "grants", "invites"];
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const counts = async () => Object.fromEntries(await Promise.all(DATA.map(async (t) => [t, Number((await q(`SELECT count(*) n FROM "${t}"`))[0].n)])));
const month = new Date().toISOString().slice(0, 7);
const appNumbers = async (budgetFrom) => ({
  toBuy: Number((await q("SELECT count(*) n FROM items WHERE status = 'to_buy'"))[0].n),
  onTheWay: Number((await q("SELECT count(*) n FROM items WHERE status = 'ordered'"))[0].n),
  history: Number((await q("SELECT count(*) n FROM items WHERE status = 'purchased'"))[0].n),
  urgent: Number((await q("SELECT count(*) n FROM items WHERE status = 'to_buy' AND priority = 'urgent'"))[0].n),
  budget: (await q(budgetFrom === "kv" ? "SELECT value FROM kv WHERE key = ?" : "SELECT value FROM space_pref WHERE key = ?", [`pref:budget:${month}`]))[0]?.value ?? null,
});
const dbHash = async () => {
  const h = createHash("sha256");
  for (const r of await q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
    h.update(String(r.name));
    h.update(JSON.stringify(await q(`SELECT * FROM "${r.name}" ORDER BY 1`)));
  }
  return h.digest("hex");
};
const migrate = () => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env, encoding: "utf8" });

const before = await counts();
const numsBefore = await appNumbers("kv");
const t0 = Date.now();
migrate();
const ms = Date.now() - t0;
const after = await counts();
const numsAfter = await appNumbers("space");
const h1 = await dbHash();
migrate();
const h2 = await dbHash();

let fail = 0;
const ok = (c, m) => {
  if (!c) fail++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}`);
};
const w = Math.max(...DATA.map((t) => t.length));
console.log(`${"table".padEnd(w)}  before   after`);
for (const t of DATA) console.log(`${t.padEnd(w)}  ${String(before[t]).padStart(6)}  ${String(after[t]).padStart(6)}${before[t] === after[t] ? "" : "  MISMATCH"}`);
ok(DATA.every((t) => before[t] === after[t]), "row counts per table equal before/after");
const nulls = [];
for (const t of ["collections", "items", "sources", "price_points", "attachments", "alerts", "alt_groups", "store_settings", "receipts", "conversations", "conversation_messages"]) {
  const n = Number((await q(`SELECT count(*) n FROM "${t}" WHERE space_id IS NULL`))[0].n);
  const notnull = (await q(`PRAGMA table_info("${t}")`)).find((c) => c.name === "space_id")?.notnull;
  if (n || !notnull) nulls.push(t);
}
ok(!nulls.length, `no NULL space_id, column NOT NULL everywhere${nulls.length ? ` (${nulls.join(", ")})` : ""}`);
ok(String((await q("PRAGMA integrity_check"))[0].integrity_check) === "ok", "integrity_check ok");
ok(h1 === h2, "second run is a no-op (whole-DB hash equal)");
console.log(`numbers before: ${JSON.stringify(numsBefore)}`);
console.log(`numbers after:  ${JSON.stringify(numsAfter)}`);
ok(JSON.stringify(numsBefore) === JSON.stringify(numsAfter), "To buy / On the way / History / urgent counts and this month's budget unchanged");
const spaces = await q("SELECT kind, count(*) n FROM space GROUP BY kind");
console.log(`spaces: ${JSON.stringify(spaces)} · migration took ${ms} ms`);

// Synthetic 2 000-item second space (E1 speed checks).
const id = () => randomBytes(12).toString("base64url");
const uid = `bench_${id()}`;
const sid = `bench_${id()}`;
const now = Date.now();
await db.batch(
  [
    { sql: `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Bench', ?, 1, ?, ?)`, args: [uid, `bench-${id()}@example.test`, now, now] },
    { sql: `INSERT INTO space (id, name, slug, kind, created_by, created_at) VALUES (?, 'Bench', ?, 'shared', ?, ?)`, args: [sid, `b-${sid}`, uid, now] },
    { sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`, args: [id(), sid, uid, now] },
  ],
  "write",
);
const stmts = [];
for (let k = 0; k < 2000; k++) {
  const iid = `bi_${id()}`;
  const st = k % 3 === 0 ? "purchased" : k % 3 === 1 ? "ordered" : "to_buy";
  stmts.push({ sql: `INSERT INTO items (id, space_id, title, status, quantity, created_at, updated_at, purchased_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`, args: [iid, sid, `Bench item ${k}`, st, now - k * 60_000, now, st === "purchased" ? now - k * 3_600_000 : null] });
  stmts.push({ sql: `INSERT INTO sources (id, space_id, item_id, url, normalized_url, store, store_key, price, currency, created_at) VALUES (?, ?, ?, ?, ?, 'Bench', 'bench', ?, 'ILS', ?)`, args: [`bs_${id()}`, sid, iid, `https://bench.example/p/${k}`, `bench.example/p/${k}`, 10 + (k % 90), now] });
}
for (let k = 0; k < stmts.length; k += 500) await db.batch(stmts.slice(k, k + 500), "write");
const benchItems = Number((await q("SELECT count(*) n FROM items WHERE space_id = ?", [sid]))[0].n);
ok(benchItems === 2000, `synthetic space: ${benchItems} items (space ${sid.slice(0, 10)}…)`);
db.close();
if (!process.argv.includes("--keep")) console.log(`(copy kept at ${COPY} for the E1 bench)`);
console.log(fail ? `FAIL rehearsal (${fail})` : `OK rehearsal on a copy of ${source}`);
process.exit(fail ? 1 : 0);
