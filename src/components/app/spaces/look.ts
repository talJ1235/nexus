// R16 D5: a space's look — an icon (24, board SpaceIdentity) on one of 6 soft gradients, or a photo. No imports, so the
// public /join page and the server (validation) can use it.

export const SPACE_ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  cart: "M2 3h3l2.7 12.4a1.5 1.5 0 0 0 1.5 1.1h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7H6 M9 21h.01 M18 21h.01",
  basket: "M3 10h18l-2 10H5z M8 10l4-6 4 6",
  tools: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
  electronics: "M6 6h12v12H6z M9 9h6v6H9z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4",
  maker: "M21 16V8l-9-5-9 5v8l9 5z M3.3 7 12 12l8.7-5 M12 22V12",
  gifts: "M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8c-2-4-6-4-6-1.5S9 8 12 8c3 0 6 .5 6-1.5S14 4 12 8",
  travel: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
  garden: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z M2 21c0-3 1.9-5.4 5.1-6",
  family: "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z",
  favourites: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  study: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  photo: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  baby: "M9 12h.01 M15 12h.01 M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5 M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1",
  pets: "M11 4.5a1.5 2 0 1 0-3 0 1.5 2 0 0 0 3 0z M16 4.5a1.5 2 0 1 0-3 0 1.5 2 0 0 0 3 0z M7 9a1.5 2 0 1 0-3 0 1.5 2 0 0 0 3 0z M20 9a1.5 2 0 1 0-3 0 1.5 2 0 0 0 3 0z M12 11c-3 0-6 4-6 7 0 2 1.5 3 3 3 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.5 0 3-1 3-3 0-3-3-7-6-7z",
  coffee: "M17 8h1a4 4 0 0 1 0 8h-1 M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M6 2v3 M10 2v3 M14 2v3",
  car: "M5 17h14v-5l-2-5H7l-2 5z M5 12h14 M7 17v2 M17 17v2 M7.5 14.5h.01 M16.5 14.5h.01",
  sport: "M6.5 6.5v11 M17.5 6.5v11 M3 9v6 M21 9v6 M6.5 12h11",
  music: "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  work: "M3 7h18v13H3z M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M3 13h18",
  clothes: "M20.4 6.6 16 4a4 4 0 0 1-8 0L3.6 6.6a1 1 0 0 0-.5 1.2l.9 3a1 1 0 0 0 1.2.7L7 11v9h10v-9l1.8.5a1 1 0 0 0 1.2-.7l.9-3a1 1 0 0 0-.5-1.2z",
  kitchen: "M3 2v7c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V2 M6 2v20 M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z M21 15v7",
  living: "M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3 M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z M5 18v2 M19 18v2",
  games: "M6 11h4 M8 9v4 M15 12h.01 M18 10h.01 M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.2 2.1L9 15h6l1.8 2.1A3 3 0 0 0 22 15l-.7-6.4A4 4 0 0 0 17.3 5z",
  /** Personal spaces (R15 migration: icon "user"). */
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};
export const ICON_KEYS = Object.keys(SPACE_ICONS).filter((k) => k !== "user");

/** The 6 colours as soft two-stop gradients (nx16 .gr-*). */
export const GRADIENT: Record<string, [string, string]> = {
  green: ["#3fbf8c", "#16785a"],
  blue: ["#5b9bf0", "#2459b8"],
  violet: ["#9f80f2", "#5d3cc4"],
  amber: ["#f2b33d", "#c27408"],
  rose: ["#ef7a9e", "#b4335f"],
  slate: ["#8f8e89", "#4d4c48"],
};
export const COLOR_KEYS = Object.keys(GRADIENT);
const gradKey = (c: string | null | undefined) => (c && GRADIENT[c] ? c : c === "plum" ? "violet" : "slate");
export const gradientOf = (c: string | null | undefined) => {
  const [a, b] = GRADIENT[gradKey(c)];
  return `linear-gradient(140deg, ${a}, ${b})`;
};
/** The darker stop (washes, QR centre, cover bands). */
export const deepOf = (c: string | null | undefined) => GRADIENT[gradKey(c)][1];
export const lightOf = (c: string | null | undefined) => GRADIENT[gradKey(c)][0];

/** Only our own uploads (Vercel Blob, under spaces/<id>/identity/) are shown as a space photo. */
export function isSpacePhoto(url: string | null | undefined): url is string {
  if (!url) return false;
  // Local development without Blob keeps the (already re-encoded) WebP inline.
  if (url.startsWith("data:image/webp;base64,")) return url.length < 400_000;
  return /^https:\/\/[a-z0-9-]+\.(public|private)\.blob\.vercel-storage\.com\/spaces\/[\w-]+\/identity\/[\w.-]+\.webp$/i.test(url);
}

/** R17 P3: a person's own upload (users/<id>/photo/), same rules as a space photo. */
export function isUserPhoto(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("data:image/webp;base64,")) return url.length < 400_000;
  return /^https:\/\/[a-z0-9-]+\.(public|private)\.blob\.vercel-storage\.com\/users\/[\w-]+\/photo\/[\w.-]+\.webp$/i.test(url);
}

/** What an avatar may show: the person's upload, or the photo Google gave at sign-up (its image host only). */
export function personPhoto(url: string | null | undefined): string | null {
  if (!url) return null;
  if (isUserPhoto(url)) return url;
  return /^https:\/\/lh\d\.googleusercontent\.com\/[\w\-./=%~]+$/i.test(url) && url.length < 2000 ? url : null;
}
