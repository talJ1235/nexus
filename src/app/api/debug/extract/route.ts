import { type NextRequest } from "next/server";
import { desc } from "drizzle-orm";
import { schema } from "@/db";
import { previewUrl } from "@/app/actions";
import { isAdmin, routeCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { safeFetch } from "@/lib/safe-fetch";
import { sourcesNeedingDetails } from "@/lib/service";

export const maxDuration = 60;

// Admin-only diagnostics (current space). Shows what the server actually receives from a store (through safeFetch).
export async function GET(req: NextRequest) {
  const ctx = await routeCtx("edit");
  if (ctx instanceof Response) return ctx;
  if (!isAdmin(ctx)) return Response.json({ error: "not_found" }, { status: 404 });
  const s = scoped(ctx);
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    const recent = await s.pick({ url: schema.sources.url, method: schema.sources.extractMethod }, schema.sources).orderBy(desc(schema.sources.createdAt)).limit(10);
    // Links still waiting for their name/price/picture (what the self-heal passes work on).
    const incomplete = (await sourcesNeedingDetails(s, 20, 0)).map((s) => ({ id: s.id, url: s.url, method: s.extractMethod, title: s.rawTitle, price: s.price }));
    return Response.json({ recent, incomplete });
  }
  const started = Date.now();
  if (req.nextUrl.searchParams.get("full")) {
    try {
      return Response.json({ ms: 0, ...(await previewUrl(url)), took: Date.now() - started });
    } catch (e) {
      return Response.json({ error: String(e) });
    }
  }
  try {
    const res = await safeFetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,he;q=0.8",
      },
    });
    const html = res.text;
    return Response.json({
      status: res.status,
      finalUrl: res.url,
      ms: Date.now() - started,
      length: html.length,
      hasJsonLd: html.includes("application/ld+json"),
      ogTitle: html.match(/og:title["'][^>]*content=["']([^"']+)/i)?.[1] ?? null,
      ogImage: html.match(/og:image["'][^>]*content=["']([^"']+)/i)?.[1] ?? null,
      title: html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? null,
      head: html.slice(0, 1500),
    });
  } catch (e) {
    return Response.json({ error: String(e), ms: Date.now() - started });
  }
}
