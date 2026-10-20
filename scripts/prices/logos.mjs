// R19 A10 — each chain's logo from its own website (apple-touch-icon → largest icon → og:image → an <img> named "logo"),
// squared onto white at 128 px webp in public/chains/<id>.webp; the source URL + date go to public/chains/sources.json.
//   node scripts/prices/logos.mjs [--only shufersal,rami-levy] [--force]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SITES = {
  shufersal: "https://www.shufersal.co.il/online/he/",
  "rami-levy": "https://www.rami-levy.co.il/he",
  victory: "https://www.victoryonline.co.il/",
  yochananof: "https://yochananof.co.il/",
  "osher-ad": "https://osherad.co.il/",
  "tiv-taam": "https://www.tivtaam.co.il/",
  carrefour: "https://www.carrefour.co.il/",
  "hatzi-hinam": "https://shop.hazi-hinam.co.il/",
  "am-pm": "https://www.ampm.co.il/",
  "keshet-teamim": "https://www.keshet-teamim.co.il/",
  "super-yuda": "https://www.yuda.co.il/",
  "mahsanei-hashuk": "https://www.mck.co.il/",
  "king-store": "https://www.kingstore.co.il/",
  freshmarket: "https://www.freshmarket.co.il/",
  "netiv-hahesed": "https://www.netivhahesed.co.il/",
  "zol-vebegadol": "https://www.zolvebegadol.com/",
  "shuk-hair": "https://www.shukcity.co.il/",
  "city-market": "https://www.citymarket.co.il/",
  "city-market-kg": "https://www.citymarket.co.il/",
  "stop-market": "https://www.stopmarket.co.il/",
  "maayan-2000": "https://www.maayan2000.co.il/",
  "shefa-birkat-hashem": "https://www.shefa-birkat-hashem.co.il/",
  "mishnat-yosef": "https://new.mishnatyosef.org/",
  "mishnat-yosef-online": "https://new.mishnatyosef.org/",
  bareket: "https://www.superbareket.co.il/",
  polizer: "https://www.polizer.co.il/",
  "salach-dabach": "https://www.dabach.co.il/",
  "super-sapir": "https://www.supersapir.co.il/",
  "het-cohen": "https://www.hcohen.co.il/",
  yellow: "https://www.yellow.co.il/",
  "wolt-market": "https://wolt.com/he/isr",
  "super-pharm": "https://shop.super-pharm.co.il/",
  "good-pharm": "https://www.good-pharm.co.il/",
};
// Sites behind Cloudflare (403 to a script): the image the site itself shows, read once in a browser (2026-10-20) —
// their CDN serves it directly. Square app icons first (they fit the tile), the header logo otherwise.
const DIRECT = {
  victory: "https://d226b0iufwcjmj.cloudfront.net/retailers/1470/icon.png",
  carrefour: "https://d226b0iufwcjmj.cloudfront.net/retailers/1540/favIcon/1727349614297.png",
  "keshet-teamim": "https://d226b0iufwcjmj.cloudfront.net/retailers/1219/icon/1723638693910.png",
  "mahsanei-hashuk": "https://d226b0iufwcjmj.cloudfront.net/retailers/1107/icon.png",
  "super-sapir": "https://d226b0iufwcjmj.cloudfront.net/retailers/1339/icon/1683713691801.png",
  "hatzi-hinam": "https://cdn.hazi-hinam.co.il/app/V_1.3029/assets/images/header_logo.svg",
  "super-yuda": "https://d226b0iufwcjmj.cloudfront.net/retailers/1492/logo/1701077319899.png",
  "shuk-hair": "https://d226b0iufwcjmj.cloudfront.net/retailers/1254/logo.png",
  // Its app icon is a generic "online" hand — the header wordmark instead.
  "rami-levy": "https://www.rami-levy.co.il/images/new_logo.png",
};
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const only = arg("--only")?.split(",");
const force = process.argv.includes("--force");
const OUT = "public/chains";
mkdirSync(OUT, { recursive: true });
const srcFile = join(OUT, "sources.json");
const sources = existsSync(srcFile) ? JSON.parse(readFileSync(srcFile, "utf8")) : {};
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", accept: "text/html,image/*,*/*" };

async function get(url, ms = 15000) {
  const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r;
}
function candidates(html, base) {
  const out = [];
  const abs = (u) => new URL(u.replace(/&amp;/g, "&"), base).href;
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const tag = m[0];
    const rel = tag.match(/rel=["']([^"']+)/i)?.[1]?.toLowerCase() ?? "";
    const href = tag.match(/href=["']([^"']+)/i)?.[1];
    if (!href || !/icon/.test(rel)) continue;
    const size = Number(tag.match(/sizes=["'](\d+)/i)?.[1] ?? (/apple/.test(rel) ? 180 : 32));
    out.push({ url: abs(href), score: size + (/apple/.test(rel) ? 50 : 0) + (/\.svg/i.test(href) ? 120 : 0) });
  }
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const src = tag.match(/src=["']([^"']+)/i)?.[1];
    if (src && /logo/i.test(tag) && !/data:/.test(src)) out.push({ url: abs(src), score: 140 });
  }
  const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i)?.[1] ?? html.match(/content=["']([^"']+)["'][^>]*property=["']og:image/i)?.[1];
  if (og) out.push({ url: abs(og), score: 60 });
  out.push({ url: new URL("/apple-touch-icon.png", base).href, score: 100 }, { url: new URL("/favicon.ico", base).href, score: 10 });
  return out.sort((a, b) => b.score - a.score);
}
async function toTile(buf) {
  const img = sharp(buf, { density: 300 }).trim({ threshold: 8 }).resize(104, 104, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } });
  const inner = await img.png().toBuffer();
  const meta = await sharp(inner).metadata();
  if ((meta.width ?? 0) < 24) throw new Error("too small");
  return sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: inner, gravity: "center" }])
    .webp({ quality: 88 })
    .toBuffer();
}
const done = [];
const failed = [];
for (const [id, site] of Object.entries(SITES)) {
  if (only && !only.includes(id)) continue;
  const file = join(OUT, `${id}.webp`);
  if (existsSync(file) && !force) continue;
  let ok = false;
  // A logo Tal saved by hand (public/chains/<id>.png / .jpg / .svg) → the tile.
  const own = ["png", "jpg", "svg"].map((x) => join(OUT, `${id}.${x}`)).find((f) => existsSync(f));
  if (own) {
    writeFileSync(file, await toTile(readFileSync(own)));
    sources[id] = { from: "saved by Tal", site, at: new Date().toISOString().slice(0, 10) };
    done.push(`${id} ← ${own}`);
    continue;
  }
  if (DIRECT[id]) {
    try {
      const buf = Buffer.from(await (await get(DIRECT[id])).arrayBuffer());
      writeFileSync(file, await toTile(buf));
      sources[id] = { from: DIRECT[id], site, at: new Date().toISOString().slice(0, 10) };
      done.push(`${id} ← ${DIRECT[id]}`);
      continue;
    } catch (e) {
      failed.push(`${id}: direct ${e.message}`);
      continue;
    }
  }
  try {
    const page = await get(site);
    const html = await page.text();
    for (const c of candidates(html, page.url)) {
      try {
        const r = await get(c.url, 12000);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 300) continue;
        const tile = await toTile(buf);
        writeFileSync(file, tile);
        sources[id] = { from: c.url, site, at: new Date().toISOString().slice(0, 10) };
        ok = true;
        done.push(`${id} ← ${c.url}`);
        break;
      } catch {}
    }
  } catch (e) {
    failed.push(`${id}: ${e.message}`);
    continue;
  }
  if (!ok) failed.push(`${id}: no usable image`);
}
writeFileSync(srcFile, JSON.stringify(sources, null, 1));
// The app knows which chains have a logo file (the rest show a plain store tile, never a first letter).
writeFileSync("src/lib/grocery/chain-logos.json", JSON.stringify(Object.keys(SITES).filter((id) => existsSync(join(OUT, `${id}.webp`)))));
console.log(done.map((d) => `OK ${d}`).join("\n"));
console.log(failed.map((d) => `FAIL ${d}`).join("\n"));
