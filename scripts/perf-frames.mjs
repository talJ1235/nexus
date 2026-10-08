// R16 frame timings for motion items (A7, A11, A12/D4): measure before and after a change, numbers go into the brief.
//   bash scripts/serve-smoke.sh, then node scripts/perf-frames.mjs plus [--cpu 6] [--runs 5]
// Scenarios:
//   plus    — phone 390×844: open the "+" sheet, then close it (tap the scrim); frame gaps during each 450 ms window.
//   switch  — desktop 1366×768: switch spaces from the sidebar switcher; sidebar box per frame + frame gaps.
//   suggest — phone 390: swipe the Nexus suggests carousel; desktop: drag it. Frame gaps during the gesture.
// Frame gaps come from requestAnimationFrame deltas in the page (CPU throttled via CDP). Prints JSON per run + a summary.
import { signIn } from "./lib/sign-in.mjs";
import { chromium } from "playwright";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const args = process.argv.slice(2);
const scenario = args[0] || "plus";
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const CPU = opt("--cpu", scenario === "plus" ? 6 : 4);
const RUNS = opt("--runs", 5);
const phone = scenario === "plus" || (scenario === "suggest" && !args.includes("--desktop"));

const browser = await chromium.launch();
const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
await signIn(page, BASE); // R17 E1: scripts/lib/sign-in.mjs
await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 });
await page.waitForSelector("#boot", { state: "hidden", timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);

// Records rAF deltas until stop(); returns { frames, max, over32, over50, p95 } in ms.
const startFrames = () =>
  page.evaluate(() => {
    const w = window;
    w.__frames = [];
    w.__rec = true;
    let last = performance.now();
    const tick = (t) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__rec) requestAnimationFrame(tick);
    };
    requestAnimationFrame((t) => {
      last = t;
      requestAnimationFrame(tick);
    });
  });
const stopFrames = () =>
  page.evaluate(() => {
    const w = window;
    w.__rec = false;
    const f = w.__frames.slice();
    const sorted = [...f].sort((a, b) => a - b);
    const r = (x) => Math.round(x * 10) / 10;
    return { frames: f.length, max: r(Math.max(0, ...f)), over32: f.filter((x) => x > 32).length, over50: f.filter((x) => x > 50).length, p95: r(sorted[Math.floor(sorted.length * 0.95)] ?? 0), fps: r(f.length ? 1000 / (f.reduce((a, b) => a + b, 0) / f.length) : 0) };
  });

const results = [];
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
for (let run = 0; run < RUNS; run++) {
  if (scenario === "plus") {
    await startFrames();
    await page.click("[data-plus]");
    await page.waitForTimeout(450);
    const open = await stopFrames();
    await page.waitForTimeout(300);
    await startFrames();
    await page.mouse.click(195, 120); // the scrim, above the cards
    await page.waitForTimeout(450);
    const close = await stopFrames();
    await page.waitForTimeout(400);
    results.push({ open, close });
  } else if (scenario === "suggest") {
    const box = await page.locator("[data-home-section=suggest]").first().boundingBox();
    if (!box) throw new Error("no suggestions carousel on Home");
    const y = box.y + Math.min(box.height / 2, 80);
    await startFrames();
    if (phone) {
      // Touch swipe toward the start edge (LTR: right → left).
      const steps = 12;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * 0.8, y }] });
      for (let k = 1; k <= steps; k++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * (0.8 - (0.6 * k) / steps), y }] });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(box.x + box.width * 0.8, y);
      await page.mouse.down();
      for (let k = 1; k <= 12; k++) await page.mouse.move(box.x + box.width * (0.8 - (0.6 * k) / 12), y, { steps: 1 });
      await page.mouse.up();
    }
    await page.waitForTimeout(500);
    results.push({ swipe: await stopFrames() });
  }
}
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
for (const r of results) console.log(JSON.stringify(r));
const keys = Object.keys(results[0] ?? {});
for (const k of keys) {
  const xs = results.map((r) => r[k]);
  console.log(`SUMMARY ${scenario}.${k} (CPU ×${CPU}, ${RUNS} runs): max frame ${Math.max(...xs.map((x) => x.max))} ms · frames > 32 ms ${xs.reduce((a, x) => a + x.over32, 0)} · > 50 ms ${xs.reduce((a, x) => a + x.over50, 0)} · median p95 ${xs.map((x) => x.p95).sort((a, b) => a - b)[Math.floor(xs.length / 2)]} ms · median fps ${xs.map((x) => x.fps).sort((a, b) => a - b)[Math.floor(xs.length / 2)]}`);
}
await browser.close();
