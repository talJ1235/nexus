// R17 C2 — the blocked-store ladder without the network: the platform API parsers (WooCommerce Store API, Shopify
// product.js) on saved answers, their URL builders, the cwc.co.il product page (saved head) read by the same HTML
// parser the Worker's answers go through, and the Worker's private-address guard.   npm run test:blocked
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseShopify, parseWoo, shopifyApiUrl, wooApiUrl } from "../src/lib/store-apis";
import { privateHost } from "./cf-worker/fetch-worker.js";

const CWC = "https://www.cwc.co.il/product/%d7%9e%d7%9b%d7%a9%d7%99%d7%a8-%d7%9c%d7%a0%d7%99%d7%a7%d7%95%d7%99-%d7%9b%d7%aa%d7%9e%d7%99%d7%9d-%d7%9e%d7%a1%d7%a4%d7%95%d7%aa-%d7%a2%d7%9d-%d7%a7%d7%99%d7%98%d7%95%d7%a8-y100-steam-%d7%99%d7%95/";

async function main() {
  // URL builders.
  assert.equal(wooApiUrl(CWC), `https://www.cwc.co.il/wp-json/wc/store/v1/products?slug=${encodeURIComponent("מכשיר-לניקוי-כתמים-מספות-עם-קיטור-y100-steam-יו")}`);
  assert.equal(wooApiUrl("https://shop.example/category/x"), null);
  assert.equal(shopifyApiUrl("https://store.example/products/bamboo-cutting-board?variant=1"), "https://store.example/products/bamboo-cutting-board.js");
  assert.equal(shopifyApiUrl("https://store.example/collections/kitchen/products/bamboo-cutting-board"), "https://store.example/products/bamboo-cutting-board.js");
  assert.equal(shopifyApiUrl("https://store.example/pages/about"), null);

  // WooCommerce: minor units → ₪999 (the sale price), ILS, picture, brand.
  const woo = parseWoo(readFileSync("scripts/fixtures/blocked/woo-store-api.json", "utf8"));
  assert.ok(woo);
  assert.equal(woo!.price, 999);
  assert.equal(woo!.currency, "ILS");
  assert.match(woo!.title!, /Y100/);
  assert.equal(woo!.brand, "UWANT");
  assert.match(woo!.image!, /Y100-2\.jpg$/);
  assert.equal(parseWoo("[]"), null);
  assert.equal(parseWoo("<html>Just a moment...</html>"), null, "a Cloudflare challenge page is not a product");

  // Shopify: cents → 49.90, entities decoded, protocol-relative picture made absolute.
  const sh = parseShopify(readFileSync("scripts/fixtures/blocked/shopify-product.js.json", "utf8"));
  assert.deepEqual(sh, { title: "Bamboo Cutting Board & Knife Set", price: 49.9, currency: null, image: "https://cdn.shopify.com/s/files/1/0001/products/board.jpg?v=1", brand: "KitchenCo" });
  assert.equal(parseShopify("{}"), null);

  // The cwc page (what our fetch and the Worker get back): title + ₪999 + picture from its meta tags.
  const { fromHtml } = await import("../src/lib/extract");
  const ex = fromHtml(readFileSync("scripts/fixtures/blocked/cwc-product.html", "utf8"), CWC, 200);
  assert.equal(ex.blocked, false);
  assert.match(ex.title ?? "", /Y100/);
  assert.equal(ex.price, 999);
  assert.equal(ex.currency, "ILS");
  assert.match(ex.image ?? "", /Y100-2\.jpg/);
  // The same page behind a challenge (status 403) is blocked.
  assert.equal(fromHtml("<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>", CWC, 403).blocked, true);

  // The Worker refuses private / loopback / link-local hosts.
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254", "[::1]", "fd00::1", "metadata.internal"]) assert.equal(privateHost(h), true, h);
  for (const h of ["www.cwc.co.il", "8.8.8.8", "shop.example"]) assert.equal(privateHost(h), false, h);
  console.log("OK blocked stores (Woo/Shopify parsers, URL builders, cwc page, worker guard)");
}
main().then(() => process.exit(0), (e) => (console.error(e), process.exit(1)));
