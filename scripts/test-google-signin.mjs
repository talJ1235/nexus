// R16 G4 — "Continue with Google" is instant and never a dead button. Runs against a server started with a (dummy)
// GOOGLE_CLIENT_ID; the request to accounts.google.com is answered with a stub page, so Google is never contacted.
//   feedback   tap → spinner + "Opening Google…" (aria-busy) within 100 ms
//   nav        tap → the navigation to Google starts within budget (NAV_BUDGET_MS, default 700 warm)
//   500 / 429 / timeout / offline → an error with a working Try again, the button enabled, an `auth` error report
//   Back from the provider → the button is enabled
//   30 mixed tries → 0 dead buttons
// Usage: BASE=http://localhost:3100 node scripts/test-google-signin.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3100";
const NAV_BUDGET = Number(process.env.NAV_BUDGET_MS || 700);
const BTN = "[data-auth=google]";
const SOCIAL = "**/api/auth/sign-in/social";
const isGoogle = (u) => u.hostname === "accounts.google.com";
let fails = 0;
const ok = (c, m, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch();
async function open() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const reports = [];
  await page.route((u) => isGoogle(u), (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Google stub</title><p id=stub>stub</p>" }));
  await page.route("**/api/errors", async (r) => {
    reports.push(r.request().postData() ?? "");
    await r.fulfill({ status: 200, contentType: "application/json", body: '{"stored":1,"rejected":0}' });
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  return { ctx, page, reports };
}
/** The button is usable: enabled, not busy, showing its normal label. */
const usable = (page) => page.evaluate((sel) => {
  const b = document.querySelector(sel);
  return !!b && !b.disabled && b.getAttribute("aria-busy") !== "true";
}, BTN);
const errorShown = (page) => page.locator("[data-auth=error]").isVisible().catch(() => false);
const onGoogle = (page) => page.waitForURL((u) => isGoogle(u), { timeout: 8000 }).then(() => true, () => false);

try {
  // ---- feedback + navigation (first = cold-ish for this server, then warm)
  {
    const times = [];
    for (let i = 0; i < 4; i++) {
      const { ctx, page } = await open();
      await page.evaluate((sel) => {
        const b = document.querySelector(sel);
        window.__fb = null;
        b.addEventListener("pointerdown", () => {
          const t0 = performance.now();
          new MutationObserver(() => {
            if (window.__fb == null && b.getAttribute("aria-busy") === "true") {
              window.__fb = performance.now() - t0;
              sessionStorage.setItem("g-label", b.textContent ?? ""); sessionStorage.setItem("g-fb", String(window.__fb));
            }
          }).observe(b, { attributes: true });
        }, { once: true });
      }, BTN);
      let navAt = 0;
      page.on("request", (r) => isGoogle(new URL(r.url())) && (navAt ||= Date.now()));
      const t0 = Date.now();
      await page.click(BTN);
      const went = await onGoogle(page);
      await page.goBack({ waitUntil: "load" }).catch(() => {});
      const { fb, label } = await page.evaluate(() => ({ fb: sessionStorage.getItem("g-fb") == null ? null : Number(sessionStorage.getItem("g-fb")), label: sessionStorage.getItem("g-label") })).catch(() => ({}));
      times.push({ fb, nav: navAt ? navAt - t0 : null, went, label });
      await ctx.close();
    }
    const warm = times.slice(1);
    ok(times.every((t) => t.fb != null && t.fb < 100), "tap → spinner + busy within 100 ms", JSON.stringify(times.map((t) => t.fb)));
    ok(/Opening Google|פותח את Google/.test(times[0].label ?? ""), "the button says it's opening Google", times[0].label);
    ok(times.every((t) => t.went), "every tap reaches Google");
    ok(warm.every((t) => t.nav != null && t.nav < NAV_BUDGET), `warm: navigation to Google starts < ${NAV_BUDGET} ms`, JSON.stringify(times.map((t) => t.nav)));
  }

  // ---- forced 500 → error + Try again that works + an `auth` report without an email
  {
    const { ctx, page, reports } = await open();
    await page.route(SOCIAL, (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }));
    await page.click(BTN);
    await page.waitForSelector("[data-auth=error]", { timeout: 5000 }).catch(() => {});
    ok((await errorShown(page)) && (await usable(page)), "500 → error shown, button enabled");
    await page.waitForTimeout(300);
    const rep = reports.join("\n");
    ok(/"kind":"auth"/.test(rep) && /google_status/.test(rep) && !/@/.test(rep), "500 → `auth` error report (status only, no email)", rep.slice(0, 200));
    await page.unroute(SOCIAL);
    await page.click("[data-auth=retry]");
    ok(await onGoogle(page), "500 → Try again opens Google");
    await ctx.close();
  }

  // ---- 429 → the limit text, button enabled
  {
    const { ctx, page } = await open();
    await page.route(SOCIAL, (r) => r.fulfill({ status: 429, headers: { "x-retryafter": "30" }, contentType: "application/json", body: '{"message":"Too many requests"}' }));
    await page.click(BTN);
    await page.waitForSelector("[data-auth=error]", { timeout: 5000 }).catch(() => {});
    const text = (await page.textContent("[data-auth=error]").catch(() => "")) ?? "";
    ok(/Too many tries|יותר מדי/.test(text) && (await usable(page)), "429 → 'too many tries', button enabled", text);
    await ctx.close();
  }

  // ---- timeout: no answer → after 6 s "Taking longer than usual" + Try again works
  {
    const { ctx, page } = await open();
    let hold = true;
    await page.route(SOCIAL, async (r) => {
      if (hold) await new Promise((res) => setTimeout(res, 9000));
      await r.continue().catch(() => {});
    });
    const t0 = Date.now();
    await page.click(BTN);
    await page.waitForSelector("[data-auth=error]", { timeout: 9000 }).catch(() => {});
    const dt = Date.now() - t0;
    const text = (await page.textContent("[data-auth=error]").catch(() => "")) ?? "";
    ok(/longer than usual|יותר זמן/.test(text) && dt > 5500 && dt < 7500 && (await usable(page)), "no answer → 'taking longer than usual' at ~6 s, button enabled", `${dt} ms · ${text}`);
    hold = false;
    await page.click("[data-auth=retry]");
    ok(await onGoogle(page), "timeout → Try again opens Google");
    await ctx.close();
  }

  // ---- Back from the provider → the button works
  {
    const { ctx, page } = await open();
    await page.click(BTN);
    await onGoogle(page);
    await page.goBack({ waitUntil: "load" });
    await page.waitForTimeout(300);
    ok(await usable(page), "Back from Google → button enabled");
    await page.click(BTN);
    ok(await onGoogle(page), "Back from Google → the button opens Google again");
    await ctx.close();
  }

  // ---- offline → says so, button enabled
  {
    const { ctx, page } = await open();
    await ctx.setOffline(true);
    await page.click(BTN);
    await page.waitForSelector("[data-auth=error]", { timeout: 5000 }).catch(() => {});
    const text = (await page.textContent("[data-auth=error]").catch(() => "")) ?? "";
    ok(/offline|אין חיבור/.test(text) && (await usable(page)), "offline → 'you're offline', button enabled", text);
    await ctx.setOffline(false);
    await page.click("[data-auth=retry]");
    ok(await onGoogle(page), "offline → back online → Try again opens Google");
    await ctx.close();
  }

  // ---- 30 mixed tries: ok + Back, 500, 429, network failure, offline → never a dead button
  {
    const { ctx, page } = await open();
    let dead = 0;
    const log = [];
    for (let i = 0; i < 30; i++) {
      const kind = ["ok", "500", "429", "abort", "offline"][i % 5];
      if (kind === "500" || kind === "429") await page.route(SOCIAL, (r) => r.fulfill({ status: Number(kind), contentType: "application/json", body: "{}" }));
      if (kind === "abort") await page.route(SOCIAL, (r) => r.abort("connectionreset"));
      if (kind === "offline") await ctx.setOffline(true);
      await page.click(BTN, { timeout: 3000 }).catch(() => {});
      if (kind === "ok") {
        if (!(await onGoogle(page))) dead++, log.push(`${i}:ok-no-nav`);
        await page.goBack({ waitUntil: "load" }).catch(() => {});
        await page.waitForTimeout(150);
      } else {
        await page.waitForSelector("[data-auth=error]", { timeout: 5000 }).catch(() => {});
        await page.unroute(SOCIAL).catch(() => {});
        if (kind === "offline") await ctx.setOffline(false);
      }
      if (!(await usable(page))) dead++, log.push(`${i}:${kind}`);
    }
    ok(dead === 0, "30 tries (Back, 500, 429, network, offline) → 0 dead buttons", log.join(" "));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `FAILED ${fails}` : "OK google sign-in: instant feedback, always opens, never a dead button");
process.exit(fails ? 1 : 0);
