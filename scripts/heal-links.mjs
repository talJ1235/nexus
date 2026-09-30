// Runs in GitHub Actions (.github/workflows/heal.yml). Reads store links that Vercel couldn't read, using
// link-preview identities (stores serve OpenGraph title/image to these so shared links unfurl), and posts
// the page to the owner-only /api/heal route, which parses it with the app's normal extractor.
// Env: BASE, NEXUS_PASSWORD, HEAL_SOURCES = JSON [{ id, url }].

const BASE = process.env.BASE;
const sources = JSON.parse(process.env.HEAL_SOURCES || "[]").filter((s) => s && typeof s.id === "string" && /^https?:\/\//.test(s.url ?? ""));
if (!BASE || !process.env.NEXUS_PASSWORD || !sources.length) {
  console.log("nothing to do");
  process.exit(0);
}

const UA = {
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  twitter: "Twitterbot/1.0",
  whatsapp: "WhatsApp/2.23.20.0",
};

function targets(url) {
  const id = url.match(/aliexpress\.[a-z.]+\/item\/(\d+)\.html/i)?.[1];
  if (id) {
    const us = id.startsWith("1005") ? String(BigInt(id) + 2n ** 51n) : null;
    return [
      [`https://www.aliexpress.com/item/${id}.html`, UA.facebook],
      [`https://m.aliexpress.com/item/${id}.html`, UA.facebook],
      ...(us ? [[`https://www.aliexpress.us/item/${us}.html`, UA.facebook]] : []),
      [`https://www.aliexpress.com/item/${id}.html`, UA.twitter],
      ...(us ? [[`https://www.aliexpress.us/item/${us}.html`, UA.whatsapp]] : []),
    ];
  }
  return [
    [url, UA.facebook],
    [url, UA.twitter],
    [url, UA.whatsapp],
  ];
}

async function read(url) {
  for (const [u, ua] of targets(url)) {
    try {
      const res = await fetch(u, { headers: { "user-agent": ua, accept: "text/html,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
      const html = await res.text();
      if (res.ok && /og:title/i.test(html) && !/_____tmd_____|x5secdata/.test(html.slice(0, 6000))) return { html: html.slice(0, 380_000), finalUrl: res.url };
    } catch {
      /* next identity */
    }
  }
  return null;
}

const form = new FormData();
form.set("password", process.env.NEXUS_PASSWORD);
const login = await fetch(`${BASE}/api/login`, { method: "POST", body: form, redirect: "manual" });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!cookie) {
  console.log("login failed", login.status);
  process.exit(1);
}

for (const s of sources.slice(0, 20)) {
  const page = await read(s.url);
  if (!page) {
    console.log(`MISS ${s.id} ${new URL(s.url).host}`);
    continue;
  }
  const res = await fetch(`${BASE}/api/heal`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sourceId: s.id, ...page }), signal: AbortSignal.timeout(65000) });
  console.log(`${res.ok ? "OK  " : "FAIL"} ${s.id} ${new URL(s.url).host} ${(await res.text()).slice(0, 200)}`);
}
