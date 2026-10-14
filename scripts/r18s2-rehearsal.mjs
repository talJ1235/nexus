// R18 Session 2 rehearsal: run the migration on a COPY of a prod snapshot (first migrated with --base = what prod runs today,
// so only S2's changes are measured), twice, and check: additive only (nothing dropped, every new column nullable or
// defaulted), the new columns / tables are exactly S2's list below (nothing else changed), row counts per table equal,
// integrity ok, the second run changes nothing, the app's numbers (To buy / On the way / History / this month's budget and
// the supermarket list) unchanged, and the new columns hold nothing yet (no data step in S2).
//   node scripts/r18s2-rehearsal.mjs --source snapshots/prod-<date>.db [--base origin/main]   (default: the newest snapshot)
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

/** S2's additions — extended by every item that adds a column or table. */
const EXPECT_COLUMNS = ["items.count", "suggest_dismiss.skips", "suggest_dismiss.skipped_at", "suggest_dismiss.hidden_at", "suggest_dismiss.hidden_by", ...["made_by", "routine_day", "routine_trips", "kept_at", "dismissed_at", "edited_at", "updated_at", "used_at"].map((c) => `template.${c}`)];
const EXPECT_TABLES = [];
import { dirname } from "node:path";

const i = process.argv.indexOf("--source");
const newest = existsSync("snapshots") ? readdirSync("snapshots").filter((f) => /^prod-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().pop() : null;
const source = i > 0 ? process.argv[i + 1] : newest ? `snapshots/${newest}` : "snapshots/prod-missing.db";
if (!existsSync(source)) {
  console.error(`FAIL no snapshot at ${source}`);
  process.exit(2);
}
const COPY = "snapshots/rehearsal-r18s2.db";
for (const f of [COPY, `${COPY}-journal`, `${COPY}-wal`, `${COPY}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync(source, COPY);
const env = { ...process.env, TURSO_DATABASE_URL: `file:${COPY}`, TURSO_AUTH_TOKEN: "", VERCEL: "" };
const b = process.argv.indexOf("--base");
{
  const ref = b > 0 ? process.argv[b + 1] : "origin/main";
  const dir = ".rehearse-base";
  rmSync(dir, { recursive: true, force: true });
  for (const f of execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "src/db", "src/lib/categories.ts", "src/lib/grocery", "drizzle"], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    mkdirSync(dirname(`${dir}/${f}`), { recursive: true });
    writeFileSync(`${dir}/${f}`, execFileSync("git", ["show", `${ref}:${f}`]));
  }
  execFileSync(process.execPath, ["../node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { cwd: dir, env: { ...env, TURSO_DATABASE_URL: `file:../${COPY}` }, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  console.log(`base: migrated with ${ref}`);
}
const db = createClient({ url: `file:${COPY}` });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const tables = async () => (await q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => String(r.name));
const schema = async () => {
  const out = {};
  for (const t of await tables()) out[t] = (await q(`PRAGMA table_info("${t}")`)).map((c) => ({ name: String(c.name), notnull: Number(c.notnull), dflt: c.dflt_value, pk: Number(c.pk) }));
  return out;
};
const counts = async (names) => Object.fromEntries(await Promise.all(names.map(async (t) => [t, Number((await q(`SELECT count(*) n FROM "${t}"`))[0].n)])));
const month = new Date().toISOString().slice(0, 7);
const appNumbers = async () => ({
  toBuy: Number((await q("SELECT count(*) n FROM items WHERE status = 'to_buy'"))[0].n),
  onTheWay: Number((await q("SELECT count(*) n FROM items WHERE status = 'ordered'"))[0].n),
  history: Number((await q("SELECT count(*) n FROM items WHERE status = 'purchased'"))[0].n),
  pricedHistory: Number((await q("SELECT count(*) n FROM items WHERE status = 'purchased' AND purchased_price IS NOT NULL"))[0].n),
  budget: (await q("SELECT value FROM space_pref WHERE key = ?", [`pref:budget:${month}`]))[0]?.value ?? null,
  supermarket: Number((await q("SELECT count(*) n FROM items WHERE list = 'supermarket' AND status = 'to_buy'"))[0].n),
  products: Number((await q("SELECT count(*) n FROM items WHERE list = 'products'"))[0].n),
});
const dbHash = async () => {
  const h = createHash("sha256");
  for (const t of await tables()) {
    h.update(t);
    h.update(JSON.stringify(await q(`SELECT * FROM "${t}" ORDER BY 1`)));
  }
  return h.digest("hex");
};
const migrate = () => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env, encoding: "utf8" });

const schemaBefore = await schema();
const oldTables = Object.keys(schemaBefore);
const before = await counts(oldTables);
const numsBefore = await appNumbers();
const t0 = Date.now();
migrate();
const ms = Date.now() - t0;
const schemaAfter = await schema();
const after = await counts(oldTables);
const numsAfter = await appNumbers();
const h1 = await dbHash();
migrate();
const h2 = await dbHash();

let fail = 0;
const ok = (c, m) => {
  if (!c) fail++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}`);
};
const dropped = [];
const added = [];
const unsafe = [];
for (const t of oldTables) {
  if (!schemaAfter[t]) {
    dropped.push(t);
    continue;
  }
  const names = new Set(schemaAfter[t].map((c) => c.name));
  for (const c of schemaBefore[t]) if (!names.has(c.name)) dropped.push(`${t}.${c.name}`);
  const old = new Set(schemaBefore[t].map((c) => c.name));
  for (const c of schemaAfter[t]) {
    if (old.has(c.name)) continue;
    added.push(`${t}.${c.name}`);
    if (c.notnull && c.dflt == null && !c.pk) unsafe.push(`${t}.${c.name}`);
  }
}
const newTables = Object.keys(schemaAfter).filter((t) => !schemaBefore[t]);
console.log(`new tables: ${newTables.join(", ") || "none"}`);
console.log(`new columns: ${added.length} (${[...new Set(added.map((a) => a.split(".")[0]))].join(", ")})`);
ok(!dropped.length, `nothing dropped${dropped.length ? ` (${dropped.join(", ")})` : ""}`);
ok(!unsafe.length, `every new column nullable or defaulted${unsafe.length ? ` (${unsafe.join(", ")})` : ""}`);
const diff = oldTables.filter((t) => before[t] !== after[t]);
ok(!diff.length, `row counts equal in all ${oldTables.length} existing tables${diff.length ? ` (${diff.map((t) => `${t} ${before[t]}→${after[t]}`).join(", ")})` : ""}`);
const extraCols = added.filter((c) => !EXPECT_COLUMNS.includes(c));
const missingCols = EXPECT_COLUMNS.filter((c) => !added.includes(c));
ok(!extraCols.length && !missingCols.length, `new columns are exactly S2's (${EXPECT_COLUMNS.join(", ")})${extraCols.length ? ` extra: ${extraCols.join(", ")}` : ""}${missingCols.length ? ` missing: ${missingCols.join(", ")}` : ""}`);
ok(JSON.stringify([...newTables].sort()) === JSON.stringify([...EXPECT_TABLES].sort()), `new tables are exactly S2's (${EXPECT_TABLES.join(", ") || "none"})`);
for (const c of EXPECT_COLUMNS) {
  const [t, col] = c.split(".");
  ok(Number((await q(`SELECT count(*) n FROM "${t}" WHERE "${col}" IS NOT NULL`))[0].n) === 0, `${c} holds nothing yet`);
}
ok(String((await q("PRAGMA integrity_check"))[0].integrity_check) === "ok", "integrity_check ok");
ok(h1 === h2, "second run is a no-op (whole-DB hash equal)");
console.log(`numbers before: ${JSON.stringify(numsBefore)}`);
console.log(`numbers after:  ${JSON.stringify(numsAfter)}`);
ok(JSON.stringify(numsBefore) === JSON.stringify(numsAfter), "To buy / On the way / History counts and this month's budget unchanged");
console.log(`items ${before.items} · migration took ${ms} ms`);

console.log(fail ? `FAIL rehearsal (${fail})` : `OK R18 S2 rehearsal on a copy of ${source}`);
// The copy is left for the OS to release (closing the native client here crashes on Windows); it is git-ignored and
// replaced on the next run.
process.exit(fail ? 1 : 0);
