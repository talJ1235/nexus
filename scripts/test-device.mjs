// R17 S7 W3 — a computer never turns into the phone UI (Tal's PC at 250 % zoom got the dock and the admin tab bar), and
// a phone always gets it. The device class (src/lib/device.ts) is decided by real signals, never the window's width:
//   computers (no touch, fine pointer, desktop UA) at 1366×768, 1024×700, 1017×496, 900×600, 768×500 and 1017×496 at
//   deviceScaleFactor 2.5 (zoom) — Home, Shopping, Settings, Inbox, /admin: sidebar / admin side nav, no dock, no admin
//   tab bar; under 1024 the sidebar is its icon rail; no sideways overflow at 1024 / 900 / 768;
//   phones (Pixel 7, iPhone 13, Pixel 7 landscape) → the phone UI; a tablet (iPad gen 7) → the computer UI;
//   the first paint (the app's scripts blocked = before hydration) is already the right layout;
//   Settings → Display → Layout flips both ways and survives a reload; 0 hydration warnings anywhere.
//   npm run build && npm run test:device
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { seedInbox } from "./lib/seed-notify.mjs";
import { startApp } from "./lib/test-app.mjs";

let fails = 0;
const ok = (c, m, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : ` ${extra}`}`);
  if (!c) fails++;
};
const OUT = process.env.SMOKE_OUT || "smoke-out";
mkdirSync(OUT, { recursive: true });

const DESK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const desk = (width, height, deviceScaleFactor = 1) => ({ tag: `computer ${width}×${height}${deviceScaleFactor !== 1 ? ` @${deviceScaleFactor}` : ""}`, want: "computer", opts: { viewport: { width, height }, deviceScaleFactor, userAgent: DESK_UA } });
const dev = (name, want) => {
  const { defaultBrowserType, ...d } = devices[name];
  void defaultBrowserType;
  return { tag: name, want, opts: d };
};
const COMPUTERS = [desk(1366, 768), desk(1024, 700), desk(1017, 496), desk(900, 600), desk(768, 500), desk(1017, 496, 2.5)];
const PHONES = [dev("Pixel 7", "phone"), dev("iPhone 13", "phone"), dev("Pixel 7 landscape", "phone"), dev("iPad (gen 7)", "computer")];
const HYDRATION = /hydrat|#418|#419|#423|#425|did not match|server rendered/i;

// Playwright's `isMobile` makes Chromium report UA-CH `mobile: true` even for an iPad descriptor; a real iPad has no
// UA-CH and a real Android tablet says `mobile: false` — give the tablet that (the UA, pointer and screen stay emulated).
const tablet = async (page, opts) => {
  if (!/iPad/.test(opts.userAgent ?? "")) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setUserAgentOverride", { userAgent: opts.userAgent, userAgentMetadata: { brands: [], fullVersionList: [], platform: "iPadOS", platformVersion: "17", architecture: "", model: "iPad", mobile: false } });
};

const app = await startApp({ db: "device-test.db", port: Number(process.env.PORT || 3127) });
// What each page shows, read in the page.
const state = (sels) => {
  const vis = (sel) =>
    [...document.querySelectorAll(sel)].some((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    });
  const out = { device: document.documentElement.getAttribute("data-device"), overflow: document.documentElement.scrollWidth - innerWidth, rail: Number(document.querySelector("aside[data-sidebar-w]")?.getAttribute("data-sidebar-w") ?? 0) };
  for (const [k, sel] of Object.entries(sels)) out[k] = vis(sel);
  return out;
};
const SELS = { dock: "[data-dock]", phoneHeader: "header[data-app-header]", sidebar: "[data-sidebar-logo]", sxDialog: ".sx-dialog", sxPhone: ".sx-phone", ntPage: "[data-nt-page]", ntPopover: "[data-nt-popover]", opsSide: ".ops-side", tabbar: ".nx.adm .tabbar" };

try {
  await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
  await seedInbox(app.db, { userId: app.admin, spaceId: app.personal });
  const browser = await chromium.launch();
  try {
    const open = async (opts) => {
      const ctx = await browser.newContext({ ...opts, locale: "en-US" });
      await ctx.addCookies(app.cookies(app.personal, "en"));
      const page = await ctx.newPage();
      await tablet(page, opts);
      const problems = [];
      page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && HYDRATION.test(m.text()) && problems.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => HYDRATION.test(String(e.message)) && problems.push(String(e.message).slice(0, 200)));
      return { ctx, page, problems };
    };
    const visit = async (page, path, ready) => {
      await page.goto(app.base + path);
      await page.waitForSelector(ready, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(500);
      return page.evaluate(state, SELS);
    };

    for (const c of [...COMPUTERS, ...PHONES]) {
      const { ctx, page, problems } = await open(c.opts);
      const phone = c.want === "phone";
      const w = c.opts.viewport.width;
      for (const path of ["/", "/?v=to_buy"]) {
        const st = await visit(page, path, "[data-app-shell][data-ready]");
        ok(st.device === c.want, `${c.tag} ${path}: data-device = ${c.want}`, JSON.stringify(st));
        ok(phone ? st.dock && !st.sidebar : st.sidebar && !st.dock, `${c.tag} ${path}: ${phone ? "the dock, no sidebar" : "the sidebar, no dock"}`, JSON.stringify(st));
        if (!phone && w < 1024) ok(st.rail > 0 && st.rail < 100, `${c.tag} ${path}: under 1024 the sidebar is its icon rail`, `width ${st.rail}`);
        if (!phone && [1024, 900, 768].includes(w)) ok(st.overflow <= 1, `${c.tag} ${path}: no sideways overflow`, `${st.overflow}px`);
      }
      const sx = await visit(page, "/settings/display", "[data-settings]");
      ok(phone ? sx.sxPhone && !sx.sxDialog : sx.sxDialog && !sx.sxPhone, `${c.tag} Settings: ${phone ? "phone pages" : "the dialog"}`, JSON.stringify(sx));
      const ib = await visit(page, "/inbox", "[data-nt-page], [data-nt-popover]");
      ok(phone ? ib.ntPage && !ib.ntPopover : ib.ntPopover && !ib.ntPage, `${c.tag} Inbox: ${phone ? "the full page" : "the popover"}`, JSON.stringify(ib));
      const ad = await visit(page, "/admin", ".nx.adm");
      ok(phone ? ad.tabbar && !ad.opsSide : ad.opsSide && !ad.tabbar, `${c.tag} /admin: ${phone ? "the tab bar" : "the side nav, no tab bar"}`, JSON.stringify(ad));
      if (!phone && [1024, 900, 768].includes(w)) ok(ad.overflow <= 1, `${c.tag} /admin: no sideways overflow`, `${ad.overflow}px`);
      ok(problems.length === 0, `${c.tag}: no hydration warning`, problems.join(" | "));
      await ctx.close();
    }

    // First paint, before hydration (the app's own scripts never load; the inline boot script still runs): a fresh
    // context with no cookie — the server's guess + the boot script alone already show the right layout (the phone's
// header — the dock is portaled in after mount; the computer's sidebar), under the opening animation.
    for (const c of [desk(1017, 496, 2.5), dev("Pixel 7", "phone"), dev("iPad (gen 7)", "computer")]) {
      const ctx = await browser.newContext({ ...c.opts, locale: "en-US" });
      await ctx.addCookies(app.cookies(app.personal, "en"));
      await ctx.route((u) => u.pathname.startsWith("/_next/static/") && u.pathname.endsWith(".js"), (r) => r.abort());
      const page = await ctx.newPage();
      await tablet(page, c.opts);
      await page.goto(app.base + "/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);
      const st = await page.evaluate(state, SELS);
      const file = `${OUT}/device-first-paint-${c.tag.replace(/[^\w]+/g, "-")}.png`;
      await page.screenshot({ path: file });
      const phone = c.want === "phone";
      ok(st.device === c.want && (phone ? st.phoneHeader && !st.sidebar : st.sidebar && !st.phoneHeader), `${c.tag}: the first paint (no hydration) is already the ${c.want} layout (${file})`, JSON.stringify(st));
      await ctx.close();
    }

    // The override: Settings → Display → Layout, both ways, kept over a reload; Automatic gives the device back.
    for (const [c, to] of [[desk(1366, 768), "phone"], [dev("Pixel 7", "phone"), "computer"]]) {
      const { ctx, page, problems } = await open(c.opts);
      await visit(page, "/settings/display", "[data-display-layout]");
      await Promise.all([page.waitForEvent("load"), page.selectOption("[data-display-layout]", to)]);
      let st = await visit(page, "/", "[data-app-shell][data-ready]");
      ok(st.device === to && (to === "phone" ? st.dock && !st.sidebar : st.sidebar && !st.dock), `${c.tag}: Layout → ${to} switches the UI`, JSON.stringify(st));
      await page.reload();
      await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30_000 }).catch(() => {});
      st = await page.evaluate(state, SELS);
      ok(st.device === to, `${c.tag}: Layout → ${to} survives a reload`, JSON.stringify(st));
      await visit(page, "/settings/display", "[data-display-layout]");
      ok((await page.inputValue("[data-display-layout]")) === to, `${c.tag}: Settings shows ${to}`);
      await Promise.all([page.waitForEvent("load"), page.selectOption("[data-display-layout]", "auto")]);
      st = await visit(page, "/", "[data-app-shell][data-ready]");
      ok(st.device === c.want, `${c.tag}: Layout → Automatic gives the ${c.want} UI back`, JSON.stringify(st));
      ok(problems.length === 0, `${c.tag} override: no hydration warning`, problems.join(" | "));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await app.stop();
}
console.log(fails ? `FAIL ${fails} check(s)` : "OK device");
process.exit(fails ? 1 : 0);
