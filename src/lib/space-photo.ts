import "server-only";
import { del, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { isSpacePhoto } from "@/components/app/spaces/look";

// R16 D5: a space's photo (like a WhatsApp group picture). The client crops (pinch/drag/zoom/rotate) and sends a
// square image; here it is always decoded and re-encoded — 512 × 512 WebP, no metadata (EXIF/GPS/XMP dropped: sharp
// writes none unless asked) — and stored in Blob under spaces/<id>/identity/. Without a Blob token (local
// runs only, never on Vercel) the WebP is kept inline as a data URL.

export const PHOTO_MAX_IN = 4 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function encodeSpacePhoto(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 48_000_000, failOn: "error" })
    .rotate() // honour the camera's orientation before the metadata goes
    .resize(512, 512, { fit: "cover", position: "centre" })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
}

export async function storeSpacePhoto(spaceId: string, webp: Buffer): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // On Vercel the token is always set; a missing one there is a setup error, not a reason to bloat the DB.
    if (process.env.VERCEL) throw new Error("blob_missing");
    return `data:image/webp;base64,${webp.toString("base64")}`;
  }
  const blob = await put(`spaces/${spaceId}/identity/${nanoid(10)}.webp`, webp, { access: "public", contentType: "image/webp", cacheControlMaxAge: 60 * 60 * 24 * 365 });
  return blob.url;
}

/** The old photo goes when it is replaced or removed (never throws). */
export async function deleteSpacePhoto(url: string | null | undefined) {
  if (!url || !isSpacePhoto(url) || url.startsWith("data:") || !process.env.BLOB_READ_WRITE_TOKEN) return;
  await del(url).catch(() => {});
}
