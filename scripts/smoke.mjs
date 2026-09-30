// Read-only end-to-end smoke test. Prints one PASS/FAIL line per check and exits non-zero on failure.
// Safe against production: it never creates, edits or deletes data.
//
//   BASE=http://localhost:3100 NEXUS_PASSWORD=... node scripts/smoke.mjs
//   SMOKE_AI=1 also calls the (owner-only) AI health endpoint. SMOKE_OUT=dir saves screenshots.
//   SMOKE_SLOW=1 (server started with NEXUS_TRACE_DELAY_MS) checks that a click in the loading shell carries over.
//   SMOKE_WRITE=1 (localhost only) also exercises adding: placeholder card, same link → +1 (+ its toast's close
//     button), partial move.
//   SMOKE_MOBILE=1 runs the owner checks in a 390×844 touch phone context; screenshots get a "-m" suffix.
//   SMOKE_TRACE=1 records every painted frame of the first 2.5 s after goto("/") (CDP screencast, timestamped)
//     into $SMOKE_OUT/trace[-m]/ plus one contact sheet (trace[-m].png) to judge load flashes from frames.
//     SMOKE_TRACE_PATH=/?v=urgent traces another URL; SMOKE_THROTTLE=1 emulates a slow phone network (Fast 3G-ish)
//     and SMOKE_TRACE_LAYOUT=table stores that layout preference first (to catch a cards→table second render).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const PASSWORD = process.env.NEXUS_PASSWORD;
const MOBILE = !!process.env.SMOKE_MOBILE;
const TRACE = !!process.env.SMOKE_TRACE;
const OUT = process.env.SMOKE_OUT || (TRACE ? join(tmpdir(), "nexus-smoke") : "");
if (OUT) mkdirSync(OUT, { recursive: true });
const SUFFIX = MOBILE ? "-m" : "";
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 860 };
const DEVICE = MOBILE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {};

let failed = 0;
const ok = (cond, msg, extra = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}${extra && !cond ? ` — ${extra}` : ""}`);
};
const step = async (msg, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(false, msg, String(e?.message || e).split("\n")[0].slice(0, 200));
  }
};
// The app with its data (not the streamed loading shell, whose clicks are replaced when the data arrives).
const READY = "[data-app-shell][data-ready] main h1";
const shot = async (page, name) => OUT && page.screenshot({ path: `${OUT}/${name}${SUFFIX}.png` });

// Record every frame Chromium paints during `ms` after navigating to `url` (screencast only emits on change,
// so each saved frame is a visible state). Writes frames + a labelled contact sheet; returns the frame list.
async function traceLoad(ctx, url, ms = 2500) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const dir = `${OUT}/trace${SUFFIX}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let t0 = 0;
  if (process.env.SMOKE_THROTTLE) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    frames.push({ t: Math.round(metadata.timestamp * 1000), data });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
  t0 = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
  await cdp.send("Page.stopScreencast");
  const start = frames[0]?.t ?? 0;
  const list = frames.map((f, i) => ({ ...f, ms: f.t - start, name: `${String(i).padStart(3, "0")}-${String(f.t - start).padStart(4, "0")}ms.jpg` }));
  for (const f of list) writeFileSync(`${dir}/${f.name}`, Buffer.from(f.data, "base64"));
  if (list.length) {
    const w = MOBILE ? 195 : 342, h = Math.round((w * VIEWPORT.height) / VIEWPORT.width), cols = MOBILE ? 8 : 5, lab = 18;
    const tiles = await Promise.all(list.map(async (f) => {
      const img = await sharp(Buffer.from(f.data, "base64")).resize(w, h, { fit: "contain", background: "#888" }).toBuffer();
      const label = Buffer.from(`<svg width="${w}" height="${lab}"><rect width="100%" height="100%" fill="#000"/><text x="4" y="13" font-size="12" font-family="monospace" fill="#fff">${f.name.replace(".jpg", "")}</text></svg>`);
      return sharp({ create: { width: w, height: h + lab, channels: 3, background: "#000" } }).composite([{ input: label, top: 0, left: 0 }, { input: img, top: lab, left: 0 }]).png().toBuffer();
    }));
    const rows = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: cols * (w + 4), height: rows * (h + lab + 4), channels: 3, background: "#f0f" } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * (w + 4), top: Math.floor(i / cols) * (h + lab + 4) })))
      .png().toFile(`${OUT}/trace${SUFFIX}.png`);
  }
  await page.close();
  return list;
}

try {
  await fetch(`${BASE}/login`, { redirect: "manual" });
} catch (e) {
  console.log(`FAIL server unreachable at ${BASE} (${e.cause?.code || e.message}) — start it first`);
  process.exit(1);
}

const browser = await chromium.launch();
try {
  // ---- Anonymous visitor: everything private is locked.
  const anon = await browser.newContext();
  await step("anonymous is redirected to /login", async () => {
    const r = await anon.request.get(`${BASE}/`, { maxRedirects: 0 });
    ok([302, 307, 308].includes(r.status()) && (r.headers().location || "").includes("/login"), "anonymous is redirected to /login", `${r.status()} ${r.headers().location}`);
  });
  for (const path of ["/api/backup", "/api/export?view=to_buy", "/api/cron/prices"]) {
    await step(`anonymous blocked from ${path}`, async () => {
      const r = await anon.request.get(`${BASE}${path}`, { maxRedirects: 0 });
      ok([401, 403, 307].includes(r.status()), `anonymous blocked from ${path}`, String(r.status()));
    });
  }
  await anon.close();

  if (!PASSWORD) {
    console.log("SKIP owner checks (NEXUS_PASSWORD not set)");
  } else {
    const ctx = await browser.newContext({ viewport: VIEWPORT, ...DEVICE, colorScheme: "dark" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 160)}`));

    await step("owner login", async () => {
      await page.goto(`${BASE}/login`);
      await page.fill("#password", PASSWORD);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }), page.click("button[type=submit]")]);
      ok(true, "owner login");
    });

    await step("app renders items", async () => {
      await page.waitForSelector(READY, { timeout: 15000 });
      ok(true, "app renders", "");
      await shot(page, "home");
    });

    await step("Esc opens command palette with quick settings", async () => {
      await page.keyboard.press("Escape");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ timeout: 5000 });
      const txt = await dialog.innerText();
      ok(/Settings|הגדרות/.test(txt), "Esc opens command palette with quick settings", txt.slice(0, 80));
      await shot(page, "palette");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
    });

    for (const [name, v] of [["history", "history"], ["spending", "spending"], ["urgent", "urgent"]]) {
      await step(`view ${name}`, async () => {
        await page.goto(`${BASE}/?v=${v}`);
        await page.waitForSelector("main", { timeout: 15000 });
        ok(true, `view ${name}`);
      });
    }

    await step("orders view: cards ↔ table toggle switches layout", async () => {
      await page.goto(`${BASE}/?v=orders`);
      await page.waitForSelector("[data-orders-layout]", { timeout: 15000 });
      const layout = () => page.locator("[data-orders-layout]").getAttribute("data-orders-layout");
      const radio = (i) => page.locator("[role=radiogroup] [role=radio]").nth(i);
      const before = await layout();
      await radio(before === "table" ? 0 : 1).click();
      await page.waitForFunction((b) => document.querySelector("[data-orders-layout]")?.getAttribute("data-orders-layout") !== b, before, { timeout: 5000 });
      const after = await layout();
      await shot(page, `orders-${after}`);
      await radio(after === "table" ? 0 : 1).click();
      await page.waitForFunction((b) => document.querySelector("[data-orders-layout]")?.getAttribute("data-orders-layout") === b, before, { timeout: 5000 });
      await shot(page, `orders-${before}`);
      const marks = await page.locator("[data-orders-layout] section header .store-bar, [data-orders-layout] section > header.store-bar").count();
      ok(before !== after && marks > 0, "orders view: cards ↔ table toggle switches layout", `${before}→${after}, store headers=${marks}`);
    });

    if (process.env.SMOKE_SLOW) {
      // Needs a server started with NEXUS_TRACE_DELAY_MS (slow data): a click in the loading shell must survive.
      await step("panel opened while loading stays open when the data arrives", async () => {
        await page.goto(`${BASE}/`, { waitUntil: "commit" });
        const btn = page.locator("[data-app-shell]:not([data-ready]) header button[title='Ask Nexus'], [data-app-shell]:not([data-ready]) header button[aria-label='Assistant']").filter({ visible: true }).first();
        await btn.waitFor({ timeout: 10000 });
        await page.waitForTimeout(400); // let the shell hydrate
        await btn.click();
        await page.waitForSelector(READY, { timeout: 20000 });
        await page.waitForTimeout(300);
        ok(await page.getByRole("dialog").isVisible(), "panel opened while loading stays open when the data arrives");
        await page.keyboard.press("Escape");
      });
    }

    await step("assistant panel opens", async () => {
      await page.goto(`${BASE}/`);
      await page.waitForSelector(READY, { timeout: 15000 });
      const btn = page.locator("header button[title='Ask Nexus'], header button[aria-label='Assistant']").filter({ visible: true }).first();
      if (!(await btn.count())) return ok(true, "assistant panel (AI off or not in this layout, skipped)");
      await btn.click();
      await page.getByRole("dialog").waitFor({ timeout: 5000 });
      ok(true, "assistant panel opens");
      const chips = page.locator("[data-testid=ai-suggestions] button");
      await chips.first().waitFor({ timeout: 5000 });
      const n = await chips.count();
      const h = (await chips.first().boundingBox())?.height ?? 0;
      const row = await page.locator("[data-testid=ai-suggestions]").evaluate((el) => getComputedStyle(el).flexWrap);
      ok(n >= 1 && n <= 4 && (!MOBILE || (h >= 40 && row === "nowrap")), "assistant suggestion chips render", `n=${n} h=${h} wrap=${row}`);
      await page.waitForTimeout(400); // let the sheet finish sliding in before the screenshot
      await shot(page, "assistant");
      await page.keyboard.press("Escape");
    });

    await step("owner backup endpoint", async () => {
      const r = await ctx.request.get(`${BASE}/api/backup`);
      ok(r.status() === 200 && (r.headers()["content-type"] || "").includes("json"), "owner backup endpoint", String(r.status()));
      // Data health report (warnings, not failures): stores whose daily price checks keep failing,
      // items missing an image or a price, and when the price cron last ran.
      const b = await r.json();
      const bad = {};
      for (const s of b.data.sources) {
        if (!s.url) continue;
        const k = s.storeKey || "?";
        bad[k] ??= { fail: 0, total: 0 };
        bad[k].total++;
        if ((s.checkFails ?? 0) > 0) bad[k].fail++;
      }
      for (const [k, v] of Object.entries(bad)) if (v.fail) console.log(`WARN store ${k}: ${v.fail}/${v.total} links failing price checks`);
      const noImg = b.data.items.filter((i) => !i.imageUrl).length;
      const noPrice = b.data.items.filter((i) => !b.data.sources.some((s) => s.itemId === i.id && s.price != null)).length;
      if (noImg || noPrice) console.log(`WARN items without image: ${noImg}, without any price: ${noPrice} (of ${b.data.items.length})`);
      const last = b.data.kv.find?.((x) => x.key === "pref:last_check");
      if (last) console.log(`INFO last price check: ${String(last.value).slice(0, 80)}`);
    });

    if (process.env.SMOKE_AI) {
      await step("AI health", async () => {
        const r = await ctx.request.get(`${BASE}/api/debug/ai`, { timeout: 60000 });
        const j = await r.json().catch(() => ({}));
        ok(r.status() === 200 && JSON.stringify(j).includes("ok"), "AI health", JSON.stringify(j).slice(0, 200));
      });
    }

    if (process.env.SMOKE_WRITE) {
      if (!/localhost|127\.0\.0\.1/.test(BASE)) {
        console.log("SKIP write checks (SMOKE_WRITE only runs against localhost)");
      } else {
        const link = `https://example.com/smoke-${Date.now()}`;
        const paste = async () => {
          await page.fill("#add-input", link);
          await page.press("#add-input", "Enter");
        };
        await step("pasted link shows a placeholder card at once", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.evaluate(() => localStorage.setItem("nexus.layout", "cards"));
          await paste();
          await page.waitForSelector("main article[aria-busy=true]", { timeout: 1500 });
          await shot(page, "pending-card");
          await page.waitForSelector("main article[aria-busy=true]", { state: "detached", timeout: 30000 });
          ok(true, "pasted link shows a placeholder card at once");
        });
        await step("same link again → quantity +1", async () => {
          await paste();
          await page.getByText(/quantity is now 2|הכמות עודכנה ל־2/).first().waitFor({ timeout: 10000 });
          ok((await page.locator("main article[aria-busy=true]").count()) === 0, "same link again → quantity +1 (no duplicate card)");
          await shot(page, "bumped");
        });
        await step("toast has a clear close button that dismisses it", async () => {
          const toastEl = page.locator("[data-sonner-toast]").filter({ hasText: /quantity is now 2|הכמות עודכנה ל־2/ }).first();
          await toastEl.waitFor({ timeout: 5000 });
          if (!MOBILE) await toastEl.hover();
          await page.waitForTimeout(300);
          const close = toastEl.locator("[data-close-button]");
          const label = await close.getAttribute("aria-label");
          const box = await close.boundingBox();
          const opacity = await close.evaluate((el) => getComputedStyle(el).opacity);
          await shot(page, "toast");
          await close.click();
          await toastEl.waitFor({ state: "detached", timeout: 3000 });
          ok(!!label && opacity === "1" && (box?.width ?? 0) >= (MOBILE ? 40 : 28), "toast has a clear close button that dismisses it", `label=${label} opacity=${opacity} w=${box?.width}`);
        });
        await step("toast swipes away sideways", async () => {
          const other = page.locator("[data-sonner-toast]").first();
          if (!(await other.count())) return ok(true, "toast swipe (no second toast on screen, skipped)");
          const b = await other.boundingBox();
          const y = b.y + b.height / 2;
          const x = b.x + 8; // start in the padding: a drag over the text selects it, and sonner ignores that
          if (MOBILE) {
            // Real touch events (Playwright's mouse inside a touch context doesn't drive pointer moves).
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
            for (let dx = 8; dx <= 160; dx += 8) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y }] });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          } else {
            await page.mouse.move(x, y);
            await page.mouse.down();
            for (let dx = 10; dx <= 160; dx += 10) await page.mouse.move(x + dx, y);
            await page.mouse.up();
          }
          await other.waitFor({ state: "detached", timeout: 3000 });
          ok(true, "toast swipes away sideways");
        });
        await step("partial move splits the item", async () => {
          const before = await page.locator("main article").count();
          await page.locator("main article button[aria-label]").first().click();
          const sheet = page.getByRole("dialog");
          await sheet.waitFor();
          await shot(page, "sheet");
          await sheet.locator("button[aria-haspopup=menu]").first().click();
          await page.getByRole("menuitemradio").nth(1).click();
          await sheet.getByRole("button", { name: /^−$/ }).last().click();
          await shot(page, "split-panel");
          await sheet.getByRole("button", { name: /Move 1|העבר 1/ }).click();
          await page.getByText(/Moved 1 to|הועברו 1 אל/).first().waitFor({ timeout: 10000 });
          await page.keyboard.press("Escape");
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          ok((await page.locator("main article").count()) === before + 1, "partial move splits the item", `${before} → ${await page.locator("main article").count()}`);
        });
      }
    }

    await step("boot screen", async () => {
      // Fresh tab (sessionStorage is per tab): phones see the opening animation once, then it hands off; desktop never.
      const p = await ctx.newPage();
      await p.goto(`${BASE}/`, { waitUntil: "commit" });
      await p.waitForSelector("#boot", { state: "attached", timeout: 10000 });
      if (MOBILE) {
        const shown = await p.locator("#boot").isVisible();
        await p.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 10000 });
        ok(shown && (await p.locator(READY).isVisible()), "boot screen: shown on phone, hands off to the app");
      } else {
        ok(!(await p.locator("#boot").isVisible()), "boot screen: never shown on desktop");
      }
      await p.close();
    });

    if (TRACE) {
      await step("load trace", async () => {
        const layout = process.env.SMOKE_TRACE_LAYOUT;
        if (layout) {
          await page.evaluate((l) => localStorage.setItem("nexus.layout", l), layout);
          await ctx.addCookies([{ name: "nexus_layout", value: layout, url: BASE }]);
        }
        const frames = await traceLoad(ctx, `${BASE}${process.env.SMOKE_TRACE_PATH || "/"}`, process.env.SMOKE_THROTTLE ? 5000 : 2500);
        console.log(`INFO trace: ${frames.length} frames → ${OUT}/trace${SUFFIX}.png (${frames.map((f) => f.ms).join(",")} ms)`);
        ok(frames.length > 0, "load trace recorded");
      });
    }

    ok(errors.length === 0, "no page/console errors", errors.slice(0, 5).join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
