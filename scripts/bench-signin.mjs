// R16 G1/G3 — how fast "Continue with Google" reacts and starts the navigation to Google.
// For each run: a fresh browser context opens /login, clicks the button, and records
//   feedback  click → the button shows it's working (aria-busy) — the visual response
//   nav       click → the first request to accounts.google.com (or the local test IdP) — "Google starts loading"
//   server    the Server-Timing of POST /api/auth/sign-in/social (if any)
// The request to Google is answered with a stub page, so Google is never contacted and nobody signs in.
// Usage: BASE=https://nexus-ashen-beta.vercel.app RUNS=10 GAP_MS=7000 node scripts/bench-signin.mjs
//        (prod: keep RUNS × 60/GAP under the sign-in rate limit; each run leaves one expired-in-10-min state row)
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3100";
const RUNS = Number(process.env.RUNS || 10);
const GAP = Number(process.env.GAP_MS || 0);
const SEL = process.env.SEL || "[data-auth=google]";
const isIdp = (u) => u.hostname === "accounts.google.com" || u.pathname.startsWith("/api/test-idp/authorize");

const browser = await chromium.launch();
const rows = [];
for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext(process.env.MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  let navAt = 0;
  let timing = "";
  let cb = "";
  await page.route((u) => isIdp(u), (r) => {
    navAt ||= Date.now();
    // CALLBACK_EMAIL (local test IdP only): really sign in and record the callback's Server-Timing too.
    if (process.env.CALLBACK_EMAIL) return r.continue();
    return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stub</title>stub" });
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/auth/sign-in/social")) timing = r.headers()["server-timing"] ?? "";
    if (r.url().includes("/api/auth/callback/")) cb = r.headers()["server-timing"] ?? "";
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  // The visual response, measured in the page (frame-accurate).
  await page.evaluate((sel) => {
    const b = document.querySelector(sel);
    window.__fb = null;
    b?.addEventListener("pointerdown", () => {
      const t0 = performance.now();
      const mo = new MutationObserver(() => {
        if (b.getAttribute("aria-busy") === "true" && window.__fb == null) window.__fb = performance.now() - t0;
      });
      mo.observe(b, { attributes: true, childList: true, subtree: true });
    }, { once: true });
  }, SEL);
  const t0 = Date.now();
  await page.click(SEL);
  await page.waitForURL((u) => isIdp(u), { timeout: 20_000 }).catch(() => {});
  const fb = await page.evaluate(() => window.__fb).catch(() => null);
  if (process.env.CALLBACK_EMAIL) {
    await page.fill("#email", process.env.CALLBACK_EMAIL);
    const t1 = Date.now();
    await page.click("#go");
    await page.waitForSelector("[data-app-shell], [data-auth=invite-only], [data-auth=not-now]", { timeout: 60_000 }).catch(() => {});
    console.log(`  back → app shell ${Date.now() - t1}ms · callback ${cb}`);
  }
  rows.push({ run: i + 1, feedback: fb == null ? null : Math.round(fb), nav: navAt ? navAt - t0 : null, timing });
  console.log(`run ${i + 1}: feedback=${fb == null ? "-" : Math.round(fb) + "ms"} nav=${navAt ? navAt - t0 + "ms" : "none"} ${timing}`);
  await ctx.close();
  if (GAP && i < RUNS - 1) await new Promise((r) => setTimeout(r, GAP));
}
await browser.close();

const navs = rows.map((r) => r.nav).filter((x) => x != null).sort((a, b) => a - b);
const p = (q) => navs[Math.min(navs.length - 1, Math.ceil(q * navs.length) - 1)];
console.log(`nav: first=${rows[0].nav}ms median=${p(0.5)}ms p95=${p(0.95)}ms (n=${navs.length}/${RUNS})`);
