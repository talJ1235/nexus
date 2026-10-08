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
process.exit(bad.length ? 1 : 0);
