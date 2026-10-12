// R18 rehearsal: run the migration on a COPY of a prod snapshot, twice, and check: the change is additive (no table or
// column dropped, every new column nullable or defaulted), row counts per table equal, integrity ok, the second run changes
// nothing, every item has a list (no NULL `list`), the item count is equal in total (Products + Supermarket), and the
// To buy / On the way / History counts + this month's budget are unchanged in total. The grocery move (items in a
// collection named like groceries → the Supermarket list) is reported as counts per space (no names, no content).
//   node scripts/r18-rehearsal.mjs --source snapshots/prod-<date>.db [--base origin/main]
// --base: migrate the copy with that git ref's src/db first (= what prod runs today), so only R18's changes are measured.
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const i = process.argv.indexOf("--source");
const source = i > 0 ? process.argv[i + 1] : "snapshots/prod-2026-10-12.db";
if (!existsSync(source)) {
  console.error(`FAIL no snapshot at ${source}`);
  process.exit(2);
}
const COPY = "snapshots/rehearsal-r18.db";
for (const f of [COPY, `${COPY}-journal`, `${COPY}-wal`, `${COPY}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync(source, COPY);
const env = { ...process.env, TURSO_DATABASE_URL: `file:${COPY}`, TURSO_AUTH_TOKEN: "", VERCEL: "" };
const b = process.argv.indexOf("--base");
if (b > 0) {
  const ref = process.argv[b + 1];
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

const hadMarker = (await q("SELECT name FROM sqlite_master WHERE name = 'kv'")).length ? (await q("SELECT 1 FROM kv WHERE key = 'migrate:r18:groceries'")).length === 1 : false;
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
// The one row R18 adds to an existing table: kv's once-marker of the grocery move.
const markerNew = !hadMarker && (await q("SELECT 1 FROM kv WHERE key = 'migrate:r18:groceries'")).length === 1;
const diff = oldTables.filter((t) => before[t] !== after[t] - (t === "kv" && markerNew ? 1 : 0));
ok(!diff.length, `row counts equal in all ${oldTables.length} existing tables (kv + its one marker row)${diff.length ? ` (${diff.map((t) => `${t} ${before[t]}→${after[t]}`).join(", ")})` : ""}`);
ok(String((await q("PRAGMA integrity_check"))[0].integrity_check) === "ok", "integrity_check ok");
ok(h1 === h2, "second run is a no-op (whole-DB hash equal)");
console.log(`numbers before: ${JSON.stringify(numsBefore)}`);
console.log(`numbers after:  ${JSON.stringify(numsAfter)}`);
ok(JSON.stringify(numsBefore) === JSON.stringify(numsAfter), "To buy / On the way / History counts and this month's budget unchanged");
console.log(`items ${before.items} · migration took ${ms} ms`);

// R18: every item has a list; the grocery move, as counts.
const lists = await q("SELECT list, count(*) n FROM items GROUP BY list");
console.log(`items per list: ${lists.map((r) => `${r.list ?? "NULL"} ${r.n}`).join(" · ")}`);
ok(Number((await q("SELECT count(*) n FROM items WHERE list IS NULL"))[0].n) === 0, "no NULL list");
ok(lists.reduce((a, r) => a + Number(r.n), 0) === before.items, "item count equal in total (Products + Supermarket)");
const moved = (await q("SELECT value FROM kv WHERE key = 'migrate:r18:groceries'"))[0]?.value;
const mv = moved ? JSON.parse(String(moved)) : null;
ok(!!mv, "the grocery move ran once (marker written)");
if (mv) console.log(`grocery move: ${mv.collections} grocery-named collection(s); moved per space: ${Object.values(mv.moved).join(", ") || "none"} (space ids withheld)`);
ok(Number((await q("SELECT count(*) n FROM items WHERE list = 'supermarket' AND (section IS NULL OR product_key IS NULL)"))[0].n) === 0, "every moved item has a section + product key");
for (const t of ["trip", "trip_check", "space_store", "suggest_dismiss", "template", "staple_add"]) ok(newTables.includes(t), `new table ${t}`);
console.log(fail ? `FAIL rehearsal (${fail})` : `OK R18 rehearsal on a copy of ${source}`);
// The copy is left for the OS to release (closing the native client here crashes on Windows); it is git-ignored and
// replaced on the next run.
process.exit(fail ? 1 : 0);
