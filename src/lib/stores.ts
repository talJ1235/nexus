// Store detection + URL normalization. Shared by server and client.

type StoreDef = { key: string; name: string; match: RegExp; currency?: string };

// Order matters: first match wins.
const STORES: StoreDef[] = [
  { key: "aliexpress", name: "AliExpress", match: /(^|\.)aliexpress\.(com|us|ru)$|(^|\.)ali\.ski$/ },
  { key: "amazon", name: "Amazon", match: /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.(to|eu|asia)$|(^|\.)a\.co$/ },
  { key: "ebay", name: "eBay", match: /(^|\.)ebay\.[a-z.]+$|(^|\.)ebay\.us$/ },
  { key: "temu", name: "Temu", match: /(^|\.)temu\.com$/ },
  { key: "ksp", name: "KSP", match: /(^|\.)ksp\.co\.il$/, currency: "ILS" },
  { key: "ivory", name: "Ivory", match: /(^|\.)ivory\.co\.il$/, currency: "ILS" },
  { key: "bug", name: "Bug", match: /(^|\.)bug\.co\.il$/, currency: "ILS" },
  { key: "ikea", name: "IKEA", match: /(^|\.)ikea\.(com|co\.il)$/ },
  { key: "zap", name: "Zap", match: /(^|\.)zap\.co\.il$/, currency: "ILS" },
  { key: "lastprice", name: "Last Price", match: /(^|\.)lastprice\.co\.il$/, currency: "ILS" },
  { key: "ace", name: "ACE", match: /(^|\.)ace\.co\.il$/, currency: "ILS" },
  { key: "homecenter", name: "Home Center", match: /(^|\.)homecenter\.co\.il$/, currency: "ILS" },
  { key: "terminalx", name: "Terminal X", match: /(^|\.)terminalx\.com$/, currency: "ILS" },
  { key: "shufersal", name: "Shufersal", match: /(^|\.)shufersal\.co\.il$/, currency: "ILS" },
  { key: "machsanei-hashmal", name: "Machsanei Hashmal", match: /(^|\.)payngo\.co\.il$|(^|\.)machsanei-hashmal\.co\.il$/, currency: "ILS" },
  { key: "digikey", name: "DigiKey", match: /(^|\.)digikey\.[a-z.]+$/ },
  { key: "mouser", name: "Mouser", match: /(^|\.)mouser\.[a-z.]+$/ },
  { key: "lcsc", name: "LCSC", match: /(^|\.)lcsc\.com$/ },
  { key: "adafruit", name: "Adafruit", match: /(^|\.)adafruit\.com$/ },
  { key: "sparkfun", name: "SparkFun", match: /(^|\.)sparkfun\.com$/ },
  { key: "banggood", name: "Banggood", match: /(^|\.)banggood\.com$/ },
  { key: "shein", name: "SHEIN", match: /(^|\.)shein\.com$/ },
  { key: "bhphoto", name: "B&H", match: /(^|\.)bhphotovideo\.com$/ },
  { key: "creality", name: "Creality", match: /(^|\.)creality\.com$/ },
  { key: "bambulab", name: "Bambu Lab", match: /(^|\.)bambulab\.com$/ },
];

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\.|^m\.|^he\.|^il\./, "");
  } catch {
    return "";
  }
}

export function storeFromUrl(url: string, siteName?: string | null) {
  const host = hostOf(url);
  const def = STORES.find((s) => s.match.test(host));
  if (def) return { key: def.key, name: def.name, currency: def.currency };
  if (/^[\d.]+$|^\[?[0-9a-f:]+\]?$/i.test(host)) return { key: host || "store", name: "Store", currency: undefined };
  const base = host.split(".").filter((p) => !["co", "com", "il", "net", "org", "shop", "store"].includes(p));
  const keyPart = base[base.length - 1] || host || "store";
  const pretty = siteName?.trim() && siteName.length <= 32 ? siteName.trim() : keyPart.charAt(0).toUpperCase() + keyPart.slice(1);
  return { key: host || "store", name: pretty, currency: host.endsWith(".il") ? "ILS" : undefined };
}

const TRACKING = /^(utm_|spm|scm|gclid|fbclid|gad_|gbraid|wbraid|msclkid|mc_|ref|ref_|tag|aff|af_|aff_|algo_|pdp_|_randl|srcSns|sourceType|businessType|dp$|pf_|sk$|th$|psc$|ascsubtag|linkCode|creative|camp|clickid|click_id|trk|trkid|share|sharer|social|s$|sr$|qid$|keywords$|crid$|sprefix$)/i;

/** Canonical form used for duplicate detection. */
export function normalizeUrl(input: string) {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const host = u.hostname;

  const ali = u.pathname.match(/\/item\/(\d+)\.html/);
  if (/aliexpress\./.test(host) && ali) return `https://aliexpress.com/item/${ali[1]}.html`;

  const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  if (/amazon\./.test(host) && asin) return `https://${host}/dp/${asin[1].toUpperCase()}`;

  const ebay = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
  if (/ebay\./.test(host) && ebay) return `https://${host}/itm/${ebay[1]}`;

  for (const k of Array.from(u.searchParams.keys())) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  let out = u.toString();
  if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
  return out.replace(/\?$/, "");
}
