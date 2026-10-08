// R17 A7 — the space switch moment: N switches each way between the personal space and a shared one, on a production
// build with the seeded data (scripts/lib/test-app.mjs). Per switch: the data's time (tap → `moment:ready`), the whole
// moment (tap → `moment:end`) and the frame rate while it runs (rAF). Prints p50/p95 and checks the acceptance: every
// total within ±50 ms of SWITCH_MS (when the data is in time), ≥ 55 fps median.
//   npm run build, then  node scripts/switch-timing.mjs [N=20]  (REDUCE=1: reduced motion, 600 ms)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { startApp } from "./lib/test-app.mjs";

const N = Number(process.argv[2] || 20);
const REDUCE = !!process.env.REDUCE;
const SWITCH_MS = REDUCE ? 600 : Number(readFileSync("src/components/app/spaces/moment.tsx", "utf8").match(/SWITCH_MS = (\d+)/)[1]);
const app = await startApp({ db: "switch-test.db", port: Number(process.env.PORT || 3110) });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, reducedMotion: REDUCE ? "reduce" : "no-preference" });
await ctx.addCookies(app.cookies(app.personal));
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem("nexus.opened", "1");
    const d = new Date();
    localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
  } catch {}
});
const page = await ctx.newPage();
await page.goto(`${app.base}/`);
await page.waitForSelector("[data-app-shell][data-ready]");
const runs = [];
for (let k = 0; k < N * 2; k++) {
  const to = k % 2 === 0 ? "pa_big" : app.personal;
  await page.locator("[data-space-switcher]").filter({ visible: true }).first().click();
  await page.waitForTimeout(250);
  const r = await page.evaluate(async (to) => {
    performance.clearMarks();
    const frames = [];
    let on = true;
    const tick = (t) => (frames.push(t), on && requestAnimationFrame(tick));
    requestAnimationFrame(tick);
    const t0 = performance.now();
    document.querySelector(`[data-space-item="${to}"]`)?.click();
    for (let i = 0; i < 200 && !performance.getEntriesByName("moment:end").length; i++) await new Promise((r) => setTimeout(r, 50));
    on = false;
    const m = (n) => performance.getEntriesByName(n).at(-1)?.startTime;
    const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
    return { ready: Math.round(m("moment:ready") - t0), total: Math.round(m("moment:end") - t0), fps: Math.round(1000 / (gaps[gaps.length >> 1] || 16.7)) };
  }, to);
  runs.push({ dir: k % 2 === 0 ? "→ shared" : "→ personal", first: k < 2, ...r });
  await page.waitForTimeout(400);
}
await browser.close();
app.stop();
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const ready = runs.map((r) => r.ready);
const total = runs.map((r) => r.total);
console.log(`INFO ${runs.length} switches, SWITCH_MS ${SWITCH_MS}${REDUCE ? " (reduced)" : ""}`);
console.log(`INFO data ready: p50 ${q(ready, 0.5)} ms, p95 ${q(ready, 0.95)} ms, max ${Math.max(...ready)} ms (first of session: ${runs.filter((r) => r.first).map((r) => r.ready).join(", ")} ms)`);
console.log(`INFO total: min ${Math.min(...total)} ms, p50 ${q(total, 0.5)} ms, max ${Math.max(...total)} ms; fps median ${q(runs.map((r) => r.fps), 0.5)}`);
const inTime = runs.filter((r) => r.ready <= SWITCH_MS - 240);
const off = inTime.filter((r) => Math.abs(r.total - SWITCH_MS) > 50);
const fps = q(runs.map((r) => r.fps), 0.5);
const pass = off.length === 0 && fps >= 55;
console.log(`${pass ? "PASS" : "FAIL"} every switch with its data in time ends within ±50 ms of ${SWITCH_MS} ms (${inTime.length}/${runs.length}), median ≥ 55 fps${pass ? "" : ` — off: ${JSON.stringify(off.slice(0, 5))}, fps ${fps}`}`);
process.exit(pass ? 0 : 1);
