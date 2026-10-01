// Contact sheet for the receipt bench: true quad (green) and, with a detections JSON from `--dump`, the found quad (magenta).
//   [ONLY=03,14] node scripts/receipt-bench/sheet.mjs <dir> <out.jpg> [from] [count] [detections.json]
import sharp from "sharp";
import { readFileSync } from "node:fs";
const dir = process.argv[2], out = process.argv[3], from = +process.argv[4] || 0, n = +process.argv[5] || 16;
const det = process.argv[6] ? JSON.parse(readFileSync(process.argv[6], "utf8")) : {};
const labels = JSON.parse(readFileSync(dir + "/labels.json", "utf8"));
const only = process.env.ONLY?.split(",");
const files = Object.keys(labels).filter((f) => !only || only.some((o) => f.startsWith(o))).slice(from, from + n);
const T = 260, cols = 8;
const tiles = await Promise.all(files.map(async (f) => {
  const l = labels[f]; const k = T / Math.max(l.w, l.h);
  const poly = (c, col) => `<polygon points="${c.map(p => `${p.x * k},${p.y * k}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2"/>`;
  const svg = `<svg width="${T}" height="${T}">${poly(l.corners, "#0f0")}${det[f] ? poly(det[f], "#f0f") : ""}<text x="4" y="14" fill="#ff0" font-size="13" font-family="Arial">${f}</text></svg>`;
  const img = await sharp(dir + "/" + f).resize(Math.round(l.w * k), Math.round(l.h * k)).extend({ right: T - Math.round(l.w * k), bottom: T - Math.round(l.h * k), background: "#333" }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  return img;
}));
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * T, height: rows * T, channels: 3, background: "#222" } }).composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * T, top: Math.floor(i / cols) * T }))).jpeg({ quality: 80 }).toFile(out);
