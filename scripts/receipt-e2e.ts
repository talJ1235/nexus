// End-to-end receipt check (Round 8 A4): the app's own browser code (lib/receipt-image: detect → crop → enhance →
// tiles) runs in headless Chromium on receipt photos, then the server's reader (lib/receipt extractReceipt + checks).
//   1. Mock (always): every synthetic bench photo up to the upload — found, IoU, tiles (≤ 2000 px, JPEG, under the
//      20 MB upload limit, tall receipts split), then extractReceipt in NEXUS_AI_MOCK mode (exercises the path).
//   2. Real reading (with GEMINI_API_KEY in the env or .env.local): 5 receipts rendered sharp at phone size (the bench
//      set is too small to read) plus test-data/receipts/*.jpg if present — the read compared with what is printed.
//
//   npm run test:receipt-e2e [-- --read 5 | --no-read]
import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { iou, type Pt } from "../src/lib/receipt-detect/geometry";

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const SYNTH = "test-data/receipt-synth";
const REAL = "test-data/receipts";
const UPLOAD_MAX = 20 * 1024 * 1024;

type Tile = { w: number; h: number; bytes: number; b64: string };
type Prepared = { w: number; h: number; quad: Pt[] | null; tiles: Tile[]; ms: number };

// Before any import of the reader: mock first, the env file for the real read.
if (existsSync(".env.local"))
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^(GEMINI_API_KEY|GEMINI_MODEL|GROQ_API_KEY)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }

async function prepareIn(page: Page, url: string): Promise<Prepared> {
  return page.evaluate(async (url) => {
    const E = (window as unknown as { E: typeof import("./receipt-bench/e2e-entry") }).E;
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const t = performance.now();
    const found = await E.detectCorners(c);
    const blobs = await E.prepareReceiptPart(c, { corners: found?.corners ?? null });
    const ms = performance.now() - t;
    const tiles = await Promise.all(
      blobs.map(async (b) => {
        const bmp = await createImageBitmap(b);
        const buf = new Uint8Array(await b.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const tile = { w: bmp.width, h: bmp.height, bytes: b.size, b64: btoa(bin) };
        bmp.close();
        return tile;
      }),
    );
    const k = found?.corners;
    return { w: img.width, h: img.height, quad: k ? [k.topLeft, k.topRight, k.bottomRight, k.bottomLeft] : null, tiles, ms };
  }, url);
}

async function main() {
  const entry = await build({
    entryPoints: ["scripts/receipt-bench/e2e-entry.ts"],
    bundle: true,
    format: "iife",
    globalName: "E",
    write: false,
    platform: "browser",
    target: "es2020",
    logLevel: "error",
  });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("http://e2e.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/scanic-ml/")) {
      const file = join("node_modules/scanic-ml/dist", path.slice("/scanic-ml/".length));
      if (existsSync(file)) return route.fulfill({ body: readFileSync(file), contentType: file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream" });
      return route.fulfill({ status: 404 });
    }
    return route.fulfill({ body: "<!doctype html><html><body></body></html>", contentType: "text/html" });
  });
  await page.goto("http://e2e.local/");
  await page.addScriptTag({ content: entry.outputFiles[0].text });

  // ---- 1. Mock: the whole synthetic set up to the upload.
  process.env.NEXUS_AI_MOCK = "1";
  const { extractReceipt } = await import("../src/lib/receipt");
  const labels = JSON.parse(readFileSync(join(SYNTH, "labels.json"), "utf8")) as Record<string, { w: number; h: number; corners: Pt[] }>;
  let ok = 0;
  let found = 0;
  let tiled = 0;
  let problems = 0;
  const times: number[] = [];
  for (const [file, l] of Object.entries(labels)) {
    const p = await prepareIn(page, `data:image/jpeg;base64,${readFileSync(join(SYNTH, file)).toString("base64")}`);
    times.push(p.ms);
    if (p.quad) found++;
    const ov = p.quad ? iou(p.quad, l.corners, { w: l.w, h: l.h }) : 0;
    if (ov >= 0.85) ok++;
    if (p.tiles.length > 1) tiled++;
    const bad = p.tiles.filter((t) => Math.max(t.w, t.h) > 2000 || t.bytes > UPLOAD_MAX || t.bytes < 1000 || t.h / t.w > 2.5 * 1.2);
    const read = await extractReceipt({ files: p.tiles.map((t) => ({ mimeType: "image/jpeg", data: t.b64 })) });
    if (bad.length || !p.tiles.length || !read?.lines.length) {
      problems++;
      console.log(`FAIL ${file}: tiles ${p.tiles.map((t) => `${t.w}×${t.h}/${(t.bytes / 1024).toFixed(0)}KB`).join(" ")} read=${read?.lines.length ?? 0}`);
    }
  }
  times.sort((a, b) => a - b);
  const n = Object.keys(labels).length;
  console.log(
    `${problems ? "FAIL" : "PASS"} mock e2e: ${n} photos → found ${found}, right outline ${ok} (IoU ≥ 0.85), ${tiled} split into tiles, every part a JPEG ≤ 2000 px under the upload limit, mock read ok; median detect+crop+enhance+encode ${times[Math.floor(n / 2)].toFixed(0)} ms`,
  );
  delete process.env.NEXUS_AI_MOCK;

  // ---- 2. Real reading.
  const N = args.includes("--no-read") ? 0 : Number(opt("read") ?? 5);
  if (!N) return void (await browser.close());
  if (!process.env.GEMINI_API_KEY) {
    console.log("SKIP real reading: no GEMINI_API_KEY");
    return void (await browser.close());
  }
  type Case = { name: string; url: string; printed?: { lines: { name: string; price: number }[]; total: number } };
  const cases: Case[] = [];
  for (let i = 0; i < N; i++) {
    const r = await page.evaluate((i) => {
      const E = (window as unknown as { E: typeof import("./receipt-bench/e2e-entry") }).E;
      // A phone-sized photo (1500×2000) of a whole receipt, paper drawn sharp; mixed Hebrew/English, both lightings.
      const spec = { ...E.specFor(100 + i), frame: { w: 1500, h: 2000 }, outOfFrame: false, scale: 0.85, blur: 0, ratio: 2.2 + (i % 3) * 0.8, hebrew: i % 2 === 1 };
      return E.render(spec, 3);
    }, i);
    cases.push({ name: `synthetic-${i}${i % 2 ? "-he" : "-en"}`, url: r.url, printed: r.printed });
  }
  if (existsSync(REAL)) for (const f of readdirSync(REAL).filter((f) => /\.jpe?g$/i.test(f)).slice(0, 5)) cases.push({ name: `real/${f}`, url: `data:image/jpeg;base64,${readFileSync(join(REAL, f)).toString("base64")}` });
  for (const c of cases) {
    const p = await prepareIn(page, c.url);
    const t0 = Date.now();
    const data = await extractReceipt({ files: p.tiles.map((t) => ({ mimeType: "image/jpeg", data: t.b64 })) }).catch((e) => (console.log(`  ${c.name}: ${String(e).slice(0, 120)}`), null));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!data) {
      console.log(`MISS ${c.name}: no read (${p.tiles.length} tiles)`);
      continue;
    }
    const checks = data.lines.filter((l) => (l as { check?: boolean }).check).length;
    if (!c.printed) {
      console.log(`info ${c.name}: ${p.tiles.length} tiles → ${data.lines.length} lines, total ${data.total}, ${checks} flagged, ${secs}s`);
      continue;
    }
    const prices = data.lines.map((l) => l.lineTotal ?? l.unitPrice ?? NaN);
    const hit = c.printed.lines.filter((l) => {
      const i = prices.findIndex((v) => Math.abs(v - l.price) < 0.011);
      if (i < 0) return false;
      prices[i] = NaN;
      return true;
    }).length;
    const totalOk = data.total != null && Math.abs(data.total - c.printed.total) < 0.011;
    console.log(
      `${totalOk && hit === c.printed.lines.length ? "ok  " : "DIFF"} ${c.name}: ${p.tiles.length} tile(s), lines ${data.lines.length}/${c.printed.lines.length}, prices matched ${hit}/${c.printed.lines.length}, total ${data.total} vs ${c.printed.total}${totalOk ? " ✓" : ""}, ${checks} flagged, ${secs}s`,
    );
  }
  await browser.close();
  if (problems) process.exit(1);
}

void main();
