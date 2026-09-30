// Research probe: which fetch strategies return real product data for a store link?
// Runs from GitHub Actions (datacenter IPs, like Vercel). Optional: BASE + NEXUS_PASSWORD also ask prod
// (/api/debug/extract) so we see what Vercel itself gets. Prints one compact line per (url, strategy).
// Usage: node scripts/probe-extract.mjs [url ...]

const URLS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://www.aliexpress.com/item/1005003676945137.html",
      "https://he.aliexpress.com/item/1005003676945137.html?spm=a2g0o.productlist&pdp_npi=4%40dis%21ILS%2150.00%2135.00%21%21%21",
      "https://www.amazon.com/dp/B07BHHG5GZ",
      "https://ksp.co.il/web/item/254425",
    ];

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const UAS = {
  browser: CHROME,
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  twitter: "Twitterbot/1.0",
  telegram: "TelegramBot (like TwitterBot)",
  whatsapp: "WhatsApp/2.23.20.0",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
};
const BLOCK = /captcha|access denied|robot check|are you a human|verify you are human|pardon our interruption|cf-chl|just a moment|attention required|punish|slide to verify|x5sec|baxia/i;

function summarize(html) {
  const m = (re) => html.match(re)?.[1]?.slice(0, 70) ?? null;
  return {
    og: m(/property=["']og:title["'][^>]*content=["']([^"']+)/i) ?? m(/content=["']([^"']+)["'][^>]*property=["']og:title/i),
    img: Boolean(m(/property=["']og:image["'][^>]*content=["']([^"']+)/i) ?? m(/content=["']([^"']+)["'][^>]*property=["']og:image/i)),
    ld: html.includes("application/ld+json"),
    title: m(/<title[^>]*>([^<]*)/i),
    blocked: BLOCK.test(html.slice(0, 20000)),
  };
}

async function timed(fn) {
  const t = Date.now();
  try {
    return { ...(await fn()), ms: Date.now() - t };
  } catch (e) {
    return { err: String(e?.cause?.code ?? e?.message ?? e).slice(0, 60), ms: Date.now() - t };
  }
}

const DUMP = process.env.DUMP === "1";
async function direct(url, ua) {
  const res = await fetch(url, { headers: { "user-agent": ua, accept: "text/html,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
  const html = await res.text();
  if (DUMP && ua.startsWith("facebook")) {
    console.log("   META:", [...html.matchAll(/<meta[^>]+(?:og:|twitter:|description)[^>]*>/gi)].map((m) => m[0].slice(0, 220)).join("\n         "));
    for (const re of [/formatedActivityPrice[^,]{0,60}/, /formatedAmount[^,]{0,60}/, /"price"[^,]{0,60}/i, /currencyCode[^,]{0,30}/, /"subject"[^,]{0,120}/, /ld\+json/]) console.log("   PAT:", re.source, "→", html.match(re)?.[0] ?? null);
  }
  return { status: res.status, len: html.length, final: new URL(res.url).host + new URL(res.url).pathname.slice(0, 30), ...summarize(html) };
}

async function jina(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, { headers: { accept: "application/json", "x-return-format": "html" }, signal: AbortSignal.timeout(25000) });
  const j = await res.json().catch(() => ({}));
  const html = j?.data?.html ?? j?.data?.content ?? "";
  return { status: res.status, len: html.length, jtitle: j?.data?.title?.slice(0, 70) ?? null, ...summarize(html) };
}

async function microlink(url) {
  const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, mstatus: j.status, title: j?.data?.title?.slice(0, 70) ?? null, img: Boolean(j?.data?.image?.url), msg: j?.message?.slice(0, 60) };
}

let cookie = null;
async function prod(url) {
  const BASE = process.env.BASE;
  if (!BASE || !process.env.NEXUS_PASSWORD) return { skip: "no BASE" };
  if (!cookie) {
    const form = new FormData();
    form.set("password", process.env.NEXUS_PASSWORD);
    const r = await fetch(`${BASE}/api/login`, { method: "POST", body: form, redirect: "manual" });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  if (process.env.VARIANTS === "1" && /aliexpress/.test(url)) {
    const v = await fetch(`${BASE}/api/debug/extract?url=${encodeURIComponent(url)}&variants=1`, { headers: { cookie }, signal: AbortSignal.timeout(60000) }).then((r) => r.json());
    console.log("   region:", v.region);
    for (const x of v.variants ?? []) console.log("   VAR", JSON.stringify(x));
  }
  if (process.env.FULL === "1") {
    const f = await fetch(`${BASE}/api/debug/extract?url=${encodeURIComponent(url)}&full=1`, { headers: { cookie }, signal: AbortSignal.timeout(65000) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    const d = f.draft;
    console.log("   FULL", JSON.stringify(d ? { title: d.title, img: Boolean(d.imageUrl), price: d.source?.price, cur: d.source?.currency, method: d.source?.extractMethod, quality: d.quality, dup: Boolean(f.duplicate), took: f.took } : f));
  }
  const res = await fetch(`${BASE}/api/debug/extract?url=${encodeURIComponent(url)}&probe=1`, { headers: { cookie }, signal: AbortSignal.timeout(60000) });
  const j = await res.json().catch(() => ({ status: res.status }));
  return j.probe ? { strategies: j.probe } : { status: j.status, len: j.length, og: j.ogTitle?.slice(0, 60) ?? null, img: Boolean(j.ogImage), title: j.title?.slice(0, 60) ?? null };
}

if (process.argv[2] === "list") {
  await prod("https://example.com"); // logs in
  const j = await fetch(`${process.env.BASE}/api/debug/extract`, { headers: { cookie } }).then((r) => r.json());
  console.log("INCOMPLETE", JSON.stringify(j.incomplete ?? j));
  const ai = await fetch(`${process.env.BASE}/api/debug/ai`, { headers: { cookie } }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  console.log("AI", JSON.stringify(ai).slice(0, 1500));
  process.exit(0);
}

const line = (url, name, r) => console.log(`${new URL(url).host.padEnd(22)} ${name.padEnd(10)} ${JSON.stringify(r)}`);

for (const url of URLS) {
  console.log(`\n== ${url}`);
  for (const [name, ua] of Object.entries(UAS)) line(url, name, await timed(() => direct(url, ua)));
  line(url, "jina", await timed(() => jina(url)));
  line(url, "microlink", await timed(() => microlink(url)));
  const p = await timed(() => prod(url));
  if (p.strategies) for (const [k, v] of Object.entries(p.strategies)) line(url, `vercel:${k}`.slice(0, 18), v);
  else line(url, "vercel", p);
}
