import "server-only";
import { safeFetch } from "./safe-fetch";
import * as cheerio from "cheerio";
import { parsePrice } from "./money";
import { normalizeUrl, storeFromUrl } from "./stores";
import { isPublicHttpUrl } from "./utils";
import { kvGet, kvSet } from "./kv";
import { parseShopify, parseWoo, shopifyApiUrl, wooApiUrl, type ApiProduct } from "./store-apis";

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
  /** Barcode from JSON-LD (gtin13/12/8/gtin/gtin14, or a numeric mpn), digits only. */
  gtin?: string | null;
  store: { key: string; name: string };
  method: "jsonld" | "microdata" | "meta" | "title" | "ai" | "client" | "none" | "woo" | "shopify" | "worker";
  /** R17 C2: which rung of the fetch ladder read it (direct = our own fetch of the page). */
  via?: FetchStep;
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

type Target = { url: string; headers: Record<string, string> };

/** Some stores answer better on a canonical URL (no tracking junk, global English site). */
function fetchTarget(url: string): Target {
  const ali = url.match(/aliexpress\.[a-z.]+\/item\/(\d+)\.html/i);
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

async function fetchHtml(inputUrl: string) {
  if (!isPublicHttpUrl(inputUrl)) throw new Error("blocked_host");
  const target = fetchTarget(inputUrl);
  const url = target.url;
  // R15 B4: safeFetch checks every hop and the resolved address; capped at ~2.5 MB to stay within memory/time.
  const res = await safeFetch(url, { headers: target.headers, timeoutMs: 9000, maxBytes: 2_500_000 });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) return { finalUrl: res.url || url, html: null, status: res.status };
  return { finalUrl: res.url || url, html: res.text, status: res.status };
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
  let gtin: string | null = null;
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
        gtin ??= gtinFrom(p);
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
  // AliExpress preview pages carry a store slogan instead of a product description.
  if (description && /smarter shopping, better living/i.test(description)) description = null;
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
    gtin,
    method,
    pageText,
  };
}

/** GTIN from a JSON-LD Product (or its first offer): digits only, 8–14 long. */
export function gtinFrom(p: Record<string, unknown>): string | null {
  const offer = (Array.isArray(p.offers) ? p.offers[0] : p.offers) as Record<string, unknown> | undefined;
  for (const o of [p, offer]) {
    if (!o) continue;
    for (const k of ["gtin13", "gtin12", "gtin8", "gtin14", "gtin", "mpn"]) {
      const d = String(o[k] ?? "").replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 14 && (k !== "mpn" || /^\d+$/.test(String(o[k]).trim()))) return d;
    }
  }
  return null;
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

// ---------- R17 C2: the fetch ladder ----------
// Stores behind Cloudflare/Akamai refuse Vercel's addresses (the page is fine — the IP is the problem). In order, until
// one yields a name + a price (or a name + a picture): 1. our own fetch (as before); 2. the store's own public JSON
// (WooCommerce Store API, Shopify product.js); 3. the Cloudflare Worker (CF_FETCH_URL + CF_FETCH_SECRET; skipped
// without them — scripts/cf-worker/). The rung that worked is remembered per host for 7 days (kv fetch:win:<host>)
// and tried first next time. Every request goes through safeFetch (SSRF guard). The tracker uses the same ladder.
export type FetchStep = "direct" | "woo" | "shopify" | "worker";
const STEPS: FetchStep[] = ["direct", "woo", "shopify", "worker"];
const WIN_MS = 7 * 86_400_000;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const good = (e: Extracted) => !e.blocked && !!e.title && (e.price != null || !!e.image);
export const workerConfigured = () => !!(process.env.CF_FETCH_URL && process.env.CF_FETCH_SECRET && process.env.CF_FETCH_SECRET.length >= 16);

/** Read a product link, climbing the ladder when the store refuses us. `only` runs one rung (the probe). */
export async function extractFromUrl(inputUrl: string, opts: { only?: FetchStep; remember?: boolean } = {}): Promise<Extracted> {
  const host = hostOf(inputUrl);
  let win: { step: FetchStep; at: number } | null = null;
  if (!opts.only && host) {
    try {
      const v = JSON.parse((await kvGet(`fetch:win:${host}`)) ?? "null") as { step: FetchStep; at: number } | null;
      if (v && Date.now() - v.at < WIN_MS && STEPS.includes(v.step)) win = v;
    } catch {}
  }
  const order = opts.only ? [opts.only] : win ? [win.step, ...STEPS.filter((s) => s !== win!.step)] : STEPS;
  let first: Extracted | null = null;
  for (const step of order) {
    const ex = await runStep(step, inputUrl).catch(() => null);
    if (!ex) continue;
    if (step === "direct" || !first) first ??= ex;
    if (good(ex)) {
      if (!opts.only && opts.remember !== false && host && win?.step !== step) await kvSet(`fetch:win:${host}`, JSON.stringify({ step, at: Date.now() })).catch(() => {});
      if (step !== "direct" && host) await onLadderWin(host).catch(() => {});
      return { ...ex, via: step };
    }
  }
  if (first) return { ...first, via: first.via ?? "direct" };
  const s = storeFromUrl(inputUrl);
  return { url: inputUrl, normalizedUrl: normalizeUrl(inputUrl), title: null, description: null, brand: null, image: null, price: null, currency: null, availability: null, siteName: null, method: "none", pageText: null, blocked: true, store: { key: s.key, name: s.name }, via: "direct" };
}

/** A host that was refused and now reads through the ladder: its "extract · blocked" log entries are marked fixed. */
async function onLadderWin(host: string) {
  const { markExtractFixed } = await import("./db-scoped/errors");
  await markExtractFixed(host);
}

async function runStep(step: FetchStep, url: string): Promise<Extracted | null> {
  if (step === "direct") return extractDirect(url);
  if (step === "worker") return workerConfigured() ? extractViaWorker(url) : null;
  const api = step === "woo" ? wooApiUrl(url) : shopifyApiUrl(url);
  if (!api || !isPublicHttpUrl(url)) return null;
  const res = await safeFetch(api, { headers: { "user-agent": HEADERS["user-agent"], accept: "application/json", "accept-language": HEADERS["accept-language"] }, timeoutMs: 5000, maxBytes: 1_000_000 });
  if (!res.ok || !/json|javascript/.test(res.headers.get("content-type") ?? "")) return null;
  const p = step === "woo" ? parseWoo(res.text) : parseShopify(res.text);
  return p ? fromApi(url, p, step) : null;
}

/** An API product as an extraction (the page URL stays the item's link). */
export function fromApi(url: string, p: ApiProduct, step: "woo" | "shopify"): Extracted {
  const store = storeFromUrl(url);
  return {
    url,
    normalizedUrl: normalizeUrl(url),
    title: p.title,
    description: null,
    brand: p.brand,
    image: p.image,
    price: p.price,
    currency: p.currency ?? store.currency ?? null,
    availability: null,
    siteName: null,
    store: { key: store.key, name: store.name },
    method: step,
    pageText: null,
    blocked: false,
  };
}

/** The Worker fetches the page from Cloudflare's network and hands back the HTML (it checks the secret, http(s) only,
 *  no private ranges, size/time caps, no cookies). Our side: the target is a public URL; the worker URL goes through
 *  safeFetch like any other. */
async function extractViaWorker(url: string): Promise<Extracted | null> {
  if (!isPublicHttpUrl(url)) return null;
  const target = fetchTarget(url);
  const res = await safeFetch(`${process.env.CF_FETCH_URL!.replace(/\/$/, "")}/?url=${encodeURIComponent(target.url)}`, { headers: { "x-fetch-secret": process.env.CF_FETCH_SECRET! }, timeoutMs: 9000, maxBytes: 2_500_000 });
  if (!res.ok) return null;
  const finalUrl = res.headers.get("x-final-url") || target.url;
  const status = Number(res.headers.get("x-status") || 200);
  const ex = fromHtml(res.text, finalUrl, status);
  return { ...ex, method: ex.method === "none" ? "none" : ex.method };
}

async function extractDirect(inputUrl: string): Promise<Extracted> {
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
  return fromHtml(fetched.html, finalUrl, fetched.status);
}

/** A fetched product page → an extraction (our own fetch and the Worker's). */
export function fromHtml(html: string, finalUrl: string, status: number): Extracted {
  const fetched = { html, status };
  const store = storeFromUrl(finalUrl);
  const parsed = parseHtml(fetched.html, finalUrl);
  const blocked =
    fetched.status >= 400 ||
    // Script-only challenge pages (AliExpress "punish"/x5sec, etc.) have no visible text to match.
    (!parsed.title && !parsed.price && /_____tmd_____|x5secdata|\/punish\?|captcha|challenge-platform/i.test(fetched.html.slice(0, 6000))) ||
    (!parsed.price && BLOCK_HINTS.test((parsed.title ?? "") + " " + (parsed.pageText ?? "").slice(0, 400)));
  const storeWithSite = storeFromUrl(finalUrl, parsed.siteName);
  if (!blocked) {
    const extra = storeSpecific(fetched.html, storeWithSite.key);
    if (parsed.price == null && extra.price != null) {
      parsed.price = extra.price;
      parsed.currency = extra.currency;
    }
    if (!parsed.title && extra.title) parsed.title = extra.title;
  }
  // R17 B1: also "… AliExpress 34" with no dash.
  if (parsed.title) parsed.title = parsed.title.replace(/\s*(?:-\s*)?AliExpress(\s*\d+)?\s*$/i, "").trim();
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
