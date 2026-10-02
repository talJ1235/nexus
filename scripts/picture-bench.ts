// Real-key bench for product pictures (Round 10 D5): runs D1 → D2 → D3 on 10 grocery receipt lines and 5 maker
// parts with the machine's GEMINI_API_KEY / SERPER_API_KEY, prints what was chosen, and writes a labelled contact
// sheet (chosen picture + alternatives per line) to judge the hit rate by eye.
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/picture-bench.ts [out.png]
import sharp from "sharp";
import { picturesFor } from "../src/lib/product-pictures";

const LINES = [
  "חלב תנ 3% 1ל'",
  "מילקי שוקו 3*100",
  "קוטג' תנובה 5% 250 גר",
  "במבה אסם 80 גר",
  "לחם אחיד פרוס אנג'ל",
  "ביצים L 12 יח'",
  "יוגורט דנונה 1.5%",
  "שוקו יטבתה 1 ל",
  "פסטה ספגטי אסם 500 גר",
  "קפה נמס עלית 200 גר",
  "NEMA 17 stepper motor 42-40 1.5A",
  "TMC2209 stepper driver",
  "Raspberry Pi 5 8GB",
  "Elegoo PLA 1.75mm 1kg red",
  "GT2 timing belt 6mm 5m",
];

async function main() {
  const t0 = Date.now();
  const out = await picturesFor(LINES.map((name) => ({ name })), 120_000);
  console.log(`${LINES.length} lines in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const rows: Buffer[] = [];
  const W = 150;
  for (const [i, r] of out.entries()) {
    const c = r.ranked.chosen;
    console.log(`${String(i + 1).padStart(2)}. ${LINES[i]}  →  ${r.info.nameEn} | ${c ? `${c.source} ${c.domain ?? ""}` : "none"}${r.ranked.check ? " (check)" : ""} · ${r.ranked.candidates.length} alts`);
    const tiles = await Promise.all(
      r.ranked.candidates.slice(0, 5).map(async (cand, k) => {
        try {
          const buf = cand.url.startsWith("data:") ? Buffer.from(cand.url.split(",")[1], "base64") : Buffer.from(await (await fetch(cand.url, { signal: AbortSignal.timeout(8000) })).arrayBuffer());
          const img = await sharp(buf, { failOn: "none" }).flatten({ background: "#fff" }).resize(W, W, { fit: "contain", background: "#fff" }).toBuffer();
          return { input: img, left: 300 + k * (W + 6), top: 0 };
        } catch {
          return null;
        }
      }),
    );
    const label = Buffer.from(
      `<svg width="296" height="${W}"><rect width="100%" height="100%" fill="${r.ranked.check ? "#fff3cd" : "#e8f5e9"}"/><text x="6" y="22" font-size="15" font-family="sans-serif">${i + 1}. ${esc(LINES[i])}</text><text x="6" y="46" font-size="13" font-family="sans-serif" fill="#444">${esc(r.info.nameEn)}</text><text x="6" y="68" font-size="12" font-family="sans-serif" fill="#666">${c ? `${c.source} · ${esc(c.domain ?? "")}` : "no picture"}${r.ranked.check ? " · check" : ""}</text></svg>`,
    );
    rows.push(
      await sharp({ create: { width: 300 + 5 * (W + 6), height: W, channels: 3, background: "#fafafa" } })
        .composite([{ input: label, left: 0, top: 0 }, ...tiles.filter((t): t is NonNullable<typeof t> => !!t)])
        .png()
        .toBuffer(),
    );
  }
  const file = process.argv[2] ?? "picture-bench.png";
  await sharp({ create: { width: 300 + 5 * (W + 6), height: rows.length * (W + 4), channels: 3, background: "#999" } })
    .composite(rows.map((input, i) => ({ input, left: 0, top: i * (W + 4) })))
    .png()
    .toFile(file);
  console.log(`contact sheet → ${file}`);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

void main().then(() => process.exit(0));
