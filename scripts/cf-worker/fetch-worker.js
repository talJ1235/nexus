// Nexus fetch worker (R17 C2) — paste into a Cloudflare Worker named `nexus-fetch` (see README.md next to this file).
// Fetches one product page from Cloudflare's network for Nexus, whose own server addresses some stores refuse.
//   GET /?url=<encoded https URL>   with header  x-fetch-secret: <FETCH_SECRET>
// Answers the page's HTML (≤ 2.5 MB) with x-status (the store's status) and x-final-url. Refuses: a wrong/missing
// secret (401), anything but http(s) (400), hosts that are IP literals in private/loopback/link-local ranges or
// localhost (403), more than 5 redirects. No cookies in or out; 9 s per fetch.

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 9000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export function privateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::";
  return false;
}

function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return new Response("method", { status: 405 });
    if (!env.FETCH_SECRET || !equal(request.headers.get("x-fetch-secret") ?? "", env.FETCH_SECRET)) return new Response("unauthorized", { status: 401 });
    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get("url") ?? "");
    } catch {
      return new Response("bad url", { status: 400 });
    }
    for (let hop = 0; hop <= 5; hop++) {
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) return new Response("bad url", { status: 400 });
      if (privateHost(target.hostname)) return new Response("forbidden", { status: 403 });
      const res = await fetch(target.toString(), {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        target = new URL(loc, target);
        continue;
      }
      // Read at most MAX_BYTES.
      const reader = res.body?.getReader();
      const chunks = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      const body = new Blob(chunks);
      return new Response(body, {
        status: 200,
        headers: { "content-type": res.headers.get("content-type") ?? "text/html; charset=utf-8", "x-status": String(res.status), "x-final-url": target.toString(), "cache-control": "no-store" },
      });
    }
    return new Response("too many redirects", { status: 508 });
  },
};
