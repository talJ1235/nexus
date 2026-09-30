// Regenerate the PNG icons from the SVG sources (re-run after changing public/icons/*.svg):
//   node scripts/icons.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";

const icon = readFileSync("public/icons/icon.svg");
const maskable = readFileSync("public/icons/maskable.svg");
const jobs = [
  [icon, 48, "public/icons/favicon-48.png"],
  [icon, 192, "public/icons/icon-192.png"],
  [icon, 512, "public/icons/icon-512.png"],
  [maskable, 512, "public/icons/maskable-512.png"],
  ...[16, 32, 48, 128].map((n) => [icon, n, `extension/icons/icon-${n}.png`]),
];
for (const [svg, size, out] of jobs) {
  // Render at a high density so small sizes are downsampled (crisp), not rasterised at 32 px and scaled up.
  await sharp(svg, { density: Math.max(72, (72 * size) / 32) * 2 }).resize(size, size).png().toFile(out);
  console.log(`${out} ${size}px`);
}
