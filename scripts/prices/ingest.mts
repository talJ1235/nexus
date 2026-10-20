// R19 B2 — read a folder of transparency files (scripts/prices/fetch.py) into the price tables, writing only changes.
//   npx tsx scripts/prices/ingest.mts --dump prices-dump [--dry] [--report report.json]
//   npx tsx scripts/prices/ingest.mts --plan plan.txt [--sample 12]   (which stores fetch.py should download: --stores)
// DB: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN). Without them it runs dry against an empty scratch DB and says so.
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { ingestDump, planStores } from "../../src/lib/prices/ingest";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const has = (n: string) => process.argv.includes(n);

let url = process.env.TURSO_DATABASE_URL;
let dry = has("--dry");
if (!url) {
  // No secrets (a fork, a first run): read the files into a scratch DB so the counts still show — nothing is kept.
  // One scratch file per job (PRICES_DRY_DB), so the Stores step's branches reach the plan step.
  const f = process.env.PRICES_DRY_DB || join(mkdtempSync(join(tmpdir(), "nexus-prices-dry-")), "dry.db");
  execSync("npx tsx src/db/migrate.ts", { env: { ...process.env, TURSO_DATABASE_URL: `file:${f}` }, stdio: "ignore" });
  url = `file:${f}`;
  console.log("DRY no TURSO_DATABASE_URL — reading into a scratch DB, nothing is written to the real one");
  dry = false;
}
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

if (arg("--plan")) {
  const plan = await planStores(db, Number(arg("--sample") ?? 12));
  // fetch.py --stores "CHAIN:1,7;OTHER:3"
  const line = Object.entries(plan).map(([c, ids]) => `${c}:${ids.join(",")}`).join(";");
  writeFileSync(arg("--plan")!, line);
  console.log(`OK plan ${Object.keys(plan).length} chains, ${Object.values(plan).reduce((a, b) => a + b.length, 0)} stores`);
  process.exit(0);
}

const dump = arg("--dump");
if (!dump) {
  console.error("usage: --dump <dir> [--dry] | --plan <file>");
  process.exit(2);
}
const r = await ingestDump(db, dump, { dry, log: (s) => console.log(`  ${s}`) });
for (const c of r.chains)
  console.log(
    `${c.error ? "FAIL" : "OK  "} ${c.id.padEnd(22)} files ${JSON.stringify(c.files)} · branches ${c.branches} · products ${c.products} · chain prices +${c.chainPrices.new} ~${c.chainPrices.changed} · own prices ${c.branchPrices} · deals ${c.promos} · ${c.ms} ms${c.error ? ` · ${c.error}` : ""}`,
  );
console.log(`SUMMARY ${r.chains.length} chains · catalog +${r.catalog.new} ~${r.catalog.changed} of ${r.catalog.total} · ${r.writes} row writes · ${r.reads} rows read · ${Math.round(r.ms / 1000)} s${dry ? " (dry: nothing written)" : ""}`);
if (arg("--report")) writeFileSync(arg("--report")!, JSON.stringify(r, null, 1));
process.exit(r.chains.some((c) => c.error) ? 1 : 0);
