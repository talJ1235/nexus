// Read-only end-to-end smoke test. Prints one PASS/FAIL line per check and exits non-zero on failure.
// Safe against production: it never creates, edits or deletes data.
//
//   BASE=http://localhost:3100 NEXUS_PASSWORD=... node scripts/smoke.mjs
//   SMOKE_AI=1 also calls the (owner-only) AI health endpoint. SMOKE_OUT=dir saves screenshots.
//   SMOKE_SLOW=1 (server started with NEXUS_TRACE_DELAY_MS) checks that a click in the loading shell carries over.
//   SMOKE_WRITE=1 (localhost only) also exercises adding: placeholder card, same link → +1 (+ its toast's close
//     button), partial move, and (server started with NEXUS_AI_MOCK=1) assistant action propose → apply → undo.
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

// Service-worker fetches only see context.setOffline() with this flag (the offline check needs the SW fallback).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= "1";
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

    if (!MOBILE) {
      await step("home: totals card, tiles, filters, paste capsule", async () => {
        const parts = await Promise.all(["[data-totals]", "[data-home-summary]", "[data-filters]", "[data-paste-capsule]", "[data-ask]:visible"].map((q) => page.locator(q).first().isVisible()));
        ok(parts.every(Boolean), "home: totals card, tiles, filters, paste capsule", JSON.stringify(parts));
      });

      await step("sidebar collapses, capsule glides, state survives reload", async () => {
        const cap = page.locator("[data-paste-capsule] form");
        const x0 = (await cap.boundingBox()).x;
        await page.click("[data-sidebar-toggle]");
        await page.waitForTimeout(700);
        const w = (await page.locator("aside nav").boundingBox()).width;
        const x1 = (await cap.boundingBox()).x;
        await page.reload();
        await page.waitForSelector(READY, { timeout: 15000 });
        const w2 = (await page.locator("aside nav").boundingBox()).width;
        await shot(page, "home-collapsed");
        await page.click("[data-sidebar-toggle]");
        await page.waitForTimeout(700);
        ok(w < 90 && w2 < 90 && x1 < x0, "sidebar collapses, capsule glides, state survives reload", `w=${w} after reload=${w2} capsule ${x0}→${x1}`);
      });

      await step("category filter narrows the grid", async () => {
        const before = await page.locator("[data-item-card]").count();
        await page.click("[data-category-filter]");
        const opt = page.getByRole("menuitemradio").nth(1);
        await opt.click();
        await page.waitForTimeout(300);
        const after = await page.locator("[data-item-card]").count();
        ok(after > 0 && after <= before, "category filter narrows the grid", `${before} → ${after}`);
        await page.click("[data-category-filter]");
        await page.getByRole("menuitemradio").first().click();
      });
    }

    if (MOBILE) {
      await step("phone: dock + '+' menu opens four actions and closes on the scrim", async () => {
        await page.waitForSelector("[data-dock]", { timeout: 10000 });
        await page.click("[data-plus]");
        await page.waitForSelector("[data-plus-menu=open]", { state: "attached" });
        await page.waitForTimeout(500);
        const n = await page.locator("[data-plus-action]:visible").count();
        await shot(page, "plus-menu");
        await page.mouse.click(195, 120);
        await page.waitForSelector("[data-plus-menu=closed]", { state: "attached", timeout: 3000 });
        ok(n === 4, "phone: dock + '+' menu opens four actions and closes on the scrim", `actions=${n}`);
      });
    }

    await step("projects screen lists project cards", async () => {
      await page.goto(`${BASE}/?v=projects`);
      await page.waitForSelector("[data-projects-view]", { timeout: 15000 });
      const n = await page.locator("[data-project-card]").count();
      await shot(page, "projects");
      if (n) {
        await page.locator("[data-project-card] > button").first().click();
        await page.waitForSelector(READY, { timeout: 10000 });
      }
      ok(n > 0 && /v=c%3A|v=c:/.test(page.url()), "projects screen lists project cards", `cards=${n} url=${page.url()}`);
      await page.goto(`${BASE}/`);
      await page.waitForSelector(READY, { timeout: 15000 });
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

    await step("spending view: this month's budget bar", async () => {
      await page.goto(`${BASE}/?v=spending`);
      const card = page.locator("[data-month-budget]");
      await card.waitFor({ timeout: 15000 });
      await shot(page, "spending-budget");
      const segs = await card.locator("[role=img] > div").count();
      const tiles = await page.locator("[data-stats] .rise-in").count();
      ok(segs === 3 && tiles >= 5, "spending view: this month's budget bar", `state=${await card.getAttribute("data-month-budget")}, segments=${segs}`);
    });

    await step("orders view: free-shipping row per store", async () => {
      await page.goto(`${BASE}/?v=orders`);
      await page.waitForSelector("[data-store-group]", { timeout: 15000 });
      const groups = await page.locator("[data-store-group]:not([data-store-group='—'])").count();
      const edits = await page.locator("[data-store-group] [data-shipping-edit]").count();
      const bars = await page.locator("[data-store-group] [data-shipping] [role=progressbar]").count();
      ok(groups > 0 && edits === groups, "orders view: free-shipping row per store", `stores=${groups}, settings=${edits}, bars=${bars}`);
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

    await step("alerts panel: weekly summary toggle", async () => {
      await page.goto(`${BASE}/?panel=alerts`);
      const pref = page.locator("[data-weekly-pref]");
      await pref.waitFor({ timeout: 15000 });
      await pref.scrollIntoViewIfNeeded();
      await shot(page, "alerts-weekly");
      ok(["on", "off"].includes(await pref.getAttribute("data-weekly-pref")), "alerts panel: weekly summary toggle");
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
        await step("free-shipping threshold: set from the store header → bar shows the gap", async () => {
          await page.goto(`${BASE}/?v=orders`);
          const free = page.locator("[data-store-group]:not(:has([data-shipping]))").filter({ has: page.locator("[data-shipping-edit]") }).first();
          await free.waitFor({ timeout: 15000 });
          const group = page.locator(`[data-store-group="${await free.getAttribute("data-store-group")}"]`);
          await group.locator("[data-shipping-edit]").click();
          const pop = page.locator("[data-radix-popper-content-wrapper]");
          await pop.locator("input[name=freeShippingMin]").fill("100000");
          await pop.locator("input[name=shippingFee]").fill("25");
          await pop.locator("button[type=submit]").click();
          await group.locator("[data-shipping=gap] [role=progressbar]").waitFor({ timeout: 8000 });
          await shot(page, "orders-shipping-gap");
          const text = await group.locator("[data-shipping]").innerText();
          // Put it back (empty = no threshold, no fee).
          await group.locator("[data-shipping-edit]").click();
          await pop.locator("input[name=freeShippingMin]").fill("");
          await pop.locator("input[name=shippingFee]").fill("");
          await pop.locator("button[type=submit]").click();
          await group.locator("[data-shipping]").waitFor({ state: "detached", timeout: 8000 });
          ok(/free shipping|למשלוח חינם/.test(text), "free-shipping threshold: set from the store header → bar shows the gap", text.replace(/\s+/g, " "));
        });
        await step("monthly budget: a small cap turns the bar over, clearing it removes the cap", async () => {
          await page.goto(`${BASE}/?v=spending`);
          const card = page.locator("[data-month-budget]");
          await card.waitFor({ timeout: 15000 });
          const setCap = async (v) => {
            await card.locator("[data-budget-edit]").click();
            const pop = page.locator("[data-radix-popper-content-wrapper]");
            await pop.locator("input[name=monthlyBudget]").fill(v);
            await pop.locator("button[type=submit]").click();
            await pop.waitFor({ state: "detached", timeout: 8000 });
          };
          await setCap("1");
          await page.locator("[data-month-budget=over]").waitFor({ timeout: 8000 });
          await shot(page, "spending-over");
          await setCap("");
          await page.locator("[data-month-budget=none]").waitFor({ timeout: 8000 });
          ok(true, "monthly budget: a small cap turns the bar over, clearing it removes the cap");
        });
        // Needs the server started with NEXUS_AI_MOCK=1 (the mock proposes "first two to-buy items → ordered").
        await step("assistant action: propose → apply → undo", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          const btn = page.locator("header button[title='Ask Nexus'], header button[aria-label='Assistant']").filter({ visible: true }).first();
          if (!(await btn.count())) return ok(true, "assistant action (AI off or not in this layout, skipped)");
          await btn.click();
          const dlg = page.getByRole("dialog");
          await dlg.locator("textarea").fill("Mark my first two to-buy items as ordered");
          await dlg.locator("textarea").press("Enter");
          const card = dlg.locator("[data-testid=ai-action-card]");
          await card.waitFor({ timeout: 60000 });
          const ids = await card.locator("[data-item-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")));
          const statuses = async () => {
            const b = await (await ctx.request.get(`${BASE}/api/backup`)).json();
            return ids.map((id) => b.data.items.find((i) => i.id === id)?.status);
          };
          const before = await statuses();
          await page.waitForTimeout(300);
          await shot(page, "ai-action");
          await card.getByRole("button", { name: /^(Apply|החל)$/ }).click();
          await dlg.locator("[data-testid=ai-action-card][data-state=applied]").waitFor({ timeout: 15000 });
          const after = await statuses();
          await page.locator("[data-sonner-toast]").filter({ hasText: /Done:|בוצע:/ }).getByRole("button", { name: /^(Undo|ביטול)$/ }).click();
          await dlg.locator("[data-testid=ai-action-card][data-state=undone]").waitFor({ timeout: 15000 });
          const undone = await statuses();
          const all = (list, s) => list.length > 0 && list.every((x) => x === s);
          ok(all(before, "to_buy") && all(after, "ordered") && all(undone, "to_buy"), "assistant action: propose → apply → undo", JSON.stringify({ before, after, undone }));
          await page.keyboard.press("Escape");
        });
        // Needs NEXUS_AI_MOCK=1: the mock reads "1 x Name @ price" lines instead of calling Gemini.
        await step("receipt: paste order email → review matches → apply → undo", async () => {
          const backup = async () => (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
          const open = (await backup()).filter((i) => i.status === "to_buy" && !i.altGroupId && i.title.length > 6);
          const picks = [...open.filter((i) => i.quantity === 1), ...open.filter((i) => i.quantity > 1)].slice(0, 2);
          if (picks.length < 2) return ok(true, "receipt (fewer than two to-buy items, skipped)");
          const orderNo = `SMOKE-${Date.now()}`;
          const text = [`Store: Smoke store`, `Order: ${orderNo}`, ...picks.map((p, i) => `1 x ${p.title} @ ${10 * (i + 1)}`), `1 x Zzqx gift wrapping service @ 3`].join("\n");
          // Desktop: the add bar button; phone: the History header button (the add bar keeps its room for the link).
          await page.goto(`${BASE}/${MOBILE ? "?v=history" : ""}`);
          await page.waitForSelector(READY);
          await page.locator(`[data-receipt-open=${MOBILE ? "view" : "add"}]`).click();
          const dlg = page.getByRole("dialog");
          await dlg.locator("#receipt-text").fill(text);
          await dlg.getByRole("button", { name: /^(Read|קריאה)$/ }).click();
          await dlg.locator("[data-receipt-review]").waitFor({ timeout: 30000 });
          const modes = await dlg.locator("[data-receipt-line]").evaluateAll((els) => els.map((e) => e.getAttribute("data-receipt-line")));
          await shot(page, "receipt-review");
          await dlg.locator("[data-receipt-apply]").click();
          const toastEl = page.locator("[data-sonner-toast]").filter({ hasText: /updated from the receipt|עודכנו מהקבלה/ });
          await toastEl.waitFor({ timeout: 15000 });
          const applied = (await backup()).filter((i) => i.orderNumber === orderNo);
          await toastEl.getByRole("button", { name: /^(Undo|ביטול)$/ }).click();
          await page.waitForTimeout(1500);
          const after = await backup();
          const left = after.filter((i) => i.orderNumber === orderNo);
          const restored = picks.every((p) => after.find((i) => i.id === p.id)?.status === "to_buy" && after.find((i) => i.id === p.id)?.quantity === p.quantity);
          ok(
            modes.join() === "match,match,ignore" && applied.length === 2 && applied.every((i) => i.status === "purchased" && i.purchasedPrice > 0) && left.length === 0 && restored,
            "receipt: paste order email → review matches → apply → undo",
            JSON.stringify({ modes, applied: applied.map((i) => [i.title, i.status, i.purchasedPrice]), left: left.length, restored }),
          );
        });
      }
    }

    // Own context: goes offline, then logs out. Read-only (nothing is edited).
    await step("offline: renders from the snapshot, read-only; logout clears it", async () => {
      const oc = await browser.newContext({ viewport: VIEWPORT, ...DEVICE, colorScheme: "dark" });
      try {
        const p = await oc.newPage();
        await p.goto(`${BASE}/login`);
        await p.fill("#password", PASSWORD);
        await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }), p.click("button[type=submit]")]);
        await p.waitForSelector(READY, { timeout: 15000 });
        const online = await p.locator("main article").count();
        const stored = () =>
          p.evaluate(async () => {
            const shell = (await caches.keys()).some((k) => k.startsWith("nexus-shell"));
            const dbs = (await indexedDB.databases()).some((d) => d.name === "nexus-offline");
            return { controlled: !!navigator.serviceWorker.controller, shell, dbs };
          });
        // SW takes control, caches the shell; the store saves the snapshot (debounced).
        await p.waitForFunction(async () => !!navigator.serviceWorker.controller && (await caches.keys()).some((k) => k.startsWith("nexus-shell")) && (await indexedDB.databases()).some((d) => d.name === "nexus-offline"), null, { timeout: 20000, polling: 500 });
        await p.waitForTimeout(1500);
        await oc.setOffline(true);
        await p.goto(`${BASE}/`);
        await p.waitForSelector("[data-offline-banner=snapshot]", { timeout: 10000 });
        await p.waitForSelector(READY, { timeout: 10000 });
        const offlineCount = await p.locator("main article").count();
        const addDisabled = await p.locator("#add-input").isDisabled();
        await shot(p, "offline");
        await p.locator("main article button[aria-label]").first().click();
        const fields = p.locator("[data-sheet-fields]");
        await fields.waitFor({ timeout: 5000 });
        const sheetDisabled = await fields.locator("textarea").first().isDisabled();
        await shot(p, "offline-sheet");
        await p.keyboard.press("Escape");
        // Back online: the shell goes back to the live app by itself.
        await oc.setOffline(false);
        await p.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
        await p.waitForSelector(READY, { timeout: 15000 });
        const banner = await p.locator("[data-offline-banner]").count();
        await p.evaluate(() => {
          const f = document.createElement("form");
          f.method = "post";
          f.action = "/api/logout";
          document.body.appendChild(f);
          f.submit();
        });
        await p.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 10000 });
        await p.waitForTimeout(1000);
        const after = await stored();
        ok(
          offlineCount > 0 && offlineCount === online && addDisabled && sheetDisabled && banner === 0 && !after.shell && !after.dbs,
          "offline: renders from the snapshot, read-only; logout clears it",
          JSON.stringify({ online, offlineCount, addDisabled, sheetDisabled, banner, after }),
        );
      } finally {
        await oc.close();
      }
    });

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
