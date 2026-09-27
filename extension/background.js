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
async function resolveUrl(url) {
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
    data.image = await imageToDataUrl(data.image);
    return data;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

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
    if (msg.type === "config") return { ok: true, ...(await getConfig()) };
    return { ok: false, error: "unknown" };
  })()
    .then(reply)
    .catch((e) => reply({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true;
});
