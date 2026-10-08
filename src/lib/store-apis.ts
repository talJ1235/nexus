// R17 C2 — the public JSON endpoints a store serves to its own front end (pure: URL builders + parsers;
// scripts/test-blocked.ts runs them on saved fixtures). Used by lib/extract.ts's ladder when the page itself is refused.

export type ApiProduct = { title: string | null; price: number | null; currency: string | null; image: string | null; brand: string | null };

/** WooCommerce Store API: /product/<slug>/ → /wp-json/wc/store/v1/products?slug=<slug>. */
export function wooApiUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    const m = u.pathname.match(/\/product\/([^/]+)\/?$/);
    if (!m) return null;
    return `${u.origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(decodeURIComponent(m[1]))}`;
  } catch {
    return null;
  }
}

/** Shopify: /products/<handle> (also under /collections/…) → /products/<handle>.js */
export function shopifyApiUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    const m = u.pathname.match(/\/products\/([^/.?]+)\/?$/);
    if (!m) return null;
    return `${u.origin}/products/${m[1]}.js`;
  } catch {
    return null;
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#8211;/g, "–").replace(/\s+/g, " ").trim() : null);

/** WooCommerce Store API answer (an array of products; prices are strings in minor units). */
export function parseWoo(body: string): ApiProduct | null {
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    return null;
  }
  const p = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return null;
  const prices = (p.prices ?? {}) as Record<string, unknown>;
  const minor = num(prices.currency_minor_unit) ?? 2;
  const raw = num(prices.sale_price) || num(prices.price);
  const price = raw != null && raw > 0 ? raw / 10 ** minor : null;
  const images = Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : [];
  const brands = Array.isArray(p.brands) ? (p.brands as Record<string, unknown>[]) : [];
  const title = text(p.name);
  if (!title && price == null) return null;
  return { title, price, currency: typeof prices.currency_code === "string" ? prices.currency_code : null, image: text(images[0]?.src) , brand: text(brands[0]?.name) };
}

/** Shopify product.js answer (prices in cents; no currency — the store's default is used). */
export function parseShopify(body: string): ApiProduct | null {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(body);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || typeof p.title !== "string") return null;
  const cents = num(p.price) ?? num((Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[])[0] : {})?.price);
  const imgs = Array.isArray(p.images) ? (p.images as unknown[]) : [];
  const img = typeof imgs[0] === "string" ? (imgs[0] as string) : typeof p.featured_image === "string" ? p.featured_image : null;
  return { title: text(p.title), price: cents != null && cents > 0 ? cents / 100 : null, currency: null, image: img ? (img.startsWith("//") ? `https:${img}` : img) : null, brand: text(p.vendor) };
}
