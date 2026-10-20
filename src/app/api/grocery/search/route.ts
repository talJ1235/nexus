import { routeCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { householdProducts } from "@/lib/db-scoped/grocery";
import { offSearch } from "@/lib/grocery/classify-server";
import { matchRange, rankUsualBrand, typeAhead, type Hit } from "@/lib/grocery/search";
import { usualBrands } from "@/lib/db-scoped/brands";
import { brandOf, gtinKey } from "@/lib/grocery/classify";
import { after } from "next/server";
import * as P from "@/lib/db-scoped/prices";

// R18 C3 — type-ahead for the supermarket Add field: GET ?q=<typed>&locale=he|en → { hits, didYouMean }. This
// household's products first (times bought × recency), then the dictionary, then Open Food Facts Israel (only when
// fewer than 5 hits and 3+ letters; cached). Each hit marks the typed letters' range in its own title (S2 bolds them).
export async function GET(req: Request) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 80).trim();
  const locale = url.searchParams.get("locale") === "he" ? "he" : "en";
  if (!q) return Response.json({ hits: [], didYouMean: [] });
  const s = scoped(ctx);
  const [household, usual] = await Promise.all([householdProducts(s), usualBrands(s).catch(() => new Map())]);
  const r = typeAhead(q, household, { locale, limit: 8 });
  // R19 D5: the catalog (every product in the chains' files) after the home's own — photo, brand + size, price at the
  // home's store; the home's products and usual brands lead its ranking. Open Food Facts only when the catalog is empty.
  const cat = q.length >= 2 ? await P.catalogSearch(q, await P.priceStoreOf(s), { limit: 6, mine: await P.homeGtins(s) }).catch(() => []) : [];
  if (cat.length) {
    const seen = new Set(r.hits.map((h) => h.title.toLowerCase()));
    const add: Hit[] = [];
    for (const c of cat) {
      const title = c.short ?? c.name;
      if (seen.has(title.toLowerCase())) continue;
      add.push({ source: "catalog", productKey: /^\d{8,14}$/.test(c.gtin) ? gtinKey(c.gtin) : `cat:${c.gtin}`, title, section: (c.section ?? "other") as Hit["section"], art: null, match: matchRange(title, q), catalog: { gtin: c.gtin, imageUrl: c.imageUrl, brand: c.brand, qty: c.qty, unit: c.unit, weighted: c.weighted, price: c.price, deals: c.deals } });
    }
    r.hits = [...r.hits.slice(0, 3), ...add, ...r.hits.slice(3)].slice(0, 9);
    if (r.hits.length) r.didYouMean = [];
    after(() => P.fillCatalogPictures(cat.filter((c) => !c.imageUrl).map((c) => c.gtin), { budgetMs: 12_000 }).catch(() => {}));
  }
  if (!cat.length && r.hits.length < 5 && q.length >= 3) {
    const off = await offSearch(q).catch(() => []);
    const seen = new Set(r.hits.map((h) => h.title.toLowerCase()));
    for (const o of off) {
      if (r.hits.length >= 8 || seen.has(o.title.toLowerCase())) continue;
      const hit: Hit = { source: "off", productKey: o.productKey, title: o.title, section: o.section as Hit["section"], art: null, match: matchRange(o.title, q) };
      if (hit.match) r.hits.push(hit);
    }
    if (r.hits.length) r.didYouMean = [];
  }
  // S4 F3: the home's usual brand variant first.
  r.hits = rankUsualBrand(r.hits, Object.fromEntries([...usual].map(([k, u]) => [k, u.brand])), brandOf);
  return Response.json(r, { headers: { "cache-control": "private, no-store" } });
}
