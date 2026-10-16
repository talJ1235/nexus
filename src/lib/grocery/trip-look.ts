// R18 S5 B2 — the start-shopping screen's look, picked by each person (board StartTrip-phone, "Screen look"): a colour
// (Auto = the store's colour, or one of 8) × a style (Vivid / Soft / Night). Saved per user: `pref:tripLook:<store>` for
// one store, `pref:tripLook` for all. Store mode's header uses the same colour. Text on the colour must reach 4.5:1 — the
// colour is darkened automatically until it does (unit test over every colour × light / dark). Client-safe.

export const TRIP_COLORS = { red: "#c2412d", orange: "#c8611a", green: "#2f8a4c", teal: "#127f78", blue: "#2563c9", purple: "#6a46c8", pink: "#c23d72", ink: "#2a2a2a" } as const;
export type TripColor = keyof typeof TRIP_COLORS;
export const TRIP_COLOR_KEYS = Object.keys(TRIP_COLORS) as TripColor[];
export type TripStyle = "vivid" | "soft" | "night";
export const TRIP_STYLES: TripStyle[] = ["vivid", "soft", "night"];
export type TripLook = { color: TripColor | "auto"; style: TripStyle };
export const DEFAULT_LOOK: TripLook = { color: "auto", style: "vivid" };

export const TRIP_LOOK_KEY = "pref:tripLook";
/** The pref key for one store ("chain|branch"), or for every store. */
export const tripLookKey = (store: string | null) => (store ? `${TRIP_LOOK_KEY}:${store}` : TRIP_LOOK_KEY);

export function parseLook(raw: string | null | undefined): TripLook | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<TripLook> | null;
    if (!v || typeof v !== "object") return null;
    const color = v.color === "auto" || (typeof v.color === "string" && v.color in TRIP_COLORS) ? (v.color as TripLook["color"]) : "auto";
    const style = TRIP_STYLES.includes(v.style as TripStyle) ? (v.style as TripStyle) : "vivid";
    return { color, style };
  } catch {
    return null;
  }
}

/** The look for this store: its own pick, else the all-stores pick, else Auto · Vivid. */
export function lookFor(looks: Record<string, string> | undefined, store: string | null): TripLook & { perStore: boolean } {
  const own = store ? parseLook(looks?.[tripLookKey(store)]) : null;
  if (own) return { ...own, perStore: true };
  const all = parseLook(looks?.[TRIP_LOOK_KEY]);
  return { ...(all ?? DEFAULT_LOOK), perStore: !all };
}

// ---- colour maths (sRGB, WCAG 2.x) ----
type RGB = [number, number, number];
export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
/** a·p + b·(1−p) — CSS `color-mix(in srgb, a p, b)`. */
export const mix = (a: RGB, b: RGB, p: number): RGB => [a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)];
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [11, 11, 11];
/** Darken toward black in 3 % steps until white text on it reaches `min` (4.5:1). */
export function safeOn(hex: string, min = 4.5): string {
  let c = hexToRgb(hex);
  for (let i = 0; i < 40 && contrast(c, WHITE) < min; i++) c = mix(c, BLACK, 0.97);
  return rgbToHex(c);
}

/** The base colour of a look (Auto = the store's colour; no store → ink). */
export function baseColor(look: Pick<TripLook, "color">, storeColor: string | null | undefined) {
  if (look.color !== "auto") return TRIP_COLORS[look.color];
  return storeColor && /^#[0-9a-f]{6}$/i.test(storeColor) ? storeColor : TRIP_COLORS.ink;
}

/**
 * The colour the screen paints with: Vivid on a dark theme = 62 % mixed with black (the board), then darkened until
 * white text reaches 4.5:1. Soft and Night keep the colour for accents (Soft's text is ink on a pale tint; Night's
 * white on near-black) — `accent` is the safe colour for white text either way.
 */
export function tripColor(look: TripLook, storeColor: string | null | undefined, dark: boolean) {
  const base = baseColor(look, storeColor);
  const vivid = look.style === "vivid" && dark ? rgbToHex(mix(hexToRgb(base), BLACK, 0.62)) : base;
  return { base, accent: safeOn(vivid) };
}
