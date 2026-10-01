// Barcodes (Round 7 D1). Pure: classification, check digits, matching keys and the lookup chain (fetchers injected,
// so scripts/test-barcode.ts can run it without a network).

export type BarcodeClass =
  /** A real product number (EAN-13/8, UPC-A/E, GTIN-14) with a valid check digit. `key` = 14-digit form. */
  | { kind: "gtin"; code: string; key: string; israeli: boolean }
  /** Store-internal or variable-weight code (prefix 2 / 02 / 04): no global database knows it → photo. */
  | { kind: "store"; code: string }
  /** Anything else (Code 128 text, bad check digit): try the item's own list, else photo. */
  | { kind: "other"; code: string };

const digits = (s: string) => s.replace(/\D/g, "");

/** GS1 mod-10 check digit over every digit but the last. */
export function checkDigitOk(code: string) {
  if (!/^\d{8,14}$/.test(code)) return false;
  const body = code.slice(0, -1).split("").reverse();
  const sum = body.reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
}

/** UPC-E (8 digits, number system 0/1) → UPC-A (12 digits). */
export function upcEtoA(e: string): string | null {
  if (!/^[01]\d{7}$/.test(e)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = e.split("");
  let mid: string;
  if (["0", "1", "2"].includes(d6)) mid = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") mid = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") mid = `${d1}${d2}${d3}${d4}00000${d5}`;
  else mid = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${mid}${check}`;
}

/** Canonical key for matching: the 14-digit GTIN (left-padded with zeros). */
export const gtinKey = (code: string) => digits(code).padStart(14, "0");

export function classifyBarcode(raw: string): BarcodeClass {
  const text = raw.trim();
  let code = digits(text);
  if (code.length !== text.replace(/[\s-]/g, "").length || !code) return { kind: "other", code: text };
  // UPC-E printed on small packs.
  if (code.length === 8 && /^[01]/.test(code) && !checkDigitOk(code)) {
    const a = upcEtoA(code);
    if (a && checkDigitOk(a)) code = a;
  } else if (code.length === 8 && /^[01]/.test(code)) {
    // Ambiguous: a valid EAN-8 can also be UPC-E. EAN-8 wins (it's the more common one outside the US).
  }
  // In-store and variable-measure numbers (EAN-13 prefix 2, UPC-A number systems 2/4): scales print them with a price
  // inside, often without a meaningful check digit, so this comes before the check.
  if ((code.length === 13 && code[0] === "2") || (code.length === 12 && /^[24]/.test(code))) return { kind: "store", code };
  if (![8, 12, 13, 14].includes(code.length) || !checkDigitOk(code)) return { kind: "other", code };
  const key = gtinKey(code);
  if (key.startsWith("02")) return { kind: "store", code };
  return { kind: "gtin", code, key, israeli: key.slice(1, 4) === "729" };
}

export type LookupSource = "own" | "off" | "opf" | "upcitemdb" | "search" | "photo";
export type LookupHit = {
  source: LookupSource;
  title: string;
  brand?: string | null;
  image?: string | null;
  /** Raw category text from the database (normalised by the caller). */
  category?: string | null;
  /** Set when the code matched an item already in Nexus. */
  itemId?: string;
  /** A product page found by a search provider. */
  url?: string | null;
};

export type LookupDeps = {
  own: (key: string) => Promise<LookupHit | null>;
  off: (code: string) => Promise<LookupHit | null>;
  opf: (code: string) => Promise<LookupHit | null>;
  upcitemdb: (code: string) => Promise<LookupHit | null>;
  /** Only when a search key is configured. */
  search?: ((code: string) => Promise<LookupHit | null>) | null;
};

/**
 * Own items first, then the free databases, then a search provider if there is a key. `null` → the UI asks for a
 * photo of the product. Store-internal/weight codes skip the global databases. Each step's failure is just a miss.
 */
export async function lookupChain(raw: string, deps: LookupDeps): Promise<{ cls: BarcodeClass; hit: LookupHit | null; tried: LookupSource[] }> {
  const cls = classifyBarcode(raw);
  const tried: LookupSource[] = [];
  const attempt = async (src: LookupSource, fn: (() => Promise<LookupHit | null>) | null | undefined) => {
    if (!fn) return null;
    tried.push(src);
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const ownKey = cls.kind === "gtin" ? cls.key : cls.code;
  const own = await attempt("own", () => deps.own(ownKey));
  if (own) return { cls, hit: own, tried };
  if (cls.kind !== "gtin") return { cls, hit: null, tried };
  for (const [src, fn] of [
    ["off", () => deps.off(cls.code)],
    ["opf", () => deps.opf(cls.code)],
    ["upcitemdb", () => deps.upcitemdb(cls.code)],
    ["search", deps.search ? () => deps.search!(cls.code) : null],
  ] as const) {
    const hit = await attempt(src, fn);
    if (hit?.title) return { cls, hit, tried };
  }
  return { cls, hit: null, tried };
}
