// The short fixed category list (Round 7). Client-safe: used by the UI (labels, filter) and the AI prompts.
export const CATEGORIES = [
  "electronics",
  "mechanical",
  "tools",
  "materials",
  "computers",
  "camera-audio",
  "home-kitchen",
  "office",
  "clothing-personal",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Pre-Round-7 values → the new list (migrate.ts applies it to stored items; AI answers go through it too). */
export const LEGACY_CATEGORIES: Record<string, Category> = {
  components: "mechanical",
  "3d-printing": "materials",
  "camera-video": "camera-audio",
  audio: "camera-audio",
  home: "home-kitchen",
  furniture: "home-kitchen",
  kitchen: "home-kitchen",
  garden: "home-kitchen",
  "health-beauty": "clothing-personal",
  sports: "clothing-personal",
  clothing: "clothing-personal",
  software: "other",
  books: "other",
  vehicle: "other",
};

export const isCategory = (v: unknown): v is Category => (CATEGORIES as readonly unknown[]).includes(v);

export function normalizeCategory(v: string | null | undefined): Category | null {
  if (!v) return null;
  const k = v.trim().toLowerCase();
  return isCategory(k) ? k : (LEGACY_CATEGORIES[k] ?? "other");
}
