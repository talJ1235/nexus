// R18 Session 4 rehearsal: no schema change in S4 — this tries the one data change (A1: "+ ×N" / "+ 2 kg" note
// fragments the old merge wrote go back into the rows' measures, run by the daily cron) on a COPY of a prod snapshot:
// migrate (must change nothing), count the rows it would touch, run the cleanup for every space, check that only those
// rows changed (and only their quantity / count / amount / unit / notes), that every fragment is gone, that other note
// text stays, and that a second run changes nothing.
//   npx tsx --conditions=react-server scripts/r18s4-rehearsal.ts [--source snapshots/prod-<date>.db]
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";

const i = process.argv.indexOf("--source");
const newest = existsSync("snapshots") ? readdirSync("snapshots").filter((f) => /^prod-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().pop() : null;
const source = i > 0 ? process.argv[i + 1] : newest ? `snapshots/${newest}` : "snapshots/prod-missing.db";
if (!existsSync(source)) {
  console.error(`FAIL no snapshot at ${source}`);
  process.exit(2);
}
const COPY = "snapshots/rehearsal-r18s4.db";
for (const f of [COPY, `${COPY}-journal`, `${COPY}-wal`, `${COPY}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync(source, COPY);
process.env.TURSO_DATABASE_URL = `file:${COPY}`;
process.env.TURSO_AUTH_TOKEN = "";

(async () => {
  const { createClient } = await import("@libsql/client");
  const raw = createClient({ url: `file:${COPY}` });
  const q = async (sql: string, args: (string | number)[] = []) => (await raw.execute({ sql, args })).rows;
  const tables = async () => (await q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => String(r.name));
  const shape = async () => JSON.stringify(await Promise.all((await tables()).map(async (t) => [t, (await q(`PRAGMA table_info("${t}")`)).map((c) => String(c.name))])));
  const before = await shape();
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });
  const migrated = await shape();
  if (before !== migrated) throw new Error("the migration changed the schema (S4 has no schema change)");
  const FRAG = /(^|· )\+ (×\d{1,3}|\d+(\.\d+)? (kg|g|L))( ·|$)/;
  const snap = async () => (await q("SELECT id, space_id, quantity, count, amount, unit, notes, title, updated_at FROM items WHERE list = 'supermarket'")).map((r) => ({ ...r }));
  const rows0 = await snap();
  const dirty = rows0.filter((r) => FRAG.test(String(r.notes ?? "")));
  console.log(`supermarket rows: ${rows0.length}; with old merge notes: ${dirty.length}`);

  const { schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const G = await import("../src/lib/db-scoped/grocery");
  const spaces = (await q("SELECT id, created_by FROM space")).map((r) => ({ id: String(r.id), owner: String(r.created_by ?? "system") }));
  let fixed = 0;
  for (const sp of spaces) fixed += await G.cleanMergeNoteRows(new Scoped({ spaceId: sp.id, userId: sp.owner, by: "system" }));
  void schema;
  const rows1 = await snap();
  const byId = new Map(rows1.map((r) => [String(r.id), r]));
  const changed = rows0.filter((r) => {
    const n = byId.get(String(r.id))!;
    return ["quantity", "count", "amount", "unit", "notes"].some((k) => String((r as Record<string, unknown>)[k]) !== String((n as Record<string, unknown>)[k]));
  });
  const titlesKept = rows0.every((r) => byId.get(String(r.id))?.title === r.title);
  const stillDirty = rows1.filter((r) => FRAG.test(String(r.notes ?? ""))).length;
  if (fixed !== dirty.length) throw new Error(`fixed ${fixed}, expected ${dirty.length}`);
  if (changed.some((r) => !dirty.some((d) => d.id === r.id))) throw new Error("a row without old merge notes changed");
  if (stillDirty) throw new Error(`${stillDirty} rows still carry merge notes`);
  if (!titlesKept || rows1.length !== rows0.length) throw new Error("rows lost or renamed");
  for (const r of dirty) {
    const n = byId.get(String(r.id))!;
    console.log(`  ${String(r.id).slice(0, 8)}… q${r.quantity} c${r.count ?? "-"} ${r.amount ?? "-"}${r.unit ?? ""} "${r.notes}" → q${n.quantity} c${n.count ?? "-"} ${n.amount ?? "-"}${n.unit ?? ""} "${n.notes ?? ""}"`);
  }
  let again = 0;
  for (const sp of spaces) again += await G.cleanMergeNoteRows(new Scoped({ spaceId: sp.id, userId: sp.owner, by: "system" }));
  if (again) throw new Error(`the second run changed ${again} rows`);
  const integrity = String((await q("PRAGMA integrity_check"))[0].integrity_check);
  if (integrity !== "ok") throw new Error(`integrity: ${integrity}`);
  console.log(`OK r18s4 rehearsal on ${source}: schema unchanged, ${fixed} rows cleaned (only those, only their measures + notes), second run 0, integrity ok`);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
