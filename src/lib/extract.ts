import "server-only";
import * as cheerio from "cheerio";
import { parsePrice } from "./money";
import { normalizeUrl, storeFromUrl } from "./stores";

export type Extracted = {
  url: string; // final URL after redirects
  normalizedUrl: string;
  title: string | null;
  description: string | null;
  brand: string | null;
  image: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  siteName: string | null;
  store: { key: string; name: string };
  method: "jsonld" | "microdata" | "meta" | "title" | "ai" | "client" | "none";
  pageText: string | null; // trimmed visible text, for AI fallback
  blocked: boolean;
};

const HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,he;q=0.8",
  "cache-control": "no-cache",
  "upgrade-insecure-requests": "1",
};

async function fetchHtml(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: ctrl.signal, cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return { finalUrl: res.url || url, html: null, status: res.status };
    // Cap at ~2.5MB to stay within function memory/time.
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const dec = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        html += dec.decode(value, { stream: true });
        if (size > 2_500_000) {
          await reader.cancel();
          break;
        }
      }
    }
    return { finalUrl: res.url || url, html, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

type Json = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v && "name" in v) return str((v as Json).name);
  if (typeof v === "object" && v && "@value" in v) return str((v as Json)["@value"]);
  return null;
}

function findProducts(node: unknown, out: Json[] = []): Json[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => findProducts(n, out));
    return out;
  }
  const obj = node as Json;
  const types = asArray(obj["@type"] as string | string[]).map((t) => String(t).toLowerCase());
  if (types.some((t) => t === "product" || t === "productgroup" || t.endsWith("/product"))) out.push(obj);
  for (const k of ["@graph", "mainEntity", "itemListElement", "item"]) if (obj[k]) findProducts(obj[k], out);
  return out;
}

function imageFrom(v: unknown): string | null {
  for (const i of asArray(v as unknown)) {
    if (typeof i === "string") return i;
    if (i && typeof i === "object") {
      const u = str((i as Json).url) ?? str((i as Json).contentUrl);
      if (u) return u;
    }
  }
  return null;
}

function offerFrom(p: Json): { price: number | null; currency: string | null; availability: string | null } {
  const variants = asArray(p.hasVariant as Json[]);
  const offers = [...asArray(p.offers as Json | Json[]), ...variants.flatMap((v) => asArray(v.offers as Json | Json[]))];
  for (const o of offers) {
    if (!o || typeof o !== "object") continue;
    const currency = str(o.priceCurrency) ?? str((o.priceSpecification as Json)?.priceCurrency);
    const raw = o.price ?? o.lowPrice ?? (o.priceSpecification as Json)?.price ?? asArray(o.offers as Json[])[0]?.price;
    const parsed = parsePrice(raw as string | number, currency ?? undefined);
    if (parsed) {
      const avail = str(o.availability)?.split("/").pop() ?? null;
      return { price: parsed.amount, currency: parsed.currency ?? currency, availability: avail };
    }
  }
  return { price: null, currency: null, availability: null };
}

function absolutize(src: string | null, base: string) {
  if (!src) return null;
  try {
    return new URL(src.replace(/^\/\//, "https://"), base).toString();
  } catch {
    return null;
  }
}

export function parseHtml(html: string, pageUrl: string): Omit<Extracted, "url" | "normalizedUrl" | "store" | "blocked"> {
  const $ = cheerio.load(html);
  const meta = (sel: string) => $(`meta[property="${sel}"], meta[name="${sel}"], meta[itemprop="${sel}"]`).first().attr("content")?.trim() || null;

  let title: string | null = null;
  let description: string | null = null;
  let brand: string | null = null;
  let image: string | null = null;
  let price: number | null = null;
  let currency: string | null = null;
  let availability: string | null = null;
  let method: Extracted["method"] = "none";

  // 1) JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    if (title && price) return;
    const raw = $(el).contents().text();
    try {
      const data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " "));
      for (const p of findProducts(data)) {
        title ??= str(p.name);
        description ??= str(p.description);
        brand ??= str(p.brand);
        image ??= imageFrom(p.image);
        if (price == null) {
          const o = offerFrom(p);
          price = o.price;
          currency = o.currency;
          availability = o.availability;
        }
        if (title) method = "jsonld";
      }
    } catch {
      /* malformed JSON-LD — ignore */
    }
  });

  // 2) Microdata
  if (!title || price == null) {
    const scope = $('[itemtype*="schema.org/Product"]').first();
    if (scope.length) {
      title ??= scope.find('[itemprop="name"]').first().attr("content")?.trim() || scope.find('[itemprop="name"]').first().text().trim() || null;
      const pEl = scope.find('[itemprop="price"]').first();
      const pRaw = pEl.attr("content") ?? pEl.text();
      const cur = scope.find('[itemprop="priceCurrency"]').first().attr("content") ?? null;
      const parsed = parsePrice(pRaw, cur ?? undefined);
      if (price == null && parsed) {
        price = parsed.amount;
        currency = parsed.currency ?? cur;
      }
      image ??= scope.find('[itemprop="image"]').first().attr("src") ?? scope.find('[itemprop="image"]').first().attr("content") ?? null;
      if (title && method === "none") method = "microdata";
    }
  }

  // 3) OpenGraph / product meta
  const ogTitle = meta("og:title") ?? meta("twitter:title");
  if (!title && ogTitle) {
    title = ogTitle;
    method = "meta";
  }
  description ??= meta("og:description") ?? meta("description");
  image ??= meta("og:image:secure_url") ?? meta("og:image") ?? meta("twitter:image");
  if (price == null) {
    const cur = meta("product:price:currency") ?? meta("og:price:currency") ?? meta("priceCurrency");
    const parsed = parsePrice(meta("product:price:amount") ?? meta("og:price:amount") ?? meta("price"), cur ?? undefined);
    if (parsed) {
      price = parsed.amount;
      currency = parsed.currency ?? cur;
      if (method === "none") method = "meta";
    }
  }
  brand ??= meta("product:brand") ?? meta("og:brand");

  // 4) <title>
  if (!title) {
    const t = $("title").first().text().trim();
    if (t) {
      title = t;
      method = "title";
    }
  }

  const siteName = meta("og:site_name") ?? meta("application-name");

  // Visible text for AI fallback
  $("script, style, noscript, svg, iframe, header nav, footer").remove();
  const pageText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12000) || null;

  return {
    title: title ? cleanTitle(title, siteName) : null,
    description: description ? description.slice(0, 600) : null,
    brand,
    image: absolutize(image, pageUrl),
    price,
    currency: currency ? currency.toUpperCase() : null,
    availability,
    siteName,
    method,
    pageText,
  };
}

function cleanTitle(t: string, siteName: string | null) {
  let out = t.replace(/\s+/g, " ").trim();
  if (siteName) out = out.replace(new RegExp(`\\s*[|\\-–—:]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  out = out.replace(/\s*[|–—]\s*(AliExpress|Amazon\.[a-z.]+|eBay|IKEA)\s*$/i, "");
  return out.slice(0, 300);
}

const BLOCK_HINTS = /captcha|access denied|robot check|are you a human|verify you are human|pardon our interruption|cf-chl|just a moment/i;

export async function extractFromUrl(inputUrl: string): Promise<Extracted> {
  const base = {
    url: inputUrl,
    normalizedUrl: normalizeUrl(inputUrl),
    title: null,
    description: null,
    brand: null,
    image: null,
    price: null,
    currency: null,
    availability: null,
    siteName: null,
    method: "none" as const,
    pageText: null,
    blocked: false,
  };
  let fetched: Awaited<ReturnType<typeof fetchHtml>>;
  try {
    fetched = await fetchHtml(inputUrl);
  } catch {
    const s = storeFromUrl(inputUrl);
    return { ...base, store: { key: s.key, name: s.name }, blocked: true };
  }
  const finalUrl = fetched.finalUrl || inputUrl;
  const store = storeFromUrl(finalUrl);
  if (!fetched.html) {
    return { ...base, url: finalUrl, normalizedUrl: normalizeUrl(finalUrl), store: { key: store.key, name: store.name }, blocked: fetched.status >= 400 };
  }
  const parsed = parseHtml(fetched.html, finalUrl);
  const blocked = fetched.status >= 400 || (!parsed.price && BLOCK_HINTS.test((parsed.title ?? "") + " " + (parsed.pageText ?? "").slice(0, 400)));
  const storeWithSite = storeFromUrl(finalUrl, parsed.siteName);
  return {
    ...parsed,
    title: blocked && parsed.method === "title" ? null : parsed.title,
    currency: parsed.currency ?? store.currency ?? null,
    url: finalUrl,
    normalizedUrl: normalizeUrl(finalUrl),
    store: { key: storeWithSite.key, name: storeWithSite.name },
    blocked,
  };
}
