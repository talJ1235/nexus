import localFont from "next/font/local";

// Self-hosted Rubik (variable), preloaded with a size-matched fallback so text never jumps when it arrives.
// Latin and Hebrew are separate files; the browser picks the Hebrew face only for Hebrew glyphs.
export const rubikLatin = localFont({
  src: "../fonts/rubik-latin-wght-normal.woff2",
  weight: "300 900",
  display: "swap",
  variable: "--font-rubik-latin",
  adjustFontFallback: "Arial",
});

export const rubikHebrew = localFont({
  src: "../fonts/rubik-hebrew-wght-normal.woff2",
  weight: "300 900",
  display: "swap",
  variable: "--font-rubik-hebrew",
  adjustFontFallback: "Arial",
});
