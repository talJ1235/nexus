// Unit test for src/lib/barcode.ts (classification, check digits, lookup chain).  npx tsx scripts/test-barcode.ts
// R18 S4 B2: + the scanner core (lib/barcode-scan.ts) — which back camera, the confirm rule, and fixture frames decoded
// with the same pass plan as the phone (zxing-wasm in node): every format × small / large / rotated / blurry /
// off-centre, with passes and time to the first read logged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmer, cropImg, MAX_SIDE, pickCamera, regionImg, rotateImg, scanZoom, selfChecked, toVideo, ZX_FORMATS, type Img } from "../src/lib/barcode-scan";
import { checkDigitOk, classifyBarcode, gtinKey, lookupChain, upcEtoA, type LookupDeps } from "../src/lib/barcode";

// Check digits: real codes.
assert.ok(checkDigitOk("7290000066318")); // Israeli EAN-13 (Tnuva-style 729 prefix)
assert.ok(checkDigitOk("4006381333931")); // EAN-13
assert.ok(checkDigitOk("036000291452")); // UPC-A
assert.ok(checkDigitOk("96385074")); // EAN-8
assert.ok(!checkDigitOk("4006381333932"));

// UPC-E → UPC-A.
assert.equal(upcEtoA("04252614"), "042100005264");
assert.ok(checkDigitOk("042100005264"));

// Classification.
const il = classifyBarcode("7290000066318");
assert.equal(il.kind, "gtin");
assert.ok(il.kind === "gtin" && il.israeli && il.key === "07290000066318");
assert.equal(classifyBarcode("4006381333931").kind, "gtin");
assert.equal(classifyBarcode(" 4006-381333931 ").kind, "gtin");
assert.equal(classifyBarcode("036000291452").kind, "gtin");
assert.equal(classifyBarcode("04252614").kind, "gtin"); // UPC-E expanded
assert.equal(classifyBarcode("2100012003507").kind, "store"); // variable-weight (prefix 2)
assert.equal(classifyBarcode("4006381333932").kind, "other"); // bad check digit
assert.equal(classifyBarcode("ABC-123").kind, "other"); // Code 128 text
assert.equal(gtinKey("036000291452"), "00036000291452");

// Lookup chain: own items first, then the free databases in order, search last (only with a key).
const calls: string[] = [];
const miss = (name: string) => async () => (calls.push(name), null);
const deps = (over: Partial<LookupDeps> = {}): LookupDeps => ({ own: miss("own"), off: miss("off"), opf: miss("opf"), upcitemdb: miss("upc"), search: null, ...over });

(async () => {
  let r = await lookupChain("4006381333931", deps({ own: async (k) => (calls.push(`own:${k}`), { source: "own", title: "Pencil", itemId: "i1" }) }));
  assert.equal(r.hit?.itemId, "i1");
  assert.deepEqual(calls, ["own:04006381333931"]);

  calls.length = 0;
  r = await lookupChain("4006381333931", deps({ opf: async () => (calls.push("opf"), { source: "opf", title: "Faber pencil" }) }));
  assert.equal(r.hit?.source, "opf");
  assert.deepEqual(calls, ["own", "off", "opf"]);

  // A thrown fetcher is a miss, not a failure.
  calls.length = 0;
  r = await lookupChain("4006381333931", deps({ off: async () => { calls.push("off!"); throw new Error("503"); }, upcitemdb: async () => ({ source: "upcitemdb", title: "X" }) }));
  assert.equal(r.hit?.source, "upcitemdb");
  assert.deepEqual(r.tried, ["own", "off", "opf", "upcitemdb"]);

  // No key → no search step; nothing found → null (the UI asks for a photo).
  calls.length = 0;
  r = await lookupChain("7290000066318", deps());
  assert.equal(r.hit, null);
  assert.deepEqual(r.tried, ["own", "off", "opf", "upcitemdb"]);
  r = await lookupChain("7290000066318", deps({ search: async () => ({ source: "search", title: "Milk 3%" }) }));
  assert.equal(r.hit?.source, "search");

  // Weight / store codes: only own items, then straight to the photo.
  r = await lookupChain("2100012003507", deps());
  assert.equal(r.cls.kind, "store");
  assert.deepEqual(r.tried, ["own"]);

  console.log("OK barcode: check digits, UPC-E, classification, lookup chain");

  // ---- S4 B2: which camera
  const cam = (id: string, label: string, caps: Record<string, unknown> | null = null) => ({ id, label, caps });
  assert.equal(pickCamera([cam("f", "camera2 1, facing front"), cam("m", "camera2 0, facing back"), cam("u", "camera2 2, facing back")]), "m", "Samsung labels: the lowest back lens");
  assert.equal(pickCamera([cam("u", "Back Ultra Wide Camera"), cam("m", "Back Camera")]), "m", "never the ultra-wide");
  assert.equal(
    pickCamera([cam("a", "camera2 0, facing back", { focusMode: ["fixed"], facingMode: ["environment"] }), cam("b", "camera2 3, facing back", { focusMode: ["continuous", "manual"], zoom: { min: 1, max: 8 }, facingMode: ["environment"] })]),
    "b",
    "the lens that focuses continuously and zooms",
  );
  assert.equal(pickCamera([cam("m", "Back Camera"), cam("t", "Back Telephoto Camera")]), "m", "never the tele");
  assert.equal(pickCamera([cam("x", "camera2 0, facing back"), cam("y", "camera2 2, facing back")], "y"), "y", "the remembered lens while it is there");
  assert.equal(pickCamera([cam("x", "camera2 0, facing back")], "gone"), "x");
  assert.equal(pickCamera([cam("f", "Front Camera")]), null, "no back camera: no choice");
  assert.equal(scanZoom({ min: 1, max: 10, step: 0.1 }), 1.6);
  assert.equal(scanZoom({ min: 1, max: 1.2 }), null, "no real zoom range");
  assert.equal(scanZoom(undefined), null);

  // ---- the confirm rule
  assert.ok(selfChecked("7290000066318") && selfChecked("04252614") && !selfChecked("7290000066319") && !selfChecked("ABC"));
  const c1 = confirmer(1500);
  assert.equal(c1("7290000066318", 0), "7290000066318", "a valid check digit counts on one read");
  assert.equal(c1("7290000066319", 0), null, "a wrong check digit waits for a second read");
  assert.equal(c1("7290000066319", 300), "7290000066319");
  assert.equal(c1("HELLO-128", 0), null);
  assert.equal(c1("HELLO-12B", 100), null, "two different reads: nothing");
  assert.equal(c1("HELLO-12B", 2000), null, "too far apart");
  assert.equal(c1("HELLO-12B", 2600), "HELLO-12B");

  // ---- fixture frames, decoded like the phone does
  (globalThis as { ImageData?: unknown }).ImageData ??= class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  };
  const z = await import("zxing-wasm/full");
  await z.prepareZXingModule({ overrides: { wasmBinary: readFileSync("node_modules/zxing-wasm/dist/full/zxing_full.wasm").buffer as ArrayBuffer }, fireImmediately: true });
  const W = 1920;
  const H = 1080;
  type Sym = { width: number; height: number; data: Uint8ClampedArray };
  type Opt = { rotate?: boolean; blur?: number; barH?: number };
  /** A camera-like frame: grey paper, the symbol at `mod` px per module with a quiet zone, centred at (cx, cy). */
  const frame = (sym: Sym, mod: number, cx: number, cy: number, o: Opt) => {
    const qz = 10;
    const linear = o.barH != null;
    const sh = linear ? o.barH! : sym.height * mod;
    const pw = (sym.width + qz * 2) * mod;
    const ph = sh + qz * 2 * mod;
    let pic: Img = { width: pw, height: ph, data: new Uint8ClampedArray(pw * ph * 4).fill(255) };
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sym.width * mod; x++) {
        const sy = linear ? Math.min(sym.height - 1, Math.floor((y / sh) * sym.height)) : Math.floor(y / mod);
        if (sym.data[sy * sym.width + Math.floor(x / mod)] !== 0) continue;
        const i = ((y + qz * mod) * pw + x + qz * mod) * 4;
        pic.data[i] = pic.data[i + 1] = pic.data[i + 2] = 20;
      }
    if (o.rotate) pic = rotateImg(pic);
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const g = 150 + ((Math.imul(i, 2654435761) >>> 27) & 31); // paper with a little noise
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
      out[i * 4 + 3] = 255;
    }
    const x0 = Math.round(cx - pic.width / 2);
    const y0 = Math.round(cy - pic.height / 2);
    for (let y = 0; y < pic.height; y++) out.set(pic.data.subarray(y * pic.width * 4, (y + 1) * pic.width * 4), ((y0 + y) * W + x0) * 4);
    let img: Img = { width: W, height: H, data: out };
    for (let b = 0; b < (o.blur ?? 0); b++) img = blur(img);
    return { img, box: { x0, y0, x1: x0 + pic.width, y1: y0 + pic.height } };
  };
  const blur = (img: Img): Img => {
    const { width: w, height: h, data } = img;
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            sum += data[(yy * w + xx) * 4];
            n++;
          }
        const i = (y * w + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = sum / n;
        out[i + 3] = 255;
      }
    return { width: w, height: h, data: out };
  };
  const shrink = (img: Img, k: number): Img => {
    const w = Math.round(img.width * k);
    const h = Math.round(img.height * k);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = (Math.min(img.height - 1, Math.floor(y / k)) * img.width + Math.min(img.width - 1, Math.floor(x / k))) * 4;
        out.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
      }
    return { width: w, height: h, data: out };
  };
  /** The phone's loop: pass k reads its region (≤ MAX_SIDE px) until a valid read. */
  const scanFrame = async (img: Img, maxPasses = 6) => {
    const t0 = performance.now();
    for (let k = 0; k < maxPasses; k++) {
      const { img: part, region } = regionImg(img, k);
      const scale = Math.min(1, MAX_SIDE / Math.max(region.w, region.h));
      const small = scale < 1 ? shrink(part, scale) : part;
      const hit = (await z.readBarcodes(small as unknown as ImageData, { formats: [...ZX_FORMATS], tryHarder: true, tryRotate: false, tryDownscale: true, maxNumberOfSymbols: 1 })).find((x) => x.isValid);
      if (hit) {
        const p = hit.position;
        return { text: hit.text, passes: k + 1, ms: Math.round(performance.now() - t0), pts: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((q) => toVideo(q, region, scale)) };
      }
    }
    return null;
  };
  const CODES: [string, string, boolean][] = [
    ["EAN13", "7290000066318", false],
    ["EAN8", "96385074", false],
    ["UPCA", "036000291452", false],
    ["UPCE", "04252614", false],
    ["Code128", "NX-4711-milk", false],
    ["Code39", "NEXUS39", false],
    ["ITF", "12345678901231", false],
    ["QRCode", "https://nexus.example/p/7290000066318", true],
    ["DataMatrix", "0107290000066318", true],
  ];
  const CASES: [string, number, number, number, Opt][] = [
    ["large", 6, W / 2, H / 2, { barH: 260 }],
    ["small", 2, W / 2, H / 2, { barH: 70 }],
    ["rotated", 3, W / 2, H / 2, { rotate: true, barH: 160 }],
    ["blurry", 5, W / 2, H / 2, { blur: 2, barH: 200 }],
    ["off-centre", 3, 330, 240, { barH: 140 }],
  ];
  const times: string[] = [];
  let worst = 0;
  for (const [fmt, text, matrix] of CODES) {
    const w = await z.writeBarcode(text, { format: fmt as never });
    assert.ok(!w.error && w.symbol, `${fmt}: fixture written (${w.error})`);
    for (const [name, mod, cx, cy, o] of CASES) {
      const f = frame(w.symbol as Sym, matrix ? mod + 1 : mod, cx, cy, matrix ? { rotate: o.rotate, blur: o.blur } : o);
      const r = await scanFrame(f.img);
      assert.ok(r, `${fmt} ${name}: read`);
      const want = fmt === "UPCA" ? [text, `0${text}`] : fmt === "UPCE" ? [text, upcEtoA(text), `0${upcEtoA(text)}`] : [text];
      assert.ok(want.includes(r!.text), `${fmt} ${name}: ${r!.text} = ${text}`);
      const inside = r!.pts.every((p) => p.x >= f.box.x0 - 8 && p.x <= f.box.x1 + 8 && p.y >= f.box.y0 - 8 && p.y <= f.box.y1 + 8);
      assert.ok(inside, `${fmt} ${name}: the outline is on the code (${JSON.stringify(r!.pts)} in ${JSON.stringify(f.box)})`);
      worst = Math.max(worst, r!.passes);
      times.push(`${fmt}/${name} ${r!.passes}p ${r!.ms}ms`);
    }
  }
  // The image helpers agree with the plan's geometry.
  const tiny: Img = { width: 4, height: 2, data: new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255, 7, 0, 0, 255, 8, 0, 0, 255]) };
  assert.deepEqual([...rotateImg(tiny).data].filter((_, i) => i % 4 === 0), [5, 1, 6, 2, 7, 3, 8, 4], "turned 90° clockwise");
  assert.deepEqual([...cropImg(tiny, { x: 1, y: 1, w: 2, h: 1 }).data].filter((_, i) => i % 4 === 0), [6, 7]);
  console.log(`OK barcode B2: ${CODES.length} formats × ${CASES.length} frames read (≤ ${worst} passes), camera pick, confirm rule`);
  console.log(`   time to first read: ${times.join(" · ")}`);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
