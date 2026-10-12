// R15 B3 guard 2: raw database access (`db.select|insert|update|delete|query|batch|…`) only inside the scoped data
// layer and a short, commented allow-list. Everything else goes through Scoped (space_id from the ctx, never input).
//   npx tsx scripts/test-scope.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const ALLOW: [RegExp, string][] = [
  [/^src\/lib\/db-scoped\//, "the scoped data layer itself (+ system reads for cron fan-out / public tokens)"],
  [/^src\/db\//, "schema + migrations"],
  [/^src\/lib\/auth\//, "auth: sessions, invites, security events, rate limits (no space data)"],
  [/^src\/lib\/spaces\.ts$/, "space + membership rows (the ctx is built from these)"],
  [/^src\/lib\/kv\.ts$/, "system kv only (ai:health, pref:last_check, barcode:*, pic:* caches)"],
  [/^src\/lib\/rates\.ts$/, "system kv: currency rates"],
  [/^src\/lib\/ai-gate\.ts$/, "R17 E2: per-person AI usage + quota (user rows; space/member names only to redact them)"],
];
const RAW = /\bdb\s*\.\s*(select|insert|update|delete|query|batch|run|all|get|values|execute|transaction)\b/;

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

const bad: string[] = [];
let files = 0;
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  // Only modules that can reach the server DB client (client-side IndexedDB helpers also call a local `db`).
  if (!/from\s+["'](@\/db|\.\.?\/(\.\.\/)*db)["']/.test(text)) continue;
  files++;
  if (ALLOW.some(([re]) => re.test(rel))) continue;
  text.split("\n").forEach((line, i) => {
    if (RAW.test(line)) bad.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}
for (const b of bad) console.log(`FAIL raw db outside the data layer: ${b}`);
console.log(bad.length ? `FAIL scope: ${bad.length} raw queries` : `OK scope: ${files} DB-importing files, raw access only in the data layer / allow-list`);

// R18 A1 — Products / Supermarket split. A scoped query that lists items (no id / collection / group condition) must say
// which list it wants (`listIs(...)`, `loadItems(s, …, list)`), or be listed here with the reason it serves both.
const BOTH: [RegExp, string][] = [
  [/^src\/app\/barcode-actions\.ts$/, "a scanned barcode finds the product in either list"],
  [/^src\/lib\/db-scoped\/short-names\.ts$/, "long-title backfill: any list"],
  [/^src\/lib\/picture-backfill\.ts$/, "picture backfill: any list"],
  [/^src\/lib\/product-pictures\.ts$/, "picture search: any list"],
  [/^src\/lib\/data\.ts$/, "loadItems builds its list condition (checked below)"],
  [/^src\/lib\/db-scoped\/changes\.ts$/, "the change feed loads changed rows of both lists and splits them (items / supermarket)"],
  [/^src\/lib\/db-scoped\/(admin|admin-health|account|backup|system|spaces|grocery|trips)\.ts$/, "counts / export / delete / moves / the grocery layer itself: whole space, never a Products view"],
];
const LISTING = /\b(select|pick|count)\(\s*(\{[^}]*\},\s*)?schema\.items\b/;
const NARROW = /schema\.items\.(id|collectionId|altGroupId|list)\b|listIs\(|inArray\(schema\.items\.id/;
const split: string[] = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (BOTH.some(([re]) => re.test(rel))) continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (LISTING.test(line) && !NARROW.test(line)) split.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
}
// The two loaders every Products view reads must filter by list.
const data = readFileSync(join(ROOT, "src/lib/data.ts"), "utf8");
if (!/list: ItemList = ids \? "any" : "products"/.test(data)) split.push("src/lib/data.ts  loadItems() must default to the Products list");
if (!/loadItems\(s, undefined, "products"\)/.test(data) || !/loadItems\(s, undefined, "supermarket"\)/.test(data)) split.push("src/lib/data.ts  getAppData must load Products and Supermarket separately");
const changes = readFileSync(join(ROOT, "src/lib/db-scoped/changes.ts"), "utf8");
if (!/i\.list !== "supermarket"/.test(changes)) split.push("src/lib/db-scoped/changes.ts  the feed's items must exclude supermarket rows");
for (const b of split) console.log(`FAIL list split: ${b}`);
console.log(split.length ? `FAIL list split: ${split.length}` : "OK list split: every item listing names its list (Products / Supermarket) or is allow-listed");
process.exit(bad.length || split.length ? 1 : 0);
