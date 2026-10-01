// Colour palette (Round 7). Mode (light/dark/system) stays with next-themes; the palette is a cookie read on the server
// and written to <html data-palette>, so the first paint already has the right colours.
export const PALETTES = ["graphite", "plum"] as const;
export type Palette = (typeof PALETTES)[number];
export const PALETTE_COOKIE = "nexus_palette";
export const DEFAULT_PALETTE: Palette = "graphite";

export const isPalette = (v: unknown): v is Palette => (PALETTES as readonly unknown[]).includes(v);

/** Browser bg per palette × mode (theme-color meta, boot screen). */
export const PALETTE_BG: Record<Palette, { light: string; dark: string }> = {
  graphite: { light: "#f6f6f5", dark: "#0b0b0b" },
  plum: { light: "#f8f6fc", dark: "#100b1a" },
};

/** Instant switch, no reload: set the attribute, remember it in a cookie. */
export function applyPalette(p: Palette) {
  document.documentElement.dataset.palette = p;
  document.cookie = `${PALETTE_COOKIE}=${p}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event("nexus:palette"));
}

export function currentPalette(): Palette {
  if (typeof document === "undefined") return DEFAULT_PALETTE;
  const v = document.documentElement.dataset.palette;
  return isPalette(v) ? v : DEFAULT_PALETTE;
}
