/** Picture style (Round 11 D1, lib/picture-style.ts): "cutout" = product on a white square, "photo" = cover crop. */
export type PictureStyle = "cutout" | "photo";

/** The style of a stored picture, from its file name (`…-c.webp` / `…-p.webp`); null when not normalized (yet). */
export function pictureStyleOf(url: string | null | undefined): PictureStyle | null {
  if (!url) return null;
  const m = url.match(/-([cp])\.webp(?:[?#]|$)/);
  return m ? (m[1] === "c" ? "cutout" : "photo") : null;
}

/** Already normalized, or nothing to normalize (icons, inline SVG). */
export function pictureSettled(url: string | null | undefined) {
  return !url || url.startsWith("data:image/svg") || pictureStyleOf(url) != null;
}
