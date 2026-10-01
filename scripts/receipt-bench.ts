// Receipt edge-detection bench (Round 8 A1). Runs the app's detector (src/lib/receipt-detect, bundled with esbuild)
// in headless Chromium, so canvas/WASM behave as in the browser, over labelled images:
//   - synthetic: test-data/receipt-synth/*.jpg + labels.json (committed; regenerate with --gen)
//   - real (optional, git-ignored): test-data/receipts/*.jpg + labels.json ({ "file.jpg": [[x,y]×4 TL,TR,BR,BL] })
// Per image: found, corner error (mean distance / diagonal), IoU with the true quad (both clipped to the frame), time.
// Summary: success rate (IoU ≥ 0.85) and median time, for "still" (full photo) and "live" (640 px frame) modes.
//
//   npm run test:receipt-detect                 # both sets, both modes; exits 1 below the targets
//   npm run test:receipt-detect -- --gen        # regenerate the synthetic set (64 images)
//   ... -- --throttle 4                         # CPU ×4 (live timing budget < 200 ms)
//   ... -- --only paper|scanic  --verbose  --mode live|still  --filter 12  --dump out/prefix (found quads → sheet.mjs)
//   ... -- --skip scanic,lines,paper,ml         # leave detectors out
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { iou, type Pt } from "../src/lib/receipt-detect/geometry";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const SYNTH = "test-data/receipt-synth";
const REAL = "test-data/receipts";
const COUNT = 64;

async function bundle(entry: string, globalName: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: "iife", globalName, write: false, platform: "browser", target: "es2020", logLevel: "error" });
  return r.outputFiles[0].text;
}

type Label = { w: number; h: number; corners: Pt[] };

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // An http origin so the detector can fetch the self-hosted ML assets (/scanic-ml/, from node_modules/scanic-ml).
  await page.route("http://bench.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/scanic-ml/")) {
      const file = join("node_modules/scanic-ml/dist", path.slice("/scanic-ml/".length));
      if (existsSync(file)) return route.fulfill({ body: readFileSync(file), contentType: file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream" });
      return route.fulfill({ status: 404 });
    }
    return route.fulfill({ body: "<!doctype html><html><body></body></html>", contentType: "text/html" });
  });
  await page.goto("http://bench.local/");

  if (flag("gen")) {
    await page.addScriptTag({ content: await bundle("scripts/receipt-bench/synth.ts", "SYN") });
    mkdirSync(SYNTH, { recursive: true });
    const labels: Record<string, Label> = {};
    let bytes = 0;
    for (let i = 0; i < COUNT; i++) {
      const out = await page.evaluate((i) => {
        const S = (window as unknown as { SYN: typeof import("./receipt-bench/synth") }).SYN;
        const spec = S.specFor(i);
        return { ...S.render(spec), w: spec.frame.w, h: spec.frame.h, bg: spec.bg };
      }, i);
      const name = `${String(i).padStart(2, "0")}-${out.bg}.jpg`;
      const buf = Buffer.from(out.url.split(",")[1], "base64");
      bytes += buf.length;
      writeFileSync(join(SYNTH, name), buf);
      labels[name] = { w: out.w, h: out.h, corners: out.corners.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })) };
    }
    writeFileSync(join(SYNTH, "labels.json"), JSON.stringify(labels, null, 1));
    console.log(`generated ${COUNT} images in ${SYNTH} (${(bytes / 1e6).toFixed(1)} MB)`);
    await browser.close();
    return;
  }

  await page.addScriptTag({ content: await bundle("src/lib/receipt-detect/index.ts", "RD") });
  const throttle = Number(opt("throttle") || 0);
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  const only = opt("only");
  const modes = (opt("mode") ? [opt("mode")] : ["still", "live"]) as ("still" | "live")[];
  const filter = opt("filter");
  const sets: { name: string; dir: string; labels: Record<string, Label | Pt[] | number[][]> }[] = [];
  if (existsSync(join(SYNTH, "labels.json"))) sets.push({ name: "synthetic", dir: SYNTH, labels: JSON.parse(readFileSync(join(SYNTH, "labels.json"), "utf8")) });
  if (existsSync(join(REAL, "labels.json"))) sets.push({ name: "real", dir: REAL, labels: JSON.parse(readFileSync(join(REAL, "labels.json"), "utf8")) });
  else if (existsSync(REAL) && readdirSync(REAL).some((f) => /\.jpe?g$/i.test(f))) console.log(`note: ${REAL} has photos but no labels.json — skipped`);

  let pass = true;
  for (const set of sets) {
    for (const mode of modes) {
      const dump: Record<string, Pt[]> = {};
      const rows: { file: string; found: boolean; err: number; iou: number; ms: number; src: string; score: number }[] = [];
      for (const [file, raw] of Object.entries(set.labels)) {
        if (filter && !file.includes(filter)) continue;
        const truth = (Array.isArray(raw) ? raw : raw.corners).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)) as Pt[];
        const data = readFileSync(join(set.dir, file)).toString("base64");
        const r = await page.evaluate(
          async ({ data, mode, only, verbose, skip }) => {
            const img = new Image();
            img.src = `data:image/jpeg;base64,${data}`;
            await img.decode();
            // Live frames are 640 px on the long side (as the camera loop draws them); stills go in as they are.
            const k = mode === "live" ? Math.min(1, 640 / Math.max(img.width, img.height)) : 1;
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * k);
            c.height = Math.round(img.height * k);
            const x = c.getContext("2d", { willReadFrequently: true })!;
            x.drawImage(img, 0, 0, c.width, c.height);
            const id = x.getImageData(0, 0, c.width, c.height);
            const RD = (window as unknown as { RD: typeof import("../src/lib/receipt-detect") }).RD;
            const off = (skip ?? "").split(",");
            const o = { mode, scanic: only !== "paper" && !off.includes("scanic"), paper: only !== "scanic" && !off.includes("paper"), lines: !off.includes("lines"), ml: off.includes("ml") ? (false as const) : "/scanic-ml/" };
            await RD.detectReceipt(id, o); // warm-up (scanic's WASM, JIT)
            const t = performance.now();
            const d = await RD.detectReceipt(id, o);
            const ms = performance.now() - t;
            const debug: { q: { x: number; y: number }[]; source: string; score: number; valid: boolean }[] = [];
            if (verbose) await RD.detectReceipt(id, { ...o, debug });
            return { debug: debug.map((c) => `${c.source}:${c.score.toFixed(2)}[${c.q.map((p) => `${Math.round(p.x / k)},${Math.round(p.y / k)}`).join(" ")}]`), w: img.width, h: img.height, ms, quad: d ? d.quad.map((p) => ({ x: p.x / k, y: p.y / k })) : null, src: d?.source ?? "", score: d?.score ?? 0 };
          },
          { data, mode, only, verbose: flag("verbose"), skip: opt("skip") },
        );
        const diag = Math.hypot(r.w, r.h);
        let err = 1;
        let ov = 0;
        if (r.quad) {
          ov = iou(r.quad, truth, { w: r.w, h: r.h });
          // Corner error: best cyclic match (the detector may start at another corner of a square-ish quad).
          for (let s = 0; s < 4; s++) {
            const e = r.quad.reduce((a, p, i) => a + Math.hypot(p.x - truth[(i + s) % 4].x, p.y - truth[(i + s) % 4].y), 0) / 4 / diag;
            err = Math.min(err, e);
          }
        }
        if (r.quad) dump[file] = r.quad;
        rows.push({ file, found: !!r.quad, err, iou: ov, ms: r.ms, src: r.src, score: r.score });
        if (flag("verbose") || (r.quad ? ov < 0.85 : true))
          if (flag("verbose") || !flag("quiet"))
            console.log(`${ov >= 0.85 ? "ok  " : "MISS"} ${set.name}/${mode} ${file.padEnd(16)} found=${r.quad ? "y" : "n"} iou=${ov.toFixed(3)} err=${(err * 100).toFixed(1)}% ${r.ms.toFixed(0)}ms ${r.src} ${r.score.toFixed(2)}${flag("verbose") ? `\n    truth [${truth.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ")}]\n    ${r.debug.join("\n    ")}` : ""}`);
      }
      if (opt("dump")) writeFileSync(`${opt("dump")}-${set.name}-${mode}.json`, JSON.stringify(dump));
      const okN = rows.filter((r) => r.iou >= 0.85).length;
      const rate = okN / Math.max(1, rows.length);
      const times = rows.map((r) => r.ms).sort((a, b) => a - b);
      const med = times[Math.floor(times.length / 2)] ?? 0;
      const medErr = rows.map((r) => r.err).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
      const target = set.name === "real" ? 0.85 : 0.9;
      const budget = mode === "live" ? (throttle >= 4 ? 200 : 60) : Infinity;
      const good = rate >= target && med < budget;
      if (!good) pass = false;
      const bySrc = rows.reduce<Record<string, number>>((a, r) => ((a[r.src || "none"] = (a[r.src || "none"] ?? 0) + 1), a), {});
      console.log(
        `${good ? "PASS" : "FAIL"} ${set.name}/${mode}: success ${okN}/${rows.length} = ${(rate * 100).toFixed(1)}% (target ${target * 100}%), median corner error ${(medErr * 100).toFixed(2)}%, median ${med.toFixed(1)} ms${throttle > 1 ? ` (CPU ×${throttle})` : ""}${budget < Infinity ? ` (budget ${budget})` : ""} — ${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      );
    }
  }
  await browser.close();
  if (!sets.length) console.log("no labelled images — run with --gen first");
  process.exit(pass && sets.length ? 0 : 1);
}

void main();
