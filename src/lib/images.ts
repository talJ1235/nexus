import "server-only";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { isPublicHttpUrl } from "./utils";

/** Download, shrink to a 480px WebP thumbnail and store in Vercel Blob. Falls back to the remote URL. */
export async function storeThumbnail(remoteUrl: string | null, id: string): Promise<string | null> {
  if (!remoteUrl) return null;
  if (!process.env.BLOB_READ_WRITE_TOKEN || !isPublicHttpUrl(remoteUrl)) return remoteUrl;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(remoteUrl, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; NexusBot/1.0)", accept: "image/*" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return remoteUrl;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 15_000_000) return remoteUrl;
    const webp = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const blob = await put(`items/${id}-${Date.now().toString(36)}.webp`, webp, {
      access: "public",
      contentType: "image/webp",
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return blob.url;
  } catch (e) {
    console.warn("[images] thumbnail failed:", String(e).slice(0, 160));
    return remoteUrl;
  }
}
