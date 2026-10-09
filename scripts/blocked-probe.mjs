// R17 C1 — which stores refuse us, and which rung of the fetch ladder reads them. For each product page below (the
// error log's blocked hosts + ~30 Israeli and global stores) it calls /api/debug/blocked (admin) on BASE and prints a
// markdown table: per rung blocked / title / price / image / ms.
//   BASE=https://nexus-ashen-beta.vercel.app SMOKE_ADMIN_TOKEN=… SMOKE_ADMIN_EMAIL=… node scripts/blocked-probe.mjs
//   (localhost: after scripts/serve-smoke.sh — but then the requests leave from this machine, not Vercel)
// The URLs are ordinary public product pages; replace any that 404 over time.
import { chromium } from "playwright";
import { signIn } from "./lib/sign-in.mjs";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const URLS = [
  "https://www.cwc.co.il/product/%d7%9e%d7%9b%d7%a9%d7%99%d7%a8-%d7%9c%d7%a0%d7%99%d7%a7%d7%95%d7%99-%d7%9b%d7%aa%d7%9e%d7%99%d7%9d-%d7%9e%d7%a1%d7%a4%d7%95%d7%aa-%d7%a2%d7%9d-%d7%a7%d7%99%d7%98%d7%95%d7%a8-y100-steam-%d7%99%d7%95/",
  "https://ksp.co.il/web/item/292537",
  "https://www.ivory.co.il/catalog.php?id=116647",
  "https://www.bug.co.il/brand/jbl/bluetooth/speakers/flip/7/special/edition/tomorrowland",
  "https://www.zap.co.il/model.aspx?modelid=1234567",
  "https://www.shufersal.co.il/online/he/p/P_3029815",
  "https://www.rami-levy.co.il/he/online/market/%D7%97%D7%9C%D7%91",
  "https://www.ikea.com/il/he/p/kallax-shelving-unit-white-80275887/",
  "https://www.amazon.com/dp/B0BSHF7WHW",
  "https://www.aliexpress.com/item/1005006233025389.html",
  "https://www.temu.com/il-en/goods.html?goods_id=601099512345678",
  "https://www.ebay.com/itm/394505734872",
  "https://il.shein.com/product-p-12345678.html",
  "https://www.office-depot.co.il/",
  "https://www.mashbir.co.il/",
  "https://www.ace.co.il/",
  "https://www.homecenter.co.il/",
  "https://www.max-stock.co.il/",
  "https://www.terminalx.com/",
  "https://www.next.co.il/he",
  "https://www.lastprice.co.il/",
  "https://www.payngo.co.il/",
  "https://www.machsanei-hashmal.co.il/",
  "https://www.electricshop.co.il/",
  "https://www.tms.co.il/",
  "https://www.kravitz.co.il/",
  "https://www.super-pharm.co.il/",
  "https://www.walmart.com/ip/123456789",
  "https://www.bestbuy.com/site/apple-airpods-pro-2nd-generation/6447382.p",
  "https://www.raspberrypi.com/products/raspberry-pi-5/",
];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await signIn(page, BASE);
const cell = (r) => (r.skipped ? "—" : `${r.blocked ? "✗" : "✓"} ${r.title ? "T" : "·"}${r.price ? "P" : "·"}${r.image ? "I" : "·"} ${r.ms}ms`);
console.log("| store | direct | woo | shopify | worker | ladder |\n|---|---|---|---|---|---|");
let ok = 0;
for (const url of URLS) {
  const r = await page.request.get(`${BASE}/api/debug/blocked?url=${encodeURIComponent(url)}`, { timeout: 90_000 }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (r.error) {
    console.log(`| ${host} | error: ${r.error} |`);
    continue;
  }
  const by = Object.fromEntries(r.steps.map((s) => [s.step, s]));
  const win = r.ladder && !r.ladder.blocked && r.ladder.title && (r.ladder.price != null || r.ladder.image);
  if (win) ok++;
  console.log(`| ${host} | ${cell(by.direct)} | ${cell(by.woo)} | ${cell(by.shopify)} | ${cell(by.worker)} | ${win ? `✓ ${r.ladder.via}` : "✗"} |`);
}
console.log(`\n${ok}/${URLS.length} read (title + price or picture)`);
await browser.close();
