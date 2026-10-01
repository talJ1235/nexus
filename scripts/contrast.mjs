// Text contrast check for the four themes (Round 7 A1). Parses the token blocks in src/app/globals.css and checks
// every text-on-background pair the UI uses against WCAG AA (4.5:1). Usage: node scripts/contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const block = (sel) => {
  const i = css.indexOf(`${sel} {`);
  if (i < 0) throw new Error(`missing ${sel}`);
  const body = css.slice(i, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const base = block(":root");
const themes = {
  "graphite light": base,
  "graphite dark": { ...base, ...block(".dark") },
  "plum light": { ...base, ...block(':root[data-palette="plum"]') },
  "plum dark": { ...base, ...block(".dark"), ...block(':root[data-palette="plum"]'), ...block(':root[data-palette="plum"].dark') },
};

const parse = (c) => {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`can't parse colour ${c}`);
};
const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const heroStops = (v) => [...v.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);

const pairs = [
  ["ink", "bg"], ["ink", "surface"], ["ink", "surface-2"],
  ["muted", "bg"], ["muted", "surface"], ["muted", "surface-2"],
  ["faint", "surface"], ["faint", "bg"],
  ["on-brand", "brand"], ["tint-ink", "tint"], ["tint-ink", "surface"],
  ["ok", "surface"], ["danger", "surface"], ["danger", "danger-soft"], ["info", "surface"],
];
let fails = 0;
for (const [name, t] of Object.entries(themes)) {
  const bad = [];
  for (const [f, b] of pairs) {
    const bgc = parse(t[b] === undefined ? "#000000" : t[b]);
    const solidBg = bgc[3] < 1 ? over(bgc, parse(t.surface)) : bgc;
    const r = ratio(over(parse(t[f]), solidBg), solidBg);
    if (r < 4.5) bad.push(`${f} on ${b} ${r.toFixed(2)}`);
  }
  for (const stop of heroStops(t.hero)) {
    const r = ratio(parse(t["on-hero"]), parse(stop));
    if (r < 4.5) bad.push(`on-hero on hero ${stop} ${r.toFixed(2)}`);
  }
  fails += bad.length;
  console.log(bad.length ? `FAIL ${name}: ${bad.join(", ")}` : `PASS ${name}`);
}
process.exit(fails ? 1 : 0);
