import sharp from "sharp";

/**
 * One catalogue look for every product picture (Round 11 D1). On ingestion:
 * 1. flatten transparency onto white;
 * 2. look at the outer frame: if it's one uniform colour (within ~8 %), trim those borders (white or black);
 * 3. cut-out (a product on a light, uniform background) → centred on a white 480 × 480 square with ~8 % padding;
 *    anything else (busy background, or a dark/coloured backdrop) is a photo → a 480 × 480 centre crop ("cover").
 * The style is written into the stored file name (`…-c.webp` / `…-p.webp`, see `pictureStyleOf`), so it travels
 * with the picture and the UI frame can't disagree with it.
 */
import type { PictureStyle } from "./picture-url";

export { pictureStyleOf, type PictureStyle } from "./picture-url";

export const PICTURE_SIZE = 480;
const PAD = 0.08;
const TOLERANCE = Math.round(0.08 * 255);
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

type Rgb = [number, number, number];

/** Is the outer frame of the (flattened) picture one colour? Returns that colour and whether it's light. */
export async function frameColour(buf: Buffer): Promise<{ uniform: boolean; colour: Rgb; light: boolean }> {
  const N = 160;
  const { data } = await sharp(buf, { failOn: "none" }).rotate().flatten({ background: WHITE }).resize(N, N, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const k = 5; // ~3 % of the side
  const px: Rgb[] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (y >= k && y < N - k && x >= k && x < N - k) continue;
      const i = (y * N + x) * 3;
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
  const median = (c: 0 | 1 | 2) => px.map((p) => p[c]).sort((a, b) => a - b)[px.length >> 1];
  const colour: Rgb = [median(0), median(1), median(2)];
  const close = px.filter((p) => Math.max(Math.abs(p[0] - colour[0]), Math.abs(p[1] - colour[1]), Math.abs(p[2] - colour[2])) <= TOLERANCE).length;
  const uniform = close / px.length >= 0.9;
  const light = Math.min(...colour) >= 222 && Math.max(...colour) - Math.min(...colour) <= 24;
  return { uniform, colour, light };
}

/** Normalize one picture: returns a 480 × 480 WebP and its style. */
export async function normalizePicture(buf: Buffer): Promise<{ webp: Buffer; style: PictureStyle }> {
  const base = await sharp(buf, { failOn: "none" }).rotate().flatten({ background: WHITE }).png().toBuffer();
  const frame = await frameColour(base);
  let body = base;
  if (frame.uniform) {
    const [r, g, b] = frame.colour;
    try {
      body = await sharp(base).trim({ background: { r, g, b }, threshold: TOLERANCE }).png().toBuffer();
    } catch {
      // Nothing left after trimming (a blank picture): keep it as it is.
    }
  }
  const style: PictureStyle = frame.uniform && frame.light ? "cutout" : "photo";
  const inner = Math.round(PICTURE_SIZE * (1 - 2 * PAD));
  const out =
    style === "cutout"
      ? sharp(await sharp(body).resize(inner, inner, { fit: "contain", background: WHITE }).toBuffer()).extend({
          top: Math.floor((PICTURE_SIZE - inner) / 2),
          bottom: Math.ceil((PICTURE_SIZE - inner) / 2),
          left: Math.floor((PICTURE_SIZE - inner) / 2),
          right: Math.ceil((PICTURE_SIZE - inner) / 2),
          background: WHITE,
        })
      : sharp(body).resize(PICTURE_SIZE, PICTURE_SIZE, { fit: "cover", position: "centre" });
  return { webp: await out.flatten({ background: WHITE }).webp({ quality: 80 }).toBuffer(), style };
}
