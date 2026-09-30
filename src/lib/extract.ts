import "server-only";
import * as cheerio from "cheerio";
import { parsePrice } from "./money";
import { normalizeUrl, storeFromUrl } from "./stores";
import { isPublicHttpUrl } from "./utils";

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
  method: "jsonld" | "microdata" | "meta" | "title" | "ai" | "client" | "social" | "none";
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

/**
 * Link-preview crawler identity. Many stores (AliExpress in particular) block datacenter IPs for normal
 * browser requests but deliberately serve OpenGraph title/image to chat-app preview bots, because they
 * want shared links to unfurl. We use it only for the same purpose: previewing a link a user pasted.
 * Verified from GitHub Actions + Vercel (scripts/probe-extract.mjs, 2026-09-30).
 */
const SOCIAL_HEADERS: Record<string, string> = {
  "user-agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/** Some stores answer better on a canonical URL (no tracking junk, global English site). */
function fetchTarget(url: string, social = false): { url: string; headers: Record<string, string> } {
  const ali = url.match(/aliexpress\.[a-z.]+\/item\/(\d+)\.html/i);
  if (ali && social) return { url: `https://www.aliexpress.com/item/${ali[1]}.html`, headers: SOCIAL_HEADERS };
  if (social) return { url: stripTracking(url), headers: SOCIAL_HEADERS };
  if (ali) {
    return {
      url: `https://www.aliexpress.com/item/${ali[1]}.html`,
      headers: { ...HEADERS, "accept-language": "en-US,en;q=0.9", cookie: "aep_usuc_f=site=glo&c_tp=USD&region=IL&b_locale=en_US; intl_locale=en_US; xman_us_f=x_locale=en_US&x_l=0" },
    };
  }
  return { url: stripTracking(url), headers: HEADERS };
}

function stripTracking(url: string) {
  try {
    const u = new URL(url);
    for (const k of Array.from(u.searchParams.keys())) if (/^(utm_|gclid|gbraid|wbraid|gad_|fbclid|msclkid|spm|scm|algo_|pdp_|srcSns|_randl)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchHtml(inputUrl: string, social = false) {
  if (!isPublicHttpUrl(inputUrl)) throw new Error("blocked_host");
  const target = fetchTarget(inputUrl, social);
  const url = target.url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { headers: target.headers, redirect: "follow", signal: ctrl.signal, cache: "no-store" });
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

/** Owner diagnostics: raw response for one fetch mode. */
export async function debugFetch(url: string, social: boolean) {
  const r = await fetchHtml(url, social);
  const html = r.html ?? "";
  return { status: r.status, len: html.length, final: r.finalUrl.slice(0, 80), og: html.match(/og:title["'][^>]*content=["']([^"']{0,60})/i)?.[1] ?? null, head: html.replace(/\s+/g, " ").slice(0, 300) };
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

const BLOCK_HINTS = /captcha|access denied|robot check|are you a human|verify you are human|pardon our interruption|cf-chl|just a moment|forbidden|attention required|punish|slide to verify/i;

/** Data we can read from the link itself, before fetching anything. */
export function hintsFromUrl(url: string): { price: number | null; currency: string | null; slugTitle: string | null } {
  let price: number | null = null;
  let currency: string | null = null;
  try {
    const u = new URL(url);
    // AliExpress search/recommendation links carry the shown price: pdp_npi=...dis!ILS!<orig>!<sale>!...
    const npi = u.searchParams.get("pdp_npi");
    const m = npi?.match(/dis!([A-Z]{3})!([\d.]+)!([\d.]*)!/);
    if (m) {
      const sale = parseFloat(m[3]);
      const orig = parseFloat(m[2]);
      price = sale > 0 ? sale : orig > 0 ? orig : null;
      currency = price ? m[1] : null;
    }
    const seg = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")
      .replace(/\.(html?|aspx?|php)$/i, "")
      .replace(/[-_+]+/g, " ")
      .trim();
    const slugTitle = seg && !/^\d+$/.test(seg) && /[\p{L}]{3,}/u.test(seg) ? seg.slice(0, 140) : null;
    return { price, currency, slugTitle };
  } catch {
    return { price, currency, slugTitle: null };
  }
}

/** Store-specific extras when generic metadata is thin. */
function storeSpecific(html: string, storeKey: string): { price: number | null; currency: string | null; title: string | null } {
  if (storeKey === "aliexpress") {
    const patterns = [
      /"formatedActivityPrice"\s*:\s*"([^"]+)"/,
      /"formatedAmount"\s*:\s*"([^"]+)"/,
      /"salePrice"\s*:\s*\{[^}]*"formattedPrice"\s*:\s*"([^"]+)"/,
      /"minActivityAmount"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/,
      /"minAmount"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/,
    ];
    const cur = html.match(/"currencyCode"\s*:\s*"([A-Z]{3})"/)?.[1] ?? null;
    for (const re of patterns) {
      const hit = html.match(re)?.[1];
      const p = hit ? parsePrice(hit, cur ?? "USD") : null;
      if (p) return { price: p.amount, currency: p.currency ?? cur, title: null };
    }
    const title = html.match(/"subject"\s*:\s*"([^"]{8,400})"/)?.[1] ?? null;
    return { price: null, currency: null, title };
  }
  return { price: null, currency: null, title: null };
}

export async function extractFromUrl(inputUrl: string): Promise<Extracted> {
  const direct = await extractDirect(inputUrl);
  if (direct.title && direct.image && !direct.blocked) return direct;
  // Blocked or thin → ask again as a link-preview bot (fills title/image/description; rarely price).
  const isProduct = (u: string) => /\/item\/|\/dp\/|\/itm\/|\/product/i.test(u);
  const social = await extractDirect(direct.url !== inputUrl && isProduct(direct.url) ? direct.url : inputUrl, true);
  if (!social.title || social.blocked || isGenericTitle(social.title)) return direct;
  // Keep the pasted link unless only the bot fetch resolved a short link to a real product page.
  const useSocialUrl = direct.url === inputUrl && social.url !== inputUrl && !isProduct(inputUrl) && isProduct(social.url);
  return {
    ...direct,
    title: direct.title && !direct.blocked ? direct.title : social.title,
    image: direct.image ?? social.image,
    description: direct.description ?? social.description,
    brand: direct.brand ?? social.brand,
    price: direct.price ?? social.price,
    currency: direct.price != null ? direct.currency : (social.currency ?? direct.currency),
    availability: direct.availability ?? social.availability,
    siteName: direct.siteName ?? social.siteName,
    url: useSocialUrl ? social.url : direct.url,
    normalizedUrl: useSocialUrl ? social.normalizedUrl : direct.normalizedUrl,
    store: useSocialUrl ? social.store : direct.store,
    method: direct.title && !direct.blocked ? direct.method : "social",
    // Page text from a bot view is just boilerplate; don't feed it to the text-extraction model.
    pageText: direct.blocked ? null : direct.pageText,
    blocked: false,
  };
}

/** Store home pages / category pages a short link may land on — not a product. */
function isGenericTitle(t: string) {
  return /^(aliexpress|amazon\.[a-z.]+|ebay)\b.*(online shopping|shop online)|^(home|homepage|404|page not found|error page)/i.test(t.trim());
}

async function extractDirect(inputUrl: string, social = false): Promise<Extracted> {
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
    fetched = await fetchHtml(inputUrl, social);
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
  if (!blocked) {
    const extra = storeSpecific(fetched.html, storeWithSite.key);
    if (parsed.price == null && extra.price != null) {
      parsed.price = extra.price;
      parsed.currency = extra.currency;
    }
    if (!parsed.title && extra.title) parsed.title = extra.title;
  }
  if (parsed.title) parsed.title = parsed.title.replace(/\s*-\s*AliExpress(\s*\d+)?\s*$/i, "").trim();
  // AliExpress bot view: the description is a store slogan, not the product.
  if (storeWithSite.key === "aliexpress" && parsed.description && /smarter shopping|aliexpress\.com$/i.test(parsed.description)) parsed.description = null;
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
