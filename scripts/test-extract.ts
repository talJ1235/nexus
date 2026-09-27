// Quick offline checks for the parsers: npx tsx scripts/test-extract.ts
import assert from "node:assert/strict";
import { parseHtml } from "../src/lib/extract";
import { parsePrice } from "../src/lib/money";
import { normalizeUrl, storeFromUrl } from "../src/lib/stores";
import { extractUrls } from "../src/lib/utils";
import { titleSimilarity } from "../src/lib/similarity";

const jsonld = `<html><head><title>X | KSP</title><meta property="og:site_name" content="KSP"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"NEMA 17 Stepper Motor 42-40","brand":{"@type":"Brand","name":"Usongshine"},"image":["/img/a.jpg"],"offers":{"@type":"AggregateOffer","lowPrice":"59.90","priceCurrency":"ILS","availability":"https://schema.org/InStock"}}]}</script></head><body>hi</body></html>`;
let r = parseHtml(jsonld, "https://ksp.co.il/web/item/123");
assert.equal(r.title, "NEMA 17 Stepper Motor 42-40");
assert.equal(r.price, 59.9);
assert.equal(r.currency, "ILS");
assert.equal(r.brand, "Usongshine");
assert.equal(r.image, "https://ksp.co.il/img/a.jpg");
assert.equal(r.availability, "InStock");
assert.equal(r.method, "jsonld");

const og = `<html><head><meta property="og:title" content="MALM Bed frame - IKEA"><meta property="og:image" content="https://x/y.jpg"><meta property="product:price:amount" content="1,299.00"><meta property="product:price:currency" content="ILS"></head><body></body></html>`;
r = parseHtml(og, "https://www.ikea.com/il/he/p/malm");
assert.equal(r.title, "MALM Bed frame - IKEA");
assert.equal(r.price, 1299);
assert.equal(r.method, "meta");

const micro = `<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Wera Screwdriver Set</h1><span itemprop="price" content="45.50"></span><meta itemprop="priceCurrency" content="USD"></div>`;
r = parseHtml(`<html><body>${micro}</body></html>`, "https://example.com/p");
assert.equal(r.title, "Wera Screwdriver Set");
assert.equal(r.price, 45.5);
assert.equal(r.currency, "USD");

assert.deepEqual(parsePrice("₪1,299.90"), { amount: 1299.9, currency: "ILS" });
assert.deepEqual(parsePrice("12,50 €"), { amount: 12.5, currency: "EUR" });
assert.deepEqual(parsePrice("US $3.21"), { amount: 3.21, currency: "USD" });
assert.equal(parsePrice("free"), null);

assert.equal(normalizeUrl("https://he.aliexpress.com/item/1005006.html?spm=a2g0o&algo_pvid=abc"), "https://aliexpress.com/item/1005006.html");
assert.equal(normalizeUrl("https://www.amazon.com/Some-Thing/dp/B08XYZ1234/ref=sr_1_1?keywords=x"), "https://amazon.com/dp/B08XYZ1234");
assert.equal(normalizeUrl("https://ksp.co.il/web/item/123?utm_source=g&gclid=1"), "https://ksp.co.il/web/item/123");
assert.equal(storeFromUrl("https://www.ivory.co.il/catalog.php?id=1").name, "Ivory");
assert.equal(storeFromUrl("https://s.click.aliexpress.com/e/_x").name, "AliExpress");
assert.equal(storeFromUrl("https://www.somemakershop.co.il/p/1").currency, "ILS");

assert.deepEqual(extractUrls("check https://a.com/x, and https://b.co.il/y)."), ["https://a.com/x", "https://b.co.il/y"]);
assert.ok(titleSimilarity("NEMA 17 stepper motor 42-40 1.5A", "Stepper motor NEMA 17 42-40") > 0.6);
assert.ok(titleSimilarity("USB-C cable 1m", "Wera screwdriver set") < 0.2);
console.log("all extraction tests passed");
