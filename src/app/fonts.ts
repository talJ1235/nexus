import localFont from "next/font/local";

// Self-hosted Heebo (variable 100–900), preloaded with a size-matched fallback so text never jumps when it arrives.
// Latin and Hebrew are separate files; the browser picks the Hebrew face only for Hebrew glyphs.
export const heeboLatin = localFont({
  src: "../fonts/heebo-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-heebo-latin",
  adjustFontFallback: "Arial",
});

export const heeboHebrew = localFont({
  src: "../fonts/heebo-hebrew-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-heebo-hebrew",
  adjustFontFallback: "Arial",
});
