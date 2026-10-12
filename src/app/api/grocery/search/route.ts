import { routeCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { householdProducts } from "@/lib/db-scoped/grocery";
import { offSearch } from "@/lib/grocery/classify-server";
import { matchRange, typeAhead, type Hit } from "@/lib/grocery/search";

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
  const household = await householdProducts(scoped(ctx));
  const r = typeAhead(q, household, { locale, limit: 8 });
  if (r.hits.length < 5 && q.length >= 3) {
    const off = await offSearch(q).catch(() => []);
    const seen = new Set(r.hits.map((h) => h.title.toLowerCase()));
    for (const o of off) {
      if (r.hits.length >= 8 || seen.has(o.title.toLowerCase())) continue;
      const hit: Hit = { source: "off", productKey: o.productKey, title: o.title, section: o.section as Hit["section"], art: null, match: matchRange(o.title, q) };
      if (hit.match) r.hits.push(hit);
    }
    if (r.hits.length) r.didYouMean = [];
  }
  return Response.json(r, { headers: { "cache-control": "private, no-store" } });
}
