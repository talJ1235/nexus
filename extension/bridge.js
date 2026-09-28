// Runs on Nexus pages only (inert elsewhere). Pairs the extension and lets the web app
// ask the extension to read a product page in this browser.
(function () {
  const tokenMeta = document.querySelector('meta[name="nexus-ext-token"]');
  if (!document.querySelector('meta[name="nexus-app"]')) return;
  if (tokenMeta) chrome.runtime.sendMessage({ type: "pair", origin: location.origin, token: tokenMeta.content });

  const announce = () => window.postMessage({ source: "nexus-ext", type: "hello", version: chrome.runtime.getManifest().version }, location.origin);
  announce();
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.source !== "nexus-app") return;
    const { id, type, url } = e.data;
    if (type === "ping") return announce();
    if (type === "check-prices") return chrome.runtime.sendMessage({ type: "check-prices" });
    if (type === "resolve") {
      chrome.runtime.sendMessage({ type: "resolve", url }, (res) => {
        window.postMessage({ source: "nexus-ext", type: "resolved", id, ok: !!(res && res.ok), data: res && res.data, error: res && res.error }, location.origin);
      });
    }
  });
})();
