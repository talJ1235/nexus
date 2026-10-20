// R19 B1–B2 — the chains' price-transparency files (the law's XML: Stores, PriceFull / Price, PromoFull / Promo), parsed
// without a DOM: the files are flat records, up to ~100 MB, in UTF-8 or UTF-16 (BOM) or windows-1255, and every portal
// spells the tags its own way (Shufersal: `<STORE><STOREID>` upper case inside SAP `asx:` wrappers; Cerberus / Bina /
// most: `<Store><StoreID>`; some `<Product>` instead of `<Item>`, `<Promotion>` with or without `<Groups>`). So: find the
// record blocks by tag (any case), read their leaf tags into a lower-cased map, and look fields up by their aliases.
// Pure (no I/O) — test:prices.
import cities from "./cities.json";

const CITY = cities as unknown as Record<string, [string, string]>;

/** Bytes → text: BOM first (UTF-16 LE / BE, UTF-8), then the XML declaration's encoding, UTF-8 otherwise. */
export function decodeXml(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder("utf-8").decode(buf.subarray(3));
  // UTF-16 without a BOM: every other byte of "<?xml" / "<Root" is 0.
  if (buf[1] === 0 && buf[3] === 0) return new TextDecoder("utf-16le").decode(buf);
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 200));
  const enc = head.match(/encoding=["']([\w-]+)["']/i)?.[1]?.toLowerCase();
  if (enc && /1255|iso-8859-8|hebrew/.test(enc)) return new TextDecoder("windows-1255").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function unescapeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Every `<tag>…</tag>` block (any case, any prefix like `asx:`), its inner XML. */
export function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}\\s*>`, "gi");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[1]);
  return out;
}

/** The leaf tags of a block → lower-cased name → text ("" for `<X/>`). The first one of a name wins. */
export function leaves(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/<(?:\w+:)?(\w+)(?:\s[^>]*)?(?:\/>|>([^<]*)<\/(?:\w+:)?\1\s*>)/g)) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = m[2] == null ? "" : unescapeXml(m[2]);
  }
  return out;
}

const pick = (f: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = f[k];
    if (v != null && v !== "") return v;
  }
  return "";
};
const num = (v: string) => {
  const n = Number(String(v).replace(/,/g, "").trim());
  return v !== "" && Number.isFinite(n) ? n : null;
};
const int = (v: string) => {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
};
/** "2026-10-19T04:56:12.903", "2026-10-19 04:56", "20261019045612", "19/10/2026 04:56" → ISO (Israel local, no zone). */
export function isoTime(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] ?? "0").padStart(2, "0")}:${m[5] ?? "00"}:00`;
  return null;
}

let CITY_NAMES: [string, number][] | null = null;
/** No city code (Yohananof, Polizer …): the longest locality name inside the store's name or address. */
export function guessCity(text: string): { code: number | null; he: string; en: string } | null {
  if (!text) return null;
  if (!CITY_NAMES) CITY_NAMES = Object.entries(CITY).filter(([, v]) => v[0].length >= 3).map(([k, v]) => [v[0], Number(k)] as [string, number]).sort((a, b) => b[0].length - a[0].length);
  const t = ` ${text.replace(/[-–,()"'׳]/g, " ").replace(/\s+/g, " ")} `;
  for (const [he, code] of CITY_NAMES) if (t.includes(` ${he.replace(/[-–]/g, " ").replace(/\s+/g, " ")} `)) return { code, he: CITY[String(code)][0], en: CITY[String(code)][1] };
  return null;
}

/** A Stores file's city: a CBS locality code (most chains) or a name (some); → { he, en, code }. */
export function cityOf(v: string): { code: number | null; he: string; en: string } {
  const s = v.trim();
  if (/^\d+$/.test(s)) {
    const code = Number(s);
    const c = CITY[String(code)];
    return { code, he: c?.[0] ?? "", en: c?.[1] ?? "" };
  }
  return { code: null, he: s === "0" || s === "unknown" ? "" : s, en: "" };
}

const UNKNOWN = /^(לא ידוע|unknown|-|0)$/i;
const clean = (v: string) => (UNKNOWN.test(v.trim()) ? "" : v.trim());

// ---------- Stores ----------
export type StoreRow = {
  storeId: number;
  subChainId: string | null;
  subChainName: string | null;
  name: string;
  address: string;
  city: { code: number | null; he: string; en: string };
  zip: string | null;
  /** 1 = a shop, 2 = online, 3 = both (the law's StoreType). */
  type: number | null;
  lat: number | null;
  lng: number | null;
};
export type StoresFile = { chainId: string; chainName: string; updated: string | null; stores: StoreRow[] };

export function parseStores(xml: string): StoresFile {
  const head = leaves(xml.slice(0, 2000));
  // Sub-chains wrap their stores in some files: read each sub-chain's id / name for the stores inside it.
  const subs = blocks(xml, "SubChain");
  const groups = subs.length ? subs.map((b) => ({ f: leaves(b.split(/<(?:\w+:)?Stores?\b/i)[0]), body: b })) : [{ f: {} as Record<string, string>, body: xml }];
  const stores: StoreRow[] = [];
  for (const g of groups) {
    // City Market's portal nests every store in `<SubChainStoreXMLObject>` inside one `<Store>`.
    const nested = blocks(g.body, "SubChainStoreXMLObject");
    for (const b of nested.length ? nested : blocks(g.body, "Store").concat(blocks(g.body, "Branch"))) {
      const f = leaves(b);
      const id = int(pick(f, "storeid", "store_id", "storenum", "branchid"));
      if (id == null) continue;
      stores.push({
        storeId: id,
        subChainId: pick(f, "subchainid") || pick(g.f, "subchainid") || null,
        subChainName: pick(f, "subchainname") || pick(g.f, "subchainname") || null,
        name: clean(pick(f, "storename", "store_name", "branchname", "name")),
        address: clean(pick(f, "address", "storeaddress", "street")),
        city: ((c) => (c.he || c.en ? c : (guessCity(`${pick(f, "storename", "name")} ${pick(f, "address")}`) ?? c)))(cityOf(pick(f, "city", "cityname", "storecity"))),
        zip: clean(pick(f, "zipcode", "zip")).replace(/^0+$/, "") || null,
        type: int(pick(f, "storetype", "type")),
        lat: num(pick(f, "latitude", "lat")),
        lng: num(pick(f, "longitude", "lng", "lon")),
      });
    }
  }
  // Same store listed twice (a sub-chain repeated) → once.
  const seen = new Set<string>();
  const unique = stores.filter((s) => {
    const k = `${s.subChainId ?? ""}:${s.storeId}`;
    return !seen.has(k) && !!seen.add(k);
  });
  return {
    chainId: pick(head, "chainid", "chain_id") || pick(leaves(xml), "chainid"),
    chainName: pick(head, "chainname", "chain_name"),
    updated: isoTime(`${pick(head, "lastupdatedate")} ${pick(head, "lastupdatetime")}`.trim()),
    stores: unique,
  };
}

// ---------- Prices ----------
export type PriceRow = {
  code: string;
  /** The law's ItemType: 0 = the store's own code (weighed produce, deli), 1 = a real barcode. */
  internal: boolean;
  name: string;
  manufacturer: string;
  country: string;
  quantity: number | null;
  /** "גרם", "100 גרם", "ליטר", "יחידות", … as the chain wrote it. */
  unit: string;
  weighted: boolean;
  inPackage: number | null;
  price: number;
  unitPrice: number | null;
  updated: string | null;
};
export type PricesFile = { chainId: string; subChainId: string | null; storeId: number | null; items: PriceRow[] };


export function parsePrices(xml: string): PricesFile {
  const head = leaves(xml.slice(0, 1500));
  const rows: PriceRow[] = [];
  const items = blocks(xml, "Item");
  for (const b of items.length ? items : blocks(xml, "Product")) {
    const f = leaves(b);
    const code = pick(f, "itemcode", "item_code", "barcode").replace(/^0+(?=\d{8,})/, "");
    const price = num(pick(f, "itemprice", "item_price", "price"));
    if (!code || price == null || price <= 0) continue;
    const type = pick(f, "itemtype", "item_type");
    rows.push({
      code,
      internal: type === "0" || code.length < 8,
      name: pick(f, "itemname", "itemnm", "item_name", "manufactureritemdescription", "manufactureitemdescription"),
      manufacturer: clean(pick(f, "manufacturername", "manufacturename", "manufacturer")),
      country: clean(pick(f, "manufacturecountry", "manufacturercountry")),
      quantity: num(pick(f, "quantity")),
      unit: clean(pick(f, "unitqty")) || clean(pick(f, "unitofmeasure")),
      weighted: ["1", "true"].includes(pick(f, "bisweighted", "isweighted", "blnisweighted").toLowerCase()),
      inPackage: num(clean(pick(f, "qtyinpackage"))),
      price,
      unitPrice: num(pick(f, "unitofmeasureprice")),
      updated: isoTime(pick(f, "priceupdatedate", "priceupdatetime", "lastupdatedate")),
    });
  }
  return {
    chainId: pick(head, "chainid", "chain_id"),
    subChainId: pick(head, "subchainid") || null,
    storeId: int(pick(head, "storeid", "store_id")),
    items: rows,
  };
}

// ---------- Promotions ----------
export type PromoItem = { code: string; minQty: number | null; discountedPrice: number | null; discountRate: number | null; weighted: boolean };
export type PromoRow = {
  id: string;
  description: string;
  updated: string | null;
  start: string | null;
  end: string | null;
  /** The law's RewardType: 1 = a price for N, 2 = % off, 3 = a set price, 10 = buy X get Y … (as published). */
  reward: number | null;
  minQty: number | null;
  maxQty: number | null;
  discountedPrice: number | null;
  /** Percent (0–100) when the chain publishes a rate. */
  discountRate: number | null;
  minBasket: number | null;
  /** A club / card deal (ClubID other than 0 = everyone). */
  club: boolean;
  items: PromoItem[];
};
export type PromosFile = { chainId: string; subChainId: string | null; storeId: number | null; promos: PromoRow[] };

export function parsePromos(xml: string): PromosFile {
  const head = leaves(xml.slice(0, 1500));
  const promos: PromoRow[] = [];
  const list = blocks(xml, "Promotion");
  for (const b of list.length ? list : blocks(xml, "Sale")) {
    // The promotion's own fields: the part before its item list (items repeat MinQty / DiscountedPrice).
    const own = leaves(b.replace(/<(?:\w+:)?(?:PromotionItems|Groups|Items)\b[\s\S]*$/i, ""));
    const all = leaves(b);
    const id = pick(own, "promotionid", "promotion_id", "promoid") || pick(all, "promotionid");
    if (!id) continue;
    const items: PromoItem[] = [];
    for (const it of blocks(b, "PromotionItem").concat(blocks(b, "Item"))) {
      const f = leaves(it);
      const code = pick(f, "itemcode", "item_code").replace(/^0+(?=\d{8,})/, "");
      if (!code) continue;
      items.push({
        code,
        minQty: num(pick(f, "minqty")),
        discountedPrice: num(pick(f, "discountedprice")),
        discountRate: num(pick(f, "discountrate")),
        weighted: pick(f, "bisweighted", "isweighted") === "1",
      });
    }
    const first = items[0];
    const club = pick(own, "clubid", "clubs").trim();
    const rate = num(pick(own, "discountrate")) ?? first?.discountRate ?? null;
    promos.push({
      id,
      description: pick(own, "promotiondescription", "promotion_description", "description"),
      updated: isoTime(pick(own, "promotionupdatedate", "promotionupdatetime")),
      start: isoTime(`${pick(own, "promotionstartdate", "promotionstartdatetime")} ${pick(own, "promotionstarthour")}`.trim()),
      end: isoTime(`${pick(own, "promotionenddate", "promotionenddatetime")} ${pick(own, "promotionendhour")}`.trim()),
      reward: int(pick(own, "rewardtype") || pick(all, "rewardtype")),
      minQty: num(pick(own, "minqty")) ?? first?.minQty ?? null,
      maxQty: num(pick(own, "maxqty") || pick(all, "maxqty")),
      discountedPrice: num(pick(own, "discountedprice")) ?? first?.discountedPrice ?? null,
      // Some chains publish the rate in hundredths of a percent (1000 = 10 %).
      discountRate: rate == null ? null : rate > 100 ? rate / 100 : rate,
      minBasket: num(pick(own, "minpurchaseamnt", "minpurchaseamount") || pick(all, "minpurchaseamount")),
      club: club !== "" && club !== "0" && !/^0+$/.test(club),
      items,
    });
  }
  return {
    chainId: pick(head, "chainid", "chain_id"),
    subChainId: pick(head, "subchainid") || null,
    storeId: int(pick(head, "storeid", "store_id")),
    promos,
  };
}

/** What a file name says: kind, chain, store, stamp (`PriceFull7290027600007-001-001-20261019-160000.gz` …). */
export function fileInfo(name: string): { kind: "Stores" | "PriceFull" | "Price" | "PromoFull" | "Promo"; chainId: string; storeId: number | null; stamp: string } | null {
  const m = name.split(/[\\/]/).pop()!.match(/^(pricefull|promofull|price|promo|storesfull|stores?)(\d{13})[-_](?:(\d{1,4})[-_])?(\d{1,4})[-_](\d{8})[-_]?(\d{4,6})?/i);
  if (!m) return null;
  const k = m[1].toLowerCase();
  const kind = k === "pricefull" ? "PriceFull" : k === "promofull" ? "PromoFull" : k === "price" ? "Price" : k === "promo" ? "Promo" : "Stores";
  return { kind, chainId: m[2], storeId: kind === "Stores" ? null : Number(m[4]), stamp: `${m[5]}${(m[6] ?? "").slice(0, 4).padEnd(4, "0")}` };
}
