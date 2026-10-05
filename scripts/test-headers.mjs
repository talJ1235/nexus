// R15 B4: security headers on every page response, an enforced nonce CSP, and no CSP violations while the app is
// used (Playwright listens to `securitypolicyviolation`). Run against a local server in closed mode:
//   BASE=http://localhost:3100 NEXUS_PASSWORD=... node scripts/test-headers.mjs
import { chromium } from "playwright";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const PASSWORD = process.env.NEXUS_PASSWORD;
const REQUIRED = {
  "content-security-policy": (v) => /script-src[^;]*'nonce-[A-Za-z0-9+/=]{16,}'/.test(v) && /object-src 'none'/.test(v) && /frame-ancestors 'none'/.test(v) && /base-uri 'none'/.test(v) && !/script-src[^;]*'unsafe-inline'/.test(v),
  "strict-transport-security": (v) => /max-age=63072000/.test(v),
  "x-content-type-options": (v) => v === "nosniff",
  "referrer-policy": (v) => v === "strict-origin-when-cross-origin",
  "permissions-policy": (v) => /camera=\(self\)/.test(v),
  "cross-origin-opener-policy": (v) => v === "same-origin",
};
let fails = 0;
const ok = (c, m, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
const violations = [];
const nonces = new Set();
const check = async (path) => {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const h = res.headers();
  const bad = Object.entries(REQUIRED).filter(([k, test]) => !h[k] || !test(h[k])).map(([k]) => k);
  ok(!bad.length, `headers on ${path}`, bad.join(", "));
  nonces.add(h["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1]);
  await page.waitForTimeout(800);
  violations.push(...(await page.evaluate(() => window.__csp ?? [])).map((v) => `${path}: ${v}`));
};

await check("/login");
await check("/login?admin=1");
if (PASSWORD) {
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  for (const p of ["/", "/?v=to_buy", "/?v=history", "/?v=spending", "/add", "/offline"]) await check(p);
  // Open a few panels so their scripts run under the policy.
  await page.goto(`${BASE}/?v=to_buy`, { waitUntil: "networkidle" });
  await page.keyboard.press("Control+k").catch(() => {});
  await page.waitForTimeout(800);
  violations.push(...(await page.evaluate(() => window.__csp ?? [])).map((v) => `panels: ${v}`));
} else console.log("SKIP signed-in pages (NEXUS_PASSWORD not set)");
await check("/s/does-not-exist-000000");
ok(nonces.size >= 3 && !nonces.has(undefined), "a fresh nonce per response", [...nonces].join(","));
ok(violations.length === 0, "no CSP violations", violations.slice(0, 6).join(" | "));
await browser.close();
console.log(fails ? `FAIL headers: ${fails}` : "OK headers + CSP");
process.exit(fails ? 1 : 0);
