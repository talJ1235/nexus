// Polish fixes (docs/POLISH-AUDIT.md) — the checks that need a running app and the worst-case data:
//   #6  every main route in the 500-item space (scripts/seed-worst.mjs) logs 0 hydration errors (next dev: the
//       unminified message names the mismatching text)
//   #29 30 page navigations in 30 s across 3 spaces → 0 responses with status 429
// Usage: node scripts/test-polish.mjs   (starts `next dev` on PORT=3108, throwaway polish-test.db; first compile is slow)
import { createClient } from "@libsql/client";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 3108);
const BASE = `http://localhost:${PORT}`;
const DB = "polish-test.db";
const SECRET = "polish-test-secret-0123456789abcdef-xyz";
const ADMIN = "polish-admin@example.com";
const ENV = {
  ...process.env,
  NODE_ENV: "development",
  TURSO_DATABASE_URL: `file:${DB}`,
  TURSO_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: BASE,
  AUTH_FULL_LOCAL: "0",
  ADMIN_EMAIL: ADMIN,
  APP_PASSWORD: "",
  GEMINI_API_KEY: "",
  GROQ_API_KEY: "",
  SERPER_API_KEY: "",
  BLOB_READ_WRITE_TOKEN: "",
  GOOGLE_CLIENT_ID: "",
  ABLY_API_KEY: "",
  NEXUS_AI_MOCK: "1",
  // Next fills EMPTY env values from .env.local, so blanks above aren't enough for Ably: the local fake transport
  // keeps the test off the network (the token route and its limit still run).
  REALTIME_FAKE: "1",
  NEXT_DIST_DIR: undefined,
};
let fails = 0;
const ok = (c, m, d = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && d ? ` — ${d}` : ""}`);
};

// ---------- DB: the admin's personal space (seed-local) + the worst-case spaces (seed-worst) ----------
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
const tsx = (f) => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", f], { env: ENV, stdio: "ignore" });
tsx("src/db/migrate.ts");
execFileSync(process.execPath, ["scripts/seed-local.mjs"], { env: ENV, stdio: "ignore" });
execFileSync(process.execPath, ["scripts/seed-worst.mjs"], { env: ENV, stdio: "ignore" });
const db = createClient({ url: `file:${DB}` });
const admin = (await db.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [ADMIN] })).rows[0].id;
const personal = (await db.execute({ sql: `SELECT id FROM space WHERE kind = 'personal' AND created_by = ?`, args: [admin] })).rows[0].id;
const token = randomBytes(24).toString("base64url");
const now = Date.now();
await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [`ps_${token.slice(0, 10)}`, now + 86_400_000, token, now, now, admin] });
const cookie = encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);

// ---------- server ----------
let log = "";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
    else server.kill();
  } catch {}
};
process.on("exit", stop);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/login`)).status === 200) break;
  } catch {}
  if (i > 240) throw new Error(`dev server did not start\n${log.slice(-2000)}`);
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch();
async function open({ phone = false, he = false, space = "pa_big" } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 860 }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  ctx.setDefaultTimeout(180_000);
  await ctx.addCookies([
    { name: "nexus_session_dev", value: cookie, url: BASE },
    { name: "nexus_space", value: space, url: BASE },
    { name: "nexus_locale", value: he ? "he" : "en", url: BASE },
  ]);
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("nexus.opened", "1");
      const d = new Date();
      localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    } catch {}
  });
  return { ctx, page: await ctx.newPage() };
}
/** The app is hydrated (its test hook is up) and has drawn its cards. */
const ready = async (page) => {
  await page.waitForFunction(() => !!window.__nexusTest, null, { timeout: 180_000 });
  await page.waitForSelector("[data-item-card]");
};
/** Run `act` (a close) and watch the dialog from inside the page: the moment it turns data-state="closed" it must have a
 *  running animation, and it must still be mounted then (gone by 700 ms). */
const exitAnimates = async (page, sel, act) => {
  const armed = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    window.__exit = { anims: -1, gone: false };
    new MutationObserver((_, mo) => {
      if (el.getAttribute("data-state") !== "closed") return;
      window.__exit.anims = el.getAnimations().length;
      mo.disconnect();
    }).observe(el, { attributes: true, attributeFilter: ["data-state"] });
    return true;
  }, sel);
  await act();
  await page.waitForTimeout(700);
  const r = await page.evaluate((s) => ({ ...window.__exit, gone: !document.querySelector(s) }), sel);
  return { ok: armed && r.anims >= 1 && r.gone, detail: `armed=${armed} animsWhenClosed=${r.anims} goneAfter700ms=${r.gone}` };
};
const ROUTES = ["/", "/?v=to_buy", "/?v=ordered", "/?v=history", "/?v=spending", "/?v=projects", "/?v=collection&id=pa_big_c0", "/?v=store&key=ksp", "/settings/account", "/add"];
const HYDRATION = /hydrat|#418|#423|#425|did not match|server rendered (text|html)/i;

// ---------- #6: 0 hydration errors on every main route of the worst-case space ----------
for (const variant of [{}, { phone: true, he: true }]) {
  const { ctx, page } = await open(variant);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && HYDRATION.test(m.text()) && errors.push(`${page.url().replace(BASE, "")}: ${m.text().slice(-1500)}`));
  page.on("pageerror", (e) => HYDRATION.test(e.message) && errors.push(`${page.url().replace(BASE, "")}: ${e.message.slice(-1500)}`));
  for (const r of ROUTES) {
    await page.goto(BASE + r, { waitUntil: "load" });
    await page.waitForTimeout(1500);
  }
  ok(errors.length === 0, `#6 0 hydration errors on ${ROUTES.length} routes in the 500-item space (${variant.phone ? "phone, Hebrew" : "desktop, English"})`, errors.join("\n  "));
  await ctx.close();
}

// ---------- phone guards (390, touch) in the demo space ----------
{
  const { ctx, page } = await open({ phone: true, space: personal });
  /** Text fields on screen whose computed font size is under 16px (iOS zooms into them). */
  const smallFields = () => page.evaluate(() => [...document.querySelectorAll("input, textarea, select")]
    .filter((el) => el.getBoundingClientRect().width > 0 && !["checkbox", "radio", "range", "color", "file", "hidden"].includes(el.type) && parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") ?? el.placeholder ?? ""}] ${getComputedStyle(el).fontSize}`));
  await page.goto(`${BASE}/?v=history`);
  await page.waitForSelector("[data-item-card]");
  const small = await smallFields();
  await page.goto(`${BASE}/?v=to_buy`);
  await ready(page);
  await page.locator("[data-item-card]").first().click();
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(600);
  small.push(...(await smallFields()));
  await page.goto(`${BASE}/settings/display`);
  await page.waitForSelector('[data-settings-section="display"]');
  small.push(...(await smallFields()));
  ok(small.length === 0, "#1 every text field is ≥ 16px on a coarse pointer (paste bar, search, item sheet, settings)", small.join(", "));
  // #4: the tap area (box ∪ ::after) of the shared small controls is ≥ 40 × 40 on touch.
  const tapArea = (sel) => page.$$eval(sel, (els) => els.filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
    const b = el.getBoundingClientRect();
    const a = getComputedStyle(el, "::after");
    const pw = a.content !== "none" && a.position === "absolute" ? parseFloat(a.width) || 0 : 0;
    const ph = a.content !== "none" && a.position === "absolute" ? parseFloat(a.height) || 0 : 0;
    return { what: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 16), w: Math.round(Math.max(b.width, pw)), h: Math.round(Math.max(b.height, ph)) };
  }));
  const tooSmall = [];
  const collect = async (sel) => tooSmall.push(...(await tapArea(sel)).filter((x) => x.w < 40 || x.h < 40).map((x) => `${sel} ${x.what} ${x.w}×${x.h}`));
  await page.goto(`${BASE}/?v=to_buy`);
  await ready(page);
  await page.locator("[data-item-card]").first().click();
  await page.waitForSelector("[data-sheet-close]");
  await collect("[data-sheet-close]");
  await collect("[data-sheet-more]");
  await collect('[role="dialog"] [role="radio"]');
  // #5: closing a sheet with ✕ and a modal with Esc each run an exit animation before the dialog unmounts.
  const sheetX = await exitAnimates(page, '[role="dialog"]', () => page.locator("[data-sheet-close]").click());
  await page.locator("[data-plus]").click();
  await page.locator('[data-plus-action="list"]').click();
  await page.waitForSelector("[data-modal-close]");
  await page.waitForTimeout(400);
  await collect("[data-modal-close]");
  await collect("button.hit");
  const modalEsc = await exitAnimates(page, '[role="dialog"]', () => page.keyboard.press("Escape"));
  ok(sheetX.ok && modalEsc.ok, "#5 phone: the item sheet (✕) and a modal (Esc) animate out before unmounting", `sheet ${sheetX.detail}; modal ${modalEsc.detail}`);
  ok(tooSmall.length === 0, "#4 sheet ✕ / more / segments, Modal ✕ and the icon Buttons have a ≥ 40 × 40 tap area on touch", tooSmall.join(", "));
  // #2: delete → the toast's Undo is a 40px target (then Undo, so the data stays as seeded).
  await page.goto(`${BASE}/?v=to_buy`);
  await ready(page);
  await page.locator("[data-item-card]").first().click();
  await page.locator("[data-sheet-more]").click();
  await page.locator("[data-sheet-delete]").click();
  const undo = page.locator("[data-sonner-toast] [data-button]").first();
  await undo.waitFor();
  await page.waitForTimeout(300);
  const ub = await undo.boundingBox();
  ok(ub && ub.height >= 40 && ub.width >= 40, "#2 the toast's Undo is ≥ 40 × 40 on touch", JSON.stringify(ub));
  await undo.click();
  // #3: a settings switch row is a ≥ 40px target — tapping its title flips the switch (and the knob slides).
  await page.goto(`${BASE}/settings/notif`);
  await page.waitForSelector('[data-settings-section="notif"]');
  const sw = page.locator('[data-notif="budget"]');
  const row = page.locator(".li", { has: sw });
  const before = await sw.getAttribute("aria-checked");
  await row.locator("b").first().click();
  await page.waitForTimeout(250);
  const after = await sw.getAttribute("aria-checked");
  const rb = await row.boundingBox();
  const knob = await sw.evaluate((el) => getComputedStyle(el, "::after").transitionProperty);
  ok(before !== after && rb && rb.height >= 40 && /transform/.test(knob), "#3 tapping a switch row's title flips it; row ≥ 40px; the knob transitions transform", `${before}→${after} ${JSON.stringify(rb)} ${knob}`);
  await row.locator("b").first().click();
  await ctx.close();
}

// ---------- desktop guards (1366) in the demo space ----------
{
  const { ctx, page } = await open({ space: personal });
  await page.goto(`${BASE}/?v=to_buy`);
  await ready(page);
  await page.locator("[data-item-card]").first().click();
  await page.waitForSelector("[data-sheet-close]");
  await page.waitForTimeout(400);
  const sideEsc = await exitAnimates(page, '[role="dialog"]', () => page.keyboard.press("Escape"));
  ok(sideEsc.ok, "#5 desktop: the side sheet animates out on Esc before unmounting", sideEsc.detail);
  await ctx.close();
}

// ---------- #29: 30 navigations in 30 s across 3 spaces → 0 × 429 ----------
{
  const { ctx, page } = await open();
  const limited = [];
  page.on("response", (r) => r.status() === 429 && limited.push(r.url().replace(BASE, "")));
  const spaces = [personal, "pa_big", "pa_one"];
  // Warm the dev compiler first so the timed run is page speed, not compile speed.
  for (const r of ROUTES.slice(0, 4)) await page.goto(BASE + r, { waitUntil: "load" });
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    await ctx.addCookies([{ name: "nexus_space", value: spaces[i % 3], url: BASE }]);
    await page.goto(BASE + ROUTES[i % 6], { waitUntil: "load" });
    const left = t0 + (i + 1) * 1000 - Date.now();
    if (left > 0) await page.waitForTimeout(left);
  }
  await page.waitForTimeout(6000); // idle-time reporters (error log) flush late
  ok(limited.length === 0, `#29 30 navigations in ${Math.round((Date.now() - t0) / 1000)} s across 3 spaces → 0 × 429`, limited.join(", "));
  await ctx.close();
}

await browser.close();
stop();
console.log(fails ? `FAIL ${fails} check(s)` : "OK polish checks");
process.exit(fails ? 1 : 0);
