import "server-only";

// Optional web search providers (Round 7): Brave Search (preferred) or Serper (Google results). Every feature that uses
// them also works without a key, in a reduced way — callers check `searchProvider()` first.

export type WebResult = { title: string; url: string; snippet?: string | null };
export type ImageResult = { image: string; page: string | null; title: string | null; width?: number | null; height?: number | null; domain?: string | null };
export type ShoppingResult = { title: string; url: string; price: string | null; source: string | null; image: string | null };

export function searchProvider(): "brave" | "serper" | null {
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.SERPER_API_KEY) return "serper";
  return null;
}

async function brave<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const res = await fetch(`https://api.search.brave.com/res/v1/${path}?${new URLSearchParams(params)}`, {
    headers: { accept: "application/json", "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY! },
    signal: AbortSignal.timeout(8000),
  });
  return res.ok ? ((await res.json()) as T) : null;
}

async function serper<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`https://google.serper.dev/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.SERPER_API_KEY! },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok ? ((await res.json()) as T) : null;
}

export async function webSearch(q: string, count = 8): Promise<WebResult[]> {
  const p = searchProvider();
  try {
    if (p === "brave") {
      const r = await brave<{ web?: { results?: { title: string; url: string; description?: string }[] } }>("web/search", { q, count: String(count) });
      return (r?.web?.results ?? []).map((x) => ({ title: stripTags(x.title), url: x.url, snippet: x.description ? stripTags(x.description) : null }));
    }
    if (p === "serper") {
      const r = await serper<{ organic?: { title: string; link: string; snippet?: string }[] }>("search", { q, num: count });
      return (r?.organic ?? []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet ?? null }));
    }
  } catch {}
  return [];
}

/** `opts` (Serper): e.g. { gl: "il", hl: "iw" } to search Google Israel in Hebrew. */
export async function imageSearch(q: string, count = 6, opts: { gl?: string; hl?: string } = {}): Promise<ImageResult[]> {
  const p = searchProvider();
  try {
    if (p === "brave") {
      const r = await brave<{ results?: { title?: string; url?: string; source?: string; properties?: { url?: string; width?: number; height?: number }; thumbnail?: { src?: string } }[] }>("images/search", { q, count: String(count), safesearch: "strict" });
      return (r?.results ?? []).map((x) => ({ image: x.properties?.url ?? x.thumbnail?.src ?? "", page: x.url ?? null, title: x.title ?? null, width: x.properties?.width ?? null, height: x.properties?.height ?? null, domain: x.source ?? null })).filter((x) => x.image);
    }
    if (p === "serper") {
      const r = await serper<{ images?: { title?: string; imageUrl: string; link?: string; imageWidth?: number; imageHeight?: number; domain?: string }[] }>("images", { q, num: count, ...opts });
      return (r?.images ?? []).map((x) => ({ image: x.imageUrl, page: x.link ?? null, title: x.title ?? null, width: x.imageWidth ?? null, height: x.imageHeight ?? null, domain: x.domain ?? null }));
    }
  } catch {}
  return [];
}

/** Shopping results (Serper's Google Shopping); with Brave, web results stand in (no price). */
export async function shoppingSearch(q: string, count = 10): Promise<ShoppingResult[]> {
  const p = searchProvider();
  try {
    if (p === "serper") {
      const r = await serper<{ shopping?: { title: string; link: string; price?: string; source?: string; imageUrl?: string }[] }>("shopping", { q, num: count });
      return (r?.shopping ?? []).map((x) => ({ title: x.title, url: x.link, price: x.price ?? null, source: x.source ?? null, image: x.imageUrl ?? null }));
    }
    if (p === "brave") return (await webSearch(q, count)).map((x) => ({ title: x.title, url: x.url, price: null, source: null, image: null }));
  } catch {}
  return [];
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
