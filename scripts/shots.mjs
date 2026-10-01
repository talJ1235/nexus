// Visual review screenshots across themes (Round 7). Logs in once, then shoots each path at desktop 1366 and phone 390
// in the requested palettes × modes. Usage:
//   node --env-file=.env.local scripts/shots.mjs [/path ...]   (default "/")
//   SHOTS_OUT=dir (default $TMP/nexus-shots) SHOTS_THEMES="graphite:light,plum:dark" SHOTS_SIZES=desktop,phone
//   SHOTS_LOCALE=he; SHOTS_WAIT=ms extra settle time; SHOTS_CLICK="css selector" clicks it before the shot; SHOTS_FULL=1 full page.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const OUT = process.env.SHOTS_OUT || join(tmpdir(), "nexus-shots");
mkdirSync(OUT, { recursive: true });
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ["/"];
const themes = (process.env.SHOTS_THEMES || "graphite:light,graphite:dark,plum:light,plum:dark").split(",").map((s) => s.split(":"));
const sizes = (process.env.SHOTS_SIZES || "desktop,phone").split(",");
const SIZE = {
  desktop: { viewport: { width: 1366, height: 860 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const host = new URL(BASE).hostname;

const browser = await chromium.launch();
let session;
for (const size of sizes) {
  for (const [palette, mode] of themes) {
    const ctx = await browser.newContext({ ...SIZE[size], colorScheme: mode, reducedMotion: process.env.SHOTS_MOTION ? "no-preference" : "reduce" });
    await ctx.addCookies([
      { name: "nexus_palette", value: palette, domain: host, path: "/" },
      ...(process.env.SHOTS_LOCALE ? [{ name: "nexus_locale", value: process.env.SHOTS_LOCALE, domain: host, path: "/" }] : []),
      ...(session ? [session] : []),
    ]);
    await ctx.addInitScript(() => { try { localStorage.setItem("theme", "system"); sessionStorage.setItem("nexus.booted", "1"); } catch {} });
    const page = await ctx.newPage();
    if (!session) {
      await page.goto(`${BASE}/login`);
      await page.fill("#password", process.env.APP_PASSWORD || process.env.NEXUS_PASSWORD || "");
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
      session = (await ctx.cookies()).find((c) => c.name !== "nexus_palette" && c.httpOnly);
    }
    for (const p of paths) {
      await page.goto(`${BASE}${p}`);
      await page.waitForSelector("[data-app-shell][data-ready], main", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(Number(process.env.SHOTS_WAIT || 700));
      if (process.env.SHOTS_CLICK) { await page.click(process.env.SHOTS_CLICK).catch((e) => console.log("click failed", e.message.split("\n")[0])); await page.waitForTimeout(600); }
      const name = `${process.env.SHOTS_LOCALE ? process.env.SHOTS_LOCALE + "-" : ""}${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}-${size}-${palette}-${mode}.png`;
      await page.screenshot({ path: join(OUT, name), fullPage: !!process.env.SHOTS_FULL });
      console.log(join(OUT, name));
    }
    await ctx.close();
  }
}
await browser.close();
