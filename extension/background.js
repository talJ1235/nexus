importScripts("extractor.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getConfig() {
  const { origin, token } = await chrome.storage.local.get(["origin", "token"]);
  return { origin, token };
}

async function extractInTab(tabId) {
  // SPA stores render late: retry until we have a title and a price (max ~9s).
  let last = {};
  for (let i = 0; i < 12; i++) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: nexusExtract });
      last = res && res.result ? res.result : last;
      if (last.title && last.price && last.image) return last;
    } catch (e) {}
    await sleep(750);
  }
  return last;
}

/** Fetch the product image from this browser (stores often block servers) and shrink it to a small WebP. */
async function imageToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return url;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
    const buf = new Uint8Array(await out.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:image/webp;base64,${btoa(bin)}`;
  } catch (e) {
    return url;
  }
}

/** Open a URL in a background tab, read the product, close the tab. */
async function resolveUrl(url, opts = { keepImage: true }) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve) => {
      const done = (id, info) => {
        if (id === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }, 20000);
    });
    const data = await extractInTab(tab.id);
    if (opts.keepImage) data.image = await imageToDataUrl(data.image);
    return data;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function api(path, init = {}) {
  const { origin, token } = await getConfig();
  if (!origin || !token) throw new Error("not_paired");
  const res = await fetch(`${origin}${path}`, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

const HAS_PRODUCT_DATA = /application\/ld\+json|product:price:amount|itemprop=["']price["']|og:price:amount/i;

/**
 * Price checks for links the Nexus server can't read (stores that block servers).
 * Scheduled runs only fetch pages quietly with the user's connection; a manual "Check now"
 * (thorough) may also open app-style store pages in a background tab.
 */
let checking = false;
async function checkPrices(thorough) {
  if (checking) return { skipped: true };
  checking = true;
  let done = 0;
  try {
    const { sources } = await api("/api/ext/stale");
    for (const src of sources) {
      try {
        const res = await fetch(src.url, { credentials: "include", redirect: "follow" });
        const html = res.ok ? await res.text() : "";
        if (html && HAS_PRODUCT_DATA.test(html) && html.length < 2_900_000) {
          await api("/api/ext/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: src.id, html, finalUrl: res.url }) });
          done++;
          continue;
        }
        if (thorough) {
          const data = await resolveUrl(src.url, { keepImage: false });
          if (data && data.price) {
            await api("/api/ext/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: src.id, payload: { price: data.price, currency: data.currency || null } }) });
            done++;
          }
        }
      } catch (e) {}
      await sleep(1200 + Math.random() * 1500); // be gentle with stores
    }
    if (done) await api("/api/ext/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) });
  } catch (e) {
  } finally {
    checking = false;
  }
  return { checked: done };
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("nexus-prices", { delayInMinutes: 3, periodInMinutes: 360 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("nexus-prices", { delayInMinutes: 3, periodInMinutes: 360 }));
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "nexus-prices") checkPrices(false);
});

async function send(path, body) {
  const { origin, token } = await getConfig();
  if (!origin || !token) throw new Error("not_paired");
  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `http_${res.status}`);
  return json;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "pair") {
      await chrome.storage.local.set({ origin: msg.origin, token: msg.token, pairedAt: Date.now() });
      return { ok: true };
    }
    if (msg.type === "resolve") return { ok: true, data: await resolveUrl(msg.url) };
    if (msg.type === "extract-tab") {
      const data = await extractInTab(msg.tabId);
      data.image = await imageToDataUrl(data.image);
      return { ok: true, data };
    }
    if (msg.type === "save") return { ok: true, ...(await send("/api/ext/save", msg.body)) };
    if (msg.type === "check-prices") return { ok: true, ...(await checkPrices(true)) };
    if (msg.type === "config") return { ok: true, ...(await getConfig()) };
    return { ok: false, error: "unknown" };
  })()
    .then(reply)
    .catch((e) => reply({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true;
});
