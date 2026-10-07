// Hotfix 2026-10-07 — the phone viewport guard (boot-screen VIEWPORT_GUARD). Android emulation (360×740, touch,
// isMobile); the broken state from Tal's installed app (a 980 px layout after Google's Custom Tab) is forced by an init
// script that rewrites the viewport meta to width=980:
//   soft      broken once, the meta re-insert fixes it → 360 wide, no reload, one `viewport` report (soft=yes)
//   reload    broken until reload → exactly one reload, then 360 wide; report soft=no
//   no loop   broken on every load → one reload only, nothing more within 30 s
//   healthy   normal phone (portrait + landscape) and desktop → never reload, never report
//   server    /api/errors accepts a `viewport` event
// Usage: BASE=http://localhost:3100 node scripts/test-viewport.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3100";
const URL_ = `${BASE}/login`;
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
let fails = 0;
const ok = (c, m, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};

/** mode: none | soft (first meta only) | once (sticky until the first reload) | always (sticky on every load) */
function breaker(mode) {
  const s = sessionStorage;
  s.setItem("t.loads", String(Number(s.getItem("t.loads") || 0) + 1));
  if (mode === "none") return;
  if (mode === "once") {
    if (s.getItem("t.broke")) return;
    s.setItem("t.broke", "1");
  }
  const bad = "width=980";
  const fix = (m) => m.getAttribute("content") !== bad && m.setAttribute("content", bad);
  const mo = new MutationObserver(() => {
    // all of them: Next adds a second viewport meta after hydration
    const ms = document.querySelectorAll('meta[name="viewport"]');
    if (!ms.length) return;
    ms.forEach(fix);
    if (mode === "soft") mo.disconnect();
  });
  mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
}

const browser = await chromium.launch();
const phone = { viewport: { width: 360, height: 740 }, screen: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA };

async function run(opts, mode, waitMs = 2500) {
  const ctx = await browser.newContext(opts);
  const reports = [];
  await ctx.route("**/api/errors", async (r) => {
    reports.push(r.request().postData() ?? "");
    await r.fulfill({ status: 200, contentType: "application/json", body: '{"stored":1,"rejected":0}' });
  });
  await ctx.addInitScript(breaker, mode);
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: "load" });
  await page.waitForTimeout(waitMs);
  await page.waitForLoadState("load");
  const st = await page.evaluate(() => ({ iw: innerWidth, loads: Number(sessionStorage.getItem("t.loads")), coarse: matchMedia("(pointer: coarse)").matches, vpfix: sessionStorage.getItem("nexus.vpfix") }));
  return { ctx, page, st, reports };
}

try {
  {
    const { ctx, st } = await run(phone, "none", 1500);
    ok(st.coarse && st.iw === 360, "emulation: coarse pointer, 360 px layout", JSON.stringify(st));
    await ctx.close();
  }
  {
    const { ctx, st, reports } = await run(phone, "soft");
    const r = reports.map((b) => JSON.parse(b).events[0]);
    ok(st.iw === 360 && st.loads === 1 && !st.vpfix, "soft: 980 layout → 360 without a reload", JSON.stringify(st));
    ok(r.length === 1 && r[0].kind === "viewport" && r[0].code === "layout" && /iw=980\b/.test(r[0].message) && /soft=yes/.test(r[0].message) && /meta=yes/.test(r[0].message) && /dm=browser/.test(r[0].message) && /mobile=yes/.test(r[0].message) && /nav=navigate/.test(r[0].message), "soft: one viewport report with the layout numbers, soft=yes", JSON.stringify(r));
    await ctx.close();
  }
  {
    const { ctx, st, reports } = await run(phone, "once");
    ok(st.iw === 360 && st.loads === 2 && !!st.vpfix, "reload: sticky 980 layout → exactly one reload, then 360", JSON.stringify(st));
    ok(reports.length === 1 && /soft=no/.test(reports[0]), "reload: the report says the soft fix didn't work", JSON.stringify(reports));
    await ctx.close();
  }
  {
    const { ctx, page, st } = await run(phone, "always", 3000);
    ok(st.loads === 2 && st.iw === 980, "no loop: still broken after the one reload → no second reload", JSON.stringify(st));
    // more chances to trigger it: visibility / pageshow / resize events
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      dispatchEvent(new Event("resize"));
      dispatchEvent(new Event("pageshow"));
    });
    await page.waitForTimeout(2500);
    const loads = await page.evaluate(() => Number(sessionStorage.getItem("t.loads")));
    ok(loads === 2, "no loop: further events within 30 s don't reload", String(loads));
    await ctx.close();
  }
  for (const [name, opts] of [
    ["phone portrait", phone],
    ["phone landscape", { ...phone, viewport: { width: 740, height: 360 }, screen: { width: 740, height: 360 } }],
    ["desktop", { viewport: { width: 1280, height: 800 } }],
  ]) {
    const { ctx, page, st, reports } = await run(opts, "none", 1500);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      dispatchEvent(new Event("resize"));
      dispatchEvent(new Event("pageshow"));
    });
    await page.waitForTimeout(800);
    const loads = await page.evaluate(() => Number(sessionStorage.getItem("t.loads")));
    ok(loads === 1 && !st.vpfix && reports.length === 0, `healthy ${name}: never reloads, never reports`, JSON.stringify({ ...st, loads, reports: reports.length }));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(URL_, { waitUntil: "load" });
    const status = await page.evaluate(async () => (await fetch("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ kind: "viewport", code: "layout", where: "/login", message: "iw=980 ow=360 s=360x740 dpr=3 vv=980@0.37 dm=standalone mobile=yes nav=navigate ref=accounts.google.com meta=yes soft=no" }] }) })).status);
    ok(status === 200, "server: /api/errors accepts a viewport event", String(status));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `FAIL ${fails} check(s)` : "OK viewport guard");
process.exit(fails ? 1 : 0);
