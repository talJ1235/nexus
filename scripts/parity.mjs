// Design parity proof (Round 14): the approved mockup (left) next to the app (right), same viewport, light + dark.
// Mockups (docs/design/home-v4/*.dc.html) render as plain HTML: `{{cls}}` / `{{colCls}}` are filled in for dark /
// collapsed, other `{{…}}` holes stay as text. Writes PNGs (≤ 400 KB each) to docs/design/parity-r14/.
//   BASE=http://localhost:3100 NEXUS_PASSWORD=... node scripts/parity.mjs [only]
import { readFileSync, statSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const PASSWORD = process.env.NEXUS_PASSWORD;
const OUT = "docs/design/parity-r14";
const ONLY = process.argv[2];
const MOCK = "docs/design/home-v4";

const DESK = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };
const SHOTS = [
  // [file, mockup, mockup fill-ins, app path, viewport, app cookies]
  ["desktop-home", "desktop", {}, "/", DESK, {}],
  ["desktop-sidebar-collapsed", "desktop", { colCls: "col" }, "/", DESK, { nexus_sidebar: "collapsed" }],
  ["phone-home", "phone", {}, "/", PHONE, {}],
  ["phone-shopping", "shopping", {}, "/?v=to_buy", PHONE, {}],
];

const browser = await chromium.launch();
const today = new Date();
const dayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

/** A logged-in context in one theme, with the opening already seen (the small loader goes as soon as data is in). */
async function appContext(viewport, mode, cookies = {}, opening = false, dpr = 1) {
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(
    ([m, k, open]) => {
      localStorage.setItem("theme", m);
      if (!open) {
        localStorage.setItem("nexus.bootDay", k);
        sessionStorage.setItem("nexus.opened", "1");
      }
    },
    [mode, dayKey, opening],
  );
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("#password", PASSWORD);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button[type=submit]")]);
  await ctx.addCookies([{ name: "nexus_palette", value: "graphite", url: BASE }, { name: "nexus_locale", value: "en", url: BASE }, ...Object.entries(cookies).map(([name, value]) => ({ name, value, url: BASE }))]);
  return { ctx, p };
}

async function appShot(path, viewport, mode, cookies) {
  const { ctx, p } = await appContext(viewport, mode, cookies);
  await p.goto(`${BASE}${path}`);
  await p.waitForSelector("[data-app-shell][data-ready]", { timeout: 20000 });
  await p.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1600);
  const buf = await p.screenshot();
  await ctx.close();
  return buf;
}

async function mockShot(name, fill, viewport, mode) {
  let html = readFileSync(`${MOCK}/${name}.dc.html`, "utf8");
  const vals = { cls: mode === "dark" ? "dark" : "", colCls: "", ...fill };
  for (const [k, v] of Object.entries(vals)) html = html.replaceAll(`{{${k}}}`, v);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(html, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(900); // the mockup's own rise-in
  const buf = await p.screenshot();
  await ctx.close();
  return buf;
}

/** Side by side (mockup | app), each scaled to `w` px wide, labelled. */
async function compose(file, cells, w) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const tile = ([label, buf]) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${buf.toString("base64")}" width="${w}"></figure>`;
  await p.setContent(`<style>body{margin:0;background:#888;font:600 13px system-ui}#c{display:inline-flex;gap:8px;padding:8px}figure{margin:0}figcaption{color:#fff;padding:0 0 6px}img{display:block}</style><div id="c">${cells.map(tile).join("")}</div>`);
  await p.locator("#c").screenshot({ path: `${OUT}/${file}.png` });
  await ctx.close();
  const kb = Math.round(statSync(`${OUT}/${file}.png`).size / 1024);
  console.log(`${kb > 400 ? "FAIL" : "OK"} ${OUT}/${file}.png ${kb} KB`);
}

for (const [file, mock, fill, path, vp, cookies] of SHOTS) {
  for (const mode of ["light", "dark"]) {
    if (ONLY && !`${file}-${mode}`.includes(ONLY)) continue;
    const m = await mockShot(mock, fill, vp, mode);
    const a = await appShot(path, vp, mode, cookies);
    await compose(`${file}-${mode}`, [[`mockup · ${mock}.dc.html · ${mode}`, m], [`app · ${path} · ${mode}`, a]], vp.width > 600 ? 760 : 390);
  }
}

// The logo in its four places (sidebar, phone top bar, assistant header, the opening), light row + dark row.
if (!ONLY || "logo".includes(ONLY)) {
  const cells = [];
  for (const mode of ["light", "dark"]) {
    const crop = async (p, loc, pad = 10) => {
      const b = await loc.boundingBox();
      return p.screenshot({ clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } });
    };
    let { ctx, p } = await appContext(DESK, mode, {}, false, 3);
    await p.goto(`${BASE}/`);
    await p.waitForSelector("[data-app-shell][data-ready]");
    await p.waitForTimeout(800);
    cells.push([`${mode} · sidebar`, await crop(p, p.locator("[data-sidebar-logo]"))]);
    await p.locator("[data-ask]").filter({ visible: true }).first().click();
    const mark = p.locator('[role=dialog] svg[viewBox="0 0 64 64"]').first();
    await mark.waitFor({ timeout: 8000 });
    await p.waitForTimeout(500);
    cells.push([`${mode} · assistant`, await crop(p, mark, 14)]);
    await ctx.close();
    ({ ctx, p } = await appContext(PHONE, mode, {}, false, 3));
    await p.goto(`${BASE}/`);
    await p.waitForSelector("[data-app-shell][data-ready]");
    await p.waitForTimeout(800);
    cells.push([`${mode} · phone top bar`, await crop(p, p.locator("[data-topbar-logo]"))]);
    await ctx.close();
    // The opening (full intro): the assembled Box during the hold.
    // A new tab: the login page already marked this one as opened (→ small loader).
    ({ ctx } = await appContext(PHONE, mode, {}, true, 3));
    p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: "commit" });
    await p.waitForTimeout(2100);
    cells.push([`${mode} · opening`, await crop(p, p.locator(".boot-mark"), 6)]);
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 600 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(
    `<style>body{margin:0;font:600 12px system-ui}#c{display:grid;grid-template-columns:repeat(4,auto);gap:10px;padding:10px;background:#888;align-items:end}figure{margin:0}figcaption{color:#fff;padding-bottom:4px}img{display:block;height:90px}</style><div id="c">${cells
      .map(([l, b]) => `<figure><figcaption>${l}</figcaption><img src="data:image/png;base64,${b.toString("base64")}"></figure>`)
      .join("")}</div>`,
  );
  await p.locator("#c").screenshot({ path: `${OUT}/logo-four-places.png` });
  await ctx.close();
  console.log(`OK ${OUT}/logo-four-places.png ${Math.round(statSync(`${OUT}/logo-four-places.png`).size / 1024)} KB`);
}

await browser.close();
