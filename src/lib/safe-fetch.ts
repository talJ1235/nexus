import "server-only";
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

// R15 B4 — the one way the server fetches a URL a user (or a store page) chose. SECURITY.md §6:
// http/https on ports 80/443 only; every DNS answer is checked and the connection goes to the checked address (no
// rebinding window); private, loopback, link-local, CGNAT, multicast, reserved and metadata ranges are refused for
// IPv4 and IPv6 (incl. IPv4-mapped); redirects are followed by hand (max 5), each hop re-checked; 10 s timeout;
// 5 MB body cap; no cookies or credentials are added; an honest user agent unless the caller sets one.

export class BlockedUrlError extends Error {
  constructor(readonly reason: string) {
    super(`blocked_url:${reason}`);
  }
}

export type SafeResponse = { status: number; url: string; headers: Headers; body: Buffer; text: string; ok: boolean; truncated: boolean };
export type SafeFetchOptions = { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; signal?: AbortSignal; method?: "GET" | "HEAD" };

const V4_BLOCK: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
];

const v4num = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);

export function isBlockedV4(ip: string) {
  const n = v4num(ip);
  return V4_BLOCK.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (2 ** 32 - 2 ** (32 - bits));
    return (n & mask) >>> 0 === (v4num(base) & mask) >>> 0;
  });
}

/** Expand an IPv6 address to 8 groups of numbers. */
function v6groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // Embedded IPv4 tail (::ffff:1.2.3.4).
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4num(tail[1]);
    s = s.slice(0, -tail[1].length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = rest !== undefined ? (rest ? rest.split(":") : []) : [];
  if (rest === undefined && a.length !== 8) return null;
  const fill = rest === undefined ? [] : Array(8 - a.length - b.length).fill("0");
  const g = [...a, ...fill, ...b].map((x) => parseInt(x || "0", 16));
  return g.length === 8 && g.every((x) => Number.isFinite(x) && x >= 0 && x <= 0xffff) ? g : null;
}

export function isBlockedV6(ip: string) {
  const g = v6groups(ip);
  if (!g) return true;
  const allZeroTo = (k: number) => g.slice(0, k).every((x) => x === 0);
  if (allZeroTo(8)) return true; // ::
  if (allZeroTo(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped / -compatible / NAT64 (64:ff9b::/96) → check the IPv4 inside.
  const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (allZeroTo(5) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(v4);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedV4(v4);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return isBlockedV4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return true; // AWS metadata over IPv6 (fd00:ec2::254)
  return false;
}

// Tests only (scripts/test-ssrf.ts): let one local "public" test server through, to prove its redirect to a private
// address is refused. Never set by app code.
let testAllow: { addresses: Set<string>; ports: Set<string> } | null = null;
export function __setTestAllow(v: { addresses: string[]; ports: string[] } | null) {
  testAllow = v && { addresses: new Set(v.addresses), ports: new Set(v.ports) };
}

export function isBlockedIp(ip: string) {
  if (testAllow?.addresses.has(ip)) return false;
  const v = isIP(ip.replace(/^\[|\]$/g, ""));
  if (v === 4) return isBlockedV4(ip);
  if (v === 6) return isBlockedV6(ip);
  return true;
}

/** Throws BlockedUrlError unless this URL may be fetched (scheme, port, literal IPs; names are checked at connect). */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("invalid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("scheme");
  if (u.username || u.password) throw new BlockedUrlError("credentials");
  if (u.port && !((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) && !testAllow?.ports.has(u.port)) throw new BlockedUrlError("port");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (testAllow?.addresses.has(host)) return u;
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || host === "metadata.google.internal") throw new BlockedUrlError("host");
  if (isIP(host) && isBlockedIp(host)) throw new BlockedUrlError("address");
  return u;
}

/** DNS for the socket: every resolved address must be public; the socket then connects to one of those. */
export function makeSafeLookup(resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = (addresses as unknown as { address: string; family: number }[]) ?? [];
      if (!list.length || list.some((a) => isBlockedIp(a.address))) return callback(new BlockedUrlError("resolved_private"), "", 4);
      const wantAll = (options as { all?: boolean }).all;
      if (wantAll) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

let lookupImpl: LookupFunction = makeSafeLookup();
/** Tests only: a local resolver stub (e.g. a name that resolves to 127.0.0.1). */
export function __setResolverForTests(resolve: typeof dnsLookup | null) {
  lookupImpl = makeSafeLookup(resolve ?? dnsLookup);
}

const UA = "Mozilla/5.0 (compatible; NexusBot/1.0; +https://nexus-ashen-beta.vercel.app)";

function once(url: URL, opts: SafeFetchOptions, deadline: number): Promise<{ status: number; headers: Headers; body: Buffer; truncated: boolean }> {
  const max = opts.maxBytes ?? 5 * 1024 * 1024;
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: opts.method ?? "GET",
        lookup: lookupImpl,
        headers: { "user-agent": UA, accept: "*/*", "accept-encoding": "gzip, deflate, br", ...(opts.headers ?? {}) },
        timeout: Math.max(1, deadline - Date.now()),
        agent: false,
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        stream.on("data", (c: Buffer) => {
          if (truncated) return;
          size += c.length;
          if (size > max) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - max)));
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks), truncated });
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks), truncated }));
        stream.on("error", (e) => (truncated ? undefined : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    opts.signal?.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    req.end();
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  let url = checkUrl(raw);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const r = await once(url, opts, deadline);
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      url = checkUrl(new URL(loc, url).toString());
      continue;
    }
    return { status: r.status, url: url.toString(), headers: r.headers, body: r.body, text: r.body.toString("utf8"), ok: r.status >= 200 && r.status < 300, truncated: r.truncated };
  }
  throw new BlockedUrlError("redirects");
}
