// Polish fixes (docs/POLISH-AUDIT.md) — the checks that need a running app and the worst-case data:
//   #6  every main route in the 500-item space (scripts/seed-worst.mjs) logs 0 hydration errors (next dev: the
//       unminified message names the mismatching text)
//   #29 30 page navigations in 30 s across 3 spaces → 0 responses with status 429
// Usage: node scripts/test-polish.mjs   (starts `next dev` on PORT=3108, throwaway polish-test.db; first compile is slow)
import { createClient } from "@libsql/client";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
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
// POLISH_ONLY=A1,A2 runs only those sections (tags: 6, phone, 23, reduced, desktop, A1, A2, A3, 29).
const want = (tag) => !process.env.POLISH_ONLY || process.env.POLISH_ONLY.split(",").includes(tag);
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
async function open({ phone = false, he = false, space = "pa_big", reduce = false } = {}) {
  const ctx = await browser.newContext({ reducedMotion: reduce ? "reduce" : "no-preference", viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 860 }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
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
if (want("6")) for (const variant of [{}, { phone: true, he: true }]) {
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
if (want("phone")) {
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
  // R17 D3: the Notifications section is gone — its one switch lives in Account.
  await page.goto(`${BASE}/settings/account`);
  await page.waitForSelector('[data-settings-section="account"]');
  const sw = page.locator("[data-notifications-on]");
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

// ---------- #23: big amounts never end in an ellipsis (worst-case space, Hebrew, 360) ----------
if (want("23")) {
  const { ctx, page } = await open({ phone: true, he: true });
  await page.setViewportSize({ width: 360, height: 780 });
  const cut = [];
  const scan = (where) => page.evaluate((w) => [...document.querySelectorAll("[data-home-stat] .tabular, [data-fit-money]")]
    .filter((el) => {
      const box = el.matches("[data-fit-money]") ? el.parentElement : el;
      return box.getBoundingClientRect().width > 0 && box.scrollWidth > box.clientWidth + 1;
    })
    .map((el) => `${w}: ${el.textContent.trim().slice(0, 40)}`), where);
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => !!window.__nexusTest, null, { timeout: 180_000 });
  await page.waitForSelector("[data-home-stat]");
  await page.waitForTimeout(800);
  cut.push(...(await scan("home")));
  const shortOnes = await page.locator('[data-fit-money="short"]').count();
  await page.goto(`${BASE}/?v=to_buy`);
  await ready(page);
  cut.push(...(await scan("to_buy")));
  ok(cut.length === 0 && shortOnes > 0, "#23 no amount in the Home stat tiles / To buy tile is cut; ₪62B goes compact when it doesn't fit", `${cut.join(", ")} short=${shortOnes}`);
  await ctx.close();
}

// ---------- reduced motion (phone, OS setting) ----------
if (want("reduced")) {
  const { ctx, page } = await open({ phone: true, space: personal, reduce: true });
  await page.goto(`${BASE}/?v=to_buy`);
  await ready(page);
  await page.locator("[data-item-card]").first().click();
  await page.waitForSelector("[data-sheet-close]");
  const names = await page.evaluate(() => document.querySelector('[role="dialog"]').getAnimations().map((a) => `${a.animationName}:${a.effect.getTiming().duration}`));
  const out = await exitAnimates(page, '[role="dialog"]', () => page.locator("[data-sheet-close]").click());
  ok(names.length > 0 && names.every((n) => /^fade:150$/.test(n)) && out.ok, "#16 reduced motion: the sheet fades in (150 ms, no slide) and fades out", `${names.join(",")} ${out.detail}`);
  await ctx.close();
}

// ---------- desktop guards (1366) in the demo space ----------
if (want("desktop")) {
  const { ctx, page } = await open({ space: personal });
  await page.goto(`${BASE}/?v=to_buy`);
  await ready(page);
  await page.locator("[data-item-card]").first().click();
  await page.waitForSelector("[data-sheet-close]");
  await page.waitForTimeout(400);
  const sideEsc = await exitAnimates(page, '[role="dialog"]', () => page.keyboard.press("Escape"));
  ok(sideEsc.ok, "#5 desktop: the side sheet animates out on Esc before unmounting", sideEsc.detail);
  // #10: Ctrl K opens the palette with no animation at all (dialog, its contents and the scrim).
  await page.keyboard.press("Control+k");
  await page.waitForSelector("[cmdk-input]");
  const paletteAnims = await page.evaluate(() => {
    const d = document.querySelector("[cmdk-input]").closest('[role="dialog"]');
    return d.getAnimations({ subtree: true }).length + (d.previousElementSibling?.getAnimations().length ?? 0);
  });
  ok(paletteAnims === 0, "#10 the command palette opens with 0 animations", String(paletteAnims));
  await page.keyboard.press("Escape");
  await ctx.close();
}

// ---------- R17 A1: the loops fade out at the end of their cycle (no frozen frame, no jump) ----------
// Jump each loop to 400 ms before its cycle ends (no AI work in flight), then sample its moving layer's opacity on every
// frame through the boundary: a continuous ramp to 0 (no single-frame change > 0.1), then the loop is paused.
if (want("A1")) {
  const { ctx, page } = await open({ space: personal });
  for (const [route, sel, name] of [["/", ".r13-sug", "r13-sheen"], ["/?v=to_buy", ".flow-border", "flow-border"]]) {
    await page.goto(BASE + route);
    await page.waitForFunction(() => !!window.__nexusTest, null, { timeout: 180_000 });
    await page.waitForSelector(sel);
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-ai-busy"), null, { timeout: 30_000 }).catch(() => {});
    const r = await page.evaluate(
      async ([sel, name]) => {
        const el = document.querySelector(sel);
        const a = document.getAnimations().find((x) => x.animationName === name && x.effect?.target === el);
        if (!a) return { error: "no animation" };
        const d = Number(a.effect.getTiming().duration);
        el.removeAttribute("data-loop-rest");
        if (a.playState === "paused") a.play();
        await new Promise((r) => setTimeout(r, 350)); // a resumed layer fades back in (300 ms)
        a.currentTime = Math.ceil(Number(a.currentTime) / d) * d - 400;
        const op = [];
        const t0 = performance.now();
        await new Promise((done) => {
          const tick = () => {
            op.push(Number(getComputedStyle(el, "::before").opacity));
            if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        await new Promise((r) => setTimeout(r, 200));
        const jumps = op.slice(1).map((v, k) => Math.abs(v - op[k]));
        return { frames: op.length, start: op[0], end: op.at(-1), maxJump: Math.max(...jumps), paused: a.playState === "paused" };
      },
      [sel, name],
    );
    ok(!r.error && r.start > 0.95 && r.end < 0.02 && r.maxJump <= 0.1 && r.paused, `A1 ${name}: fades out at the cycle end (continuous ramp, then paused)`, JSON.stringify(r));
  }
  await ctx.close();
}

// ---------- R17 A2: every widget at every size uses its height (desktop S/M/L × 1×/2×, phone half/full × 1×/2×) ----------
// All 17 widgets in one layout per size, on the demo data and the 500-item space. Per widget: its content (the lowest
// visible leaf under the header) reaches ≥ 70 % of the inner height, or it shows its empty state centred; nothing
// overflows the card. PARITY=1 also saves the grids at 2× into docs/design/parity-r17/.
if (want("A2")) {
  const ALL = ["left", "budget", "way", "saved", "suggest", "week", "needs", "ontheway", "pace", "projects", "noticed", "drops", "vslast", "nextdel", "bycat", "most", "activity"];
  const setLayout = async (space, items) =>
    db.execute({
      sql: `INSERT INTO user_pref (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
      args: [admin, `pref:home:layout:${space}`, JSON.stringify({ v: 2, preset: null, items }), Date.now()],
    });
  const measure = () =>
    [...document.querySelectorAll("[data-home-grid] .hw")].map((hw) => {
      const card = hw.firstElementChild;
      const cr = card.getBoundingClientRect();
      const head = card.querySelector(":scope > [data-card-head], :scope > div:first-child.border-b");
      const top = head ? head.getBoundingClientRect().bottom : cr.top;
      let low = top;
      let maxRight = cr.left;
      let minLeft = cr.right;
      let ovEl = null;
      for (const e of card.querySelectorAll("*")) {
        if (head?.contains(e) || e.childElementCount > 0 && e.tagName !== "svg" && e.tagName !== "BUTTON") continue;
        if (e.closest("svg") && e.tagName !== "svg") continue;
        const br = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (!br.width || !br.height || cs.visibility === "hidden" || e.closest("[hidden],[aria-hidden=true][inert]")) continue;
        // What's visible of it: clipped by its own overflow-hidden ancestors below the card (an ellipsis line, a folded
        // section), not by the card itself — a leaf the card cuts off is exactly what this looks for.
        const r = { left: br.left, right: br.right, top: br.top, bottom: br.bottom };
        for (let p = e.parentElement; p && p !== card; p = p.parentElement) {
          const pc = getComputedStyle(p);
          if (pc.overflowX === "visible" && pc.overflowY === "visible") continue;
          const pr = p.getBoundingClientRect();
          if (pc.overflowX !== "visible") (r.left = Math.max(r.left, pr.left)), (r.right = Math.min(r.right, pr.right));
          if (pc.overflowY !== "visible") (r.top = Math.max(r.top, pr.top)), (r.bottom = Math.min(r.bottom, pr.bottom));
        }
        if (r.right <= r.left || r.bottom <= r.top) continue;
        low = Math.max(low, r.bottom);
        if (!ovEl && (r.bottom > cr.bottom + 1 || r.right > cr.right + 1 || r.left < cr.left - 1)) ovEl = `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).slice(0, 60)} "${(e.textContent || '').trim().slice(0, 24)}" [${Math.round(r.left - cr.left)},${Math.round(r.right - cr.right)},${Math.round(r.bottom - cr.bottom)}]`;
        maxRight = Math.max(maxRight, r.right);
        minLeft = Math.min(minLeft, r.left);
      }
      const empty = card.querySelector("[data-widget-empty],[data-saved-empty]");
      const more = Number(card.getAttribute("data-more") ?? 0);
      let centred = false;
      if (empty) {
        const er = empty.getBoundingClientRect();
        const mid = (top + cr.bottom) / 2;
        centred = Math.abs((er.top + er.bottom) / 2 - mid) < (cr.bottom - top) * 0.2;
      }
      return {
        id: hw.dataset.widget,
        h: Number(hw.dataset.h),
        fill: Math.round(((low - top) / Math.max(1, cr.bottom - top)) * 100) / 100,
        empty: !!empty,
        more,
        ovEl,
        centred,
        // Geometry, not scroll sizes (the invisible ::after tap areas extend scrollWidth/Height on purpose): a visible
        // leaf outside the card, or the card past its grid cell.
        overflow: low > cr.bottom + 1 || maxRight > cr.right + 1 || minLeft < cr.left - 1 || cr.bottom > hw.getBoundingClientRect().bottom + 1,
      };
    });
  const SIZES = [
    ...["S", "M", "L"].flatMap((w) => [1, 2].map((h) => ({ phone: false, w, h, items: ALL.map((id) => ({ id, w, h })) }))),
    ...["half", "full"].flatMap((p) => [1, 2].map((h) => ({ phone: true, w: p, h, items: ALL.map((id) => ({ id, w: "M", h, p })) }))),
  ];
  const bad = [];
  const low = [];
  let checked = 0;
  for (const space of [personal, "pa_big"]) {
    for (const phone of [false, true]) {
      const { ctx, page } = await open({ phone, space });
      for (const z of SIZES.filter((z) => z.phone === phone)) {
        await setLayout(space, z.items);
        await page.goto(`${BASE}/`);
        await page.waitForSelector("[data-home-grid] .hw");
        await page.waitForTimeout(900);
        const rows = await page.evaluate(measure);
        for (const r of rows) {
          checked++;
          const tag = `${space === personal ? "demo" : "big"} ${phone ? "phone" : "desk"} ${z.w}×${z.h} ${r.id}`;
          if (r.overflow) bad.push(`${tag}: overflows${r.ovEl ? ` — ${r.ovEl}` : " its cell"}`);
          // Under 70 % is a failure only while the widget has more to show (data-more): one that shows everything it
          // has (or sits in a row a taller neighbour sets) is data-bound and only reported.
          else if (r.empty ? !r.centred : r.fill < 0.7) (r.empty || r.more > 0 ? bad : low).push(`${tag}: ${r.empty ? "empty state not centred" : `fills ${Math.round(r.fill * 100)} % (${r.more} more not shown)`}`);
        }
        if (process.env.PARITY && z.h === 2 && (space === personal || z.w === "M")) {
          mkdirSync("docs/design/parity-r17", { recursive: true });
          await page.locator("[data-home-grid]").screenshot({ path: `docs/design/parity-r17/widgets-2x-${space === personal ? "demo" : "big"}-${phone ? "phone" : "desk"}-${z.w}.png` });
        }
      }
      await ctx.close();
    }
  }
  if (low.length) console.log(`INFO A2 ${low.length} widgets under 70 % that show all their data:\n  ${low.join("\n  ")}`);
  ok(bad.length === 0, `A2 ${checked} widget × size checks: content fills ≥ 70 % (or a centred empty state), nothing overflows`, bad.join("\n  "));
  await db.execute({ sql: `DELETE FROM user_pref WHERE user_id = ? AND key LIKE 'pref:home:layout%'`, args: [admin] });
}

// ---------- R17 A3: Settings is on screen from the first frame (cold deep link, and a tap in the app) ----------
// Cold: an init script samples every frame from document start — a frame that shows Home's widgets without the settings
// shell over them is a flash. Tap: the frame right after the click already has the shell.
if (want("A3")) {
  for (const phone of [true, false]) {
    const { ctx, page } = await open({ phone, space: personal });
    await page.addInitScript(() => {
      window.__frames = [];
      const tick = () => {
        const shell = [...document.querySelectorAll("[data-settings]")].some((e) => e.getBoundingClientRect().width > 0);
        const home = [...document.querySelectorAll("[data-home-grid] .hw")].some((e) => e.getBoundingClientRect().width > 0);
        window.__frames.push({ shell, home });
        if (window.__frames.length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(`${BASE}/settings/display`);
    await page.waitForSelector("[data-settings-section=display], [data-settings] [data-sx-page=display], [data-settings]");
    await page.waitForTimeout(1500);
    const f = await page.evaluate(() => window.__frames);
    const flash = f.filter((x) => x.home && !x.shell).length;
    const firstShell = f.findIndex((x) => x.shell);
    ok(flash === 0 && firstShell >= 0 && firstShell <= 2, `A3 cold /settings/display (${phone ? "phone" : "desktop"}): the shell is there from the first frame, never Home alone`, JSON.stringify({ frames: f.length, firstShell, flash }));
    // A tap in the app: Home → Settings.
    await page.goto(`${BASE}/`);
    await page.waitForSelector("[data-home-grid] .hw");
    await page.waitForTimeout(600);
    if (phone) {
      await page.locator("[data-me-open]").click();
      await page.locator("[data-me-settings]").waitFor();
      await page.waitForTimeout(400);
    }
    const target = phone ? "[data-me-settings]" : "aside button[data-carry=settings]";
    const r = await page.evaluate(async (sel) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
      if (!el) return { error: "no settings button" };
      el.click();
      await new Promise((r) => requestAnimationFrame(() => r()));
      const shell = [...document.querySelectorAll("[data-settings]")].some((e) => e.getBoundingClientRect().width > 0);
      return { shell };
    }, target);
    ok(r.shell === true, `A3 tap → Settings (${phone ? "phone, from the avatar sheet" : "desktop, sidebar"}): the shell is in the next frame`, JSON.stringify(r));
    await ctx.close();
  }
}

// ---------- #29: 30 navigations in 30 s across 3 spaces → 0 × 429 ----------
if (want("29")) {
  const { ctx, page } = await open();
  const limited = [];
  let tokens = 0;
  page.on("response", (r) => {
    if (r.status() === 429) limited.push(r.url().replace(BASE, ""));
    if (r.url().includes("/api/realtime/token")) tokens++;
  });
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
  // One per second at most (next dev's loads are slower, so the run takes a little over 30 s); every load asks for a
  // realtime token — the route that answered 429 in the audit (30/min before polish #29).
  ok(limited.length === 0 && tokens >= 30, `#29 30 navigations in ${Math.round((Date.now() - t0) / 1000)} s across 3 spaces (${tokens} token requests) → 0 × 429`, limited.join(", "));
  await ctx.close();
}

await browser.close();
stop();
console.log(fails ? `FAIL ${fails} check(s)` : "OK polish checks");
process.exit(fails ? 1 : 0);
