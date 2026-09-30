import { type NextRequest } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { previewUrl } from "@/app/actions";
import { extractWithUrlContext } from "@/lib/ai";
import { extractFromUrl } from "@/lib/extract";

export const maxDuration = 60;

// Owner-only diagnostics (behind the session proxy). Shows what the server actually receives from a store.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    const recent = await db.select({ url: schema.sources.url, method: schema.sources.extractMethod }).from(schema.sources).orderBy(desc(schema.sources.createdAt)).limit(10);
    return Response.json({ recent });
  }
  const started = Date.now();
  // ?probe=1 → each strategy separately, as seen from Vercel (used by scripts/probe-extract.mjs).
  if (req.nextUrl.searchParams.get("probe")) {
    const t = async <T,>(fn: () => Promise<T>) => {
      const s0 = Date.now();
      try {
        return { ...(await fn()), ms: Date.now() - s0 };
      } catch (e) {
        return { err: String(e).slice(0, 120), ms: Date.now() - s0 };
      }
    };
    const pick = (x: { title: string | null; image: string | null; price: number | null; currency: string | null; method: string; blocked: boolean; url: string }) => ({
      title: x.title?.slice(0, 60) ?? null, img: Boolean(x.image), price: x.price, cur: x.currency, method: x.method, blocked: x.blocked, url: x.url.slice(0, 70),
    });
    const [extract, gemini] = await Promise.all([
      t(async () => pick(await extractFromUrl(url))),
      t(async () => {
        const r = await extractWithUrlContext(url);
        return r ? { title: r.title?.slice(0, 60) ?? null, img: Boolean(r.imageUrl), price: r.price, cur: r.currency } : { none: true };
      }),
    ]);
    return Response.json({ probe: { extract, gemini } });
  }
  if (req.nextUrl.searchParams.get("full")) {
    try {
      return Response.json({ ms: 0, ...(await previewUrl(url)), took: Date.now() - started });
    } catch (e) {
      return Response.json({ error: String(e) });
    }
  }
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,he;q=0.8",
      },
    });
    const html = await res.text();
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
