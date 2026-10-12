// R17 S7 W3 — no new width check decides "phone or computer UI". That's the device class (useDevice / isPhone /
// the phone: and desk: variants, src/lib/device.ts) — browser zoom shrinks the width and turned a PC into the phone UI.
// Flags Tailwind lg:/max-lg:, matchMedia / useMedia with a width, and CSS @media width queries in src/; each kept one
// (it only sizes things inside a layout) is listed in scripts/device-width-allow.txt as `path | snippet of the line`.
//   npm run test:device-width        (no build)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOW = readFileSync("scripts/device-width-allow.txt", "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const [path, ...rest] = l.split(" | ");
    return { path: path.trim(), snip: rest.join(" | ").trim(), used: 0 };
  });
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(f)) files.push(p.replace(/\\/g, "/"));
  }
};
walk("src");
const RULES = [
  [/\.(tsx?)$/, /(?:^|[\s"'`{(])(?:max-)?lg:/],
  [/\.(tsx?)$/, /(?:matchMedia|useMedia)\([^)]*width/],
  [/\.(tsx?)$/, /"\((?:max|min)-width:\s*\d+px\)"/],
  [/\.css$/, /@media[^{]*width/],
];
const bad = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!RULES.some(([ext, re]) => ext.test(f) && re.test(line))) return;
    const a = ALLOW.find((x) => x.path === f && line.includes(x.snip));
    if (a) a.used++;
    else bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}
const stale = ALLOW.filter((a) => !a.used).map((a) => `${a.path} | ${a.snip}`);
for (const b of bad) console.log(`FAIL width check that may choose the UI (use useDevice / phone: / desk:, or allow-list it): ${b}`);
for (const s of stale) console.log(`FAIL allow-list entry matches nothing (remove it): ${s}`);
console.log(bad.length || stale.length ? `FAIL ${bad.length + stale.length} check(s)` : `OK device-width (${files.length} files, ${ALLOW.length} kept width checks)`);
process.exit(bad.length || stale.length ? 1 : 0);
