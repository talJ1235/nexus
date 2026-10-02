// Pure glue for product pictures (Round 10 D2/D3): which image-search results are worth showing, how the model's
// pick turns into a chosen picture + ranked alternatives, and the query cache. No I/O here (tests import it).

export type PicSource = "barcode" | "own" | "search" | "off" | "generic" | "icon";
export type Candidate = { url: string; source: PicSource; title?: string | null; domain?: string | null; w?: number | null; h?: number | null; score?: number };
export type RawImage = { image: string; page?: string | null; title?: string | null; width?: number | null; height?: number | null; domain?: string | null };

/** Stores and brands whose product photos are clean packshots (Israeli groceries first, then maker shops). */
const GOOD_DOMAINS = [
  "shufersal.co.il", "rami-levy.co.il", "yochananof.co.il", "victoryonline.co.il", "carrefour.co.il", "osherad.co.il", "tivtaam.co.il", "mega.co.il", "superpharm.co.il", "be-pharm.co.il", "wolt.com", "10bis.co.il",
  "tnuva.co.il", "strauss-group.com", "strauss.co.il", "osem.co.il", "elite.co.il", "tara.co.il", "yotvata.co.il", "openfoodfacts.org", "openproductsfacts.org",
  "amazon.com", "media-amazon.com", "aliexpress.com", "alicdn.com", "ksp.co.il", "ivory.co.il", "bug.co.il", "adafruit.com", "sparkfun.com", "digikey.com", "mouser.com", "pololu.com", "botland.store", "reichelt.de", "lcsc.com",
];
const JUNK = /(logo|banner|collage|sprite|favicon|placeholder|icon[-_]|avatar|thumbnail-default|לוגו|באנר|קולאז|מבצע)/i;

const host = (u: string | null | undefined) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/** Keep square-ish photos ≥ 300 px from https; drop logos, banners, collages; boost store/brand domains. */
export function filterImageResults(results: RawImage[], opts: { brand?: string | null; source?: PicSource } = {}): Candidate[] {
  const brand = opts.brand?.toLowerCase().replace(/[^a-z]/g, "") || null;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  results.forEach((r, i) => {
    const url = r.image;
    if (!/^https:\/\//.test(url) || /\.(svg|gif)(\?|$)/i.test(url) || seen.has(url)) return;
    if (JUNK.test(url) || JUNK.test(r.title ?? "")) return;
    const w = r.width ?? null;
    const h = r.height ?? null;
    if (w != null && h != null) {
      if (Math.min(w, h) < 300) return;
      const ar = w / h;
      if (ar < 0.6 || ar > 1.7) return;
    }
    seen.add(url);
    const domain = r.domain ?? host(r.page) ?? host(url);
    let score = 1 - i * 0.03;
    if (domain && GOOD_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) score += 0.3;
    if (brand && domain?.replace(/[^a-z]/g, "").includes(brand)) score += 0.25;
    if (w != null && h != null) score += 0.1 * (1 - Math.min(1, Math.abs(1 - w / h)));
    out.push({ url, source: opts.source ?? "search", title: r.title ?? null, domain, w, h, score: Math.round(score * 100) / 100 });
  });
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 6);
}

export type Pick = { index: number | null; confidence: number };
export type Ranked = { chosen: Candidate | null; candidates: Candidate[]; check: boolean };

/** The model's pick (index into `cands`, or none) → chosen first, the rest after; low confidence → "check". */
export function applyRanking(cands: Candidate[], pick: Pick | null): Ranked {
  if (!cands.length) return { chosen: null, candidates: [], check: false };
  const ok = pick && pick.index != null && pick.index >= 0 && pick.index < cands.length;
  const idx = ok ? pick!.index! : 0;
  const chosen = cands[idx];
  const candidates = [chosen, ...cands.filter((_, i) => i !== idx)].slice(0, 6);
  // An exact barcode photo needs no check; a generic picture or an icon always asks for a look.
  const sure = chosen.source === "barcode" || (ok && pick!.confidence >= 0.6 && chosen.source !== "generic" && chosen.source !== "icon");
  return { chosen, candidates, check: !sure };
}

/** Stored picture source for a candidate (items.image_source): barcode / search / generic / icon. */
export const storedSource = (c: Candidate): "barcode" | "search" | "generic" | "icon" => (c.source === "barcode" || c.source === "generic" || c.source === "icon" ? c.source : "search");

// ---------- Query cache (kv, 30 days) ----------

export const CACHE_DAYS = 30;
type Store = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };

/** `fn(q)` cached under `key` for 30 days; a failed or empty answer isn't cached (so it can be retried). */
export function makeCache(store: Store, now: () => number = Date.now) {
  return async function cached<T>(key: string, fn: () => Promise<T[]>): Promise<T[]> {
    const hit = await store.get(key).catch(() => null);
    if (hit) {
      try {
        const v = JSON.parse(hit) as { at: number; r: T[] };
        if (now() - v.at < CACHE_DAYS * 86400_000) return v.r;
      } catch {}
    }
    const r = await fn();
    if (r.length) await store.set(key, JSON.stringify({ at: now(), r })).catch(() => {});
    return r;
  };
}

export const cacheKey = (kind: string, q: string) => `pic:v1:${kind}:${q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160)}`;
