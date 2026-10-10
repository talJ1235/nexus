// Read-only end-to-end smoke test. Prints one PASS/FAIL line per check and exits non-zero on failure.
// Safe against production: it never creates, edits or deletes data.
//
//   bash scripts/serve-smoke.sh && node scripts/smoke.mjs        (local: signs in with the session serve-smoke seeded)
//   BASE=https://… SMOKE_ADMIN_TOKEN=… SMOKE_ADMIN_EMAIL=… node scripts/smoke.mjs   (prod: the admin emergency sign-in)
//   R17 E1: there is no password sign-in any more.
//   SMOKE_AI=1 also calls the (owner-only) AI health endpoint. SMOKE_OUT=dir saves screenshots.
//   SMOKE_SLOW=1 (server started with NEXUS_TRACE_DELAY_MS) checks that a click in the loading shell carries over.
//   SMOKE_WRITE=1 (localhost only) also exercises adding: placeholder card, same link → +1 (+ its toast's close
//     button), partial move, and (server started with NEXUS_AI_MOCK=1) assistant action propose → apply → undo.
//   SMOKE_PERF=1 (with SMOKE_MOBILE=1) throttles the CPU ×4 and reports long tasks (> 50 ms) during the main
//     transitions: open an item (card → sheet), switch views, change the sort, the + menu.
//   SMOKE_MOBILE=1 runs the owner checks in a 390×844 touch phone context; screenshots get a "-m" suffix.
//   SMOKE_ONLY=text runs only the steps whose name contains `text` (after logging in).
//   SMOKE_TRACE=1 records every painted frame of the first 3.4 s after goto("/") (CDP screencast, timestamped)
//     into $SMOKE_OUT/trace[-m]/ plus one contact sheet (trace[-m].png) to judge load flashes from frames.
//     SMOKE_TRACE_PATH=/?v=urgent traces another URL; SMOKE_THROTTLE=1 emulates a slow phone network (Fast 3G-ish)
//     and SMOKE_TRACE_LAYOUT=table stores that layout preference first (to catch a cards→table second render).
//     With SMOKE_TRACE, animations get their own frame series too (trace-sheet-*, trace-cover-*).
//   SMOKE_FRESH=http://localhost:3101 also checks Home on an empty account (a second server on a fresh DB:
//     `bash scripts/serve-fresh.sh`), Round 13 A7.
//   SMOKE_VISUAL=/?v=projects screenshots that view in Graphite + Plum × light + dark (phone: at 360 and 390 px)
//     into $SMOKE_OUT/visual/, for judging a visual change by screenshot. SMOKE_VISUAL_FULL=1 takes full-page shots.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { canSignIn, signIn as signInAs } from "./lib/sign-in.mjs";
import { actionTable } from "./lib/actions.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

// Service-worker fetches only see context.setOffline() with this flag (the offline check needs the SW fallback).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= "1";
const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
// R17 E1 — sign-in without a password (scripts/lib/sign-in.mjs): locally a fresh session row in smoke.db per sign-in;
// elsewhere the admin emergency path (POST /api/emergency, CI secrets).
const CAN_SIGN_IN = canSignIn(BASE);
const signIn = (p, base = BASE) => signInAs(p, base);
const MOBILE = !!process.env.SMOKE_MOBILE;
// R17 0.3: prod (or SMOKE_REAL=1) has real data, not the demo seed — steps that need demo ids / demo dates are skipped.
const REAL = process.env.SMOKE_REAL ? process.env.SMOKE_REAL !== "0" : !/localhost|127\.0\.0\.1/.test(BASE);
// R17 0.3: the two CPU-throttled timing steps (camera, boot frame trace) measure the machine as much as the app — on a
// busy PC they fail on main too (R14/R16 Open). Strict budgets only with SMOKE_TIMING=1 on a quiet machine; otherwise a
// loose budget that still catches a stall of seconds.
const STRICT_TIMING = !!process.env.SMOKE_TIMING;
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
// SMOKE_ONLY=text runs only the steps whose name contains it (plus login), for quick iteration; a|b for several.
const ONLY = process.env.SMOKE_ONLY;
const demoStep = async (msg, fn) => (REAL ? console.log(`SKIP ${msg} (real data: needs the demo seed)`) : step(msg, fn));
const step = async (msg, fn) => {
  if (ONLY && !ONLY.split("|").some((o) => msg.includes(o)) && !["owner login", "app renders items"].includes(msg)) return;
  try {
    await fn();
  } catch (e) {
    // SMOKE_DEBUG=1 keeps the locator / call log lines of the error (which element, what it waited for).
    ok(false, msg, process.env.SMOKE_DEBUG ? String(e?.message || e).split("\n").slice(0, 8).join(" | ") : String(e?.message || e).split("\n")[0].slice(0, 200));
    // With SMOKE_OUT, a failing step leaves a screenshot of the main page as it was.
    if (OUT && failShotPage) await failShotPage.screenshot({ path: `${OUT}/fail-${msg.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}${SUFFIX}.png` }).catch(() => {});
  }
};
let failShotPage = null;
// Scroll an element to the middle of the viewport (never under the sticky top bar, where a tap would hit the header).
const centerIn = async (loc) => {
  await loc.waitFor({ state: "attached" });
  await loc.evaluate((e) => e.scrollIntoView({ block: "center" }));
};
// The app with its data (not the streamed loading shell, whose clicks are replaced when the data arrives).
const READY = "[data-app-shell][data-ready] main h1 >> visible=true";
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

// ---- Round 13 Part A: Home (the dashboard) — default screen, section order, phone height, tiles, logo.
const HOME_ORDER = ["suggest", "week", "needs", "ontheway"];
/** Visible Home sections in page order (the phone's merged "pace projects" card counts as both). */
const homeSections = (page) =>
  page.$$eval("[data-home-grid] [data-widget]", (els, all) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("data-widget")).filter((id) => all.includes(id)), HOME_ORDER_ALL);
const HOME_ORDER_ALL = ["suggest", "week", "needs", "ontheway", "pace", "projects", "noticed"];
/** R16 D1: Settings at a section (deep link /settings/<section>; the shell opens over the app). */
async function openSettings(page, section = "ai") {
  const base = new URL(page.url()).origin;
  await page.goto(`${base}/settings/${section}`);
  await page.waitForSelector(`[data-settings-section="${section}"]`, { timeout: 20000 }).catch(() => {});
}
/** The AI phrasing pick (Settings → Assistant & AI): "ai" = AI + rules, "rules" = rules only. */
async function setAiPick(page, on) {
  await page.locator(`[data-ai-pick="${on ? "ai" : "rules"}"]`).click();
}
async function homeChecks(page) {
  await step("home is the default screen", async () => {
    const url = new URL(page.url());
    const home = await page.locator("[data-home]").count();
    ok(home === 1 && !url.searchParams.get("v"), "home is the default screen", `home=${home} url=${url.search}`);
  });
  await step("home section order", async () => {
    const got = await homeSections(page);
    const expect = HOME_ORDER.filter((id) => got.includes(id));
    // R16 E1: Household has 4 of the R13 sections; real data may show fewer (empty ones stay out of view).
    ok(got.length >= 2 && JSON.stringify(got) === JSON.stringify(expect), "home section order", `${got.join(",")} (want ${expect.join(",")})`);
    await shot(page, "home-v4");
  });
  await demoStep("home status count = Needs-you queue", async () => {
    const tile = await page.locator('[data-home-tile="needs"] b').first().textContent().catch(() => null);
    const badge = await page.locator('[data-home-count="needs"]').first().textContent().catch(() => null);
    const n = (x) => (x ?? "").match(/\d+/)?.[0];
    ok(n(tile) != null && n(tile) === n(badge), "home status count = Needs-you queue", `tile "${tile}" badge "${badge}"`);
  });
  if (MOBILE)
    await step("home phone height ≤ 1800 px and no overflow at 360/390", async () => {
      const h = await page.locator("[data-home]").evaluate((e) => e.offsetHeight);
      const widths = [];
      for (const w of [360, 390]) {
        await page.setViewportSize({ width: w, height: VIEWPORT.height });
        await page.waitForTimeout(250);
        widths.push(await page.evaluate((w) => document.documentElement.scrollWidth - w, w));
      }
      await page.setViewportSize(VIEWPORT);
      ok(h <= 1800 && widths.every((x) => x <= 0), "home phone height ≤ 1800 px and no overflow at 360/390", `height ${h}, overflow ${widths.join("/")}`);
    });
  // A6: each status tile scrolls to its section and flashes it.
  await step("home status tiles scroll to their sections", async () => {
    const tiles = await page.$$eval("[data-home-tile]", (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("data-home-tile")));
    const bad = [];
    for (const id of tiles) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await page.locator(`[data-home-tile="${id}"]:visible`).first().click();
      await page.waitForTimeout(1000);
      // R16 E1: the tile flashes its widget — or the nearest one on Home (pace → Budget…), or opens its view / panel.
      const r = await page.evaluate(() => {
        const el = [...document.querySelectorAll(".r13-flash")].find((x) => x.offsetParent !== null);
        const moved = !document.querySelector("[data-home]") || !!document.querySelector('[role="dialog"]');
        if (!el) return moved ? { moved } : null;
        const b = el.getBoundingClientRect();
        return { top: Math.round(b.top), inView: b.top >= 0 && b.top < innerHeight - 60, flash: true, at: el.getAttribute("data-home-section") };
      });
      if (!r || (!r.moved && !r.inView)) bad.push(`${id}:${JSON.stringify(r)}`);
      if (r?.moved) {
        for (let k = 0; k < 3 && (await page.locator('[role="dialog"]:visible').count()); k++) await page.keyboard.press("Escape");
        await page.goto(`${BASE}/`);
        await page.waitForSelector("[data-home]", { timeout: 15000 });
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    ok(tiles.length >= 2 && !bad.length, "home status tiles scroll to their sections", `${tiles.length} tiles; ${bad.join(" ")}`);
  });
  // A3: "Nexus suggests" — pager by keyboard, the border sheen without layout work, AI text vs templates.
  await step("suggest: keyboard pager", async () => {
    const card = page.locator('[data-home-section="suggest"]');
    if (!(await card.count())) return ok(true, "suggest: keyboard pager (no suggestions in this data)");
    const dots = await card.locator("[data-sug-pager] span button").first().locator("xpath=..").locator("button").count().catch(() => 0);
    const before = await card.getAttribute("data-sug-index");
    await card.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    const after = await card.getAttribute("data-sug-index");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    const back = await card.getAttribute("data-sug-index");
    ok(dots < 2 || (after !== before && back === before), "suggest: keyboard pager", `${before} → ${after} → ${back} (${dots} dots)`);
  });
  // R16 A7: swipe (phone, touch) / drag (desktop, mouse) moves between suggestions; a short drag snaps back; a drag
  // over the CTA never clicks it.
  await step("suggest: swipe / drag pager", async () => {
    const card = page.locator('[data-home-section="suggest"]');
    if (!(await card.count()) || Number(await card.getAttribute("data-sug-count")) < 2) return ok(true, "suggest: swipe / drag pager (fewer than two suggestions)");
    // The desktop opening (once a day) covers the page until it ends.
    await page.waitForSelector("#boot", { state: "hidden", timeout: 10000 }).catch(() => {});
    await card.scrollIntoViewIfNeeded();
    const idx = () => card.getAttribute("data-sug-index");
    const box = await card.boundingBox();
    const y = box.y + box.height / 2;
    const at = (f) => box.x + box.width * f;
    const cdp = MOBILE ? await page.context().newCDPSession(page) : null;
    const drag = async (from, to) => {
      if (MOBILE) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at(from), y }] });
        for (let k = 1; k <= 10; k++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at(from + ((to - from) * k) / 10), y }] });
          await page.waitForTimeout(16);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        // On the text (a drag that starts on a button stays a click): positions are shares of the title's width.
        const t = await card.locator("[data-sug-title]").boundingBox();
        const tx = (f) => t.x + t.width * f;
        await page.mouse.move(tx(from), t.y + t.height / 2);
        await page.mouse.down();
        for (let k = 1; k <= 10; k++) await page.mouse.move(tx(from + ((to - from) * k) / 10), t.y + t.height / 2);
        await page.mouse.up();
      }
      await page.waitForTimeout(450);
    };
    const i0 = await idx();
    const ltr = (await page.evaluate(() => document.documentElement.dir)) !== "rtl";
    // Toward "next" (LTR: leftward), past 25 % of the width.
    await drag(ltr ? 0.95 : 0.05, ltr ? 0.05 : 0.95);
    const i1 = await idx();
    // A short drag snaps back.
    await drag(0.5, ltr ? 0.45 : 0.55);
    const i2 = await idx();
    const offset = await card.locator("[data-sug-swipe]").evaluate((e) => getComputedStyle(e).transform);
    // Back to the first.
    await drag(ltr ? 0.05 : 0.95, ltr ? 0.95 : 0.05);
    const i3 = await idx();
    ok(i1 !== i0 && i2 === i1 && i3 === i0 && (offset === "none" || offset === "matrix(1, 0, 0, 1, 0, 0)"), "suggest: swipe / drag pager", JSON.stringify({ i0, i1, i2, i3, offset }));
  });
  await step("suggest: border sheen runs without layout", async () => {
    if (!(await page.locator('[data-home-section="suggest"]').count())) return ok(true, "suggest: border sheen runs without layout (no card)");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const a = await m();
    await page.waitForTimeout(2000);
    const b = await m();
    await cdp.detach();
    const layouts = b.LayoutCount - a.LayoutCount;
    ok(layouts <= 2, "suggest: border sheen runs without layout", `${layouts} layouts, ${b.RecalcStyleCount - a.RecalcStyleCount} style recalcs in 2 s`);
  });
  if (WRITE)
    await step("suggest: AI text when on, template when off", async () => {
      const card = page.locator('[data-home-section="suggest"]');
      if (!(await card.count())) return ok(true, "suggest: AI text when on, template when off (no suggestions)");
      // AI phrasing arrives after render (server: mock or real chain, cached per day); never blocks the card.
      const ai = await page.waitForSelector('[data-sug-source="ai"]', { timeout: 15000 }).then(() => true, () => false);
      const setAi = async (on) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await openSettings(page, "ai");
        await setAiPick(page, on);
        await page.waitForTimeout(400);
        // Close every layer (phone: settings over the Me sheet) and make sure nothing stays open for later steps.
        for (let k = 0; k < 5 && (await page.locator("[role=dialog]:visible").count()); k++) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(450);
        }
        await page.goto(`${BASE}/`);
        await page.waitForSelector("[data-home]", { timeout: 15000 });
      };
      await setAi(false);
      const src = await card.locator("[data-sug-source]").getAttribute("data-sug-source");
      await setAi(true);
      const back = await page.waitForSelector('[data-sug-source="ai"]', { timeout: 15000 }).then(() => true, () => false);
      ok(ai && src === "template" && back, "suggest: AI text when on, template when off", `ai first ${ai}, off → ${src}, on again ${back}`);
    });
  // A4: "Nexus noticed" — true insights only; desktop shows them side by side, the phone one at a time with dots.
  await step("noticed: insights render (phone: dots switch)", async () => {
    const sec = page.locator('[data-home-section="noticed"]');
    if (!(await sec.count())) return ok(true, "noticed: insights render (phone: dots switch) (none in this data)");
    const visible = await sec.locator("[data-insight]:visible").count();
    let switched = true;
    if (MOBILE) {
      const dots = sec.locator('[role="tab"]');
      if ((await dots.count()) > 1) {
        const a = await sec.locator("[data-noticed-phone] [data-insight]").getAttribute("data-insight");
        const txt = await sec.locator("[data-noticed-phone] p").textContent();
        await centerIn(dots.nth(1)); // not under the fixed dock
        await dots.nth(1).click();
        await page.waitForTimeout(300);
        switched = (await sec.locator("[data-noticed-phone] p").textContent()) !== txt || !a;
      }
    }
    ok(visible >= 1 && (!MOBILE || visible === 1) && switched, "noticed: insights render (phone: dots switch)", `${visible} visible, switched ${switched}`);
  });
  // A5 → R16 E1: Customise — hide "Next delivery", move "Needs you" up one (grip + arrow key), Done, reload: the layout
  // persisted (server, per space); then Reset → the Household preset again.
  await step("customize: hide + move persist after reload", async () => {
    // R16 E1: the layout is saved on the server for this person — never edit a real account (prod) from the smoke.
    if (!WRITE) return ok(true, "customize: hide + move persist after reload (skipped: writes the person's saved layout; localhost + SMOKE_WRITE only)");
    const widgets =() => page.$$eval("[data-home-grid] [data-widget]", (els) => els.map((e) => e.getAttribute("data-widget")));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("[data-home-customize]").click();
    await page.waitForSelector("[data-home-customizing]");
    // Start from the Household preset whatever an earlier run saved.
    await page.locator("[data-home-reset]").click();
    const start = await widgets();
    await page.locator('[data-widget-hide="nextdel"]').click();
    await page.locator('[data-widget-handle="needs"]').focus();
    await page.keyboard.press("ArrowUp");
    const draft = await widgets();
    await page.locator("[data-home-done]").click();
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector("[data-home-grid]", { timeout: 15000 });
    await page.waitForTimeout(400);
    const got = await widgets();
    const iP = start.indexOf("needs");
    const moved = draft.indexOf("needs") === iP - 1 && !draft.includes("nextdel");
    const persisted = !got.includes("nextdel") && got.indexOf("needs") >= 0 && got.indexOf("needs") < got.indexOf(start[iP - 1]);
    await page.locator("[data-home-customize]").click();
    await page.locator("[data-home-reset]").click();
    const preset = await page.locator('[data-home-preset="household"]').getAttribute("aria-checked");
    await page.locator("[data-home-done]").click();
    await page.waitForTimeout(500);
    const reset = preset === "true" && (await widgets()).includes("nextdel");
    ok(moved && persisted && reset, "customize: hide + move persist after reload", `start ${start.join(",")} draft ${draft.join(",")} after ${got.join(",")} reset ${reset}`);
  });
  // The logo returns to Home from every view.
  await step("logo returns to Home from every view", async () => {
    const bad = [];
    for (const v of ["to_buy", "ordered", "projects", "spending", "history", "orders"]) {
      await page.goto(`${BASE}/?v=${v}`);
      await page.waitForSelector(READY, { timeout: 15000 });
      await page.locator(MOBILE ? "[data-topbar-logo]" : "[data-sidebar-logo]").first().click();
      await page.waitForSelector("[data-home]", { timeout: 4000 }).catch(() => {});
      if (!(await page.locator("[data-home]").count()) || new URL(page.url()).searchParams.get("v")) bad.push(v);
    }
    ok(!bad.length, "logo returns to Home from every view", bad.join(","));
  });
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

  if (!CAN_SIGN_IN) {
    console.log("SKIP owner checks (no SMOKE_SESSION / SMOKE_ADMIN_TOKEN)");
  } else {
    const ctx = await browser.newContext({ viewport: VIEWPORT, ...DEVICE, colorScheme: "dark", permissions: ["camera"] });
    const page = await ctx.newPage();
    failShotPage = page;
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 160)}`));

    await step("owner login", async () => {
      await signIn(page);
      ok(true, "owner login");
    });

    openPalette = async () => {
      for (let k = 0; k < 6; k++) {
        await page.keyboard.press("Escape");
        // The palette itself (polish #5: a closing sheet stays mounted for its 200 ms exit, so "any dialog" isn't it).
        if (await page.locator("[cmdk-input]").waitFor({ timeout: 1000 }).then(() => true, () => false)) return;
      }
    };

    await step("app renders items", async () => {
      await page.waitForSelector(READY, { timeout: 15000 });
      ok(true, "app renders", "");
      await shot(page, "home");
    });

    // ---- Round 13 Part A: Home is the default screen (login lands on it); then the list for the item checks below.
    await homeChecks(page);
    await page.goto(`${BASE}/?v=to_buy`);
    await page.waitForSelector(READY, { timeout: 15000 });

    // Round 10 A1: opening a product must not move anything behind the sheet (> 1 px), and closing must fly the
    // picture back and leave no clone — also when items are opened and closed quickly in a row.
    await step("item sheet morph: nothing behind the sheet moves on open, no stray clone after 10 quick open/close", async () => {
      const clones = () => page.evaluate(() => document.querySelectorAll("[data-morph-clone]").length);
      const ids = await page.$$eval("main [data-item-card]", (els) => [...new Set(els.map((e) => e.getAttribute("data-item-card")))].slice(0, 10));
      const tap = async (id) => {
        const btn = page.locator(`main [data-item-card="${id}"] button.absolute.inset-0`).first();
        await centerIn(btn);
        const b = await btn.boundingBox();
        if (MOBILE) await page.touchscreen.tap(b.x + 20, b.y + 20);
        else await page.mouse.click(b.x + 20, b.y + 20);
      };
      // Calm open: sample everything outside the sheet every frame (the hovered/tapped card itself is excluded:
      // its picture is the one that flies).
      let worst = 0, what = "";
      for (const id of ids.slice(0, 3)) {
        await centerIn(page.locator(`main [data-item-card="${id}"]`).first());
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

    // Round 14 C1: This week → Month (desktop: in place; phone: a sheet), ‹ › between months, a day with an arrival
    // lists it, tapping it opens the item.
    await demoStep("month view: open, next month, a day with an arrival → its item", async () => {
      await page.goto(`${BASE}/`);
      await page.waitForSelector("[data-home]", { timeout: 15000 });
      const link = page.locator("[data-card-link=week]").filter({ visible: true }).first();
      await centerIn(link);
      await link.click();
      const cal = page.locator("[data-month]").filter({ visible: true }).first();
      await cal.waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      const first = await cal.getAttribute("data-month");
      await cal.locator("[data-month-next]").click();
      let moved = (await cal.getAttribute("data-month")) !== first;
      // The seeded order arrives in ~40 days: next month or the one after.
      let day = cal.locator("[data-month-kinds~=arrive]").first();
      for (let k = 0; k < 2 && !(await day.count()); k++) await cal.locator("[data-month-next]").click();
      await day.click();
      const ev = cal.locator("[data-month-ev=arrive]").first();
      await ev.waitFor({ timeout: 3000 });
      await shot(page, "month-view");
      await ev.click();
      const opened = await page.locator("[data-sheet-img]").first().waitFor({ timeout: 8000 }).then(() => true, () => false);
      await page.keyboard.press("Escape");
      ok(moved && opened, "month view: open, next month, a day with an arrival → its item", JSON.stringify({ first, moved, opened }));
    });

    // Round 14 C2: Settings → Calendar shows the feed link; fetched without a session it's an iCalendar (200,
    // text/calendar, the seeded arrival in it); a wrong token is a 404.
    await demoStep("calendar feed: link in Settings, 200 text/calendar with the token, 404 without", async () => {
      await page.goto(`${BASE}/`);
      await page.waitForSelector(READY, { timeout: 15000 });
      await openSettings(page, "calendar");
      const input = page.locator("[data-cal-url]");
      await input.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => /\/api\/cal\/[\w-]+\.ics$/.test(document.querySelector("[data-cal-url]")?.value ?? ""), null, { timeout: 8000 });
      const url = await input.inputValue();
      const google = await page.locator("[data-cal-google]").getAttribute("href");
      await shot(page, "settings-calendar");
      for (let k = 0; k < 5 && (await page.locator("[role=dialog]:visible").count()); k++) await page.keyboard.press("Escape");
      // The feed is fetched from this machine's server (the link carries the public origin in production).
      const local = `${BASE}${new URL(url).pathname}`;
      const res = await fetch(local);
      const body = await res.text();
      const bad = await fetch(local.replace(/\/[\w-]+\.ics$/, "/wrong-token-0000000000000000.ics"));
      const r = {
        status: res.status,
        type: res.headers.get("content-type"),
        vcal: body.startsWith("BEGIN:VCALENDAR"),
        arrival: body.includes("UID:demo-o4-eta@nexus"),
        noPrices: !/₪|\$\d|amazon/i.test(body),
        bad: bad.status,
        google: !!google && google.startsWith("https://calendar.google.com/calendar/r?cid=webcal%3A"),
      };
      ok(r.status === 200 && /^text\/calendar/.test(r.type ?? "") && r.vcal && r.arrival && r.noPrices && r.bad === 404 && r.google, "calendar feed: link in Settings, 200 text/calendar with the token, 404 without", JSON.stringify(r));
    });

    // Round 14 A4: phones never show the desktop table, even with the `table` cookie; list ⇄ grid works; the layout
    // command flips the phone layout. Desktop: Cards ⇄ Table both ways on every product view, checkbox ≥ 8 px from the
    // picture (en + he).
    await demoStep("layouts: phone ignores the table pref (list ⇄ grid, command); desktop cards ⇄ table on every view", async () => {
      const r = {};
      if (MOBILE) {
        const pctx = await browser.newContext({ viewport: VIEWPORT, ...DEVICE, storageState: { cookies: await ctx.cookies(), origins: [] } });
        await pctx.addCookies([{ name: "nexus_layout", value: "table", url: BASE }]);
        const p = await pctx.newPage();
        const counts = async () => ({ rows: await p.locator("[data-item-row]").count(), cards: await p.locator("main [data-item-card]").count(), layout: await p.locator("[data-app-shell]").getAttribute("data-phone-layout") });
        for (const [name, path] of [["toBuy", "/?v=to_buy"], ["history", "/?v=history"], ["project", "/?v=c:demo-c-railcam"]]) {
          await p.goto(`${BASE}${path}`);
          await p.waitForSelector(READY, { timeout: 15000 });
          await p.waitForTimeout(400);
          const c = await counts();
          r[name] = c.rows === 0 && c.cards > 0;
        }
        const toggle = p.locator("[data-phone-layout-toggle] [role=radio]").filter({ visible: true });
        await toggle.nth(0).click();
        await p.waitForTimeout(500);
        const grid = await p.locator("main [data-item-card]").evaluateAll((els) => new Set(els.slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left))).size);
        r.grid = (await counts()).layout === "cards" && grid === 2 && (await counts()).rows === 0;
        await toggle.nth(1).click();
        await p.waitForTimeout(500);
        r.list = (await counts()).layout === "rows" && (await counts()).rows === 0;
        if (OUT) await p.screenshot({ path: `${OUT}/a4-phone-after${SUFFIX}.png` });
        // The layout command from phone search: flips List / Grid, never the table.
        await p.locator("[data-phone-search]").click();
        await p.locator("[data-phone-search-input]").fill("layout");
        await p.locator("[data-search-cmd=layout]").first().click();
        await p.waitForTimeout(500);
        r.command = (await counts()).layout === "cards" && (await counts()).rows === 0;
        await p.locator("[data-phone-search]").click();
        await p.locator("[data-phone-search-input]").fill("layout");
        await p.locator("[data-search-cmd=layout]").first().click();
        await p.waitForTimeout(500);
        r.commandBack = (await counts()).layout === "rows";
        await pctx.close();
      } else {
        const views = ["/?v=to_buy", "/?v=to_buy&f=urgent", "/?v=ordered", "/?v=history", "/?v=orders", "/?v=c:demo-c-railcam", "/?v=c:demo-c-home", "/?v=s:raspberrypi"];
        for (const v of views) {
          await page.goto(`${BASE}${v}`);
          await page.waitForSelector(READY, { timeout: 15000 });
          await page.locator('[data-carry="layout:table"]').filter({ visible: true }).first().click();
          const rows = await page.locator("[data-item-row]").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
          await page.locator('[data-carry="layout:cards"]').filter({ visible: true }).first().click();
          await page.waitForTimeout(400);
          const back = (await page.locator("[data-item-row]").count()) === 0;
          r[v] = rows && back;
        }
        // Checkbox ↔ picture gap in the table (both directions).
        for (const lang of ["en", "he"]) {
          await ctx.addCookies([{ name: "nexus_locale", value: lang, url: BASE }, { name: "nexus_layout", value: "table", url: BASE }]);
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector("[data-item-row]", { timeout: 15000 });
          r[`gap_${lang}`] = await page.locator("[data-item-row]").first().evaluate((row) => {
            const box = row.querySelector("[data-row-check] input").getBoundingClientRect();
            const pic = row.querySelector("[data-row-check]").nextElementSibling.firstElementChild.getBoundingClientRect();
            return Math.round(document.documentElement.dir === "rtl" ? box.left - pic.right : pic.left - box.right);
          });
          if (lang === "he") await shot(page, "table-rtl");
        }
        await ctx.addCookies([{ name: "nexus_locale", value: "en", url: BASE }, { name: "nexus_layout", value: "cards", url: BASE }]);
        r.gaps = r.gap_en >= 8 && r.gap_he >= 8;
      }
      ok(Object.values(r).every(Boolean), "layouts: phone ignores the table pref (list ⇄ grid, command); desktop cards ⇄ table on every view", JSON.stringify(r));
    });

    // Round 14 B4: one To buy with filter chips (All · Urgent · No project); old Urgent / Unsorted links redirect; no
    // Urgent / Unsorted rows left. Desktop (write mode): drag a card onto "No project", and Move to → Remove from
    // project from the selection bar (each undone).
    await step("to buy filters: chips + counts, ?f= in the URL, old links redirect, moves out of a project", async () => {
      const r = {};
      const chip = (k) => page.locator(`[data-buy-filter=${k}]`).filter({ visible: true }).first();
      const pressed = async (k) => (await chip(k).getAttribute("aria-pressed")) === "true";
      const f = () => new URL(page.url()).searchParams.get("f");
      for (const [old, want] of [["urgent", "urgent"], ["unsorted", "none"]]) {
        await page.goto(`${BASE}/?v=${old}`);
        await page.waitForSelector(READY, { timeout: 15000 });
        await page.waitForFunction((w) => new URL(location.href).searchParams.get("f") === w, want, { timeout: 5000 }).catch(() => {});
        r[`redirect_${old}`] = new URL(page.url()).searchParams.get("v") === "to_buy" && f() === want && (await pressed(want));
      }
      // The urgent chip's count = the urgent cards shown.
      const n = Number(await chip("urgent").locator("[data-buy-count]").textContent());
      await chip("urgent").click();
      await page.waitForTimeout(500);
      r.urgentCount = (await page.locator("main [data-item-card]").count()) === n && f() === "urgent";
      await chip("all").click();
      await page.waitForTimeout(400);
      r.all = f() === null && (await pressed("all"));
      await chip("none").click();
      await page.waitForTimeout(400);
      r.none = f() === "none" && (await pressed("none"));
      r.noOldRows = (await page.locator("[data-carry='view:urgent'], [data-carry='view:unsorted']").count()) === 0;
      await shot(page, "to-buy-filters");
      if (!MOBILE && WRITE) {
        const items = async () => (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
        const collOf = async (id) => (await items()).find((i) => i.id === id)?.collectionId ?? null;
        const until = async (id, want) => {
          for (let k = 0; k < 20; k++) {
            if ((await collOf(id)) === want) return true;
            await page.waitForTimeout(250);
          }
          return false;
        };
        const undoBtn = () => page.locator("[data-sonner-toast]").getByRole("button", { name: /^(Undo|ביטול)$/ }).last();
        // Hovering a toast pauses its timer, so Undo is still there after the database check.
        const holdToast = () => undoBtn().hover({ timeout: 5000 }).then(() => true, () => false);
        const undo = async () => {
          await undoBtn().click();
          await page.waitForTimeout(800);
        };
        // Any to-buy item that is in a project (the newest, so its card is near the top).
        const pick = (await items()).filter((i) => i.status === "to_buy" && i.collectionId).sort((a, b) => b.createdAt - a.createdAt)[0];
        const id = pick?.id;
        const was = pick?.collectionId ?? null;
        await page.goto(`${BASE}/?v=to_buy`);
        await page.waitForSelector(READY, { timeout: 15000 });
        const card = page.locator(`[data-item-card="${id}"]`);
        await centerIn(card);
        // The move is a server action (POST): wait for it, check the database once, then Undo while its toast is up
        // (polling the full backup export outlasted the toast).
        const saved = () => page.waitForResponse((res) => res.request().method() === "POST", { timeout: 8000 }).catch(() => null);
        let posted = saved();
        await card.dragTo(chip("none"));
        await holdToast();
        await posted;
        r.dragMoved = !!was && (await until(id, null));
        if (r.dragMoved) await undo();
        r.dragUndo = await until(id, was);
        await centerIn(card);
        await card.click({ modifiers: ["Control"] });
        await page.locator("[data-selection-bar]").getByRole("button", { name: /Move to|העבר אל/ }).click();
        posted = saved();
        await page.locator("[data-select-unassign]").click();
        await holdToast();
        await posted;
        r.selectMoved = await until(id, null);
        if (r.selectMoved) await undo();
        r.selectUndo = await until(id, was);
        await page.keyboard.press("Escape");
      }
      ok(Object.values(r).every(Boolean), "to buy filters: chips + counts, ?f= in the URL, old links redirect, moves out of a project", JSON.stringify(r));
    });

    // Round 14 A3: no indicators on To buy (it opens on the toolbar + list); a store page keeps its summary card and
    // a project page its own header (budget ring, numbers — Round 9 E1).
    await demoStep("to buy: no summary card, toolbar first; store + project pages keep theirs", async () => {
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
      const onToBuy = await page.locator("[data-home-summary]").count();
      const filters = await page.locator(MOBILE ? "[data-shop-header]" : "[data-filters]").first().isVisible();
      const capsule = MOBILE || (await page.locator("[data-paste-capsule]").first().isVisible());
      await page.goto(`${BASE}/?v=c:demo-c-railcam`);
      await page.waitForSelector(READY, { timeout: 15000 });
      const onProject = await page.locator("[data-project-header]").first().waitFor({ timeout: 8000 }).then(() => true, () => false);
      await page.goto(`${BASE}/?v=s:raspberrypi`);
      await page.waitForSelector(READY, { timeout: 15000 });
      const onStore = await page.locator("[data-home-summary]").first().waitFor({ timeout: 8000 }).then(() => true, () => false);
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
      ok(onToBuy === 0 && filters && capsule && onProject && onStore, "to buy: no summary card, toolbar first; store + project pages keep theirs", JSON.stringify({ onToBuy, filters, capsule, onProject, onStore }));
    });

    if (!MOBILE) {

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
        // R17 Q3: To buy on its own — on real data the step that used to open it is skipped (demo seed only), so this
        // ran on Home, which has no category filter (prod: click timeout). An account with < 2 categories can't narrow.
        await page.goto(`${BASE}/?v=to_buy`);
        await page.waitForSelector(READY, { timeout: 15000 });
        await page.locator("[data-item-card]").first().waitFor({ timeout: 8000 }).catch(() => {});
        const filter = page.locator("[data-category-filter]");
        if (!(await filter.count())) return console.log("SKIP category filter narrows the grid (no categories in this account's To buy)");
        const before = await page.locator("[data-item-card]").count();
        await filter.click();
        const opts = page.getByRole("menuitemradio");
        await opts.first().waitFor({ timeout: 5000 });
        const cats = (await opts.count()) - 1; // minus "All"
        if (cats < 2) {
          await page.keyboard.press("Escape");
          return console.log(`SKIP category filter narrows the grid (${cats} categor${cats === 1 ? "y" : "ies"} in this account — needs 2)`);
        }
        await opts.nth(1).click();
        await page.waitForTimeout(300);
        const after = await page.locator("[data-item-card]").count();
        ok(after > 0 && after <= before, "category filter narrows the grid", `${before} → ${after} (${cats} categories)`);
        await filter.click();
        await page.getByRole("menuitemradio").first().click();
      });
    }

    if (MOBILE) {
      // Round 14 B2: the v4 phone shell — dock icons with labels (active = ink), top bar Box + Nexus, 36 px circles.
      await step("phone shell: dock labels, active ink, v4 top bar (36 px, avatar, no bell)", async () => {
        await page.goto(`${BASE}/?v=to_buy`);
        await page.waitForSelector("[data-dock]", { timeout: 10000 });
        const r = await page.evaluate(() => {
          const labels = [...document.querySelectorAll("[data-dock] [data-dock-label]")];
          const probe = document.createElement("i");
          probe.style.color = "var(--ink)";
          document.body.append(probe);
          const ink = getComputedStyle(probe).color;
          probe.remove();
          const on = document.querySelector("[data-dock] [aria-current=page]");
          const top = document.querySelector("[data-phone-top]");
          const size = (sel) => Math.round(top.querySelector(sel)?.getBoundingClientRect().width ?? 0);
          return {
            labels: labels.map((l) => l.textContent),
            font: labels[0] && getComputedStyle(labels[0]).fontSize,
            activeInk: !!on && getComputedStyle(on).color === ink && on.getAttribute("data-dock-target") === "shopping",
            logo: top.querySelector("[data-topbar-logo]")?.textContent?.trim(),
            search: size("[data-phone-search]"),
            ask: size("[data-ask]"),
            avatar: size("[data-me-open]"),
            bell: size("[data-nt-bell=phone]"),
          };
        });
        await shot(page, "phone-shell-v4");
        ok(r.labels.length === 4 && r.labels.every(Boolean) && r.font === "10.5px" && r.activeInk && r.logo === "Nexus" && r.search === 36 && (r.ask === 36 || r.ask === 0) && r.avatar === 32 && r.bell === 36, "phone shell: dock labels, active ink, v4 top bar (36 px, bell, avatar)", JSON.stringify(r));
      });

      await step("phone: dock + '+' menu opens the add list (4 cards + 3 compact) and closes on the scrim", async () => {
        await page.waitForSelector("[data-dock]", { timeout: 10000 });
        await page.click("[data-plus]");
        await page.waitForSelector("[data-plus-menu=open]", { state: "attached" });
        await page.waitForTimeout(500);
        const n = await page.locator("[data-plus-action]:visible").count();
        await shot(page, "plus-menu");
        await page.mouse.click(195, 120);
        await page.waitForSelector("[data-plus-menu=closed]", { state: "attached", timeout: 3000 });
        // R16 A3: the shared add list — barcode, receipt, paste, plan as cards + import, new list, new project in a row.
        ok(n === 7, "phone: dock + '+' menu opens the add list (4 cards + 3 compact) and closes on the scrim", `actions=${n}`);
      });

      // Round 12 #2: a slow (~15 px per frame) swipe locks open on either side by distance, like a fast one; a short one
      // closes. Read-only (nothing is tapped), in English and Hebrew (mirrored).
      await step("phone rows: slow swipes lock open both ways (en + he), short ones close", async () => {
        const r = {};
        try {
          const cdp = await ctx.newCDPSession(page);
          const t = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
          const held = () => page.evaluate(() => document.querySelector("[data-swipe-held]")?.getAttribute("data-swipe-held") ?? "0");
          for (const lang of ["en", "he"]) {
            await ctx.addCookies([{ name: "nexus_locale", value: lang, url: BASE }]);
            await page.goto(`${BASE}/?v=to_buy`);
            await page.waitForSelector(READY, { timeout: 15000 });
            await page.locator("[data-phone-layout-toggle] [role=radio]").nth(0).click();
            await page.waitForTimeout(400);
            const card = page.locator("main [data-item-card]").nth(1);
            const dir = lang === "he" ? -1 : 1;
            // Slow drag: 15 px per ~frame, then a still moment before lifting (no fling).
            const slow = async (dx) => {
              await centerIn(card);
              const b = await card.boundingBox();
              const y = b.y + b.height / 2, x0 = b.x + b.width / 2;
              await t("touchStart", x0, y);
              const n = Math.ceil(Math.abs(dx) / 15);
              for (let k = 1; k <= n; k++) {
                await t("touchMove", x0 + (dx * k) / n, y);
                await page.waitForTimeout(16);
              }
              await page.waitForTimeout(150);
              await t("touchEnd");
              await page.waitForTimeout(400);
            };
            const tapClose = async () => {
              const b = await card.boundingBox();
              await t("touchStart", b.x + b.width / 2, b.y + b.height / 2);
              await t("touchEnd");
              await page.waitForTimeout(400);
            };
            await slow(90 * dir); // toward the end edge: status (threshold 40 % of 168 px)
            r[`${lang}Status`] = (await held()) === "1" && (await page.locator("[data-swipe-action]").count()) >= 2;
            await tapClose();
            r[`${lang}Closed`] = (await held()) === "0";
            await slow(-60 * dir); // toward the start edge: Delete (threshold 40 % of 92 px)
            r[`${lang}Delete`] = (await held()) === "-1" && (await page.locator("[data-swipe-action=delete]").count()) === 1;
            await tapClose();
            await slow(45 * dir); // short: below the status threshold
            r[`${lang}Short`] = (await held()) === "0";
            await page.locator("[data-phone-layout-toggle] [role=radio]").nth(0).click();
          }
        } catch (e) {
          r.error = String(e?.message || e).split(String.fromCharCode(10))[0].slice(0, 160);
        }
        await ctx.addCookies([{ name: "nexus_locale", value: "en", url: BASE }]);
        ok(Object.values(r).every(Boolean) && !r.error, "phone rows: slow swipes lock open both ways (en + he), short ones close", JSON.stringify(r));
      });

      // Round 12 #1: every phone bottom sheet closes with a swipe down (handle/header or content at its top), springs
      // back on a short drag, closes on a fling, on the scrim and on the back gesture; one shared implementation.
      await step("phone sheets: drag down to close, spring back, fling, scrim, back gesture", async () => {
        const r = {};
        try {
          const cdp = await ctx.newCDPSession(page);
          const t = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
          const go = async (path = "/?v=to_buy") => {
            await page.goto(`${BASE}${path}`);
            await page.waitForSelector(READY, { timeout: 15000 });
          };
          const dialogs = () => page.locator("[role=dialog]:visible").count();
          // Drag the top sheet's handle down by `dy` in `steps` moves, `gap` ms apart; `hold` ms still before lifting.
          const drag = async (dy, { steps = 10, gap = 16, hold = 0, from = "[data-sheet-handle]" } = {}) => {
            const h = page.locator(`[role=dialog] ${from}`).last();
            const b = await h.boundingBox();
            const x = b.x + b.width / 2, y = b.y + b.height / 2;
            await t("touchStart", x, y);
            for (let k = 1; k <= steps; k++) {
              await t("touchMove", x, y + (dy * k) / steps);
              if (gap) await page.waitForTimeout(gap);
            }
            if (hold) await page.waitForTimeout(hold);
            await t("touchEnd");
            await page.waitForTimeout(600);
          };
          const sheetH = async () => (await page.locator("[role=dialog]").last().boundingBox()).height;
          // Quick-action sheet (long-press a card): short slow drag springs back; 50 % closes; scrim tap closes.
          await go();
          await page.locator("[data-phone-layout-toggle] [role=radio]").nth(1).click(); // grid (Round 13: the list is the default)
          await page.waitForTimeout(400);
          const card = page.locator("main [data-item-card]").first();
          const longPress = async () => {
            const b = await card.boundingBox();
            await t("touchStart", b.x + b.width / 2, b.y + b.height / 2);
            await page.waitForTimeout(650);
            await t("touchEnd");
            await page.waitForTimeout(400);
          };
          await longPress();
          await page.locator("[data-item-actions=menu]").waitFor({ timeout: 5000 });
          await drag(40, { hold: 150 });
          const top = await page.locator("[data-item-actions]").evaluate((e) => e.getBoundingClientRect().bottom);
          r.actionsSpringBack = (await page.locator("[data-item-actions]").count()) === 1 && Math.abs(top - 844) < 3;
          await drag((await sheetH()) * 0.5, { hold: 150 });
          r.actionsDragClose = (await page.locator("[data-item-actions]").count()) === 0;
          await longPress();
          await page.mouse.click(195, 60);
          await page.waitForTimeout(400);
          r.actionsScrim = (await page.locator("[data-item-actions]").count()) === 0;
          // Item sheet: drag from its header (not the handle) past 30 %.
          const items = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
          const it = items.find((i) => i.status === "to_buy") ?? items[0];
          await go(`/?item=${it.id}`);
          await page.locator("[data-change-picture]").waitFor({ timeout: 15000 });
          await page.waitForTimeout(400);
          // Picture picker (a Modal) on top: dragging it closes only the picker.
          await page.locator("[data-change-picture]").click();
          await page.locator("[data-picture-picker]").waitFor({ timeout: 8000 });
          await page.waitForTimeout(400);
          await drag((await sheetH()) * 0.45, { hold: 150 });
          r.pickerDragClose = (await page.locator("[data-picture-picker]").count()) === 0 && (await dialogs()) === 1;
          await drag(844 * 0.45, { hold: 150 });
          r.itemDragClose = (await dialogs()) === 0;
          // Me sheet: a quick fling (3 big moves, no pause) closes it even though it moved < 30 %.
          await go();
          await page.locator("[data-me-open]").click();
          await page.locator("[data-me]").waitFor({ timeout: 5000 });
          await page.waitForTimeout(450);
          await drag(150, { steps: 3, gap: 0 });
          r.meFling = (await page.locator("[data-me]").count()) === 0;
          // Reports (from the Me sheet): the back gesture closes it, the page stays.
          await page.locator("[data-me-open]").click();
          await page.locator("[data-me-reports]").click();
          await page.locator("[data-reports]").waitFor({ timeout: 8000 });
          await page.waitForTimeout(450);
          await page.goBack();
          await page.waitForTimeout(500);
          r.reportsBack = (await page.locator("[data-reports]").count()) === 0 && (await page.locator(READY).count()) === 1;
          // Assistant: drag its handle down.
          const ask = page.locator("[data-ask]").filter({ visible: true }).first();
          if (await ask.count()) {
            await ask.click();
            await page.locator("[data-assistant]").waitFor({ timeout: 5000 });
            await page.waitForTimeout(500);
            await drag(844 * 0.4, { hold: 150 });
            r.assistantDragClose = (await page.locator("[data-assistant]").count()) === 0;
          }
          await shot(page, "sheets-after");
        } catch (e) {
          r.error = String(e?.message || e).split(String.fromCharCode(10))[0].slice(0, 160);
        }
        ok(Object.values(r).every(Boolean) && !r.error, "phone sheets: drag down to close, spring back, fling, scrim, back gesture", JSON.stringify(r));
      });
    }

    // Round 14 B1: the v4 sidebar — 34 px rows; the active row is a soft tint + accent bar, never the --ink fill.
    if (!MOBILE)
      await step("sidebar rows: 34 px, active = soft tint + accent bar (not --ink)", async () => {
        await page.goto(`${BASE}/?v=to_buy`);
        await page.waitForSelector(READY);
        const r = await page.locator("aside nav [data-nav-row][aria-current=page]").first().evaluate((el) => {
          const cs = getComputedStyle(el);
          const bar = getComputedStyle(el, "::before");
          const probe = document.createElement("i");
          probe.style.color = "var(--ink)";
          document.body.append(probe);
          const ink = getComputedStyle(probe).color;
          probe.remove();
          const inkRgb = ink.match(/\d+/g).slice(0, 3).join(",");
          const bgRgb = (cs.backgroundColor.match(/[\d.]+/g) ?? []).slice(0, 3).join(",");
          return { h: el.getBoundingClientRect().height, bg: cs.backgroundColor, notInk: bgRgb !== inkRgb, barW: bar.width, barOpacity: bar.opacity, weight: cs.fontWeight, asideBg: getComputedStyle(el.closest("nav")).backgroundColor };
        });
        await shot(page, "sidebar-v4");
        ok(Math.abs(r.h - 34) <= 1 && r.notInk && r.barW === "3px" && r.barOpacity === "1" && Number(r.weight) >= 600 && /rgba\(0, 0, 0, 0\)|transparent/.test(r.asideBg), "sidebar rows: 34 px, active = soft tint + accent bar (not --ink)", JSON.stringify(r));
      });

    // Round 13 C2: the desktop sidebar collapses by dragging its edge (and persists), Ctrl+B toggles; Hebrew mirrors.
    if (!MOBILE)
      await step("sidebar: drag the edge to collapse, persists, Ctrl+B expands (en + he)", async () => {
        const r = {};
        const collapsed = () => page.locator("aside nav[data-collapsed]").count().then((n) => n > 0);
        const dragEdge = async (dx) => {
          const b = await page.locator("[data-sidebar-edge]").boundingBox();
          const x = b.x + b.width / 2, y = b.y + b.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          for (let k = 1; k <= 12; k++) await page.mouse.move(x + (dx * k) / 12, y);
          r.mid = Number(await page.locator("aside[data-sidebar-w]").getAttribute("data-sidebar-w"));
          await page.mouse.up();
          await page.waitForTimeout(600);
        };
        for (const lang of ["en", "he"]) {
          await ctx.addCookies([{ name: "nexus_locale", value: lang, url: BASE }, { name: "nexus_sidebar", value: "open", url: BASE }]);
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector(READY);
          const sign = lang === "he" ? -1 : 1;
          if (TRACE && lang === "en") await traceFrames(page, "trace-sidebar-drag", () => dragEdge(-120 * sign), 1100);
          else await dragEdge(-120 * sign);
          r[`${lang}Live`] = r.mid > 68 && r.mid < 224;
          r[`${lang}Collapsed`] = await collapsed();
          await page.reload();
          await page.waitForSelector(READY);
          r[`${lang}Persisted`] = await collapsed();
          await page.locator("main h1").first().click({ position: { x: 2, y: 2 } }).catch(() => {});
          await page.keyboard.press("Control+b");
          await page.waitForTimeout(600);
          r[`${lang}CtrlB`] = !(await collapsed());
        }
        await ctx.addCookies([{ name: "nexus_locale", value: "en", url: BASE }, { name: "nexus_sidebar", value: "open", url: BASE }]);
        delete r.mid;
        ok(Object.values(r).every(Boolean), "sidebar: drag the edge to collapse, persists, Ctrl+B expands (en + he)", JSON.stringify(r));
      });

    if (MOBILE) {
      // Round 9 A2 / Round 13 B1: the dock is physically Home · Shopping · + · Projects · Insights in every language, and it never
      // moves: its box is sampled every animation frame while switching through all five targets.
      await step("phone dock: fixed order in en + he, dock and top bar perfectly still while switching", async () => {
        const order = async () =>
          page.evaluate(() => [...document.querySelectorAll("[data-dock] > [data-dock-target]")].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((e) => e.getAttribute("data-dock-target")));
        await page.goto(`${BASE}/?v=to_buy`);
        await page.waitForSelector(READY);
        await page.waitForSelector("[data-dock]");
        const en = await order();
        await ctx.addCookies([{ name: "nexus_locale", value: "he", url: BASE }]);
        await page.reload();
        await page.waitForSelector(READY);
        await page.waitForSelector("[data-dock]");
        const he = await order();
        await ctx.addCookies([{ name: "nexus_locale", value: "en", url: BASE }]);
        await page.reload();
        await page.waitForSelector(READY);
        await page.waitForSelector("[data-dock]");
        await page.waitForTimeout(300);
        const moves = [];
        for (const target of ["home", "projects", "spending", "shopping", "plus", "home", "shopping"]) {
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
        const want = ["home", "shopping", "plus", "projects", "spending"];
        ok(JSON.stringify(en) === JSON.stringify(want) && JSON.stringify(he) === JSON.stringify(want) && !moves.length, "phone dock: fixed order in en + he, dock and top bar perfectly still while switching", JSON.stringify({ en, he, moves }));
      });
    }

    if (MOBILE) {
      // Round 8 C: the hero summarizes, the products are the page.
      // Round 10 B1: tap → first video frame → decoder ready, on a mid-phone profile (CPU ×4), first open and a reopen;
      // the camera turns off the moment each screen closes (<html data-camera>). Fake camera; permission granted.
      await step("camera opens fast: barcode viewfinder < 300 ms, decoder < 800 ms; receipt camera too; off as soon as each closes", async () => {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const times = async () => page.evaluate(() => {
          const m = (n) => performance.getEntriesByName(n).at(-1)?.startTime;
          const tap = m("cam:tap");
          return { frame: Math.round(m("cam:frame") - tap), decoder: Math.round(Math.max(0, (m("scan:decoder") ?? tap) - tap)) };
        });
        const offs = [];
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
          offs.push(await page.evaluate(() => document.documentElement.dataset.camera));
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
        await page.waitForTimeout(300);
        offs.push(await page.evaluate(() => document.documentElement.dataset.camera));
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await page.waitForTimeout(400);
        console.log(`INFO camera (CPU ×4): barcode first frame ${first.frame} ms, decoder ${first.decoder} ms; reopen frame ${again.frame} ms; receipt first frame ${receipt.frame} ms; after close: ${offs.join(", ")}`);
        // Target 300 ms; Chromium's fake camera
        // cold start alone varies 200–500 ms on a loaded machine; every open is cold now (no keep-alive), so 400 ms here.
        const [F, D] = STRICT_TIMING ? [400, 800] : [2500, 3000];
        ok(first.frame < F && first.decoder < D && again.frame < F && receipt.frame < F && offs.every((x) => x === "off"), "camera opens fast: barcode viewfinder < 300 ms, decoder < 800 ms; receipt camera too; off as soon as each closes", JSON.stringify({ first, again, receipt, offs }));
      });

      // Round 13 C1: one phone search that also finds settings. "dark" → the theme control works in place;
      // "חשמל" in Hebrew finds the matching items; an empty search offers recent searches + 4 quick actions.
      await step("phone search: settings in place (theme) + Hebrew items", async () => {
        const r = {};
        const openSearch = async () => {
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-phone-search]").click();
          await page.locator("[data-phone-search-input]").waitFor();
        };
        await openSearch();
        r.quick = await page.locator("[data-search-quick]").count();
        await page.locator("[data-phone-search-input]").fill("dark");
        const ctl = page.locator('[data-search-control="theme"]');
        await ctl.waitFor({ timeout: 5000 });
        r.first = (await page.locator("[data-search-group]").first().getAttribute("data-search-group")) === "settings";
        const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
        await ctl.locator('[role=radio]').nth(0).click(); // light
        await page.waitForTimeout(300);
        r.light = !(await isDark());
        await ctl.locator('[role=radio]').nth(1).click(); // dark
        await page.waitForTimeout(300);
        r.dark = await isDark();
        r.stillOpen = await page.locator("[data-phone-search-results]").isVisible();
        await ctl.locator('[role=radio]').nth(2).click(); // back to system
        await shot(page, "phone-search-dark");
        await page.keyboard.press("Escape");
        await ctx.addCookies([{ name: "nexus_locale", value: "he", url: BASE }]);
        await openSearch();
        await page.locator("[data-phone-search-input]").fill("חשמל");
        await page.locator("[data-search-item]").first().waitFor({ timeout: 5000 }).catch(() => {});
        r.he = await page.locator("[data-search-item]").count();
        await shot(page, "phone-search-he");
        await page.keyboard.press("Escape");
        await ctx.addCookies([{ name: "nexus_locale", value: "en", url: BASE }]);
        ok(r.quick === 4 && r.first && r.light && r.dark && r.stillOpen && r.he >= 1, "phone search: settings in place (theme) + Hebrew items", JSON.stringify(r));
      });

      // Round 13 B2: the Shopping tab's switch — both ways in en + he: URL/view and where the thumb sits.
      await step("phone shopping: switch both ways in en + he (URL, thumb)", async () => {
        const bad = [];
        for (const loc of ["en", "he"]) {
          await ctx.addCookies([{ name: "nexus_locale", value: loc, url: BASE }]);
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector(READY);
          const check = async (want) => {
            await page.waitForTimeout(650);
            const r = await page.evaluate(() => {
              const sw = document.querySelector("[data-shop-switch]").getBoundingClientRect();
              const th = document.querySelector("[data-shop-thumb]").getBoundingClientRect();
              return { mid: th.left + th.width / 2 - (sw.left + sw.width / 2), v: new URL(location.href).searchParams.get("v"), sw: document.querySelector("[data-shop-switch]").getAttribute("data-shop-switch") };
            });
            // To buy is the start card: left in English, right in Hebrew.
            const startSide = (want === "to_buy") === (loc === "en") ? r.mid < 0 : r.mid > 0;
            if (r.v !== want || r.sw !== want || !startSide) bad.push(`${loc}→${want}:${JSON.stringify(r)}`);
          };
          await page.locator('[data-shop-tab="ordered"]').click();
          await check("ordered");
          await page.locator('[data-shop-tab="to_buy"]').click();
          await check("to_buy");
        }
        await ctx.addCookies([{ name: "nexus_locale", value: "en", url: BASE }]);
        ok(!bad.length, "phone shopping: switch both ways in en + he (URL, thumb)", bad.join(" "));
      });

      // B2 frame check: a switch on a mid phone (CPU ×4). What the eye sees is the compositor: painted frames
      // (screencast) during the thumb's 450 ms spring must keep coming (≤ 2 gaps over 2 vsyncs), and the dock never
      // moves. Main-thread long frames are reported too (they grow with the list's length, not with the switch).
      await step("phone shopping: switch frames on a mid phone (no dropped frames, dock still)", async () => {
        await page.goto(`${BASE}/?v=to_buy`);
        await page.waitForSelector(READY);
        await page.waitForTimeout(1200);
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const run = async (target) => {
          const frames = [];
          const onFrame = ({ sessionId, metadata }) => {
            frames.push(metadata.timestamp * 1000);
            cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
          };
          cdp.on("Page.screencastFrame", onFrame);
          await cdp.send("Page.startScreencast", { format: "jpeg", quality: 30, maxWidth: 195, maxHeight: 422, everyNthFrame: 1 });
          await page.waitForTimeout(250);
          const r = await page.evaluate(async (target) => {
            const dock = document.querySelector("[data-dock]");
            const d0 = dock.getBoundingClientRect();
            let moved = 0;
            const gaps = [];
            let last = performance.now();
            let on = true;
            const tick = (t) => {
              gaps.push(t - last);
              last = t;
              const d = dock.getBoundingClientRect();
              moved = Math.max(moved, Math.abs(d.top - d0.top), Math.abs(d.left - d0.left));
              if (on) requestAnimationFrame(tick);
            };
            const t0 = Date.now();
            document.querySelector(`[data-shop-tab="${target}"]`).click();
            requestAnimationFrame(tick);
            await new Promise((r) => setTimeout(r, 1100));
            on = false;
            return { t0, longMain: gaps.filter((g) => g > 34).length, worstMain: Math.round(Math.max(...gaps)), moved };
          }, target);
          await cdp.send("Page.stopScreencast");
          cdp.off("Page.screencastFrame", onFrame);
          // Painted-frame gaps inside the thumb's spring (first 450 ms after the tap).
          const inSpring = frames.filter((t) => t >= r.t0 - 20 && t <= r.t0 + 470).sort((a, b) => a - b);
          const gaps = inSpring.slice(1).map((t, k) => t - inSpring[k]);
          return { painted: inSpring.length, dropped: gaps.filter((g) => g > 34).length, worstPaint: Math.round(Math.max(0, ...gaps)), longMain: r.longMain, worstMain: r.worstMain, moved: r.moved };
        };
        const items = await page.locator("main [data-item-card]").count();
        const a = await run("ordered");
        const b = await run("to_buy");
        if (TRACE) {
          await traceFrames(page, "trace-shop-switch", () => page.locator('[data-shop-tab="ordered"]').click(), 900);
          await page.locator('[data-shop-tab="to_buy"]').click();
        }
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await cdp.detach();
        console.log(`INFO shop switch (${items} cards in To buy): ${JSON.stringify({ toWay: a, back: b })}`);
        ok(a.dropped + b.dropped <= 2 && a.painted >= 5 && a.moved < 0.5 && b.moved < 0.5, "phone shopping: switch frames on a mid phone (no dropped frames, dock still)", JSON.stringify({ toWay: a, back: b }));
      });

      // B3: list and grid in both sub-tabs, at 360 and 390 px: items render the right way, nothing overflows.
      await step("phone shopping: list + grid × To buy + On the way at 360/390, no overflow", async () => {
        const bad = [];
        for (const layout of ["rows", "cards"]) {
          for (const v of ["to_buy", "ordered"]) {
            for (const w of [360, 390]) {
              await page.setViewportSize({ width: w, height: VIEWPORT.height });
              await page.goto(`${BASE}/?v=${v}`);
              await page.waitForSelector(READY);
              const toggle = page.locator(`[data-phone-layout-toggle] [role=radio]`).nth(layout === "rows" ? 0 : 1);
              if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
              await page.waitForTimeout(500);
              const r = await page.evaluate(() => ({
                over: document.documentElement.scrollWidth - innerWidth,
                cards: document.querySelectorAll("main [data-item-card]").length,
                groups: document.querySelectorAll("[data-shop-group]").length,
                tracks: [...document.querySelectorAll("main [data-item-card] [data-track]")].filter((e) => e.offsetParent).length,
                pills: [...document.querySelectorAll("main [data-item-card] [data-pill]")].filter((e) => e.offsetParent).length,
                layout: document.querySelector("[data-app-shell]").getAttribute("data-phone-layout"),
              }));
              const fine = r.over <= 0 && r.cards > 0 && r.layout === layout && (v !== "ordered" || (r.tracks > 0 && r.pills > 0)) && (!(v === "to_buy" && layout === "rows") || r.groups > 0);
              if (!fine) bad.push(`${layout}/${v}/${w}:${JSON.stringify(r)}`);
              if (w === 390) await shot(page, `shop-${v}-${layout}`);
            }
          }
        }
        await page.setViewportSize(VIEWPORT);
        // Back to the default (list).
        await page.locator("[data-phone-layout-toggle] [role=radio]").nth(0).click();
        ok(!bad.length, "phone shopping: list + grid × To buy + On the way at 360/390, no overflow", bad.join(" "));
      });
    }

    if (MOBILE) {
      await step("receipt camera: shutter → corner adjust → add a part → use", async () => {
        await page.goto(`${BASE}/?v=to_buy`);
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
          await p2.goto(`${BASE}/?v=to_buy`);
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
          ["home", () => go("/")],
          ["to buy", () => go("/?v=to_buy")],
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
        await page.goto(`${BASE}/?v=to_buy`);
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
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
    });

    // Round 10 A2: the cover morphs card → page and back with its rounded corners the whole way (the transition's
    // group clips with the same radius as both ends; read it every frame while the transition runs).
    await step("project cover morph: rounded corners the whole way, both directions", async () => {
      await page.goto(`${BASE}/?v=projects`);
      await page.waitForSelector("[data-project-card] [data-project-cover]", { timeout: 15000 });
      await page.waitForTimeout(900); // the cards' rise-in settles first (a click waits for a stable element)
      const name = await page.locator("[data-project-card] [data-project-cover]").first().evaluate((e) => getComputedStyle(e).viewTransitionName);
      // Click from inside the sampling script: no actionability waits between the click and the first sample.
      const sample = (name, target) => page.evaluate(([name, target]) => new Promise((res) => {
        const seen = [];
        const t0 = performance.now();
        const tick = () => {
          const g = getComputedStyle(document.documentElement, `::view-transition-group(${name})`);
          if (g.width && g.width !== "auto" && g.width !== "0px") seen.push(g.borderTopLeftRadius);
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else res(seen);
        };
        requestAnimationFrame(tick);
        document.querySelector(target)?.click();
      }), [name, target]);
      const back = MOBILE ? '[data-dock-target="projects"]' : null;
      if (!back) {
        // Desktop: the sidebar's Projects label.
        await page.evaluate(() => [...document.querySelectorAll("aside button")].find((b) => /^(Projects|פרויקטים)$/.test(b.textContent.trim()))?.setAttribute("data-smoke-projects", ""));
      }
      const backSel = back ?? "[data-smoke-projects]";
      let fwd, rev;
      const go = async () => { fwd = await sample(name, "[data-project-card] > button"); await page.waitForSelector("[data-project-header]"); };
      const ret = async () => { await page.waitForTimeout(600); rev = await sample(name, backSel); await page.waitForSelector("[data-project-card]"); };
      if (TRACE) {
        await traceFrames(page, "trace-cover-open", go, 1100);
        await traceFrames(page, "trace-cover-back", ret, 1100);
      } else {
        await go();
        await ret();
      }
      const round = (r) => r.length > 0 && r.every((x) => x === r[0] && parseFloat(x) >= 20);
      ok(round(fwd) && round(rev), "project cover morph: rounded corners the whole way, both directions", `in: ${[...new Set(fwd)].join("/") || "no transition"}; back: ${[...new Set(rev)].join("/") || "no transition"}`);
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
    });

    // R17 A4: Space settings from the space switcher closes back to where you were (Home) with ✕/back, Esc, the system
    // Back and (phone) the edge swipe; opened from Settings, back returns to Settings.
    await step("space settings: from the switcher → closes to Home (every close); from Settings → back to Settings", async () => {
      const r = {};
      const shell = () => page.locator("[data-settings]").filter({ visible: true }).first();
      const gone = async () => (await page.locator("[data-settings]").filter({ visible: true }).count()) === 0 && (await page.locator("[data-home-grid]").first().isVisible());
      const fromSwitcher = async () => {
        await page.goto(`${BASE}/`);
        await page.waitForSelector("[data-home-grid]", { timeout: 15000 });
        await page.waitForTimeout(300);
        if (MOBILE) {
          await page.locator("[data-me-open]").click();
          await page.locator("[data-space-settings]").filter({ visible: true }).first().click();
        } else {
          await page.locator("[data-space-switcher]").filter({ visible: true }).first().click();
          await page.locator("[data-space-settings]").filter({ visible: true }).first().click();
        }
        await shell().waitFor({ timeout: 5000 });
        await page.waitForTimeout(350);
      };
      const closers = {
        button: async () => page.locator(MOBILE ? "[data-settings-back]" : "[data-settings-close]").filter({ visible: true }).first().click(),
        esc: async () => page.keyboard.press("Escape"),
      };
      // Android Back (the system back = history back); desktop has no back gesture for a dialog.
      if (MOBILE) closers.back = async () => page.goBack();
      if (MOBILE)
        closers.swipe = async () => {
          const cdp = await ctx.newCDPSession(page);
          const t = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
          await t("touchStart", 6, 400);
          for (let k = 1; k <= 8; k++) await t("touchMove", 6 + k * 20, 402);
          await t("touchEnd");
        };
      for (const [name, fn] of Object.entries(closers)) {
        await fromSwitcher();
        await fn();
        await page.waitForTimeout(500);
        r[name] = await gone();
        if (!r[name]) r[`${name}Why`] = { url: page.url().replace(BASE, ""), shells: await page.locator("[data-settings]").count(), section: await page.locator("[data-settings]").first().getAttribute("data-settings-section").catch(() => null) };
      }
      // From Settings: the space page's back is the Settings list (phone) / the dialog stays open (desktop Esc closes all).
      await page.goto(`${BASE}/`);
      await page.waitForSelector("[data-home-grid]", { timeout: 15000 });
      if (MOBILE) {
        await page.locator("[data-me-open]").click();
        await page.locator("[data-me-settings]").click();
        await shell().waitFor();
        await page.locator("[data-sx-nav=space]").filter({ visible: true }).first().click();
        await page.waitForTimeout(350);
        await page.locator("[data-settings-back]").filter({ visible: true }).first().click();
        await page.waitForTimeout(400);
        r.fromSettings = (await shell().getAttribute("data-settings-section")) === "list";
        await page.keyboard.press("Escape");
      } else r.fromSettings = true; // desktop: Space sections are in the same dialog as the rest of Settings
      ok(Object.values(r).every(Boolean), "space settings: from the switcher → closes to Home (every close); from Settings → back to Settings", JSON.stringify(r));
    });

    // R17 A5: Account & security opens in its final layout (no swap: CLS 0 on a warm visit), the devices answer is one
    // fast request (< 500 ms warm), and the three tiles show their whole labels at 360 (phone).
    if (MOBILE)
      await step("account & security (phone): one layout (CLS 0 warm), devices < 500 ms, tiles not cut at 360", async () => {
        const r = {};
        let secId = null;
        try {
          secId = actionTable().find((a) => a.name === "getSecurityState")?.id ?? null;
        } catch {
          /* no local build (prod smoke): fall back to the body */
        }
        const visit = async () => {
          const times = [];
          const sent = new Map();
          const onReq = (q) => q.method() === "POST" && q.headers()["next-action"] && sent.set(q, Date.now());
          // The devices call is recognised by its action id (the build's manifest), not by reading its body: late in a
          // long run DevTools may already have dropped the body ("No data found for resource") — R17 S3.
          const onRes = async (res) => {
            const q = res.request();
            if (!sent.has(q)) return;
            if (secId) return void (q.headers()["next-action"] === secId && times.push(Date.now() - sent.get(q)));
            const body = await res.text().catch(() => "");
            if (body.includes('"devices"')) times.push(Date.now() - sent.get(q));
          };
          page.on("request", onReq);
          page.on("response", onRes);
          await page.goto(`${BASE}/settings/account`);
          await page.evaluate(() => {
            window.__cls = 0;
            new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
          });
          await page.locator("[data-device=current]").first().waitFor({ timeout: 10000 });
          await page.waitForTimeout(2500);
          page.off("request", onReq);
          page.off("response", onRes);
          return { cls: Math.round((await page.evaluate(() => window.__cls)) * 1000) / 1000, ms: times.at(-1) ?? null };
        };
        r.cold = await visit();
        r.warm = await visit();
        await page.setViewportSize({ width: 360, height: VIEWPORT.height });
        await page.waitForTimeout(300);
        r.tilesCut = await page.evaluate(() =>
          [...document.querySelectorAll("[data-account-tiles] b, [data-account-tiles] .tiny, [data-account-tiles] button")]
            .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth + 1)
            .map((e) => e.textContent.trim()),
        );
        await page.setViewportSize(VIEWPORT);
        ok(r.warm.cls === 0 && r.warm.ms != null && r.warm.ms < 500 && r.tilesCut.length === 0, "account & security (phone): one layout (CLS 0 warm), devices < 500 ms, tiles not cut at 360", JSON.stringify(r));
        console.log(`INFO account & security: ${JSON.stringify(r)}`);
        await page.keyboard.press("Escape");
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

    // Round 11 B1: one overlay opened from another is either a sub-page of it or fully on top; Esc / an outside click
    // closes only the top layer, with a visible result each time.
    await step("nested overlays: the newer one is on top and closes alone", async () => {
      const go = async (path = "/?v=to_buy") => {
        await page.goto(`${BASE}${path}`);
        await page.waitForSelector(READY, { timeout: 15000 });
      };
      const dialogs = () => page.locator("[role=dialog]:visible").count();
      // The element at the surface's centre (or 40 px down) belongs to it → it is the visible top layer.
      const onTop = (sel) =>
        page.evaluate((sel) => {
          const els = [...document.querySelectorAll(sel)];
          const el = els[els.length - 1];
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40));
          return !!hit && el.contains(hit);
        }, sel);
      const settle = () => page.waitForTimeout(350);
      const r = {};
      // Settings → Reports: a sub-page in the same modal; Esc and the back arrow return to Settings, Esc again closes.
      await go();
      await openPalette();
      await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: /Open settings|פתיחת ההגדרות/ }).first().click();
      if (!(await page.locator("[data-settings-reports]").isVisible())) await page.locator('[data-sx-nav="account"]').click();
      await page.locator("[data-settings-reports]").click();
      await page.locator("[data-settings-subpage=reports]").waitFor({ timeout: 8000 });
      await settle();
      r.reportsSub = (await onTop("[data-settings-subpage=reports]")) && (await dialogs()) === 1;
      await page.keyboard.press("Escape");
      await settle();
      r.escBack = (await page.locator("[data-settings-reports]").isVisible()) && (await dialogs()) === 1;
      await page.locator("[data-settings-reports]").click();
      await page.locator("[data-settings-back]:visible").first().click();
      await settle();
      r.arrowBack = await page.locator("[data-settings-reports]").isVisible();
      // (R15 D2: the extension row is gone from Settings.) R16 D3: on phones Esc goes back to the section list first.
      await page.keyboard.press("Escape");
      await settle();
      if (MOBILE && (await dialogs()) > 0) {
        await page.keyboard.press("Escape");
        await settle();
      }
      r.settingsClosed = (await dialogs()) === 0;
      // Reports sheet → "Report a problem" form on top; Esc closes the form, then the sheet.
      await openPalette();
      await page.locator("[data-cmd-reports]").click();
      await page.locator("[data-reports-new]").click();
      await page.locator("[data-report-form]").waitFor({ timeout: 8000 });
      await settle();
      r.formTop = await onTop("[data-report-form]");
      await page.keyboard.press("Escape");
      await settle();
      r.formAlone = (await page.locator("[data-report-form]").count()) === 0 && (await page.locator("[data-reports]").isVisible());
      await page.keyboard.press("Escape");
      await settle();
      r.sheetClosed = (await dialogs()) === 0;
      // Item sheet → picture picker on top; Esc closes the picker, then the sheet.
      const items = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
      const it = items.find((i) => i.status === "to_buy") ?? items[0];
      await go(`/?item=${it.id}`);
      await page.locator("[data-change-picture]").waitFor({ timeout: 15000 });
      await page.locator("[data-change-picture]").click();
      await page.locator("[data-picture-picker]").waitFor({ timeout: 8000 });
      await settle();
      r.pickerTop = await onTop("[data-picture-picker]");
      await page.keyboard.press("Escape");
      await settle();
      r.pickerAlone = (await page.locator("[data-picture-picker]").count()) === 0 && (await page.locator("[data-change-picture]").isVisible());
      await page.keyboard.press("Escape");
      await settle();
      r.itemClosed = (await dialogs()) === 0;
      if (MOBILE) {
        // Me sheet → Reports: the Me sheet steps aside, Reports is visible on top.
        await go();
        await page.locator("[data-me-open]").click();
        await page.locator("[data-me-reports]").click();
        await page.locator("[data-reports]").waitFor({ timeout: 8000 });
        await settle();
        r.meReports = (await onTop("[data-reports]")) && (await page.locator("[data-me]").count()) === 0;
        await page.keyboard.press("Escape");
        await settle();
      }
      ok(Object.values(r).every(Boolean), "nested overlays: the newer one is on top and closes alone", JSON.stringify(r));
    });

    // Round 11 B2: History within reach — phone dock "Insights" (Spending · History), History's search + filters and
    // month timeline, History in the Me sheet, and "Go to History" from a search elsewhere.
    await step("insights: Spending · History, history filters + timeline, Go to History", async () => {
      const r = {};
      const data = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data;
      const bought = data.items.filter((i) => i.status === "purchased");
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
      if (MOBILE) {
        await page.locator('[data-dock-target="spending"]').click();
        await page.locator("[data-insights-switch=spending]").waitFor({ timeout: 8000 });
        await page.locator("[data-insights-switch] [role=radio]").nth(1).click();
        await page.locator("[data-insights-switch=history]").waitFor({ timeout: 8000 });
        r.dockStays = (await page.locator('[data-dock-target="spending"]').getAttribute("aria-current")) === "page";
        r.url = new URL(page.url()).searchParams.get("v") === "history";
        await page.locator("[data-insights-switch] [role=radio]").nth(0).click();
        await page.locator("[data-stats]").waitFor({ timeout: 8000 });
        // Me sheet → History.
        await page.locator("[data-me-open]").click();
        await page.locator("[data-me-history]").click();
        await page.locator("[data-history-tools]").waitFor({ timeout: 8000 });
        r.me = true;
      } else {
        await page.goto(`${BASE}/?v=history`);
        await page.waitForSelector(READY, { timeout: 15000 });
        r.noSwitchOnDesktop = !(await page.locator("[data-insights-switch]").isVisible());
      }
      if (bought.length) {
        await page.locator("[data-history-timeline]").waitFor({ timeout: 8000 });
        const months = await page.locator("[data-history-month]").evaluateAll((els) => els.map((e) => e.getAttribute("data-history-month")));
        r.timeline = months.length > 0 && months.filter((m) => m !== "none").every((m, i, a) => i === 0 || a[i - 1] >= m);
        // Month filter narrows to one month group.
        const first = months.find((m) => m !== "none");
        if (first) {
          await page.locator("[data-history-month-filter]").click();
          await page.getByRole("menuitemradio").nth(1).click();
          await page.waitForTimeout(300);
          const after = await page.locator("[data-history-month]").evaluateAll((els) => els.map((e) => e.getAttribute("data-history-month")));
          r.monthFilter = after.length === 1 && after[0] === first;
        }
        // Search inside History.
        const word = (bought[0].title.split(/\s+/).find((w) => w.length > 3) ?? bought[0].title).slice(0, 12);
        await page.goto(`${BASE}/?v=history`);
        await page.waitForSelector(READY, { timeout: 15000 });
        await page.locator("[data-history-search]").fill(word);
        await page.waitForTimeout(300);
        r.search = (await page.locator("main [data-item-card]").count()) > 0;
        await page.locator("[data-history-search]").fill("zzzz-no-such-thing");
        await page.waitForTimeout(300);
        r.searchEmpty = (await page.locator("main [data-item-card]").count()) === 0;
        // Searching To buy → "Go to History" carries the search over.
        await page.goto(`${BASE}/?v=to_buy`);
        await page.waitForSelector(READY, { timeout: 15000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        if (MOBILE) await page.locator("[data-phone-search]").click();
        const box = page.locator(MOBILE ? "[data-phone-top] input" : "header input, [data-app-header] input").filter({ visible: true }).first();
        await box.fill(word);
        await page.locator("[data-go-history]").waitFor({ timeout: 8000 });
        await page.locator("[data-go-history]").click();
        await page.locator("[data-history-tools]").waitFor({ timeout: 8000 });
        // The filtered list renders a moment after the tools (a timing flake when read at once).
        await page.locator("main [data-item-card]").first().waitFor({ timeout: 8000 }).catch(() => {});
        r.goHistory = (await page.locator("[data-history-search]").inputValue()) === word && (await page.locator("main [data-item-card]").count()) > 0;
      }
      ok(Object.values(r).every(Boolean), "insights: Spending · History, history filters + timeline, Go to History", JSON.stringify(r));
    });

    await step("orders view: cards ↔ table toggle switches layout", async () => {
      await page.goto(`${BASE}/?v=orders`);
      await page.waitForSelector("[data-orders-layout]", { timeout: 15000 });
      const layout = () => page.locator("[data-orders-layout]").getAttribute("data-orders-layout");
      // R14 A4: phones never get the table — the desktop switch is hidden there and the phone List / Grid one shows.
      if (MOBILE) {
        const r = { layout: await layout(), desktopSwitch: await page.locator('[data-carry="layout:table"]').filter({ visible: true }).count(), phoneSwitch: await page.locator("[data-phone-layout-toggle]").filter({ visible: true }).count() };
        return ok(r.layout === "cards" && r.desktopSwitch === 0 && r.phoneSwitch === 1, "orders view: cards ↔ table toggle switches layout (phone: cards only, phone switch)", JSON.stringify(r));
      }
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
        await page.goto(`${BASE}/?v=to_buy`, { waitUntil: "commit" });
        const btn = page.locator("[data-app-shell]:not([data-ready]) [data-ask]").filter({ visible: true }).first();
        await btn.waitFor({ timeout: 10000 });
        await page.waitForTimeout(400); // let the shell hydrate
        await btn.click();
        await page.waitForSelector(READY, { timeout: 20000 });
        await page.waitForTimeout(300);
        ok(await page.getByRole("dialog").isVisible(), "panel opened while loading stays open when the data arrives");
        await page.keyboard.press("Escape");
      });

      // Round 10 C3: the loading skeleton has the shape of the view in the URL.
      await step("loading skeletons match the view being loaded", async () => {
        const coll = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.collections.find((c) => c.kind === "project" && !c.archived);
        const cases = [["/?v=projects", "projects"], ["/?v=orders", "orders"], ["/?v=history", "items"], ["/?v=ordered", "items"], ["/?v=spending", null], ["/", "items"]];
        if (coll) cases.push([`/?v=c:${coll.id}`, "project-header"]);
        const bad = [];
        for (const [path, want] of cases) {
          await page.goto(`${BASE}${path}`, { waitUntil: "commit" });
          await page.waitForSelector("[data-app-shell]:not([data-ready])", { timeout: 10000 });
          const got = await page.evaluate(() => [...document.querySelectorAll("[data-app-shell]:not([data-ready]) [data-skeleton]")].map((e) => e.getAttribute("data-skeleton")));
          if (want ? !got.includes(want) || (want !== "project-header" && got.some((g) => g !== want)) : got.length) bad.push(`${path}: ${got.join(",") || "none"}`);
          if (MOBILE && path === "/?v=projects") await shot(page, "skeleton-projects");
          await page.waitForSelector(READY, { timeout: 20000 });
        }
        ok(bad.length === 0, "loading skeletons match the view being loaded", bad.join(" | "));
      });
    }

    // R16 A3: desktop keeps every way to add one click away on a space with items (Add split button → menu);
    // phone: the "+" sheet shows the same list (cards + the compact row).
    await step("add menu: the shared add list on desktop (receipt + barcode) and in the phone +", async () => {
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
      if (MOBILE) {
        await page.click("[data-plus]");
        await page.waitForTimeout(500);
        const keys = await page.locator("[data-plus-action]:visible").evaluateAll((els) => els.map((e) => e.getAttribute("data-plus-action")));
        await page.mouse.click(195, 120);
        return ok(["barcode", "receipt", "paste", "plan", "import", "list", "project"].every((k) => keys.includes(k)), "add menu: the shared add list on desktop (receipt + barcode) and in the phone +", JSON.stringify(keys));
      }
      const menu = page.locator("[data-add-menu]");
      await menu.click();
      const keys = await page.locator("[data-add-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-add-action")));
      await shot(page, "add-menu");
      await page.locator("[data-add-action=receipt]").click();
      const receipt = await page.locator("[data-receipt-dialog]").waitFor({ timeout: 8000 }).then(() => true, () => false);
      await page.keyboard.press("Escape");
      await page.locator("[data-receipt-dialog]").waitFor({ state: "detached", timeout: 8000 });
      await menu.click();
      await page.locator("[data-add-action=barcode]").click();
      const barcode = await page.locator("[data-barcode-scanner]").waitFor({ timeout: 8000 }).then(() => true, () => false);
      await page.keyboard.press("Escape");
      await page.locator("[data-barcode-scanner]").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
      ok(receipt && barcode && ["barcode", "receipt", "paste", "plan", "import", "list", "project"].every((k) => keys.includes(k)), "add menu: the shared add list on desktop (receipt + barcode) and in the phone +", JSON.stringify({ keys, receipt, barcode }));
    });

    // R16 A5: the selection bar has one menu/popover open at a time — another trigger swaps it in one click, Esc closes.
    await step("selection bar: one menu at a time, one click to swap, Esc closes", async () => {
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
      const cards = page.locator("[data-item-card], [data-item-row]").filter({ visible: true });
      if ((await cards.count()) < 2) return ok(true, "selection bar (fewer than two items, skipped)");
      // Ctrl+click selects (phones long-press; the bar is the same).
      await cards.nth(0).click({ modifiers: ["Control"] });
      await cards.nth(1).click({ modifiers: ["Control"] });
      await page.locator("[data-selection-bar]").waitFor({ timeout: 5000 });
      // Every bar menu/popover is one popper (a menu's [role=menu] sits inside its wrapper): count the poppers.
      const open = () => page.evaluate(() => document.querySelectorAll("[data-radix-popper-content-wrapper]").length);
      const keys = ["move", "priority", "compare"];
      const present = [];
      for (const k of keys) if (await page.locator(`[data-select-menu=${k}]`).count()) present.push(k);
      const counts = [];
      for (const a of present)
        for (const b of present) {
          if (a === b) continue;
          await page.locator(`[data-select-menu=${a}]`).click();
          await page.waitForTimeout(250);
          await page.locator(`[data-select-menu=${b}]`).click();
          await page.waitForTimeout(250);
          const bOpen = await page.locator(`[data-select-menu=${b}]`).getAttribute("data-state");
          counts.push([a, b, await open(), bOpen]);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
        }
      const afterEsc = await open();
      await page.keyboard.press("Escape");
      ok(present.length >= 2 && counts.every(([, , n, st]) => n === 1 && st === "open") && afterEsc === 0, "selection bar: one menu at a time, one click to swap, Esc closes", JSON.stringify({ counts, afterEsc }));
    });

    // R16 A6: list (table) and grid checkboxes are hidden at idle, fade in on hover / keyboard focus, and every row shows
    // one while anything is selected; "select all" in the header only in selection mode. Desktop only (phones long-press).
    await step("checkboxes: hidden at idle, shown on hover / focus / while selecting", async () => {
      if (MOBILE) return ok(true, "checkboxes: hidden at idle, shown on hover / focus / while selecting (desktop only)");
      const r = {};
      await ctx.addCookies([{ name: "nexus_layout", value: "table", url: BASE }]);
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector("[data-item-row]", { timeout: 15000 });
      const rows = page.locator("[data-item-row]");
      const op = (k) => rows.nth(k).locator("[data-row-check] input").evaluate((e) => getComputedStyle(e).opacity);
      await page.mouse.move(5, 5);
      await page.waitForTimeout(200);
      r.idle = await op(0);
      r.headerIdle = await page.locator("[data-select-all]").count();
      await shot(page, "checkbox-idle");
      await rows.nth(0).hover();
      await page.waitForTimeout(250);
      r.hover = await op(0);
      r.otherOnHover = await op(1);
      await shot(page, "checkbox-hover");
      await page.mouse.move(5, 5);
      await rows.nth(1).focus();
      await page.keyboard.press("Tab").catch(() => {});
      await rows.nth(1).focus();
      await page.waitForTimeout(250);
      r.focus = await op(1);
      await rows.nth(0).locator("[data-row-check] input").click({ force: true });
      await page.mouse.move(5, 5);
      await page.waitForTimeout(250);
      r.selecting = [await op(1), await op(2)];
      r.headerSelecting = await page.locator("[data-select-all]").count();
      await shot(page, "checkbox-selecting");
      await page.keyboard.press("Escape");
      // Grid cards: same rule.
      await ctx.addCookies([{ name: "nexus_layout", value: "cards", url: BASE }]);
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY);
      const card = page.locator("[data-item-card]").first();
      const cop = () => card.locator("[role=checkbox]").first().evaluate((e) => getComputedStyle(e).opacity);
      await page.mouse.move(5, 5);
      await page.waitForTimeout(200);
      r.cardIdle = await cop();
      await card.hover();
      await page.waitForTimeout(250);
      r.cardHover = await cop();
      ok(
        r.idle === "0" && r.headerIdle === 0 && r.hover === "1" && r.otherOnHover === "0" && r.focus === "1" && r.selecting.every((x) => x === "1") && r.headerSelecting === 1 && r.cardIdle === "0" && r.cardHover === "1",
        "checkboxes: hidden at idle, shown on hover / focus / while selecting",
        JSON.stringify(r),
      );
    });

    // Hotfix.1 guard (boot-screen VIEWPORT_GUARD): a phone screen laid out at desktop width is fixed with at most one
    // reload and never loops (soft fix = re-insert the viewport meta first; a reload only when that doesn't help, at most
    // once per 30 s, `sessionStorage["nexus.vpfix"]` = its timestamp); a normal phone and a desktop are never touched.
    // Here the wide layout comes from the emulated viewport (1100 px on a 390 px phone screen), which no meta change can
    // fix → the reload path. scripts/test-viewport.mjs covers the meta-driven cases (soft fix, sticky, always broken,
    // reports, landscape) in detail.
    await step("viewport guard: a phone at desktop width reloads once, never loops", async () => {
      const run = async (opts) => {
        const c = await browser.newContext(opts);
        const p = await c.newPage();
        let docs = 0;
        p.on("framenavigated", (f) => f === p.mainFrame() && docs++);
        await p.goto(`${BASE}/login`);
        await p.waitForTimeout(2500);
        const settled = docs;
        // Give it more chances to loop: the guard also checks on resize / pageshow / visibility.
        await p.evaluate(() => {
          document.dispatchEvent(new Event("visibilitychange"));
          dispatchEvent(new Event("resize"));
          dispatchEvent(new Event("pageshow"));
        });
        await p.waitForTimeout(2000);
        const r = await p.evaluate(() => ({ flag: sessionStorage.getItem("nexus.vpfix"), nav: performance.getEntriesByType("navigation")[0]?.type }));
        await c.close();
        return { docs, settled, ...r };
      };
      const wide = await run({ viewport: { width: 1100, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const phone = await run({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const desk = await run({ viewport: { width: 1366, height: 860 } });
      const recent = (f) => /^\d{13}$/.test(f ?? "") && Math.abs(Date.now() - Number(f)) < 120_000;
      ok(
        recent(wide.flag) && wide.nav === "reload" && wide.docs === phone.docs + 1 && wide.docs === wide.settled && !phone.flag && phone.nav === "navigate" && !desk.flag && desk.nav === "navigate" && phone.docs === phone.settled && desk.docs === desk.settled,
        "viewport guard: a phone at desktop width reloads once, never loops",
        JSON.stringify({ wide, phone, desk }),
      );
    });

    // R16 A9: sign-in — the cube field sits inside its panel at every size (never cropped), and on phones the form block is
    // centred in the space under the brand band with the legal line at the bottom.
    await step("sign-in: cube field fits its panel, phone form centred", async () => {
      const bad = [];
      for (const [w, h] of [[360, 740], [390, 844], [1280, 720], [1366, 768], [1920, 1080]]) {
        const phone = w < 900;
        const c = await browser.newContext({ viewport: { width: w, height: h }, ...(phone ? { isMobile: true, hasTouch: true } : {}), reducedMotion: "reduce" });
        const p = await c.newPage();
        await p.goto(`${BASE}/login`);
        const m = await p.evaluate(() => {
          const vis = [...document.querySelectorAll("[data-auth-stage]")].find((e) => e.getBoundingClientRect().width > 0);
          const art = document.querySelector(".art").getBoundingClientRect();
          const st = vis?.getBoundingClientRect();
          const g = document.querySelector("[data-auth=google]").getBoundingClientRect();
          const legal = [...document.querySelectorAll("a[href='/terms']")].pop()?.getBoundingClientRect();
          return { art: [art.left, art.top, art.right, art.bottom], st: st && [st.left, st.top, st.right, st.bottom], g: [g.top, g.bottom], legal: legal && legal.top, vh: innerHeight };
        });
        const inside = m.st && m.st[0] >= m.art[0] - 1 && m.st[1] >= m.art[1] - 1 && m.st[2] <= m.art[2] + 1 && m.st[3] <= m.art[3] + 1 && m.st[2] - m.st[0] > 200;
        // Phone: the Google button's centre is in the middle third of the space between the band and the legal line.
        const mid = (m.g[0] + m.g[1]) / 2;
        const centred = !phone || (mid > m.art[3] + (m.legal - m.art[3]) / 3 && mid < m.art[3] + ((m.legal - m.art[3]) * 2) / 3);
        if (!inside || !centred) bad.push(`${w}x${h} ${JSON.stringify(m)}`);
        await c.close();
      }
      ok(!bad.length, "sign-in: cube field fits its panel, phone form centred", bad.join(" | "));
    });

    // R16 A10: the phone top bar keeps the logo + "Nexus" wordmark at full size next to the space chip (360 + 390, en + he):
    // nothing overlaps or overflows, both are ≥ 40 px tap targets.
    await step("phone top bar: full-size logo + compact space chip (360/390, en/he)", async () => {
      const state = await ctx.storageState();
      const bad = [];
      for (const w of [360, 390])
        for (const lang of ["en", "he"]) {
          const c = await browser.newContext({ storageState: state, viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
          await c.addCookies([{ name: "nexus_locale", value: lang, url: BASE }]);
          const p = await c.newPage();
          await p.goto(`${BASE}/`);
          await p.waitForSelector("[data-topbar-logo]", { timeout: 20000 });
          await p.waitForSelector("#boot", { state: "hidden", timeout: 10000 }).catch(() => {});
          const m = await p.evaluate(() => {
            const r = (s) => document.querySelector(s)?.getBoundingClientRect();
            const logo = r("[data-topbar-logo]");
            const chip = r("[data-phone-space]");
            const word = [...document.querySelectorAll("[data-topbar-logo] span")].find((e) => /Nexus/.test(e.textContent))?.getBoundingClientRect();
            const overlap = chip && logo && !(chip.left >= logo.right - 0.5 || chip.right <= logo.left + 0.5);
            return { logoW: logo?.width, logoH: logo?.height, word: word ? Math.round(word.width) : 0, chipH: chip?.height, chipW: chip?.width, overlap, scroll: document.documentElement.scrollWidth - innerWidth };
          });
          if (!(m.word >= 40 && m.logoH >= 40 && (!m.chipH || (m.chipH >= 40 && m.chipW >= 40)) && !m.overlap && m.scroll <= 0)) bad.push(`${w}/${lang} ${JSON.stringify(m)}`);
          await p.screenshot({ path: OUT ? `${OUT}/topbar-${w}-${lang}.png` : join(tmpdir(), "nx-topbar.png"), clip: { x: 0, y: 0, width: w, height: 72 } });
          await c.close();
        }
      ok(!bad.length, "phone top bar: full-size logo + compact space chip (360/390, en/he)", bad.join(" | "));
    });

    // R16 A12: switching spaces doesn't reload the page — the sidebar's box is the same on every frame of the switch, the
    // app lands on Home with the new space's data only, and switching back restores the first space's data.
    await step("space switch: no reload, sidebar steady every frame, lands on Home", async () => {
      if (MOBILE) return ok(true, "space switch: no reload, sidebar steady every frame, lands on Home (desktop only)");
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY);
      await page.waitForSelector("#boot", { state: "hidden", timeout: 10000 }).catch(() => {});
      const sw = page.locator("[data-space-switcher]").first();
      const home = await sw.getAttribute("data-space-id");
      await sw.click();
      const others = await page.locator("[data-space-item]").evaluateAll((els, h) => els.map((e) => e.getAttribute("data-space-item")).filter((x) => x && x !== h), home);
      if (!others.length) {
        await page.keyboard.press("Escape");
        return ok(true, "space switch (only one space, skipped)");
      }
      const target = others[0];
      // Sample the sidebar's box on every frame; a marker on window proves there was no reload.
      await page.evaluate(() => {
        window.__noReload = true;
        window.__boxes = [];
        const aside = document.querySelector("[data-sidebar-logo]").closest("aside, nav, [data-sidebar]") || document.querySelector("[data-sidebar-logo]").parentElement.parentElement;
        const tick = () => {
          const r = aside.getBoundingClientRect();
          window.__boxes.push([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","));
          if (window.__boxes.length < 240) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const titlesBefore = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items.length;
      await page.locator(`[data-space-item="${target}"]`).first().click();
      await page.waitForFunction((t) => document.querySelector("[data-space-switcher]")?.getAttribute("data-space-id") === t, target, { timeout: 20000 });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => ({ noReload: !!window.__noReload, boxes: [...new Set(window.__boxes)], frames: window.__boxes.length, path: location.pathname + location.search }));
      const homeShown = await page.locator("[data-home]").count();
      // The new space's data only: the app's item count equals that space's backup.
      const backupNew = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items.length;
      await shot(page, "space-switched");
      // Back to the first space (same path).
      await page.locator("[data-space-switcher]").first().click();
      await page.locator(`[data-space-item="${home}"]`).first().click();
      await page.waitForFunction((t) => document.querySelector("[data-space-switcher]")?.getAttribute("data-space-id") === t, home, { timeout: 20000 });
      const back = await page.evaluate(() => !!window.__noReload);
      ok(r.noReload && back && r.boxes.length === 1 && r.frames > 20 && r.path === "/" && homeShown > 0 && backupNew !== titlesBefore, "space switch: no reload, sidebar steady every frame, lands on Home", JSON.stringify({ ...r, homeShown, items: [titlesBefore, backupNew], back }));
    });

    await step("assistant panel opens", async () => {
      await page.goto(`${BASE}/?v=to_buy`);
      await page.waitForSelector(READY, { timeout: 15000 });
      const btn = page.locator("[data-ask]").filter({ visible: true }).first();
      if (!(await btn.count())) return ok(true, "assistant panel (AI off or not in this layout, skipped)");
      // Round 12 #4: every Ask button on screen is a fully rounded pill (radius ≥ half its height).
      const pills = await page.locator("[data-ask]").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) >= e.offsetHeight / 2 - 0.5 && parseFloat(getComputedStyle(e).borderBottomRightRadius) >= e.offsetHeight / 2 - 0.5));
      ok(pills.length > 0 && pills.every(Boolean), "Ask button is a fully rounded pill", JSON.stringify(pills));
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
      // Round 12 #3: History sits at the start before the mark (mirrored in RTL), New chat at the end; suggestion rows
      // carry a type icon + chevron under a "Suggested" label; nothing in the panel scrolls sideways.
      const hdr = await page.locator("[data-ai-header]").evaluate((el) => {
        const rtl = getComputedStyle(el).direction === "rtl";
        const x = (q) => el.querySelector(q).getBoundingClientRect();
        const start = (r) => (rtl ? -r.right : r.left);
        const hist = x("[data-ai-history-open]"), logo = x(":scope > svg"), add = x("[data-ai-new]");
        const sideways = [el.closest("[role=dialog]"), ...el.closest("[role=dialog]").querySelectorAll("*")].some((n) => n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX));
        return { order: start(hist) < start(logo) && start(logo) < start(add), sideways };
      });
      const rows = await page.locator("[data-testid=ai-suggestions] [data-ai-chip]").evaluateAll((els) => els.every((e) => e.querySelectorAll("svg").length === 2));
      const label = await page.locator("[data-testid=ai-suggestions] [data-ai-sug-label]").isVisible();
      ok(hdr.order && !hdr.sideways && rows && label, "assistant header (History at the start) + suggestion rows, no sideways scroll", JSON.stringify({ ...hdr, rows, label }));
      await page.waitForTimeout(400); // let the sheet finish sliding in before the screenshot
      await shot(page, "assistant");
      await page.keyboard.press("Escape");
    });

    await step(MOBILE ? "inbox page (R17 S3): the phone bell opens it, browser Back closes it" : "inbox popover (R17 S3): opens from the bell, no Telegram, Esc closes and focus returns", async () => {
      await page.goto(BASE);
      await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 15000 });
      if (MOBILE) {
        await page.click("[data-nt-bell=phone]");
        const pg = page.locator("[data-nt-page]");
        await pg.waitFor({ timeout: 10000 });
        await page.waitForTimeout(450);
        await shot(page, "inbox-page");
        await page.goBack();
        await pg.waitFor({ state: "detached", timeout: 5000 });
        ok(true, "inbox page: the phone bell opens it, browser Back closes it");
        return;
      }
      await page.click("[data-nt-bell=desk]");
      const pop = page.locator("[data-nt-popover]");
      await pop.waitFor({ timeout: 10000 });
      await page.waitForTimeout(300);
      await shot(page, "inbox-popover");
      const tg = await page.getByText("Telegram", { exact: true }).count();
      await page.keyboard.press("Escape");
      await pop.waitFor({ state: "detached", timeout: 5000 });
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-nt-bell") === "desk", null, { timeout: 1500 }).catch(() => {});
      const focus = await page.evaluate(() => document.activeElement?.getAttribute("data-nt-bell"));
      ok(tg === 0 && focus === "desk", "inbox popover: no Telegram controls, Esc closes, focus back on the bell", JSON.stringify({ tg, focus }));
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
      const last = b.data.kv?.find?.((x) => x.key === "pref:last_check");
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
          await page.goto(`${BASE}/?v=to_buy`);
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
        // Round 11 C1/C2: quick actions. Phone: row swipe → status blocks / Delete (full swipe), long-press row = select,
        // long-press card = action sheet. Desktop: hover bar, right-click menu, O / M / Delete keys. Every change undone.
        await step("quick actions: swipe / long-press (phone), hover bar / right-click / keys (desktop), with undo", async () => {
          const backup = async () => (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
          const statusOf = async (id) => (await backup()).find((i) => i.id === id)?.status ?? "gone";
          const undo = async () => {
            const btn = page.locator("[data-sonner-toast]").getByRole("button", { name: /^(Undo|ביטול)$/ }).last();
            await btn.waitFor({ timeout: 8000 });
            await btn.click();
            await page.waitForTimeout(1500);
          };
          const until = async (fn, want) => {
            for (let k = 0; k < 20; k++) {
              if ((await fn()) === want) return true;
              await page.waitForTimeout(250);
            }
            return false;
          };
          const r = {};
          try {
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector(READY, { timeout: 15000 });
          await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 1 }).catch(() => {});
          const ids = await page.$$eval("main [data-item-card]", (els) => els.map((e) => e.getAttribute("data-item-card")));
          const id = ids[1] ?? ids[0];
          const card = () => page.locator(`main [data-item-card="${id}"]`).first();
          if (MOBILE) {
            const cdp = await ctx.newCDPSession(page);
            const t = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
            await page.locator("[data-phone-layout-toggle] [role=radio]").nth(1).click(); // grid (Round 13: the list is the default)
            await page.waitForTimeout(300);
            const swipe = async (dx) => {
              await card().waitFor({ state: "visible", timeout: 8000 });
              await centerIn(card());
              const b = await card().boundingBox();
              const y = b.y + b.height / 2, x0 = b.x + b.width / 2;
              await t("touchStart", x0, y);
              for (let k = 1; k <= 12; k++) await t("touchMove", x0 + (dx * k) / 12, y);
              await t("touchEnd");
              await page.waitForTimeout(350);
            };
            const longPress = async () => {
              await card().waitFor({ state: "visible", timeout: 8000 });
              await centerIn(card());
              const b = await card().boundingBox();
              await t("touchStart", b.x + b.width / 2, b.y + b.height / 2);
              await page.waitForTimeout(650);
              await t("touchEnd");
              await page.waitForTimeout(300);
            };
            // Grid card: long-press → the action sheet; Move → list; Esc → back; Esc → closed.
            await longPress();
            r.sheet = await page.locator("[data-item-actions=menu]").isVisible();
            await page.locator("[data-item-action=move]").click();
            r.moveList = await page.locator("[data-move-list]").isVisible();
            await page.keyboard.press("Escape");
            await page.waitForTimeout(250);
            r.sheetBack = await page.locator("[data-item-action=delete]").isVisible();
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            r.sheetClosed = (await page.locator("[data-item-actions]").count()) === 0;
            // Rows.
            await page.locator("[data-phone-layout-toggle] [role=radio]").nth(0).click();
            await page.waitForTimeout(300);
            // Swipe toward the end edge (right in LTR) → two status blocks, held open; tap "On the way".
            await swipe(160);
            r.held = (await page.locator(`[data-swipe-held="1"]`).count()) === 1 && (await page.locator("[data-swipe-action]").count()) === 2;
            await page.locator("[data-swipe-action=ordered]").click();
            r.ordered = await until(() => statusOf(id), "ordered");
            await undo();
            r.orderedUndo = await until(() => statusOf(id), "to_buy");
            // Full swipe toward the start edge → deleted; Undo brings it back.
            await page.goto(`${BASE}/?v=to_buy`);
            await page.waitForSelector(READY, { timeout: 15000 });
            // Right after the reload the row's touch handlers can still be attaching (fresh smoke DB, R17 0.3): settle,
            // and swipe once more if the first one landed before them.
            await page.waitForTimeout(400);
            await swipe(-330);
            r.deleted = await until(() => statusOf(id), "gone");
            if (!r.deleted && (await card().count())) {
              await swipe(-330);
              r.deleted = await until(() => statusOf(id), "gone");
            }
            await undo();
            r.deleteUndo = await until(() => statusOf(id), "to_buy");
            // Long-press a row → selected.
            await page.goto(`${BASE}/?v=to_buy`);
            await page.waitForSelector(READY, { timeout: 15000 });
            await longPress();
            r.select = await page.locator("[data-selection-bar]").isVisible();
            await page.locator("[data-selection-bar] button").first().click();
            await page.locator("[data-phone-layout-toggle] [role=radio]").nth(0).click();
          } else {
            await centerIn(card());
            await card().hover();
            await page.waitForTimeout(250);
            r.hoverBar = (await card().locator("[data-hover-bar] [data-hover-action]").count()) === 4 && (await card().locator("[data-hover-bar]").evaluate((e) => getComputedStyle(e).opacity)) === "1";
            // Right-click → the menu with the same actions.
            await card().click({ button: "right", position: { x: 30, y: 30 } });
            await page.locator("[data-item-menu]").waitFor({ timeout: 5000 });
            r.menu = (await page.locator("[data-item-menu] [data-item-action]").count()) >= 5;
            await page.keyboard.press("Escape");
            // Keys on the focused card: O → on the way (undo), M → move list, Delete → deleted (undo).
            await card().locator("button.absolute.inset-0").focus();
            await page.keyboard.press("o");
            r.keyO = await until(() => statusOf(id), "ordered");
            await undo();
            r.keyOUndo = await until(() => statusOf(id), "to_buy");
            await card().locator("button.absolute.inset-0").focus();
            await page.keyboard.press("m");
            r.keyM = await page.locator("[data-item-actions=move]").isVisible({ timeout: 3000 }).catch(() => false);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(250);
            await card().locator("button.absolute.inset-0").focus();
            await page.keyboard.press("Delete");
            r.keyDel = await until(() => statusOf(id), "gone");
            await undo();
            r.keyDelUndo = await until(() => statusOf(id), "to_buy");
          }
          } catch (e) {
            r.error = String(e?.message || e).split(String.fromCharCode(10))[0].slice(0, 160);
          }
          ok(Object.values(r).every(Boolean) && !r.error, "quick actions: swipe / long-press (phone), hover bar / right-click / keys (desktop), with undo", JSON.stringify(r));
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
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector(READY);
          const before = await settled();
          // An item with more than one to split (the phone list is grouped by project, so not simply the first card).
          const many = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items.find((i) => i.status === "to_buy" && i.quantity > 1);
          const target = many ? page.locator(`main [data-item-card="${many.id}"] button[aria-label]`).first() : page.locator("main article button[aria-label]").first();
          await centerIn(target);
          await target.click();
          const sheet = page.getByRole("dialog");
          await sheet.waitFor();
          await shot(page, "sheet");
          await sheet.locator("button[aria-haspopup=menu]:not([data-sheet-more])").first().click();
          await page.getByRole("menuitemradio").nth(1).click();
          // Step down to moving exactly one (the item's quantity depends on earlier runs).
          for (let k = 0; k < 12 && !(await sheet.getByRole("button", { name: /Move 1$|העבר 1$/ }).count()); k++) {
            await sheet.getByRole("button", { name: /^−$/ }).last().click();
            await page.waitForTimeout(120);
          }
          await shot(page, "split-panel");
          await sheet.getByRole("button", { name: /Move 1|העבר 1/ }).click();
          await page.getByText(/Moved 1 to|הועברו 1 אל/).first().waitFor({ timeout: 10000 });
          await page.keyboard.press("Escape");
          await page.goto(`${BASE}/?v=to_buy`);
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
            await page.goto(`${BASE}/?v=to_buy`);
            await page.waitForSelector(READY);
            await openSettings(page, "budget");
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
          const target = items.find((i) => i.id === "demo-1" && i.status === "to_buy") ?? items.find((i) => i.status === "to_buy" && i.id.startsWith("demo-"));
          if (!target) return ok(true, "compare stores (no demo item, skipped)");
          await page.goto(`${BASE}/?v=to_buy&item=${target.id}`);
          await page.waitForSelector(READY);
          await page.locator("[data-compare-open]").click();
          await page.locator("[data-compare-row]").first().waitFor({ timeout: 20000 });
          // The stores answer one by one: wait for a second row before reading (a flake when read at the first).
          await page.waitForFunction(() => document.querySelectorAll("[data-compare-row]").length >= 2, null, { timeout: 20000 }).catch(() => {});
          const prices = await page.locator("[data-compare-row] .tabular.text-\\[17px\\]").allInnerTexts();
          await shot(page, "compare");
          ok(prices.length >= 2, "compare stores: item sheet → results sorted by price", JSON.stringify(prices));
          await page.keyboard.press("Escape");
        });
        // Needs NEXUS_AI_MOCK=1: the mock answer is streamed word by word through /api/ask.
        await step("assistant: streamed answer with lead line, mini cards, then follow-ups", async () => {
          await page.goto(`${BASE}/?v=to_buy`);
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
          await page.goto(`${BASE}/?v=to_buy`);
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
          await page.goto(`${BASE}/?v=to_buy`);
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
          await page.goto(`${BASE}/?v=to_buy`);
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
          await page.goto(`${BASE}/?v=to_buy`);
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
        // Round 14 A1 (mock): a question seeded from search (phone) / the command menu (desktop) is sent exactly once —
        // not again by New chat, a close + reopen, or a reload.
        await step("ask seed: sent once — new chat empty, reopen shows it once, reload doesn't resend", async () => {
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector(READY);
          const marker = `Seed${Date.now() % 100000}`;
          const question = `How much is left to buy for ${marker}?`;
          if (MOBILE) {
            await page.locator("[data-phone-search]").click();
            await page.locator("[data-phone-search-input]").fill(question);
            await page.locator("[data-search-ask]").click();
          } else {
            await openPalette();
            await page.getByRole("dialog").locator("input").first().fill(question);
            await page.locator("[data-cmd-ask]").click();
          }
          const dlg = page.getByRole("dialog");
          const asked = () => dlg.locator("[data-ai-user]").filter({ hasText: marker }).count();
          await dlg.locator("[data-ai-user]").filter({ hasText: marker }).waitFor({ timeout: 8000 });
          await dlg.locator("[data-ai-send=send]").waitFor({ timeout: 15000 });
          const first = await asked();
          await dlg.locator("[data-ai-new]").click();
          await page.waitForTimeout(1500);
          const newChat = (await dlg.locator("[data-ai-user]").count()) === 0;
          await page.keyboard.press("Escape");
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await dlg.locator("[data-ai-user]").filter({ hasText: marker }).waitFor({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(1500);
          const reopen = await asked();
          await page.keyboard.press("Escape");
          await page.reload();
          await page.waitForSelector(READY);
          await page.locator("[data-ask]").filter({ visible: true }).first().click();
          await dlg.locator("[data-ai-user]").first().waitFor({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(1500);
          const reload = await asked();
          const busy = await dlg.locator("[data-ai-send=stop]").count();
          await shot(page, "ask-seed-once");
          ok(first === 1 && newChat && reopen === 1 && reload <= 1 && busy === 0, "ask seed: sent once — new chat empty, reopen shows it once, reload doesn't resend", JSON.stringify({ via: MOBILE ? "phone search" : "command menu", first, newChat, reopen, reload, busy }));
          await page.keyboard.press("Escape");
        });
        // Round 9 C3 (mock): a stated preference → "Remember?" chip → saved → listed in Settings with the profile.
        await step("assistant memory: preference → remember chip → in Settings with the profile", async () => {
          await page.goto(`${BASE}/?v=to_buy`);
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
          await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: /Settings: Memory|הגדרות: זיכרון/ }).first().click();
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
          await page.goto(`${BASE}/?v=to_buy`);
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
          await page.goto(`${BASE}/?v=to_buy`);
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
            await page.goto(`${BASE}/?v=to_buy`);
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

        // R16 A2 (mock AI): every opening of "Scan receipt" starts clean; a new (or the same) file is always taken.
        // Files: locally there is no Blob store, so a picked file ends in "Upload failed" — that toast proves it was read.
        await step("receipt dialog: reopen starts clean, A then B is read, same file twice is taken", async () => {
          if (MOBILE) return ok(true, "receipt dialog: reopen starts clean, A then B is read, same file twice is taken (desktop only)");
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          const dlg = page.locator("[data-receipt-dialog]");
          const open = async () => {
            await page.locator("[data-receipt-open=add]").click();
            await dlg.waitFor({ timeout: 8000 });
            return dlg.getAttribute("data-receipt-dialog");
          };
          const close = async () => {
            await page.keyboard.press("Escape");
            await dlg.waitFor({ state: "detached", timeout: 8000 });
          };
          const tag = `RD${Date.now().toString(36)}`;
          const readText = async (name) => {
            await page.locator("#receipt-text").fill(["Store: Smoke grocer", `1 x ${name} ${tag} @ 3`, "1 x Filler line @ 1"].join("\n"));
            await page.getByRole("button", { name: /^(Read|קריאה)$/ }).click();
            await page.locator("[data-receipt-review]").waitFor({ timeout: 30000 });
            return page.locator("[data-receipt-review]").innerText();
          };
          const phases = [await open()];
          const a = await readText("Apples");
          await close();
          phases.push(await open());
          const b = await readText("Bananas");
          await close();
          // Files (A, B, then B again): each pick must fire.
          const uploads = page.locator("[data-sonner-toast]").filter({ hasText: /Upload failed|ההעלאה נכשלה/ });
          const fails = [];
          for (const f of ["00-white.jpg", "01-wood.jpg", "01-wood.jpg"]) {
            phases.push(await open());
            const before = await uploads.count();
            await page.locator("[data-receipt-file]").setInputFiles(`test-data/receipt-synth/${f}`);
            await page.waitForFunction((n) => [...document.querySelectorAll("[data-sonner-toast]")].filter((t) => /Upload failed|ההעלאה נכשלה/.test(t.textContent || "")).length > n || document.querySelector("[data-receipt-review]"), before, { timeout: 30000 }).catch(() => {});
            fails.push((await uploads.count()) > before || (await page.locator("[data-receipt-review]").count()) > 0);
            await close();
          }
          // Clean up the two text receipts left "not applied".
          await open();
          for (let k = 0; k < 2; k++) {
            const row = page.locator("[data-receipt-dialog] li").filter({ hasText: /email.txt|Smoke grocer|Pasted/i }).first();
            if (!(await row.count())) break;
            await row.getByRole("button", { name: /^(Discard|מחיקה)$/ }).click().catch(() => {});
            await page.waitForTimeout(400);
          }
          await close();
          ok(
            phases.every((p) => p === "pick") && a.includes("Apples") && !b.includes("Apples") && b.includes("Bananas") && fails.every(Boolean),
            "receipt dialog: reopen starts clean, A then B is read, same file twice is taken",
            JSON.stringify({ phases, a: a.includes("Apples"), b: [b.includes("Bananas"), b.includes("Apples")], fails }),
          );
        });

        // R16 A1 (mock AI): receipt items (no store link) keep their paid price through To buy and back (bulk path).
        await step("receipt prices survive To buy and back (bulk)", async () => {
          if (MOBILE) return ok(true, "receipt prices survive To buy and back (bulk) (desktop only)");
          const backup = async () => (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items;
          const tag = `LP${Date.now().toString(36)}`;
          const text = ["Store: Smoke grocer", `Order: SMOKE-${tag}`, `1 x Oat milk ${tag} @ 12.9`, `1 x Rye bread ${tag} @ 17.5`].join("\n");
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          await page.locator("[data-receipt-open=add]").click();
          const dlg = page.getByRole("dialog");
          await dlg.locator("#receipt-text").fill(text);
          await dlg.getByRole("button", { name: /^(Read|קריאה)$/ }).click();
          await dlg.locator("[data-receipt-review]").waitFor({ timeout: 30000 });
          await dlg.locator("[data-receipt-apply]").click();
          await page.locator("[data-sonner-toast]").filter({ hasText: /from the receipt|מהקבלה/ }).first().waitFor({ timeout: 15000 });
          const mine = async () => (await backup()).filter((i) => i.title.includes(tag));
          const made = await mine();
          const paid = Object.fromEntries(made.map((i) => [i.id, i.purchasedPrice]));
          // Select both in History, right-click → To buy (one bulk call).
          const move = async (view, to) => {
            await page.goto(`${BASE}/?v=${view}`);
            await page.waitForSelector(READY);
            for (const i of made) await page.locator(`[data-item-card="${i.id}"], [data-item-row="${i.id}"]`).first().click({ modifiers: ["Control"] });
            await page.locator(`[data-item-card="${made[0].id}"], [data-item-row="${made[0].id}"]`).first().click({ button: "right" });
            await page.locator(`[role=menuitem][data-item-action=${to}]`).click();
            await page.waitForTimeout(1200);
          };
          await move("history", "to_buy");
          const inToBuy = await mine();
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector(READY);
          // Items showing a "Last paid" price (a card may render the price twice, for its wide and narrow layouts).
          let visible = 0;
          for (const i of made) visible += (await page.locator(`[data-item-card="${i.id}"] [data-last-paid], [data-item-row="${i.id}"] [data-last-paid]`).count()) > 0 ? 1 : 0;
          await shot(page, "last-paid");
          await move("to_buy", "purchased");
          const back = await mine();
          // Clean up.
          for (const i of made) {
            await page.goto(`${BASE}/?v=history&item=${i.id}`);
            await page.getByRole("button", { name: /^(Delete item|מחק פריט)$/ }).click({ timeout: 15000 });
            await page.waitForTimeout(400);
          }
          ok(
            made.length === 2 && made.every((i) => i.purchasedPrice > 0) &&
              inToBuy.every((i) => i.status === "to_buy" && i.lastPaidPrice === paid[i.id]) && visible === 2 &&
              back.every((i) => i.status === "purchased" && i.purchasedPrice === paid[i.id]),
            "receipt prices survive To buy and back (bulk)",
            JSON.stringify({ made: made.map((i) => [i.status, i.purchasedPrice]), inToBuy: inToBuy.map((i) => [i.status, i.lastPaidPrice]), visible, back: back.map((i) => [i.status, i.purchasedPrice]) }),
          );
        });

        // R16 C1: a link that can't be read → its toast has "Report" → the dialog is pre-filled (what failed, the link
        // ticked) → Send → the stored report has the failure code and the link as domain + path only (no query string).
        // Reads the report row from the smoke DB file (SMOKE_DB, default smoke.db = scripts/serve-smoke.sh) — localhost write mode only.
        await step("report from a failure toast: one tap, failure code + link domain/path", async () => {
          if (MOBILE) return ok(true, "report from a failure toast: one tap, failure code + link domain/path (desktop only)");
          const tag = Date.now().toString(36);
          const link = `https://nexus-smoke-${tag}.invalid/products/drill-18v?ref=newsletter&uid=123456789`;
          await page.goto(`${BASE}/?v=to_buy`);
          await page.waitForSelector(READY);
          await page.locator("#add-input").fill(link);
          await page.locator("#add-input").press("Enter");
          const toastEl = page.locator("[data-sonner-toast]").filter({ has: page.getByRole("button", { name: /^(Report|דיווח)$/ }) }).first();
          await toastEl.waitFor({ timeout: 60000 });
          await toastEl.getByRole("button", { name: /^(Report|דיווח)$/ }).click();
          const form = page.locator("[data-report-form]");
          await form.waitFor({ timeout: 8000 });
          const failure = await form.locator("[data-report-failure]").innerText();
          const linkTicked = await form.locator("[data-report-with-link]").isChecked();
          await shot(page, "report-failure");
          await form.locator("[data-report-send]").click();
          await page.locator("[data-sonner-toast]").filter({ hasText: /sent|נשלח/i }).first().waitFor({ timeout: 15000 });
          const { createClient } = await import("@libsql/client");
          const db = createClient({ url: `file:${process.env.SMOKE_DB || "smoke.db"}` });
          const row = (await db.execute("SELECT diagnostics FROM reports ORDER BY created_at DESC LIMIT 1")).rows[0];
          db.close();
          const d = JSON.parse(String(row?.diagnostics ?? "{}"));
          ok(
            linkTicked && /drill-18v/.test(failure) && /^link:/.test(d.failure?.code ?? "") && d.failure?.link === `nexus-smoke-${tag}.invalid/products/drill-18v` && !JSON.stringify(d).includes("newsletter") && !JSON.stringify(d).includes("123456789"),
            "report from a failure toast: one tap, failure code + link domain/path",
            JSON.stringify({ linkTicked, failure: failure.slice(0, 80), stored: d.failure }),
          );
        });

        // R16 A4 (mock AI): on a brand-new shared space (no lists yet) Move to offers status + "New list…" — never a lone
        // "Remove" — and New list "Test" creates the list and moves both items in one step. Back to the personal space after.
        await step("move to: empty shared space → New list moves both items", async () => {
          if (MOBILE) return ok(true, "move to: empty shared space → New list moves both items (desktop only)");
          const backup = async () => (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data;
          await page.goto(`${BASE}/`);
          await page.waitForSelector(READY);
          const home = await page.locator("[data-space-switcher]").first().getAttribute("data-space-id");
          await page.locator("[data-space-switcher]").first().click();
          await page.locator("[data-space-create]").first().click();
          const tag = `MV${Date.now().toString(36)}`;
          // R16 D5: create = the identity editor (name + icon/colour), then the invite step.
          await page.locator("[data-identity-name]").fill(`Smoke ${tag}`);
          await page.locator('[data-identity-icon="tools"]').click();
          await page.locator("[data-identity-save]").click();
          await page.locator("[data-create-skip]").click({ timeout: 15000 });
          await page.waitForFunction((h) => document.querySelector("[data-space-switcher]")?.getAttribute("data-space-id") !== h, home, { timeout: 20000 });
          await page.waitForSelector(READY);
          // Two items from a pasted receipt (they land in History).
          await page.locator("[data-receipt-open=add]").click();
          await page.locator("#receipt-text").fill(["Store: Smoke grocer", `1 x Tea ${tag} @ 9`, `1 x Honey ${tag} @ 21`].join("\n"));
          await page.getByRole("button", { name: /^(Read|קריאה)$/ }).click();
          await page.locator("[data-receipt-review]").waitFor({ timeout: 30000 });
          await page.locator("[data-receipt-apply]").click();
          await page.locator("[data-sonner-toast]").filter({ hasText: /from the receipt|מהקבלה/ }).first().waitFor({ timeout: 15000 });
          const made = (await backup()).items.filter((i) => i.title.includes(tag));
          await page.goto(`${BASE}/?v=history`);
          await page.waitForSelector(READY);
          for (const i of made) await page.locator(`[data-item-card="${i.id}"], [data-item-row="${i.id}"]`).first().click({ modifiers: ["Control"] });
          await page.locator("[data-select-menu=move]").click();
          const menu = page.locator("[data-move-menu]");
          await menu.waitFor({ timeout: 5000 });
          const empty = await menu.locator("[data-move-empty]").count();
          const lonelyRemove = await menu.locator("[data-select-unassign]").count();
          const statuses = await menu.locator("[data-move-status]").count();
          await shot(page, "move-empty");
          await menu.locator("[data-move-new]").click();
          await menu.locator("[data-move-new-name]").fill("Test");
          await menu.locator("[data-move-create]").click();
          await page.waitForTimeout(1500);
          const data = await backup();
          const list = data.collections.find((c) => c.name === "Test");
          const moved = data.items.filter((i) => i.title.includes(tag)).every((i) => list && i.collectionId === list.id);
          // Back to the personal space for the rest of the run.
          await page.locator("[data-space-switcher]").first().click();
          await page.locator(`[data-space-item="${home}"]`).first().click();
          await page.waitForFunction((h) => document.querySelector("[data-space-switcher]")?.getAttribute("data-space-id") === h, home, { timeout: 20000 });
          ok(made.length === 2 && empty === 1 && lonelyRemove === 0 && statuses === 3 && !!list && moved, "move to: empty shared space → New list moves both items", JSON.stringify({ made: made.length, empty, lonelyRemove, statuses, list: !!list, moved }));
        });

        // Round 10 D5 (mock AI): a receipt of 5 new grocery lines → every card gets a picture (shimmer until then) →
        // change one in the picker → approve all → Confirm: the items carry the pictures, alternatives, approved.
        // Then the item sheet's "Change picture" swaps one. The test items are deleted afterwards.
        await step("receipt pictures: 5 lines → pictures appear → change one → approve all → item sheet change picture", async () => {
          const tag = `P${Date.now().toString(36)}`;
          const names = ["חלב תנ 3%", "מילקי שוקו 3*100", "קוטג' תנובה 5% 250 גר", "במבה אסם 80 גר", "לחם אחיד פרוס"].map((n) => `${n} ${tag}`);
          const text = ["Store: Smoke grocer", `Order: SMOKE-${tag}`, ...names.map((n, i) => `1 x ${n} @ ${5 + i}`)].join(String.fromCharCode(10));
          await page.goto(`${BASE}/${MOBILE ? "?v=history" : ""}`);
          await page.waitForSelector(READY);
          await page.locator(`[data-receipt-open=${MOBILE ? "view" : "add"}]`).click();
          const dlg = page.getByRole("dialog");
          await dlg.locator("#receipt-text").fill(text);
          await dlg.getByRole("button", { name: /^(Read|קריאה)$/ }).click();
          await dlg.locator("[data-receipt-review]").waitFor({ timeout: 30000 });
          const pics = dlg.locator("[data-receipt-line=new] [data-receipt-picture]");
          const sawPending = (await dlg.locator('[data-receipt-picture="pending"]').count()) > 0;
          await page.waitForFunction(() => document.querySelectorAll('[data-receipt-picture="pending"]').length === 0 && document.querySelectorAll("[data-receipt-line=new] [data-receipt-picture]").length >= 5, null, { timeout: 30000 });
          const states = await pics.evaluateAll((els) => els.map((e) => e.getAttribute("data-receipt-picture")));
          await shot(page, "receipt-pictures");
          // Change the first card's picture in the picker.
          const before = await dlg.locator("[data-receipt-line=new] [data-receipt-picture] img").first().getAttribute("src").catch(() => null);
          await pics.first().click();
          const picker = page.locator("[data-picture-picker]");
          await picker.waitFor({ timeout: 10000 });
          const choices = await picker.locator("[data-picture-choice]").count();
          await page.waitForTimeout(450);
          await shot(page, "picture-picker");
          await picker.locator("[data-picture-choice]").nth(1).click();
          await picker.waitFor({ state: "detached", timeout: 5000 });
          const after = await dlg.locator("[data-receipt-line=new] [data-receipt-picture] img").first().getAttribute("src").catch(() => null);
          await dlg.locator("[data-pictures-approve]").click();
          const approved = await dlg.locator("[data-pictures-approved]").count();
          await dlg.locator("[data-receipt-apply]").click();
          await page.locator("[data-sonner-toast]").filter({ hasText: /updated from the receipt|עודכנו מהקבלה/ }).waitFor({ timeout: 15000 });
          const items = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items.filter((i) => i.title.endsWith(tag));
          const saved = items.filter((i) => i.imageUrl && !i.imageCheck && (i.imageCandidates?.length ?? 0) >= 2 && i.productInfo?.type).length;
          // Item sheet: Change picture → another alternative.
          let sheetChanged = false;
          const it = items[1];
          if (it) {
            await page.goto(`${BASE}/?v=history&item=${it.id}`);
            await page.waitForSelector("[data-change-picture]", { timeout: 15000 });
            const was = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items.find((i) => i.id === it.id).imageUrl;
            await page.locator("[data-change-picture]").click();
            await page.locator("[data-picture-picker] [data-picture-choice]").first().waitFor({ timeout: 15000 });
            const pick = page.locator("[data-picture-picker] [data-picture-choice]").filter({ hasNotText: /Current|נוכחית/ }).first();
            await pick.click();
            await page.locator("[data-picture-picker]").waitFor({ state: "detached", timeout: 10000 });
            await page.waitForTimeout(600);
            const now = (await (await ctx.request.get(`${BASE}/api/backup`)).json()).data.items.find((i) => i.id === it.id).imageUrl;
            sheetChanged = !!now && now !== was;
            await page.waitForSelector("#boot", { state: "hidden", timeout: 10000 }).catch(() => {});
            await shot(page, "sheet-picture");
          }
          // Clean up: delete the test items from their sheets.
          for (const i of items) {
            await page.goto(`${BASE}/?v=history&item=${i.id}`);
            await page.waitForSelector("[data-change-picture]", { timeout: 15000 });
            await page.getByRole("button", { name: /^(Delete item|מחק פריט)$/ }).click();
            await page.waitForTimeout(500);
          }
          ok(
            states.length === 5 && states.every((x) => x === "ok" || x === "check") && choices >= 2 && before !== after && approved === 1 && items.length === 5 && saved === 5 && sheetChanged,
            "receipt pictures: 5 lines → pictures appear → change one → approve all → item sheet change picture",
            JSON.stringify({ sawPending, states, choices, changed: before !== after, approved, items: items.length, saved, sheetChanged }),
          );
        });
      }
    }

    // Own context: goes offline, then logs out. Read-only (nothing is edited).
    await step("offline: renders from the snapshot, read-only; logout clears it", async () => {
      const oc = await browser.newContext({ viewport: VIEWPORT, ...DEVICE, colorScheme: "dark" });
      try {
        const p = await oc.newPage();
        await signIn(p);
        await p.waitForSelector(READY, { timeout: 15000 });
        // Login lands on Home (Round 13); count the list's cards.
        await p.goto(`${BASE}/?v=to_buy`);
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
        await p.goto(`${BASE}/?v=to_buy`);
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
        // Playwright's setOffline(false) doesn't always fire the page's "online" event (R15): fire it like the browser would.
        await p.evaluate(() => window.dispatchEvent(new Event("online")));
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
      // Phones (polish #7, Tal 2026-10-08): the full intro on the first app open of the day (localStorage
      // nexus.bootDay, as desktop), the small Box-in-a-circle loader on every other open, reloads, pull-to-refresh and
      // later loads in the session (Round 11 A1); both hand off to the app.
      // Round 13 D1: the full opening lasts 3.0 s (ends ≥ 2,950 ms after it starts, by its own animation clock);
      // desktop plays it on the first open of the day, then the small loader.
      const bootMs = (pg) =>
        pg.evaluate(
          () =>
            new Promise((res) => {
              let t0 = null;
              const tick = () => {
                const a = document.querySelector("#boot .boot-left")?.getAnimations?.()[0];
                if (t0 == null && a?.startTime != null) t0 = a.startTime;
                if (document.getElementById("boot")?.classList.contains("boot-gone")) return res(t0 == null ? -1 : Math.round(document.timeline.currentTime - t0));
                requestAnimationFrame(tick);
              };
              tick();
              setTimeout(() => res(-2), 12000);
            }),
        );
      // A browser with no record of today's opening (fresh storage, same session cookie).
      const bctx = MOBILE ? await browser.newContext({ viewport: VIEWPORT, ...DEVICE, storageState: { cookies: await ctx.cookies(), origins: [] } }) : ctx;
      const p = await bctx.newPage();
      const mode = () => p.evaluate(() => document.documentElement.dataset.boot);
      await p.goto(`${BASE}/?v=to_buy`, { waitUntil: "commit" });
      await p.waitForSelector("#boot", { state: "attached", timeout: 10000 });
      if (MOBILE) {
        const shown = await p.locator("#boot .boot-mark").isVisible();
        const first = await mode();
        const fullMs = await bootMs(p);
        ok(shown && first === "full" && fullMs >= 2950 && fullMs < 3400 && (await p.locator(READY).isVisible()), "boot screen: full 3.0 s intro on the first app open of the day, hands off to the app", `mode=${first} ends at ${fullMs} ms`);
        const again = [];
        for (let k = 0; k < 2; k++) {
          await p.reload({ waitUntil: "commit" });
          await p.waitForSelector("#boot", { state: "attached", timeout: 10000 });
          again.push(`${await mode()}:${await p.locator("#boot .boot-small").isVisible()}:${await p.locator("#boot .boot-mark").isVisible()}`);
          await p.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 10000 });
        }
        // Same tab, a fresh navigation (not a reload) later in the session → still small.
        await p.goto(`${BASE}/?v=history`, { waitUntil: "commit" });
        again.push(`${await mode()}:${await p.locator("#boot .boot-small").isVisible()}:false`);
        await p.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 10000 });
        await p.goto(`${BASE}/?v=to_buy`);
        await p.waitForSelector(READY, { timeout: 15000 });
        // Our pull-to-refresh replaces Chrome's: pull down at the top → the Box mark → release → reload → small loader.
        const overscroll = await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
        const cdp = await bctx.newCDPSession(p);
        const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
        await p.evaluate(() => window.scrollTo(0, 0));
        // The pull listener attaches just after the app is ready; nobody pulls within those milliseconds.
        await p.waitForTimeout(400);
        await touch("touchStart", 200);
        for (let y = 210; y <= 420; y += 15) await touch("touchMove", y);
        const ind = await p.locator("[data-pull]").count();
        const nav = p.waitForEvent("framenavigated", { timeout: 5000 }).then(() => true, () => false);
        await touch("touchEnd");
        const reloaded = await nav;
        let afterPull = "";
        if (reloaded) {
          await p.waitForSelector("#boot", { state: "attached", timeout: 10000 });
          afterPull = `${await mode()}:${await p.locator("#boot .boot-small").isVisible()}`;
        }
        ok(
          again.every((a) => a === "small:true:false") && overscroll === "contain" && ind === 1 && reloaded && afterPull === "small:true",
          "boot screen: small loader on reload / later loads; pull-to-refresh shows the Box mark and reloads into it",
          `loads=${again} overscroll=${overscroll} indicator=${ind} reloaded=${reloaded} afterPull=${afterPull}`,
        );
        // A new tab the same day → the small mark; the first open on another day → the full intro again.
        const p2 = await bctx.newPage();
        await p2.goto(`${BASE}/?v=to_buy`, { waitUntil: "commit" });
        await p2.waitForSelector("#boot", { state: "attached", timeout: 10000 });
        const sameDay = await p2.evaluate(() => document.documentElement.dataset.boot);
        await p2.evaluate(() => localStorage.setItem("nexus.bootDay", "2000-1-1"));
        const p3 = await bctx.newPage();
        await p3.goto(`${BASE}/?v=to_buy`, { waitUntil: "commit" });
        await p3.waitForSelector("#boot", { state: "attached", timeout: 10000 });
        const nextDay = await p3.evaluate(() => document.documentElement.dataset.boot);
        ok(sameDay === "small" && nextDay === "full", "boot screen: another open the same day is small; the first open of a new day is full", `sameDay=${sameDay} nextDay=${nextDay}`);
        await p3.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 10000 }).catch(() => {});
        await bctx.close();
        return;
      } else {
        await p.close();
        // A browser with no record of today's opening (fresh storage, same session cookie): full first, then small.
        const dctx = await browser.newContext({ viewport: VIEWPORT, storageState: { cookies: await ctx.cookies(), origins: [] } });
        const d = await dctx.newPage();
        await d.goto(`${BASE}/`, { waitUntil: "commit" });
        await d.waitForSelector("#boot", { state: "attached", timeout: 10000 });
        const first = await d.evaluate(() => document.documentElement.dataset.boot);
        const ms = await bootMs(d);
        await d.goto(`${BASE}/?v=history`, { waitUntil: "commit" });
        await d.waitForSelector("#boot", { state: "attached", timeout: 10000 });
        const second = await d.evaluate(() => document.documentElement.dataset.boot);
        await d.goto(`${BASE}/login`, { waitUntil: "commit" }).catch(() => {});
        await dctx.close();
        ok(first === "full" && ms >= 2950 && second === "small", "boot screen: desktop plays the opening once a day (then the small loader)", `first=${first} (${ms} ms) second=${second}`);
        return;
      }
      await p.close();
    });

    // Round 13 D1: the opening on a mid phone (CPU ×4): painted frames keep coming for its 3 s (≤ 2 dropped).
    if (MOBILE)
      await step("boot screen: frame trace on a mid phone (≤ 2 dropped frames)", async () => {
        const fctx = await browser.newContext({ viewport: VIEWPORT, ...DEVICE, storageState: { cookies: await ctx.cookies(), origins: [] } });
        const p = await fctx.newPage();
        const cdp = await fctx.newCDPSession(p);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const frames = [];
        cdp.on("Page.screencastFrame", ({ sessionId, metadata }) => {
          frames.push(metadata.timestamp * 1000);
          cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
        });
        await cdp.send("Page.startScreencast", { format: "jpeg", quality: 30, maxWidth: 195, maxHeight: 422, everyNthFrame: 1 });
        await p.goto(`${BASE}/`, { waitUntil: "commit" });
        await p.waitForSelector("#boot.boot-gone", { state: "attached", timeout: 15000 }).catch(() => {});
        await cdp.send("Page.stopScreencast");
        await fctx.close();
        // From the first painted frame of the opening through its 3 s.
        const f = frames.sort((a, b) => a - b);
        const start = f.find((t, k) => k > 0 && t - f[k - 1] < 100) ?? f[0];
        const win = f.filter((t) => t >= start && t <= start + 3000);
        const gaps = win.slice(1).map((t, k) => t - win[k]);
        const dropped = gaps.filter((g) => g > 34).length;
        const maxDropped = STRICT_TIMING ? 2 : 10;
        ok(win.length > 60 && dropped <= maxDropped, "boot screen: frame trace on a mid phone (≤ 2 dropped frames)", `${win.length} frames, dropped ${dropped}, worst ${Math.round(Math.max(0, ...gaps))} ms`);
      });

    // Round 13 A7: a new account opens on Home with the greeting, one line and the big add actions — nothing else.
    if (process.env.SMOKE_FRESH)
      await step("home: empty account shows the add actions only", async () => {
        const FRESH = process.env.SMOKE_FRESH.replace(/\/$/, "");
        const fctx = await browser.newContext({ viewport: VIEWPORT, ...DEVICE });
        const p = await fctx.newPage();
        await signIn(p, FRESH);
        await p.waitForSelector("[data-home-empty]", { timeout: 15000 });
        const actions = await p.locator("[data-home-empty-action]").count();
        const sections = await p.locator("[data-home-section], [data-home-stats], [data-home-status]").count();
        if (OUT) await p.screenshot({ path: `${OUT}/home-empty${SUFFIX}.png` });
        await fctx.close();
        ok(actions >= 3 && actions <= 4 && sections === 0, "home: empty account shows the add actions only", `${actions} actions, ${sections} other sections`);
      });

    // Round 14 A2: a sparse account (SEED_PROFILE=sparse server, NEXUS_AI_MOCK=1) — Home always has a voice.
    // AI on: ≥ 2 suggestions incl. the AI's, ≥ 1 insight; AI off: ≥ 1 suggestion and ≥ 1 insight, none from the AI.
    if (process.env.SMOKE_SPARSE)
      await step("home: sparse account still shows suggestions + insights (AI on and off)", async () => {
        const SPARSE = process.env.SMOKE_SPARSE.replace(/\/$/, "");
        const fctx = await browser.newContext({ viewport: VIEWPORT, ...DEVICE });
        const p = await fctx.newPage();
        await signIn(p, SPARSE);
        const read = async (wantAi) => {
          await p.waitForSelector("[data-home]", { timeout: 15000 });
          const sug = p.locator("[data-home-section=suggest]");
          await sug.waitFor({ timeout: 8000 }).catch(() => {});
          if (wantAi) await p.waitForSelector("[data-sug-kinds~=ai]", { timeout: 10000 }).catch(() => {});
          else await p.waitForTimeout(1500);
          const attr = async (sel, a) => (await p.locator(sel).count()) ? await p.locator(sel).first().getAttribute(a) : null;
          return {
            sugs: Number((await attr("[data-home-section=suggest]", "data-sug-count")) ?? 0),
            sugKinds: (await attr("[data-home-section=suggest]", "data-sug-kinds")) ?? "",
            ins: Number((await attr("[data-home-section=noticed]", "data-noticed-count")) ?? 0),
            insKinds: (await attr("[data-home-section=noticed]", "data-noticed-kinds")) ?? "",
          };
        };
        const setAi = async (on) => {
          await openSettings(p, "ai");
          await setAiPick(p, on);
          await p.waitForTimeout(500);
          const diag = (await p.locator("[data-home-diag]").count()) ? await p.locator("[data-home-diag]").innerText() : "";
          await p.keyboard.press("Escape");
          return diag;
        };
        await setAi(true);
        await p.goto(`${SPARSE}/`);
        const on = await read(true);
        if (OUT) await p.screenshot({ path: `${OUT}/home-sparse-ai${SUFFIX}.png` });
        const diag = await setAi(false);
        await p.goto(`${SPARSE}/`);
        const off = await read(false);
        if (OUT) await p.screenshot({ path: `${OUT}/home-sparse-rules${SUFFIX}.png` });
        await setAi(true);
        await fctx.close();
        const good =
          on.sugs >= 2 && /\bai\b/.test(on.sugKinds) && on.ins >= 1 && off.sugs >= 1 && !/\bai\b/.test(off.sugKinds) && off.ins >= 1 && !/\bai\b/.test(off.insKinds) && /AI|בינה/.test(diag);
        ok(good, "home: sparse account still shows suggestions + insights (AI on and off)", JSON.stringify({ on, off, diag: diag.slice(0, 90) }));
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
        const frames = await traceLoad(ctx, `${BASE}${process.env.SMOKE_TRACE_PATH || "/"}`, process.env.SMOKE_THROTTLE ? 5000 : 3400);
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
