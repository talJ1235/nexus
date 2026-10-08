// R17 rehearsal: run the migration on a COPY of the post-R15 prod snapshot, twice, and check: the change is additive
// (no table or column dropped, every new column nullable or defaulted), row counts per table equal, integrity ok, the
// second run changes nothing, and the To buy / On the way / History counts + this month's budget are unchanged.
// Numbers only — no content is printed.
//   node --env-file=.env.local scripts/r17-rehearsal.mjs [--source snapshots/x.db] [--base origin/main]
// --base: migrate the copy with that git ref's src/db first (= what prod runs today), so only R17's changes are measured. Then B1's short-name backfill (rules only, no AI) runs on the copy and
// is checked: only items whose title is longer than 50 characters change, only title / full_title / quantity..
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const i = process.argv.indexOf("--source");
const source = i > 0 ? process.argv[i + 1] : "snapshots/prod-2026-10-06-post.db";
if (!existsSync(source)) {
  console.error(`FAIL no snapshot at ${source}`);
  process.exit(2);
}
const COPY = "snapshots/rehearsal-r17.db";
for (const f of [COPY, `${COPY}-journal`, `${COPY}-wal`, `${COPY}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync(source, COPY);
const env = { ...process.env, TURSO_DATABASE_URL: `file:${COPY}`, TURSO_AUTH_TOKEN: "", VERCEL: "" };
const b = process.argv.indexOf("--base");
if (b > 0) {
  const ref = process.argv[b + 1];
  const dir = ".rehearse-base";
  rmSync(dir, { recursive: true, force: true });
  for (const f of execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "src/db", "src/lib/categories.ts", "drizzle"], { encoding: "utf8" }).split("\n").filter(Boolean)) {
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
ok(String((await q("PRAGMA integrity_check"))[0].integrity_check) === "ok", "integrity_check ok");
ok(h1 === h2, "second run is a no-op (whole-DB hash equal)");
console.log(`numbers before: ${JSON.stringify(numsBefore)}`);
console.log(`numbers after:  ${JSON.stringify(numsAfter)}`);
ok(JSON.stringify(numsBefore) === JSON.stringify(numsAfter), "To buy / On the way / History counts and this month's budget unchanged");
console.log(`items ${before.items} · migration took ${ms} ms`);

// B1: the short-name backfill (rules only) on the migrated copy — only long titles change, only these columns.
const itemCols = ["title", "full_title", "quantity"];
const snap = async () => Object.fromEntries((await q("SELECT * FROM items ORDER BY id")).map((r) => [String(r.id), r]));
const itemsBefore = await snap();
const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--conditions=react-server", "scripts/lib/backfill-cli.ts"], { env, encoding: "utf8" });
const bf = JSON.parse(out.trim().split("\n").pop());
const itemsAfter = await snap();
let otherCols = 0;
let shortTouched = 0;
let changed = 0;
for (const [id, a] of Object.entries(itemsAfter)) {
  const b0 = itemsBefore[id];
  const diffCols = Object.keys(a).filter((k) => String(a[k]) !== String(b0[k]) && !["rev", "rev_by", "updated_at"].includes(k));
  if (!diffCols.length) continue;
  changed++;
  if (diffCols.some((k) => !itemCols.includes(k))) otherCols++;
  if (String(b0.title).length <= 50) shortTouched++;
  if (a.full_title !== b0.title) otherCols++;
}
const longTitles = Object.values(itemsBefore).filter((r) => String(r.title).length > 50).length;
console.log(`backfill (rules only): ${JSON.stringify(bf)} · items with a title > 50 chars: ${longTitles} · changed: ${changed}`);
ok(Object.keys(itemsAfter).length === Object.keys(itemsBefore).length, "backfill: item count unchanged");
ok(otherCols === 0, "backfill: only title / full_title / quantity change, and full_title = the old title");
ok(shortTouched === 0, "backfill: no item with a title of ≤ 50 characters changes");
ok(JSON.stringify(await appNumbers()) === JSON.stringify(numsBefore), "backfill: To buy / On the way / History counts unchanged");
console.log(fail ? `FAIL rehearsal (${fail})` : `OK R17 rehearsal on a copy of ${source}`);
// The copy is left for the OS to release (closing the native client here crashes on Windows); it is git-ignored and
// replaced on the next run.
process.exit(fail ? 1 : 0);
