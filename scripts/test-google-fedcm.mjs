// Hotfix 2026-10-07 — Google sign-in inside the app (Google Identity Services over FedCM), with the redirect as the
// fallback. Runs against a server started with a (dummy) GOOGLE_CLIENT_ID; GIS is a stub script served for
// accounts.google.com/gsi/client and every other accounts.google.com URL is a stub page, so Google is never contacted.
//   sheet      tap → busy < 100 ms; GIS gets our client id, FedCM on, a server nonce (signed httpOnly cookie); the token
//              goes to /sign-in/social with that nonce; existing account → next, new account → /welcome, no invite →
//              the InviteOnly screen, 401 → error + Try again (which uses the redirect), 429 → limit
//   fallback   sheet skipped / dismissed, GIS script blocked, no FedCM, iOS → the full-page redirect (+ `google_fedcm` report)
//   server     the nonce endpoint; ID tokens without / with a wrong nonce, for another provider or with extra fields are
//              refused; the nonce is single-use
//   csp        no violations while GIS loads
// Usage: BASE=http://localhost:3100 node scripts/test-google-fedcm.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3100";
const BTN = "[data-auth=google]";
const isGoogle = (u) => u.hostname === "accounts.google.com";
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
let fails = 0;
const ok = (c, m, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};

// GIS stand-in: initialize / prompt / cancel; window.__gisMode picks what the "sheet" does.
const GIS_STUB = `(function(){var cfg=null;window.__gis={inits:[],prompts:0,cancelled:false};
function mode(){return window.__gisMode||"credential"}
window.google={accounts:{id:{
initialize:function(o){cfg=o;window.__gis.inits.push({client_id:o.client_id,nonce:o.nonce,fedcm:o.use_fedcm_for_prompt,hint:o.login_hint||null});window.__gisReport&&window.__gisReport(JSON.stringify(window.__gis))},
prompt:function(cb){window.__gis.prompts++;setTimeout(function(){var m=mode();
if(m==="credential"){cfg.callback({credential:"stub-token-for-"+cfg.nonce});cb&&cb({isSkippedMoment:function(){return false},isDismissedMoment:function(){return true},getDismissedReason:function(){return"credential_returned"}})}
else if(m==="skipped"){cb&&cb({isSkippedMoment:function(){return true},getSkippedReason:function(){return"unknown_reason"}})}
else if(m==="dismissed"){cb&&cb({isSkippedMoment:function(){return false},isDismissedMoment:function(){return true},getDismissedReason:function(){return"cancel_called"}})}
},120)},
cancel:function(){window.__gis.cancelled=true}}}}})();`;

const browser = await chromium.launch();

/** A login page. opts: gis = credential | skipped | dismissed | blocked; fedcm (default true); ua; social = handler for id-token posts. */
async function open(opts = {}) {
  // Service workers off: the app's SW answers navigations, which hides them from page.on("request").
  const ctx = await browser.newContext({ serviceWorkers: "block", ...(opts.ua ? { userAgent: opts.ua } : {}) });
  const page = await ctx.newPage();
  const seen = { gisLoads: 0, socialBodies: [], reports: [], csp: [], gis: null };
  await ctx.exposeFunction("__gisReport", (j) => (seen.gis = JSON.parse(j)));
  await ctx.exposeFunction("__cspReport", (v) => seen.csp.push(v));
  await ctx.addInitScript(
    ({ mode, fedcm }) => {
      window.__gisMode = mode;
      if (!fedcm) delete window.IdentityCredential;
      else if (!("IdentityCredential" in window)) window.IdentityCredential = function IdentityCredential() {};
      document.addEventListener("securitypolicyviolation", (e) => window.__cspReport?.(`${e.violatedDirective} ${e.blockedURI}`));
    },
    { mode: opts.gis ?? "credential", fedcm: opts.fedcm ?? true },
  );
  await ctx.route((u) => isGoogle(u), async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/gsi/client") {
      seen.gisLoads++;
      if (opts.gis === "blocked") return r.abort();
      return r.fulfill({ status: 200, contentType: "text/javascript", body: GIS_STUB });
    }
    return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Google stub</title><p id=stub>stub</p>" });
  });
  await ctx.route("**/api/errors", async (r) => {
    seen.reports.push(r.request().postData() ?? "");
    await r.fulfill({ status: 200, contentType: "application/json", body: '{"stored":1,"rejected":0}' });
  });
  if (opts.social) {
    await ctx.route("**/api/auth/sign-in/social", async (r) => {
      const body = JSON.parse(r.request().postData() || "{}");
      if (!body.idToken) return r.continue();
      seen.socialBodies.push(body);
      const [status, json] = opts.social();
      await r.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    });
  }
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  return { ctx, page, seen };
}
const navTo = (page, test, ms = 8000) => page.waitForRequest((r) => r.isNavigationRequest() && test(new URL(r.url())), { timeout: ms }).then((r) => new URL(r.url()), () => null);
const errorShown = (page) => page.locator("[data-auth=error]").isVisible().catch(() => false);
const user = (createdAt) => ({ redirect: false, token: "t", user: { id: "u1", email: "x@example.com", name: "X", emailVerified: true, createdAt, updatedAt: createdAt } });

try {
  // ---- the sheet: existing account → next
  {
    const { ctx, page, seen } = await open({ social: () => [200, user("2020-01-01T00:00:00.000Z")] });
    await page.evaluate((sel) => {
      const b = document.querySelector(sel);
      b.addEventListener("pointerdown", () => {
        const t0 = performance.now();
        new MutationObserver(() => window.__fb == null && b.getAttribute("aria-busy") === "true" && (window.__fb = performance.now() - t0)).observe(b, { attributes: true });
      }, { once: true });
    }, BTN);
    const went = navTo(page, (u) => u.origin === BASE && u.pathname === "/");
    await page.click(BTN);
    const fb = await page.evaluate(() => window.__fb);
    const dest = await went;
    const gis = seen.gis;
    const cookies = await ctx.cookies(BASE + "/api/auth");
    const nonceCookie = cookies.find((c) => c.name === "nexus_gnonce");
    const body = seen.socialBodies[0];
    ok(fb != null && fb < 100, "sheet: tap → busy within 100 ms", String(fb));
    ok(seen.gisLoads >= 1, "sheet: GIS script loaded (warmed on page load)");
    ok(!!body && body.provider === "google" && typeof body.idToken?.token === "string" && Object.keys(body.idToken).sort().join() === "nonce,token", "sheet: the ID token + nonce go to /sign-in/social (nothing else)", JSON.stringify(body));
    ok(!!gis && gis.inits.at(-1)?.fedcm === true && /\.apps\.googleusercontent\.com$/.test(gis.inits.at(-1)?.client_id ?? "") && gis.inits.at(-1)?.nonce === body?.idToken?.nonce && body?.idToken?.token === `stub-token-for-${body?.idToken?.nonce}`, "sheet: GIS gets our client id, FedCM on, the server's nonce", JSON.stringify(gis));
    ok(!!nonceCookie && nonceCookie.httpOnly && nonceCookie.path === "/api/auth" && nonceCookie.value.startsWith(`${body?.idToken?.nonce}.`), "sheet: the nonce sits in a signed httpOnly cookie", JSON.stringify(nonceCookie));
    ok(!!dest, "sheet: existing account → the app (next)", String(dest));
    ok(!seen.csp.length, "csp: no violations while GIS loads and runs", JSON.stringify(seen.csp));
    await ctx.close();
  }
  // ---- new account → /welcome; no invite → InviteOnly
  {
    const { ctx, page } = await open({ social: () => [200, user(new Date().toISOString())] });
    const went = navTo(page, (u) => u.pathname === "/welcome");
    await page.click(BTN);
    ok(!!(await went), "sheet: new account → /welcome");
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ social: () => [403, { code: "invite_required", message: "pendingref123" }] });
    const went = navTo(page, (u) => u.pathname === "/login" && u.searchParams.get("error") === "invite_required" && u.searchParams.get("error_description") === "pendingref123");
    await page.click(BTN);
    ok(!!(await went), "sheet: no invite → the InviteOnly screen (same as the redirect's error URL)");
    await ctx.close();
  }
  // ---- 401 → error + Try again (redirect); 429 → limit
  {
    const { ctx, page, seen } = await open({ social: () => [401, { code: "INVALID_TOKEN", message: "Invalid token" }] });
    await page.click(BTN);
    await page.waitForSelector("[data-auth=error]", { timeout: 8000 }).catch(() => {});
    const enabled = await page.locator(BTN).isEnabled();
    ok((await errorShown(page)) && enabled, "sheet: server refuses the token → error shown, button enabled");
    await page.waitForTimeout(300);
    ok(seen.reports.some((b) => /"kind":"auth"/.test(b) && /google_status/.test(b) && /id token: status 401/.test(b)), "sheet: refused token → `auth` report (status only)", JSON.stringify(seen.reports));
    const went = navTo(page, (u) => isGoogle(u));
    await page.click("[data-auth=retry]");
    ok(!!(await went), "sheet: Try again → the redirect to Google");
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ social: () => [429, { message: "Too many requests" }] });
    await page.click(BTN);
    await page.waitForSelector("[data-auth=error]", { timeout: 8000 }).catch(() => {});
    ok(/too many|יותר מדי|נסיונות|tries/i.test((await page.locator("[data-auth=error]").textContent().catch(() => "")) ?? "") && (await page.locator(BTN).isEnabled()), "sheet: 429 → 'too many tries', button enabled");
    await ctx.close();
  }
  // ---- fallbacks to the redirect
  for (const [name, opts, gisExpected, reason] of [
    ["sheet skipped (cooldown / not signed in to Google / origin not allowed)", { gis: "skipped" }, true, "skipped:unknown_reason"],
    ["sheet dismissed", { gis: "dismissed" }, true, "dismissed:cancel_called"],
    ["GIS script blocked", { gis: "blocked" }, true, "script"],
    ["no FedCM in this browser", { fedcm: false }, false, null],
    ["iOS", { ua: IOS }, false, null],
  ]) {
    const { ctx, page, seen } = await open(opts);
    const went = navTo(page, (u) => isGoogle(u) && u.pathname !== "/gsi/client");
    await page.click(BTN);
    const dest = await went;
    ok(!!dest, `fallback — ${name}: the full-page redirect to Google`, String(dest));
    ok(gisExpected ? seen.gisLoads >= 1 : seen.gisLoads === 0, `fallback — ${name}: GIS ${gisExpected ? "tried" : "never loaded"}`, String(seen.gisLoads));
    if (reason) ok(seen.reports.some((b) => /google_fedcm/.test(b) && b.includes(reason)), `fallback — ${name}: \`google_fedcm\` report (${reason})`, JSON.stringify(seen.reports));
    await ctx.close();
  }
  // ---- server: nonce endpoint + the ID-token guard (real server, nothing intercepted)
  {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    const post = (path, body) =>
      page.evaluate(async ([p, b]) => {
        const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, [path, body]);
    const social = (idToken, provider = "google") => post("/api/auth/sign-in/social", { provider, idToken, callbackURL: "/" });
    const none = await social({ token: "x.y.z", nonce: "abc" });
    ok(none.status === 401 && /invalid nonce/.test(none.body?.message ?? ""), "server: an ID token without our nonce cookie → 401", JSON.stringify(none));
    const n = await post("/api/auth/google/nonce", {});
    const nonce = n.body?.nonce;
    ok(n.status === 200 && typeof nonce === "string" && nonce.length >= 32, "server: /google/nonce issues a nonce", JSON.stringify(n));
    const wrong = await social({ token: "x.y.z", nonce: "not-the-nonce" });
    ok(wrong.status === 401 && /invalid nonce/.test(wrong.body?.message ?? ""), "server: wrong nonce → 401", JSON.stringify(wrong));
    const other = await social({ token: "x.y.z", nonce }, "test-idp");
    ok(other.status === 400, "server: ID token for another provider → 400", JSON.stringify(other));
    const extra = await social({ token: "x.y.z", nonce, accessToken: "a" });
    ok(extra.status === 400, "server: extra fields (access token / profile) → 400", JSON.stringify(extra));
    const n2 = (await post("/api/auth/google/nonce", {})).body?.nonce;
    const bogus = await social({ token: "x.y.z", nonce: n2 });
    ok(bogus.status === 401 && !/invalid nonce/.test(bogus.body?.message ?? ""), "server: right nonce, forged token → refused by Google's signature check", JSON.stringify(bogus));
    const again = await social({ token: "x.y.z", nonce: n2 });
    ok(again.status === 401 && /invalid nonce/.test(again.body?.message ?? ""), "server: the nonce is single-use", JSON.stringify(again));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `FAIL ${fails} check(s)` : "OK google in-app sign-in (FedCM) + redirect fallback");
process.exit(fails ? 1 : 0);
