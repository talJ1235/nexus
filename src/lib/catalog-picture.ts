// R19 B4 — a real picture for every catalog product (pure parts — test:pictures): the line the picture search reads
// (name, brand, size, barcode — the barcode makes Open Food Facts the first source), the daily caps, and the thumbnail
// (≤ 20 KB webp, 160 px, white square). The search itself is product-pictures.ts (barcode → Open Food Facts → own
// household photos → Serper by name + an AI yes / no on the candidates → an illustration last).
import sharp from "sharp";
import { heuristicLineInfo, type LineInfo } from "./product-lines";

export type CatalogLine = { gtin: string; name: string; brand: string | null; qty: number | null; unit: string | null; internal: boolean };

/** The picture search's view of a catalog product: the chains' name, its brand and size, the barcode when it's real. */
export function catalogLineInfo(p: CatalogLine): LineInfo {
  const h = heuristicLineInfo(p.name);
  const size = p.qty != null && p.unit ? `${p.qty}${p.unit === "u" ? "" : p.unit}` : h.size;
  const brand = h.brand ?? p.brand;
  return {
    ...h,
    brand,
    size,
    barcode: p.internal ? null : p.gtin,
    queryHe: [h.nameHe || p.name, brand && !p.name.includes(brand) ? brand : null, size].filter(Boolean).join(" ").slice(0, 120),
  };
}

/** Per day: products tried (each may cost a Serper search) and the AI checks they need, from the system's budget. */
export const PICTURE_CAPS = { products: 60, aiBatches: 20 } as const;
export const pictureDayKey = (day: string) => `pic:catalog:${day}`;

/** Under the cap? (`used` = products tried today). */
export const underCap = (used: number, want: number) => Math.max(0, Math.min(want, PICTURE_CAPS.products - used));

/** A list thumbnail: ≤ 160 px on white, webp, stepped down until ≤ 20 KB. */
export async function catalogThumb(buf: Buffer): Promise<Buffer> {
  const base = sharp(buf, { failOn: "none", density: 200 }).flatten({ background: "#ffffff" }).trim({ threshold: 10 }).resize(160, 160, { fit: "contain", background: "#ffffff" });
  const png = await base.png().toBuffer();
  for (const q of [78, 66, 54, 42]) {
    const out = await sharp(png).webp({ quality: q }).toBuffer();
    if (out.length <= 20_000) return out;
  }
  return sharp(png).resize(120, 120).webp({ quality: 40 }).toBuffer();
}
