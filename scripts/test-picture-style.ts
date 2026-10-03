// Unit test for picture normalization (Round 11 D1): trim + cut-out/photo detection on four fixtures — a product on
// white, on black, a transparent PNG and a busy lifestyle photo — plus the file-name style marker.
//   npx tsx scripts/test-picture-style.ts
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizePicture, PICTURE_SIZE } from "../src/lib/picture-style";
import { pictureSettled, pictureStyleOf } from "../src/lib/picture-url";

const W = { r: 255, g: 255, b: 255, alpha: 1 };
const product = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();

/** A product (red w×h block with a blue stripe) placed at (x, y) on a canvas. */
async function onCanvas(bg: { r: number; g: number; b: number; alpha: number }, size: [number, number], x: number, y: number, channels: 3 | 4 = 3) {
  const stripe = await sharp({ create: { width: 140, height: 20, channels: 3, background: { r: 30, g: 60, b: 200 } } }).png().toBuffer();
  return sharp({ create: { width: size[0], height: size[1], channels, background: bg } })
    .composite([
      { input: await product(160, 220), left: x, top: y },
      { input: stripe, left: x + 10, top: y + 100 },
    ])
    .png()
    .toBuffer();
}

/** Bounding box of pixels that differ from white, and the colour of the four corners. */
async function inspect(webp: Buffer) {
  const { data, info } = await sharp(webp).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 235) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const corners = [at(2, 2), at(info.width - 3, 2), at(2, info.height - 3), at(info.width - 3, info.height - 3)];
  return { w: info.width, h: info.height, box: { minX, minY, maxX, maxY }, corners };
}
const isWhite = (c: number[]) => Math.min(...c) >= 245;
const isDark = (c: number[]) => Math.max(...c) <= 40;

async function main() {
// 1. Product off-centre on white, lots of margin → cut-out, centred, ~8 % padding on the long side.
{
  const { webp, style } = await normalizePicture(await onCanvas(W, [900, 600], 60, 40));
  const r = await inspect(webp);
  assert.equal(style, "cutout");
  assert.deepEqual([r.w, r.h], [PICTURE_SIZE, PICTURE_SIZE]);
  assert.ok(r.corners.every(isWhite), "white corners");
  const pad = PICTURE_SIZE * 0.08;
  assert.ok(Math.abs(r.box.minY - pad) <= 4 && Math.abs(PICTURE_SIZE - 1 - r.box.maxY - pad) <= 4, `vertical padding ${r.box.minY}/${PICTURE_SIZE - 1 - r.box.maxY}`);
  const cx = (r.box.minX + r.box.maxX) / 2;
  assert.ok(Math.abs(cx - PICTURE_SIZE / 2) <= 4, `centred horizontally (${cx})`);
}

// 2. Product on black → black border trimmed away, shown as a photo (no black frame left at the edges).
{
  const { webp, style } = await normalizePicture(await onCanvas({ r: 0, g: 0, b: 0, alpha: 1 }, [800, 800], 300, 250));
  const r = await inspect(webp);
  assert.equal(style, "photo");
  assert.deepEqual([r.w, r.h], [PICTURE_SIZE, PICTURE_SIZE]);
  assert.ok(!r.corners.some(isDark), `no black corners after trim: ${JSON.stringify(r.corners)}`);
}

// 3. Transparent PNG → flattened onto white, a cut-out.
{
  const { webp, style } = await normalizePicture(await onCanvas({ r: 0, g: 0, b: 0, alpha: 0 }, [700, 700], 100, 300, 4));
  const r = await inspect(webp);
  assert.equal(style, "cutout");
  assert.ok(r.corners.every(isWhite), `transparent became white: ${JSON.stringify(r.corners)}`);
  assert.ok(r.box.minX > 20 && r.box.minY > 20, "padded");
}

// 4. Busy lifestyle photo (noise + gradient, landscape) → photo, square centre crop that fills the frame.
{
  const w = 1000, h = 640;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = (x * 255) / w;
      raw[i + 1] = (y * 255) / h;
      raw[i + 2] = (x * y * 7) % 256;
    }
  const { webp, style } = await normalizePicture(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer());
  const r = await inspect(webp);
  assert.equal(style, "photo");
  assert.deepEqual([r.w, r.h], [PICTURE_SIZE, PICTURE_SIZE]);
  assert.ok(!r.corners.every(isWhite), "fills the frame (no white padding)");
}

// 5. The style marker in stored file names.
assert.equal(pictureStyleOf("https://x.public.blob.vercel-storage.com/items/abc-lq2-c.webp"), "cutout");
assert.equal(pictureStyleOf("https://x.public.blob.vercel-storage.com/items/abc-lq2-p.webp?v=1"), "photo");
assert.equal(pictureStyleOf("https://x.public.blob.vercel-storage.com/items/abc-lq2.webp"), null);
assert.equal(pictureStyleOf("https://store.example/img.jpg"), null);
assert.equal(pictureSettled("data:image/svg+xml;base64,AAAA"), true);
assert.equal(pictureSettled("https://store.example/img.jpg"), false);

console.log("OK picture style: 4 fixtures (white, black, transparent, photo) + file-name marker");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
