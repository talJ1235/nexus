// Read-only end-to-end smoke test. Prints one PASS/FAIL line per check and exits non-zero on failure.
// Safe against production: it never creates, edits or deletes data.
//
//   BASE=http://localhost:3100 NEXUS_PASSWORD=... node scripts/smoke.mjs
//   SMOKE_AI=1 also calls the (owner-only) AI health endpoint. SMOKE_OUT=dir saves screenshots.
//   SMOKE_SLOW=1 (server started with NEXUS_TRACE_DELAY_MS) checks that a click in the loading shell carries over.
//   SMOKE_WRITE=1 (localhost only) also exercises adding: placeholder card, same link → +1 (+ its toast's close
//     button), partial move, and (server started with NEXUS_AI_MOCK=1) assistant action propose → apply → undo.
//   SMOKE_PERF=1 (with SMOKE_MOBILE=1) throttles the CPU ×4 and reports long tasks (> 50 ms) during the main
//     transitions: open an item (card → sheet), switch views, change the sort, the + menu.
//   SMOKE_MOBILE=1 runs the owner checks in a 390×844 touch phone context; screenshots get a "-m" suffix.
//   SMOKE_ONLY=text runs only the steps whose name contains `text` (after logging in).
//   SMOKE_TRACE=1 records every painted frame of the first 2.5 s after goto("/") (CDP screencast, timestamped)
//     into $SMOKE_OUT/trace[-m]/ plus one contact sheet (trace[-m].png) to judge load flashes from frames.
//     SMOKE_TRACE_PATH=/?v=urgent traces another URL; SMOKE_THROTTLE=1 emulates a slow phone network (Fast 3G-ish)
//     and SMOKE_TRACE_LAYOUT=table stores that layout preference first (to catch a cards→table second render).
//     With SMOKE_TRACE, animations get their own frame series too (trace-sheet-*, trace-cover-*).
//   SMOKE_VISUAL=/?v=projects screenshots that view in Graphite + Plum × light + dark (phone: at 360 and 390 px)
//     into $SMOKE_OUT/visual/, for judging a visual change by screenshot. SMOKE_VISUAL_FULL=1 takes full-page shots.
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
const WRITE = !!process.env.SMOKE_WRITE && /localhost|127\.0\.0\.1/.test(BASE);
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
// SMOKE_ONLY=text runs only the steps whose name contains it (plus login), for quick iteration.
const ONLY = process.env.SMOKE_ONLY;
const step = async (msg, fn) => {
  if (ONLY && !msg.includes(ONLY) && !["owner login", "app renders items"].includes(msg)) return;
  try {
    await fn();
  } catch (e) {
    ok(false, msg, String(e?.message || e).split("\n")[0].slice(0, 200));
  }
};
// The app with its data (not the streamed loading shell, whose clicks are replaced when the data arrives).
const READY = "[data-app-shell][data-ready] main h1";
// Esc opens the command menu once the app's key handler is attached (right after READY it can still be hydrating).
let openPalette;
const shot = async (page, name) => OUT && page.screenshot({ path: `${OUT}/${name}${SUFFIX}.png` });

// Record every frame Chromium paints (screencast only emits on change, so each saved frame is a visible state) while
// `run` executes on `page` and for `ms` after it starts. Writes frames to $OUT/<name>[-m]/ plus a labelled contact
// sheet <name>[-m].png; returns the frame list. Used for page loads (traceLoad) and for animations (SMOKE_TRACE).
async function traceFrames(page, name, run, ms = 2500) {
  const cdp = await page.context().newCDPSession(page);
  const dir = `${OUT}/${name}${SUFFIX}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  if (process.env.SMOKE_THROTTLE) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    frames.push({ t: Math.round(metadata.timestamp * 1000), data });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
  const t0 = Date.now();
  await run();
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
  await cdp.send("Page.stopScreencast");
  await cdp.detach().catch(() => {});
  const start = frames[0]?.t ?? 0;
  const list = frames.map((f, i) => ({ ...f, ms: f.t - start, name: `${String(i).padStart(3, "0")}-${String(f.t - start).padStart(4, "0")}ms.jpg` }));
  for (const f of list) writeFileSync(`${dir}/${f.name}`, Buffer.from(f.data, "base64"));
  if (list.length) {
    const w = MOBILE ? 195 : 342, h = Math.round((w * VIEWPORT.height) / VIEWPORT.width), cols = MOBILE ? 8 : 5, lab = 18;
    const tiles = await Promise.all(list.slice(0, 80).map(async (f) => {
      const img = await sharp(Buffer.from(f.data, "base64")).resize(w, h, { fit: "contain", background: "#888" }).toBuffer();
      const label = Buffer.from(`<svg width="${w}" height="${lab}"><rect width="100%" height="100%" fill="#000"/><text x="4" y="13" font-size="12" font-family="monospace" fill="#fff">${f.name.replace(".jpg", "")}</text></svg>`);
      return sharp({ create: { width: w, height: h + lab, channels: 3, background: "#000" } }).composite([{ input: label, top: 0, left: 0 }, { input: img, top: lab, left: 0 }]).png().toBuffer();
    }));
    const rows = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: cols * (w + 4), height: rows * (h + lab + 4), channels: 3, background: "#f0f" } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * (w + 4), top: Math.floor(i / cols) * (h + lab + 4) })))
      .png().toFile(`${OUT}/${name}${SUFFIX}.png`);
  }
  return list;
}
// Frames of the first `ms` after navigating a fresh page to `url` (load flashes).
async function traceLoad(ctx, url, ms = 2500) {
  const page = await ctx.newPage();
  const list = await traceFrames(page, "trace", () => page.goto(url, { waitUntil: "commit" }), ms);
  await page.close();
  return list;
}

try {
  await fetch(`${BASE}/login`, { redirect: "manual" });
} catch (e) {
  console.log(`FAIL server unreachable at ${BASE} (${e.cause?.code || e.message}) — start it first`);
  process.exit(1);
}

// A fake-camera video of a receipt (Round 8 A3): one synthetic bench photo as a ~1 s .y4m (I420) that Chromium loops.
async function receiptVideo() {
  const { data, info } = await sharp("test-data/receipt-synth/02-dark.jpg").resize(600, 800).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const Y = Buffer.alloc(w * h);
  const U = Buffer.alloc((w / 2) * (h / 2));
  const V = Buffer.alloc((w / 2) * (h / 2));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      Y[y * w + x] = Math.max(0, Math.min(255, 0.257 * r + 0.504 * g + 0.098 * b + 16));
      if (y % 2 === 0 && x % 2 === 0) {
        const j = (y / 2) * (w / 2) + x / 2;
        U[j] = Math.max(0, Math.min(255, -0.148 * r - 0.291 * g + 0.439 * b + 128));
        V[j] = Math.max(0, Math.min(255, 0.439 * r - 0.368 * g - 0.071 * b + 128));
      }
    }
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
  const file = join(tmpdir(), "nexus-receipt.y4m");
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F15:1 Ip A1:1 C420jpeg\n`), ...Array(15).fill(frame)]));
  return file;
}

// A fake camera (test pattern) so the barcode / receipt camera screens can be exercised headless.
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
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
    const ctx = await browser.newContext({ viewport: VIEWPORT, ...DEVICE, colorScheme: "dark", permissions: ["camera"] });
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

    openPalette = async () => {
      for (let k = 0; k < 6; k++) {
        await page.keyboard.press("Escape");
        if (await page.getByRole("dialog").waitFor({ timeout: 1000 }).then(() => true, () => false)) return;
      }
    };

    await step("app renders items", async () => {
      await page.waitForSelector(READY, { timeout: 15000 });
      ok(true, "app renders", "");
      await shot(page, "home");
    });

    // Round 10 A1: opening a product must not move anything behind the sheet (> 1 px), and closing must fly the
    // picture back and leave no clone — also when items are opened and closed quickly in a row.
    await step("item sheet morph: nothing behind the sheet moves on open, no stray clone after 10 quick open/close", async () => {
      const clones = () => page.evaluate(() => document.querySelectorAll("[data-morph-clone]").length);
      const ids = await page.$$eval("main [data-item-card]", (els) => [...new Set(els.map((e) => e.getAttribute("data-item-card")))].slice(0, 10));
      const tap = async (id) => {
        const btn = page.locator(`main [data-item-card="${id}"] button.absolute.inset-0`).first();
        await btn.scrollIntoViewIfNeeded();
        const b = await btn.boundingBox();
        if (MOBILE) await page.touchscreen.tap(b.x + 20, b.y + 20);
        else await page.mouse.click(b.x + 20, b.y + 20);
      };
      // Calm open: sample everything outside the sheet every frame (the hovered/tapped card itself is excluded:
      // its picture is the one that flies).
      let worst = 0, what = "";
      for (const id of ids.slice(0, 3)) {
        await page.locator(`main [data-item-card="${id}"]`).first().scrollIntoViewIfNeeded();
        if (!MOBILE) await page.mouse.move(2, VIEWPORT.height - 2);
        await page.waitForTimeout(350);
        await page.evaluate((id) => {
          const els = [...document.querySelectorAll("main h1, main [data-item-card], [data-app-shell] header, [data-dock], [data-filters]")].filter((e) => e.getAttribute("data-item-card") !== id).slice(0, 40);
          const r0 = els.map((e) => e.getBoundingClientRect());
          const t0 = performance.now();
          window.__moved = [0, ""];
          const tick = () => {
            els.forEach((e, i) => {
              const r = e.getBoundingClientRect();
              const d = Math.max(Math.abs(r.left - r0[i].left), Math.abs(r.top - r0[i].top), Math.abs(r.width - r0[i].width));
              if (d > window.__moved[0]) window.__moved = [d, `${e.tagName.toLowerCase()}${e.getAttribute("data-item-card") ? ` card ${e.getAttribute("data-item-card")} (tapped ${id})` : ""} ${Math.round(r0[i].left)},${Math.round(r0[i].top)},${Math.round(r0[i].width)} → ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)} @${Math.round(performance.now() - t0)}ms`];
            });
            if (performance.now() - t0 < 700) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, id);
        await tap(id);
        await page.waitForTimeout(750);
        const [d, w] = await page.evaluate(() => window.__moved);
        if (d > worst) [worst, what] = [d, w];
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        if (await clones()) break;
      }
      // Quick: open → close fast, and open another while one is still flying.
      for (const id of ids) {
        await tap(id);
        await page.waitForTimeout(60 + Math.round(Math.random() * 120));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(40 + Math.round(Math.random() * 100));
      }
      await page.waitForTimeout(500);
      const left = await clones();
      const sheetOpen = await page.locator("[data-sheet-img]").count();
      ok(worst <= 1 && left === 0 && sheetOpen === 0, "item sheet morph: nothing behind the sheet moves on open, no stray clone after 10 quick open/close", `moved ${worst.toFixed(1)} px (${what}), clones left ${left}, sheet still open ${sheetOpen}`);
      if (TRACE) {
        const id = ids[1] ?? ids[0];
        const open = await traceFrames(page, "trace-sheet-open", () => tap(id), 900);
        const close = await traceFrames(page, "trace-sheet-close", () => page.keyboard.press("Escape"), 900);
        console.log(`INFO trace: sheet open ${open.length} frames, close ${close.length} frames → ${OUT}/trace-sheet-*${SUFFIX}.png`);
      }
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

    if (MOBILE) {
      // Round 9 A2: the dock is physically To buy · On the way · + · Projects · Stats in every language, and it never
      // moves: its box is sampled every animation frame while switching through all five targets.
      await step("phone dock: fixed order in en + he, dock and top bar perfectly still while switching", async () => {
        const order = async () =>
          page.evaluate(() => [...document.querySelectorAll("[data-dock] > [data-dock-target]")].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((e) => e.getAttribute("data-dock-target")));
        await page.goto(`${BASE}/`);
        await page.waitForSelector(READY);
        const en = await order();
        await ctx.addCookies([{ name: "nexus_locale", value: "he", url: BASE }]);
        await page.reload();
        await page.waitForSelector(READY);
        const he = await order();
        await ctx.addCookies([{ name: "nexus_locale", value: "en", url: BASE }]);
        await page.reload();
        await page.waitForSelector(READY);
        const moves = [];
        for (const target of ["ordered", "projects", "spending", "to_buy", "plus", "ordered", "to_buy"]) {
          const d = await page.evaluate(async (target) => {
            const dock = document.querySelector("[data-dock]");
            const top = [...document.querySelectorAll("[data-app-header]")].find((e) => e.offsetHeight > 0);
            const box = () => {
              const r = dock.getBoundingClientRect();
              const h = top.getBoundingClientRect();
              return [r.left, r.top, r.width, r.height, window.innerWidth, h.left, h.top, h.width, h.height];
            };
            const first = box();
            let max = 0;
            let on = true;
            const tick = () => {
              const b = box();
              max = Math.max(max, ...b.map((v, i) => Math.abs(v - first[i])));
              if (on) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            document.querySelector(`[data-dock-target="${target}"]`).click();
            await new Promise((r) => setTimeout(r, 900));
            if (target === "plus") {
              document.querySelector("[data-dock-target=plus]").click();
              await new Promise((r) => setTimeout(r, 600));
            }
            on = false;
            return max;
          }, target);
          if (d > 0.5) moves.push(`${target}: ${d.toFixed(1)} px`);
        }
        const want = ["to_buy", "ordered", "plus", "projects", "spending"];
        ok(JSON.stringify(en) === JSON.stringify(want) && JSON.stringify(he) === JSON.stringify(want) && !moves.length, "phone dock: fixed order in en + he, dock and top bar perfectly still while switching", JSON.stringify({ en, he, moves }));
      });
    }

    if (MOBILE) {
      // Round 8 C: the hero summarizes, the products are the page.
      // Round 10 B1: tap → first video frame → decoder ready, on a mid-phone profile (CPU ×4), first open and a reopen
      // within the minute (the stream is kept). Fake camera; permission granted.
      await step("camera opens fast: barcode viewfinder < 300 ms, decoder < 800 ms; receipt camera too", async () => {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const times = async () => page.evaluate(() => {
          const m = (n) => performance.getEntriesByName(n).at(-1)?.startTime;
          const tap = m("cam:tap");
          return { frame: Math.round(m("cam:frame") - tap), decoder: Math.round(Math.max(0, (m("scan:decoder") ?? tap) - tap)) };
        });
        const clear = () => page.evaluate(() => ["cam:tap", "cam:frame"].forEach((n) => performance.clearMarks(n)));
        const openBarcode = async () => {
          await clear();
          await page.click('[data-dock-target="plus"]');
          await page.click("[data-plus-action=barcode]");
          await page.waitForSelector('[data-barcode-scanner] video[data-cam-state="on"]', { timeout: 8000 });
          await page.waitForTimeout(900);
          const t = await times();
          await page.keyboard.press("Escape");
          await page.waitForSelector("[data-barcode-scanner]", { state: "detached", timeout: 5000 });
          return t;
        };
        const first = await openBarcode();
        const again = await openBarcode();
        await clear();
        await page.click('[data-dock-target="plus"]');
        await page.click("[data-plus-action=receipt]");
        await page.waitForFunction(() => performance.getEntriesByName("cam:frame").length > 0, null, { timeout: 8000 });
        const receipt = await times();
        await page.keyboard.press("Escape");
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await page.waitForTimeout(400);
        console.log(`INFO camera (CPU ×4): barcode first frame ${first.frame} ms, decoder ${first.decoder} ms; reopen frame ${again.frame} ms; receipt first frame ${receipt.frame} ms`);
        // Target 300 ms; the cold start of Chromium's fake camera alone varies 200–500 ms on a loaded machine, so the
        // cold open gets 400 ms here and the reopen (our part only) the full target.
        ok(first.frame < 400 && first.decoder < 800 && again.frame < 300 && receipt.frame < 300, "camera opens fast: barcode viewfinder < 300 ms, decoder < 800 ms; receipt camera too", JSON.stringify({ first, again, receipt }));
      });

      await step("phone home: totals legend + strip, first row of products above the fold, cards ↔ rows", async () => {
        await page.goto(`${BASE}/`);
        await page.waitForSelector(READY);
        await page.waitForSelector("[data-item-card]");
        const r = await page.evaluate(() => {
          const cards = [...(document.querySelector("[data-card-grid]")?.children ?? [])].slice(0, 2).map((e) => e.getBoundingClientRect());
          const dock = document.querySelector("[data-dock]")?.getBoundingClientRect().top ?? innerHeight;
          return {
            legend: !!document.querySelector("[data-totals-legend]") || !document.querySelector("[data-totals] .grow-x"),
            strip: document.querySelectorAll("[data-totals-strip] [data-totals-go]").length,
            row: cards.length === 2 && Math.abs(cards[0].top - cards[1].top) < 2,
            visible: cards.length > 0 && Math.max(...cards.map((c) => c.bottom)) <= dock,
            bottom: Math.round(Math.max(...cards.map((c) => c.bottom))),
            dock: Math.round(dock),
          };
        });
        await page.locator("[data-phone-layout-toggle] [role=radio]").nth(1).click();
        const rows = await page.locator("[data-app-shell][data-phone-layout=rows]").count();
        await page.locator("[data-phone-layout-toggle] [role=radio]").nth(0).click();
        ok(r.legend && r.strip === 3 && r.row && r.visible && rows === 1, "phone home: totals legend + strip, first row of products above the fold, cards ↔ rows", JSON.stringify({ ...r, rows }));
      });
    }

    if (MOBILE) {
      await step("receipt camera: shutter → corner adjust → add a part → use", async () => {
        await page.goto(`${BASE}/`);
        await page.waitForSelector(READY);
        await page.click("[data-plus]");
        await page.click("[data-plus-action=receipt]");
        const cam = page.locator("[data-receipt-camera]");
        await cam.waitFor({ timeout: 8000 });
        const shutter = cam.locator("[data-receipt-shutter]");
        await page.waitForFunction(() => !document.querySelector("[data-receipt-shutter]")?.hasAttribute("disabled"), null, { timeout: 15000 });
        await shutter.click();
        await cam.locator("[data-receipt-adjust]").waitFor({ timeout: 8000 });
        await page.waitForTimeout(600);
        await shot(page, "receipt-adjust");
        await cam.locator("[data-receipt-add-part]").click();
        await cam.locator("[data-receipt-parts='1']").waitFor({ timeout: 8000 });
        await page.waitForFunction(() => !document.querySelector("[data-receipt-shutter]")?.hasAttribute("disabled"), null, { timeout: 15000 });
        await shutter.click();
        await cam.locator("[data-receipt-adjust]").waitFor({ timeout: 8000 });
        await cam.locator("[data-receipt-use]").click();
        // Uploading needs a Blob store (absent locally): the receipt dialog opens and then reports the upload.
        await page.locator("[data-receipt-dialog]").waitFor({ timeout: 15000 });
        ok(true, "receipt camera: shutter → corner adjust → add a part → use");
        await page.keyboard.press("Escape");
      });
    }

    if (MOBILE) {
      await step("receipt camera on a receipt video: outline → auto-capture → adjust with loupe", async () => {
        const video = await receiptVideo();
        const b2 = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`] });
        try {
          const c2 = await b2.newContext({ viewport: VIEWPORT, ...DEVICE, colorScheme: "dark", permissions: ["camera"], storageState: await ctx.storageState() });
          const p2 = await c2.newPage();
          await p2.goto(`${BASE}/`);
          await p2.waitForSelector(READY, { timeout: 15000 });
          await p2.click("[data-plus]");
          await p2.click("[data-plus-action=receipt]");
          await p2.waitForSelector("[data-receipt-outline=on]", { state: "attached", timeout: 15000 });
          const guide = await p2.locator("[data-receipt-guide]").getAttribute("data-receipt-guide");
          await shot(p2, "receipt-live");
          // Nobody presses the shutter: steady + sharp captures by itself.
          await p2.waitForSelector("[data-receipt-adjust]", { timeout: 15000 });
          await p2.waitForTimeout(1500); // full-resolution re-detect
          await shot(p2, "receipt-auto");
          const bb = await p2.locator("[data-receipt-corner=topLeft]").boundingBox();
          await p2.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
          await p2.mouse.down();
          await p2.mouse.move(bb.x + bb.width / 2 + 24, bb.y + bb.height / 2 + 18, { steps: 4 });
          const loupe = await p2.locator("[data-receipt-loupe]").isVisible();
          await shot(p2, "receipt-loupe");
          await p2.mouse.up();
          ok(loupe, "receipt camera on a receipt video: outline → auto-capture → adjust with loupe", `guide=${guide} loupe=${loupe}`);
        } finally {
          await b2.close();
        }
      });
    }

    // Round 8 B2: nothing wider than the screen. Every view and sheet at 390 and 360 px: the layout viewport stays the
    // device width (no zoomed-out page), and no visible element's edge is past it (unless clipped by a scroll box that
    // itself fits).
    if (MOBILE) {
      await step("phone: no view or sheet is wider than the screen (360 + 390)", async () => {
        const items = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
        const anItem = items.find((i) => i.status === "to_buy") ?? items[0];
        const project = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.collections?.find((c) => c.kind !== "list") ?? null;
        const go = async (path) => {
          await page.goto(`${BASE}${path}`);
          await page.waitForSelector(READY, { timeout: 15000 });
        };
        const viaPalette = async (re) => {
          await go("/");
          await openPalette();
          await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: re }).first().click();
        };
        const screens = [
          ["to buy", () => go("/")],
          ["urgent", () => go("/?v=urgent")],
          ["on the way", () => go("/?v=ordered")],
          ["history", () => go("/?v=history")],
          ["spending", () => go("/?v=spending")],
          ["order by store", () => go("/?v=orders")],
          ["projects", () => go("/?v=projects")],
          ["project page", () => go(project ? `/?v=c:${project.id}` : "/?v=projects")],
          ["item sheet", async () => {
            await go(`/?item=${anItem.id}`);
            await page.getByRole("dialog").first().waitFor({ timeout: 8000 });
          }],
          ["shopping mode", async () => {
            await viaPalette(/Shopping mode|מצב קנייה/);
            await page.locator("[data-shop-scope=all]").click();
            await page.locator("[data-shop-add]").waitFor({ timeout: 8000 });
          }],
          ["assistant", async () => {
            await go("/");
            await page.locator("[data-ask]").filter({ visible: true }).first().click();
            await page.locator("[data-ai-new]").click(); // a fresh chat (the panel reopens recent conversations)
            await page.locator("[data-assistant]").waitFor({ timeout: 8000 });
          }],
          ["settings", async () => {
            await viaPalette(/Open settings|פתיחת ההגדרות|Settings/);
            await page.getByRole("dialog").first().waitFor({ timeout: 8000 });
          }],
          ["command menu", async () => {
            await go("/");
            await openPalette();
          }],
          ["me sheet", async () => {
            await go("/");
            await page.locator("[data-me-open]").click();
            await page.locator("[data-me]").waitFor({ timeout: 8000 });
          }],
          ["report form", async () => {
            await go("/");
            await openPalette();
            await page.locator("[data-cmd-report]").click();
            await page.locator("[data-report-form]").waitFor({ timeout: 8000 });
          }],
          ["reports", async () => {
            await go("/");
            await openPalette();
            await page.locator("[data-cmd-reports]").click();
            await page.locator("[data-reports]").waitFor({ timeout: 8000 });
          }],
        ];
        if (WRITE)
          screens.push(["receipt review", async () => {
            await go("/?v=history");
            await page.locator("[data-receipt-open=view]").click();
            const dlg = page.getByRole("dialog");
            await dlg.locator("#receipt-text").fill(`Store: Smoke store\nOrder: OVF-${Date.now()}\n1 x A rather long product name that could push things sideways on a phone @ 1234.5\n2 x Another line @ 12`);
            await dlg.getByRole("button", { name: /^(Read|קריאה)$/ }).click();
            await dlg.locator("[data-receipt-review]").waitFor({ timeout: 30000 });
          }]);
        // Measured against the device width, not innerWidth: on a phone, content wider than the screen widens the
        // layout viewport itself (innerWidth grows, the page is zoomed out) — exactly the bug this guards against.
        const measure = (vw) =>
          page.evaluate((vw) => {
            const sel = (el) => {
              const data = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}${a.value && a.value.length < 20 ? `=${a.value}` : ""}]`).slice(0, 2).join("");
              const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 4).map((c) => `.${c}`).join("") : "";
              return `${el.tagName.toLowerCase()}${data}${cls}`.slice(0, 120);
            };
            const bad = [];
            for (const el of document.querySelectorAll("body *")) {
              if (el.closest("[inert],[aria-hidden=true],[data-sonner-toaster],.sr-only")) continue;
              const cs = getComputedStyle(el);
              if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
              const r = el.getBoundingClientRect();
              if (r.width < 2 || r.height < 2) continue;
              if (r.right <= vw + 1 && r.left >= -1) continue;
              // Clipped by an ancestor scroll/overflow box that itself fits on screen → fine (e.g. a chip row).
              let clipped = false;
              for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
                const s = getComputedStyle(p);
                if (/(auto|scroll|hidden|clip)/.test(s.overflowX) || /(hidden|clip)/.test(s.overflow)) {
                  const pr = p.getBoundingClientRect();
                  if (pr.right <= vw + 1 && pr.left >= -1) {
                    clipped = true;
                    break;
                  }
                }
                if (getComputedStyle(p).visibility === "hidden" || Number(getComputedStyle(p).opacity) === 0) {
                  clipped = true;
                  break;
                }
              }
              if (clipped) continue;
              // Report the outermost offender only.
              if (bad.some((b) => b.el.contains(el))) continue;
              bad.push({ el, s: `${sel(el)} (${Math.round(r.left)}…${Math.round(r.right)})` });
            }
            return { scroll: Math.max(document.documentElement.scrollWidth, window.innerWidth), vw, bad: bad.slice(0, 6).map((b) => b.s) };
          }, vw);
        const fails = [];
        for (const width of [390, 360]) {
          await page.setViewportSize({ width, height: 844 });
          for (const [name, open] of screens) {
            try {
              await open();
              await page.waitForTimeout(700);
              const m = await measure(width);
              if (m.scroll > m.vw || m.bad.length) {
                fails.push(`${width}/${name}: scrollWidth ${m.scroll} > ${m.vw}? ${m.bad.join(" | ")}`);
                await shot(page, `overflow-${width}-${name.replace(/\s+/g, "-")}`);
              }
            } catch (e) {
              fails.push(`${width}/${name}: could not open (${String(e?.message || e).split("\n")[0].slice(0, 100)})`);
            }
            await page.keyboard.press("Escape");
          }
        }
        await page.setViewportSize(VIEWPORT);
        ok(!fails.length, "phone: no view or sheet is wider than the screen (360 + 390)", `\n    ${fails.join("\n    ")}`);
      });
    }

    if (process.env.SMOKE_PERF) {
      await step("motion: no long tasks > 50 ms during the main transitions (CPU ×4)", async () => {
        await page.goto(`${BASE}/`);
        await page.waitForSelector(READY);
        await page.waitForTimeout(1500);
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.evaluate(() => {
          window.__long = [];
          new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push({ name: window.__phase, ms: Math.round(e.duration) }))).observe({ type: "longtask", buffered: false });
        });
        const phase = async (name, fn) => {
          await page.evaluate((n) => (window.__phase = n), name);
          await fn();
          await page.waitForTimeout(900);
        };
        await phase("open item", () => page.locator("[data-item-card] > button").first().click());
        await phase("close item", () => page.keyboard.press("Escape"));
        await phase("view → on the way", () => page.locator(MOBILE ? "[data-dock] [data-carry='view:ordered']" : "aside [data-carry='view:ordered']").click());
        await phase("view → to buy", () => page.locator(MOBILE ? "[data-dock] [data-carry='view:to_buy']" : "aside [data-carry='view:to_buy']").click());
        if (MOBILE) {
          await phase("+ menu", () => page.click("[data-plus]"));
          await phase("+ menu close", () => page.click("[data-plus]"));
        } else await phase("sidebar collapse", () => page.click("[data-sidebar-toggle]"));
        const long = await page.evaluate(() => window.__long);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        if (!MOBILE) await page.click("[data-sidebar-toggle]");
        console.log(`INFO long tasks: ${long.length ? long.map((l) => `${l.name} ${l.ms}ms`).join(", ") : "none"}`);
        ok(long.length === 0, "motion: no long tasks > 50 ms during the main transitions (CPU ×4)", JSON.stringify(long));
      });
    }

    await step("projects screen: cards with covers, order projects → lists → start-new, New menu → project page with its header → Excel export", async () => {
      await page.goto(`${BASE}/?v=projects`);
      await page.waitForSelector("[data-projects-view]", { timeout: 15000 });
      const n = await page.locator("[data-project-card]").count();
      const covers = await page.locator("[data-project-card] [data-project-cover]").count();
      // Round 10 C1: Projects, then Lists, then the one "Start something new" card; the header's New pill has both.
      const add = await page.locator("[data-start-new] [data-start-new-item]").count() === 2 ? 1 : 0;
      const order = await page.evaluate(() => ["[data-projects-section]", "[data-lists-section]", "[data-start-new]"].map((q) => document.querySelector(q)?.getBoundingClientRect().top ?? -1));
      if (!(order[0] >= 0 && (order[1] < 0 || order[1] > order[0]) && order[2] > Math.max(order[0], order[1]))) throw new Error(`order ${order}`);
      // C2: summary chips; list cards smaller than project cards; cards in one section share one height.
      const shape = await page.evaluate(() => {
        const h = (q) => [...document.querySelectorAll(q)].map((e) => Math.round(e.getBoundingClientRect().height));
        return { summary: document.querySelectorAll("[data-projects-summary] > *").length, p: h("[data-projects-section] [data-project-card]"), l: h("[data-lists-section] [data-project-card]") };
      });
      const same = (a) => a.length < 2 || Math.max(...a) - Math.min(...a) <= 1;
      if (shape.summary !== 3 || !same(shape.p) || !same(shape.l) || (shape.l.length && shape.p.length && !(shape.l[0] < shape.p[0]))) throw new Error(`shape ${JSON.stringify(shape)}`);
      await page.locator("[data-projects-new]").click();
      const menu = await page.locator("[data-projects-new-item]").count();
      await page.keyboard.press("Escape");
      if (menu !== 2) throw new Error(`New menu has ${menu} items`);
      await shot(page, "projects");
      let header = 0;
      if (n) {
        await page.locator("[data-project-card] > button").first().click();
        // The cover morphs (View Transition): the page updates a frame later.
        await page.waitForSelector("[data-project-header]", { timeout: 10000 });
        header = await page.locator("[data-project-header] [data-project-cover]").count();
        // R9 F1: the project menu exports the project to Excel.
        await page.locator("[data-project-menu]").click();
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.locator("[data-project-export]").click()]);
        if (!/\.xlsx$/i.test(dl.suggestedFilename())) throw new Error(`export file: ${dl.suggestedFilename()}`);
        await openPalette();
        const cmd = await page.locator("[data-cmd-export]").count();
        await page.keyboard.press("Escape");
        if (cmd !== 1) throw new Error("no Export to Excel in the command menu");
      }
      ok(n > 0 && covers === n && add === 1 && header === 1 && /v=c%3A|v=c:/.test(page.url()), "projects screen: cards with covers, order projects → lists → start-new, New menu → project page with its header → Excel export", `cards=${n} covers=${covers} add=${add} header=${header} url=${page.url()}`);
      await page.goto(`${BASE}/`);
      await page.waitForSelector(READY, { timeout: 15000 });
    });

    // Round 10 A2: the cover morphs card → page and back with its rounded corners the whole way (the transition's
    // group clips with the same radius as both ends; read it every frame while the transition runs).
    await step("project cover morph: rounded corners the whole way, both directions", async () => {
      await page.goto(`${BASE}/?v=projects`);
      await page.waitForSelector("[data-project-card] [data-project-cover]", { timeout: 15000 });
      await page.waitForTimeout(900); // the cards' rise-in settles first (a click waits for a stable element)
      const name = await page.locator("[data-project-card] [data-project-cover]").first().evaluate((e) => getComputedStyle(e).viewTransitionName);
      const watch = () => page.evaluate((name) => {
        const seen = [];
        const t0 = performance.now();
        const tick = () => {
          const g = getComputedStyle(document.documentElement, `::view-transition-group(${name})`);
          if (g.width && g.width !== "auto" && g.width !== "0px") seen.push(g.borderTopLeftRadius);
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else window.__radii = seen;
        };
        requestAnimationFrame(tick);
      }, name);
      const radii = async () => { await page.waitForFunction(() => window.__radii, null, { timeout: 3000 }); const r = await page.evaluate(() => window.__radii); await page.evaluate(() => delete window.__radii); return r; };
      const back = MOBILE ? page.locator('[data-dock-target="projects"]') : page.locator("aside button", { hasText: /^(Projects|פרויקטים)$/ }).first();
      const go = async () => { await watch(); await page.locator("[data-project-card] > button").first().click(); await page.waitForSelector("[data-project-header]"); };
      const ret = async () => { await page.waitForTimeout(600); await watch(); await back.click(); await page.waitForSelector("[data-project-card]"); };
      let fwd, rev;
      if (TRACE) {
        await traceFrames(page, "trace-cover-open", go, 900); fwd = await radii();
        await traceFrames(page, "trace-cover-back", ret, 900); rev = await radii();
      } else {
        await go(); fwd = await radii();
        await ret(); rev = await radii();
      }
      const round = (r) => r.length > 0 && r.every((x) => x === r[0] && parseFloat(x) >= 20);
      ok(round(fwd) && round(rev), "project cover morph: rounded corners the whole way, both directions", `in: ${[...new Set(fwd)].join("/") || "no transition"}; back: ${[...new Set(rev)].join("/") || "no transition"}`);
      await page.goto(`${BASE}/`);
      await page.waitForSelector(READY, { timeout: 15000 });
    });

    await step("Esc opens command palette with quick settings", async () => {
      await openPalette();
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
        const btn = page.locator("[data-app-shell]:not([data-ready]) [data-ask]").filter({ visible: true }).first();
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
      const btn = page.locator("[data-ask]").filter({ visible: true }).first();
      if (!(await btn.count())) return ok(true, "assistant panel (AI off or not in this layout, skipped)");
      await btn.click();
      await page.getByRole("dialog").waitFor({ timeout: 5000 });
      ok(true, "assistant panel opens");
      await page.locator("[data-ai-new]").click(); // suggestions show on a fresh chat (recent conversations reopen)
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
          // Long grids mount in chunks: count once the number stops changing.
          const settled = async () => {
            let n = -1;
            for (let k = 0; k < 20; k++) {
              const m = await page.locator("main article").count();
              if (m === n) return m;
              n = m;
              await page.waitForTimeout(250);
            }
            return n;
          };
          const before = await settled();
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
          const after = await settled();
          ok(after === before + 1, "partial move splits the item", `${before} → ${after}`);
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
        await step("import VAT: a low limit shows the notice in Order by store", async () => {
          const setLimit = async (v) => {
            await page.goto(`${BASE}/`);
            await page.waitForSelector(READY);
            await openPalette();
            await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: /Open settings|פתיחת ההגדרות|Settings/ }).first().click();
            const f = page.locator("[data-import-limit]");
            await f.waitFor({ timeout: 8000 });
            await f.fill(String(v));
            await f.press("Enter");
            await page.waitForTimeout(800);
            await page.keyboard.press("Escape");
          };
          await setLimit(10);
          await page.goto(`${BASE}/?v=orders`);
          await page.waitForSelector("[data-orders-layout]", { timeout: 15000 });
          const n = await page.locator("[data-import-vat]").count();
          await shot(page, "import-vat");
          await setLimit(130);
          ok(n > 0, "import VAT: a low limit shows the notice in Order by store", `notices=${n}`);
        });
        // Needs NEXUS_AI_MOCK=1 without a search key: two mock offers, sorted by total.
        await step("compare stores: item sheet → results sorted by price", async () => {
          const items = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
          const target = items.find((i) => i.status === "to_buy" && i.id.startsWith("demo-"));
          if (!target) return ok(true, "compare stores (no demo item, skipped)");
          await page.goto(`${BASE}/?item=${target.id}`);
          await page.waitForSelector(READY);
          await page.locator("[data-compare-open]").click();
          await page.locator("[data-compare-row]").first().waitFor({ timeout: 20000 });
          const prices = await page.locator("[data-compare-row] .tabular.text-\\[17px\\]").allInnerTexts();
          await shot(page, "compare");
          ok(prices.length >= 2, "compare stores: item sheet → results sorted by price", JSON.stringify(prices));
          await page.keyboard.press("Escape");
        });
        // Needs NEXUS_AI_MOCK=1: the mock answer is streamed word by word through /api/ask.
        await step("assistant: streamed answer with lead line, mini cards, then follow-ups", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await page.locator("[data-ai-new]").click(); // a fresh chat (the panel reopens recent conversations)
          const dlg = page.getByRole("dialog");
          await dlg.locator("textarea").fill("How much is left to buy?");
          await dlg.locator("textarea").press("Enter");
          await dlg.locator("[data-ai-send=stop]").waitFor({ timeout: 8000 });
          await dlg.locator("[data-ai-lead]").waitFor({ timeout: 15000 });
          await dlg.locator("[data-ai-send=send]").waitFor({ timeout: 15000 });
          const refs = await dlg.locator("[data-ai-refs] button").count();
          await dlg.getByTestId("ai-followups").waitFor({ timeout: 5000 });
          await shot(page, "assistant-answer");
          ok(refs > 0, "assistant: streamed answer with lead line, mini cards, then follow-ups", `refs=${refs}`);
          await page.keyboard.press("Escape");
        });
        // Round 8 D2 (mock): a how-to question is routed to the help, answered with an action button that works.
        await step("assistant help: how-to question → help answer with a working action button + how-to follow-ups", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await page.locator("[data-ai-new]").click(); // a fresh chat (the panel reopens recent conversations)
          const dlg = page.getByRole("dialog");
          await dlg.locator("textarea").fill("How do I add a receipt?");
          await dlg.locator("textarea").press("Enter");
          const btn = dlg.locator("[data-ai-action=receipt]");
          await btn.waitFor({ timeout: 15000 });
          // R9 C4: after a help answer the follow-ups are how-to questions, not data questions.
          await dlg.getByTestId("ai-followups").waitFor({ timeout: 8000 });
          const follow = await dlg.getByTestId("ai-followups").locator("button").allInnerTexts();
          if (!follow.length || !follow.every((x) => /^(How|איך)/.test(x.trim()))) throw new Error(`follow-ups after help: ${JSON.stringify(follow)}`);
          await shot(page, "assistant-help");
          await btn.click();
          // Phones open the receipt camera, desktop the receipt dialog.
          await page.locator(MOBILE ? "[data-receipt-camera]" : "[data-receipt-dialog]").waitFor({ timeout: 8000 });
          ok(true, "assistant help: how-to question → help answer with a working action button + how-to follow-ups");
          await page.keyboard.press("Escape");
        });
        // Round 8 D3 (mock): a complaint gets a report card; sent, it shows up in Reports with its diagnostics.
        await step("report: 'this is broken' → report card → send → in Reports with diagnostics", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await page.locator("[data-ai-new]").click(); // a fresh chat (the panel reopens recent conversations)
          const dlg = page.getByRole("dialog");
          const marker = `Smoke report ${Date.now()}`;
          await dlg.locator("textarea").fill(`${marker}: the shopping mode is broken`);
          await dlg.locator("textarea").press("Enter");
          await dlg.locator("[data-ai-report-card=draft]").waitFor({ timeout: 15000 });
          await shot(page, "report-card");
          await dlg.locator("[data-ai-report-send]").click();
          await dlg.locator("[data-ai-report-card=sent]").waitFor({ timeout: 10000 });
          await page.keyboard.press("Escape");
          await openPalette();
          await page.locator("[data-cmd-reports]").click();
          const row = page.locator("[data-report-row]").first();
          await row.waitFor({ timeout: 10000 });
          await row.click();
          const detail = page.locator("[data-report-detail]");
          await detail.waitFor({ timeout: 5000 });
          const txt = await detail.innerText();
          await shot(page, "report-detail");
          await page.keyboard.press("Escape");
          // And the form from the command menu.
          await openPalette();
          await page.locator("[data-cmd-report]").click();
          const form = await page.locator("[data-report-form]").waitFor({ timeout: 5000 }).then(() => true, () => false);
          // R9 D1: one text box (+ expected for bugs), the automatic details listed, send.
          await page.locator("[data-report-included] summary").click();
          await page.locator("[data-report-text]").fill(`${marker} from the menu: the totals card shows zero after a reload`);
          await page.locator("[data-report-expected]").fill("The real total");
          await shot(page, "report-form");
          await page.locator("[data-report-send]").click();
          await page.locator("[data-sonner-toast]").filter({ hasText: /Report sent|הדיווח נשלח/ }).first().waitFor({ timeout: 10000 });
          ok(/View|Extension/.test(txt) && txt.includes(marker.slice(0, 12)) && form, "report: 'this is broken' → report card → send → in Reports with diagnostics", txt.slice(0, 160));
        });
        // Round 9 C1 (mock): one chat — Plan mode turns the next message into a plan card; add a line, then the rest.
        await step("assistant plan mode: description → plan card in the chat → add a line → add all", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await page.locator("[data-ai-new]").click(); // a fresh chat (the panel reopens recent conversations)
          const dlg = page.getByRole("dialog");
          await dlg.locator("[data-ai-mode-option=plan]").click();
          await dlg.locator("textarea").fill("A motorized camera slider on V-slot with an ESP32");
          await dlg.locator("textarea").press("Enter");
          const card = dlg.locator("[data-ai-plan]");
          await card.waitFor({ timeout: 20000 });
          // Add into an existing project (not a new one every run).
          await card.locator("[data-ai-plan-target]").selectOption({ index: 1 }).catch(() => {});
          const mode = await dlg.locator("[data-ai-mode]").getAttribute("data-ai-mode");
          await shot(page, "assistant-plan");
          await card.locator("[data-ai-plan-add]").first().click();
          await card.locator("[data-ai-plan-add]").first().filter({ hasText: /Added|נוסף/ }).waitFor({ timeout: 10000 });
          await card.locator("[data-ai-plan-all]").click();
          await page.waitForFunction(() => document.querySelector("[data-ai-plan-all]")?.hasAttribute("disabled"), null, { timeout: 10000 });
          ok(mode === "chat", "assistant plan mode: description → plan card in the chat → add a line → add all", `mode after=${mode}`);
          await page.keyboard.press("Escape");
        });
        // Round 9 C2 (mock): conversations are saved — reopening continues one, History finds, deletes (Undo), new chat.
        await step("assistant history: reopen continues, history search, delete + undo, new chat", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await page.locator("[data-ai-new]").click();
          const dlg = page.getByRole("dialog");
          const marker = `Zebra${Date.now() % 100000}`;
          await dlg.locator("textarea").fill(`How much is left to buy for ${marker}?`);
          await dlg.locator("textarea").press("Enter");
          await dlg.locator("[data-ai-send=send]").waitFor({ timeout: 15000 });
          await dlg.locator("[data-ai-title]").waitFor({ timeout: 10000 });
          await page.keyboard.press("Escape");
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          const reopened = await dlg.locator("[data-ai-user]").filter({ hasText: marker }).waitFor({ timeout: 8000 }).then(() => true, () => false);
          await dlg.locator("[data-ai-history-open]").click();
          await dlg.locator("[data-ai-history-search]").fill(marker);
          const row = dlg.locator("[data-ai-history-row]").first();
          await row.waitFor({ timeout: 8000 });
          await shot(page, "assistant-history");
          const rows = await dlg.locator("[data-ai-history-row]").count();
          await row.locator("[data-ai-history-delete]").click();
          await page.locator("[data-sonner-toast]").filter({ hasText: /deleted|נמחקה/ }).getByRole("button", { name: /Undo|ביטול/ }).click();
          await dlg.locator("[data-ai-history-search]").fill(`${marker} `);
          const back = await dlg.locator("[data-ai-history-row]").first().waitFor({ timeout: 8000 }).then(() => true, () => false);
          await dlg.locator("[data-ai-new]").click();
          const fresh = (await dlg.locator("[data-ai-user]").count()) === 0;
          ok(reopened && rows === 1 && back && fresh, "assistant history: reopen continues, history search, delete + undo, new chat", JSON.stringify({ reopened, rows, back, fresh }));
          await page.keyboard.press("Escape");
        });
        // Round 9 C3 (mock): a stated preference → "Remember?" chip → saved → listed in Settings with the profile.
        await step("assistant memory: preference → remember chip → in Settings with the profile", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await page.locator("[data-ai-new]").click();
          const dlg = page.getByRole("dialog");
          const marker = `Smoke${Date.now() % 100000}`;
          await dlg.locator("textarea").fill(`I always order ${marker} parts from AliExpress`);
          await dlg.locator("textarea").press("Enter");
          await dlg.locator("[data-ai-memory=ask]").waitFor({ timeout: 15000 });
          await dlg.locator("[data-ai-memory-save]").click();
          await dlg.locator("[data-ai-memory=saved]").waitFor({ timeout: 8000 });
          await page.keyboard.press("Escape");
          await openPalette();
          await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: /Open settings|פתיחת ההגדרות|Settings/ }).first().click();
          const note = page.locator("[data-memory-note]").filter({ hasText: marker });
          await note.waitFor({ timeout: 10000 });
          await note.scrollIntoViewIfNeeded();
          const profile = await page.locator("[data-memory-profile]").count();
          await shot(page, "memory-settings");
          await note.getByRole("button", { name: /Delete|מחיקה/ }).click();
          await note.waitFor({ state: "detached", timeout: 8000 });
          ok(profile === 1, "assistant memory: preference → remember chip → in Settings with the profile", `profile=${profile}`);
          await page.keyboard.press("Escape");
        });
        // Needs the server started with NEXUS_AI_MOCK=1 (the mock proposes "first two to-buy items → ordered").
        await step("assistant action: propose → apply → undo", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          const btn = page.locator("[data-ask]").filter({ visible: true }).first();
          if (!(await btn.count())) return ok(true, "assistant action (AI off or not in this layout, skipped)");
          await btn.click();
          await page.locator("[data-ai-new]").click();
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
        // Needs NEXUS_AI_MOCK=1 (lookups answer "Mock product" without the network). No camera in headless: type it.
        await step("barcode: type a code → found → add to list (with its barcode)", async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          if (MOBILE) {
            await page.click("[data-plus]");
            await page.click("[data-plus-action=barcode]");
          } else {
            await openPalette();
            await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: /Scan a barcode|סריקת ברקוד/ }).first().click();
          }
          const sc = page.locator("[data-barcode-scanner]");
          await sc.waitFor({ timeout: 8000 });
          if (!(await sc.locator("[data-barcode-input]").count())) await sc.locator("[data-barcode-type]").click();
          const code = "4006381333931";
          await sc.locator("[data-barcode-input]").fill(code);
          await sc.locator("[data-barcode-input]").press("Enter");
          const res = sc.locator("[data-barcode-result]");
          await res.waitFor({ timeout: 15000 });
          const kind = await res.getAttribute("data-barcode-result");
          if (kind === "found") {
            await sc.locator("[data-barcode-add]").click();
            await page.locator("[data-sonner-toast]").filter({ hasText: /Added to your list|נוסף לרשימה/ }).waitFor({ timeout: 10000 });
          }
          await shot(page, "barcode");
          await page.keyboard.press("Escape");
          const items = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
          const saved = items.find((i) => i.gtin === code);
          ok((kind === "found" || kind === "own") && !!saved, "barcode: type a code → found → add to list (with its barcode)", `result=${kind} saved=${!!saved}`);
        });
        await step("shopping mode: check → finish → undo; offline finish queues and syncs", async () => {
          const backup = async () => (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
          const openTrip = async () => {
            await page.goto(`${BASE}/`);
            await page.waitForSelector(READY);
            await openPalette();
            await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: /Shopping mode|מצב קנייה/ }).first().click();
            await page.locator("[data-shop-scope=all]").click();
            await page.locator("[data-shop-add]").waitFor({ timeout: 8000 });
          };
          await openTrip();
          const name = `Smoke shop ${Date.now()}`;
          await page.locator("[data-shop-add]").fill(name);
          await page.locator("[data-shop-add]").press("Enter");
          await page.locator("[data-shop-row=done]").filter({ hasText: name }).waitFor({ timeout: 10000 });
          const firstOpen = page.locator("[data-shop-row=open]").first();
          const otherTitle = (await firstOpen.innerText()).split("\n")[0].trim();
          await firstOpen.click();
          await page.waitForTimeout(400);
          const progress = await page.locator("[data-shop-progress]").innerText();
          await shot(page, "shopping");
          await page.locator("[data-shop-finish]").click();
          await page.locator("[data-shop-confirm]").click();
          const toastEl = page.locator("[data-sonner-toast]").filter({ hasText: /marked as bought|סומנו כנקנו/ });
          await toastEl.waitFor({ timeout: 15000 });
          const mid = (await backup()).find((i) => i.title === name)?.status;
          await toastEl.getByRole("button", { name: /^(Undo|ביטול)$/ }).click();
          await page.waitForTimeout(2500);
          const after = (await backup()).find((i) => i.title === name)?.status;
          const okOnline = /^2 /.test(progress) && mid === "purchased" && after === "to_buy";

          // Offline: the finish is queued on the device and sent once the connection is back.
          await openTrip();
          const off = `Smoke offline ${Date.now()}`;
          await page.locator("[data-shop-add]").fill(off);
          await page.locator("[data-shop-add]").press("Enter");
          await page.locator("[data-shop-row=done]").filter({ hasText: off }).waitFor({ timeout: 10000 });
          await ctx.setOffline(true);
          await page.locator("[data-shop-finish]").click();
          await page.locator("[data-shop-confirm]").click();
          await page.locator("[data-sonner-toast]").filter({ hasText: /sync when|יסונכרן/ }).waitFor({ timeout: 8000 });
          await ctx.setOffline(false);
          let synced = false;
          for (let k = 0; k < 20 && !synced; k++) {
            await page.waitForTimeout(500);
            synced = (await backup()).find((i) => i.title === off)?.status === "purchased";
          }
          ok(okOnline && synced, "shopping mode: check → finish → undo; offline finish queues and syncs", JSON.stringify({ progress, mid, after, synced, otherTitle }));
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
          // The unmatched line comes in as a new card; skip it (×) so only the two matches apply.
          await dlg.locator("[data-receipt-line=new] [data-receipt-ignore]").first().click();
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
            modes.join() === "match,match,new" && applied.length === 2 && applied.every((i) => i.status === "purchased" && i.purchasedPrice > 0) && left.length === 0 && restored,
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
        await p.waitForTimeout(1500); // long grids mount in chunks
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
        await p.waitForTimeout(1500);
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
      // Phones see the opening animation on every full load and reload (Round 10 A3), then it hands off; desktop never.
      const p = await ctx.newPage();
      await p.goto(`${BASE}/`, { waitUntil: "commit" });
      await p.waitForSelector("#boot", { state: "attached", timeout: 10000 });
      if (MOBILE) {
        const shown = await p.locator("#boot").isVisible();
        await p.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 10000 });
        ok(shown && (await p.locator(READY).isVisible()), "boot screen: shown on phone, hands off to the app");
        const again = [];
        for (let k = 0; k < 2; k++) {
          await p.reload({ waitUntil: "commit" });
          await p.waitForSelector("#boot", { state: "attached", timeout: 10000 });
          again.push(await p.locator("#boot").isVisible());
          await p.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 10000 });
        }
        // Our pull-to-refresh replaces Chrome's: pull down at the top → the Box mark → release → reload → boot again.
        const overscroll = await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
        const cdp = await ctx.newCDPSession(p);
        const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
        await p.evaluate(() => window.scrollTo(0, 0));
        await touch("touchStart", 200);
        for (let y = 210; y <= 420; y += 15) await touch("touchMove", y);
        const ind = await p.locator("[data-pull]").count();
        const nav = p.waitForEvent("framenavigated", { timeout: 5000 }).then(() => true, () => false);
        await touch("touchEnd");
        const reloaded = await nav;
        let bootAfterPull = false;
        if (reloaded) {
          await p.waitForSelector("#boot", { state: "attached", timeout: 10000 });
          bootAfterPull = await p.locator("#boot").isVisible();
        }
        ok(again.every(Boolean) && overscroll === "contain" && ind === 1 && reloaded && bootAfterPull, "boot screen: plays on every reload; pull-to-refresh shows the Box mark and reloads into it", `reloads=${again} overscroll=${overscroll} indicator=${ind} reloaded=${reloaded} boot=${bootAfterPull}`);
      } else {
        ok(!(await p.locator("#boot").isVisible()), "boot screen: never shown on desktop");
      }
      await p.close();
    });

    if (process.env.SMOKE_VISUAL) {
      await step("visual matrix", async () => {
        const dir = `${OUT || join(tmpdir(), "nexus-smoke")}/visual`;
        mkdirSync(dir, { recursive: true });
        const widths = MOBILE ? [360, 390] : [VIEWPORT.width];
        let n = 0;
        for (const palette of ["graphite", "plum"]) {
          for (const mode of ["light", "dark"]) {
            await ctx.addCookies([{ name: "nexus_palette", value: palette, url: BASE }]);
            await page.emulateMedia({ colorScheme: mode });
            await page.evaluate((m) => localStorage.setItem("theme", m), mode);
            for (const w of widths) {
              await page.setViewportSize({ width: w, height: VIEWPORT.height });
              await page.goto(`${BASE}${process.env.SMOKE_VISUAL}`);
              await page.waitForSelector(READY, { timeout: 15000 });
              await page.waitForSelector("#boot", { state: "hidden", timeout: 10000 }).catch(() => {});
              await page.mouse.move(1, 1);
              await page.waitForTimeout(900);
              await page.screenshot({ path: `${dir}/${palette}-${mode}-${w}.png`, fullPage: !!process.env.SMOKE_VISUAL_FULL });
              n++;
            }
          }
        }
        await page.setViewportSize(VIEWPORT);
        await page.emulateMedia({ colorScheme: "dark" });
        await page.evaluate(() => localStorage.setItem("theme", "system"));
        await ctx.addCookies([{ name: "nexus_palette", value: "graphite", url: BASE }]);
        ok(n > 0, "visual matrix", `${n} shots`);
        console.log(`INFO visual: ${n} shots → ${dir}`);
      });
    }

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
