// R17 S7 X1 — refresh the vendored snapshot of EasyList's generic cosmetic rules (`##selector` with no domain), used by
// `test:adblock` to make sure no ad blocker hides a part of the app. Run by hand now and then; commit the result.
//   node scripts/refresh-easylist.mjs
import { writeFileSync } from "node:fs";

const SRC = "https://easylist.to/easylist/easylist.txt";
const OUT = "scripts/fixtures/easylist-generic.txt";

const res = await fetch(SRC);
if (!res.ok) throw new Error(`${SRC}: ${res.status}`);
const text = await res.text();
const version = text.match(/^! Version: (.+)$/m)?.[1] ?? "?";
// Generic element hiding only: `##sel` at the start of the line (no domain before it). Exceptions (`#@#`), extended
// (`#?#`, `#$#`) and procedural (`:-abp-…`) rules aren't plain CSS — skipped.
const rules = [...new Set(text.split(/\r?\n/).filter((l) => l.startsWith("##") && !l.includes(":-abp-")).map((l) => l.slice(2)))];
writeFileSync(OUT, `! EasyList generic cosmetic selectors — ${SRC} version ${version}, ${rules.length} rules (scripts/refresh-easylist.mjs)\n${rules.join("\n")}\n`);
console.log(`${OUT}: ${rules.length} rules (EasyList ${version})`);
