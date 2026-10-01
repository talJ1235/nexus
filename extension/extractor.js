// Runs inside the product page. Must be self-contained (injected via chrome.scripting).
// Returns { url, title, price, currency, image, brand, siteName, description } — any field may be missing.
function nexusExtract() {
  const q = (s) => document.querySelector(s);
  const meta = (n) => {
    const e = q(`meta[property="${n}"],meta[name="${n}"],meta[itemprop="${n}"]`);
    return e ? e.getAttribute("content") : null;
  };
  const S = (v) => (v == null ? null : typeof v === "object" ? v.name || v.url || v["@value"] || null : String(v));
  const out = {};

  // 1) JSON-LD Product
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(walk);
        const t = [].concat(o["@type"] || []).join(" ").toLowerCase();
        if (/product/.test(t) && !out.title) {
          out.title = S(o.name);
          const offers = [].concat(o.offers || []);
          const f = offers[0] || {};
          const inner = [].concat(f.offers || [])[0] || {};
          out.price = f.price || f.lowPrice || (f.priceSpecification || {}).price || inner.price;
          out.currency = f.priceCurrency || (f.priceSpecification || {}).priceCurrency || inner.priceCurrency;
          out.image = S([].concat(o.image || [])[0]);
          out.brand = S(o.brand);
          for (const k of ["gtin13", "gtin12", "gtin8", "gtin14", "gtin"]) {
            const d = String(o[k] || f[k] || "").replace(/\D/g, "");
            if (!out.gtin && d.length >= 8 && d.length <= 14) out.gtin = d;
          }
          out.description = S(o.description);
        }
        [].concat(o["@graph"] || []).forEach(walk);
      };
      walk(JSON.parse(s.textContent));
    } catch (e) {}
  }

  // 2) OpenGraph / microdata
  const ip = q('[itemprop="price"]');
  out.title = out.title || meta("og:title") || meta("twitter:title");
  out.image = out.image || meta("og:image") || meta("og:image:secure_url") || meta("twitter:image");
  out.price = out.price || meta("product:price:amount") || meta("og:price:amount") || (ip && (ip.getAttribute("content") || ip.textContent));
  out.currency = out.currency || meta("product:price:currency") || meta("og:price:currency") || (q('[itemprop="priceCurrency"]') || {}).content;
  out.siteName = meta("og:site_name");
  out.description = out.description || meta("og:description") || meta("description");

  // 3) Store-specific price selectors
  if (!out.price) {
    const sel = [
      '[class*="price-default--current"]', '[class*="product-price-current"]', '[class*="price--currentPriceText"]', '[class*="uniform-banner-box-price"]',
      "#corePrice_feature_div .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-offscreen", ".a-price .a-offscreen", "#priceblock_ourprice", "#priceblock_dealprice",
      ".x-price-primary", '[data-testid="x-price-primary"]',
      '[data-testid*="price"]', '[class*="ProductPrice"]', ".price ins .amount", ".summary .price .amount", ".product-price", '[class*="finalPrice"]',
    ];
    for (const s of sel) {
      const el = q(s);
      const txt = el && el.textContent.trim();
      if (txt && /\d/.test(txt)) { out.price = txt; break; }
    }
  }

  // 4) Generic price heuristic: the biggest currency-looking number near the top of the page.
  if (!out.price) {
    let best = null;
    const re = /(₪|\$|€|£|ILS|USD|EUR|ש"ח)\s*\d[\d,.]*|\d[\d,.]*\s*(₪|\$|€|£|ש"ח)/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let n = 0;
    while (walker.nextNode() && n < 6000) {
      n++;
      const el = walker.currentNode;
      if (el.children.length > 3) continue;
      const txt = (el.textContent || "").trim();
      if (txt.length > 24 || !re.test(txt)) continue;
      if (/^(DEL|S|STRIKE)$/.test(el.tagName) || getComputedStyle(el).textDecorationLine.includes("line-through")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.top > window.innerHeight * 1.6) continue;
      const size = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (!best || size > best.size) best = { size, txt };
    }
    if (best) out.price = best.txt;
  }

  // 5) Title / image fallbacks
  if (!out.title) {
    const h1 = q("h1");
    out.title = (h1 && h1.textContent.trim()) || document.title;
  }
  if (!out.image) {
    let best = null;
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (r.top > window.innerHeight * 1.5 || img.naturalWidth < 200) continue;
      const area = r.width * r.height;
      if (!best || area > best.area) best = { area, src: img.currentSrc || img.src };
    }
    if (best) out.image = best.src;
  }
  if (out.image) {
    try { out.image = new URL(out.image, location.href).href; } catch (e) {}
  }
  if (!out.currency) {
    const t = String(out.price || "");
    out.currency = /₪|ש"ח|ILS/.test(t) ? "ILS" : /€/.test(t) ? "EUR" : /£/.test(t) ? "GBP" : /\$/.test(t) ? "USD" : location.hostname.endsWith(".il") ? "ILS" : null;
  }
  out.url = location.href;
  for (const k in out) {
    if (out[k] == null || out[k] === "") delete out[k];
    else out[k] = String(out[k]).trim().slice(0, k === "description" ? 600 : 1500);
  }
  return out;
}
