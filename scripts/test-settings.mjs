// R16 D1–D3, D5 guard: the settings shell and the space look, against a running local server on a FILE DB copy.
//   bash scripts/serve-r16.sh   then   TURSO_DATABASE_URL=file:r16-smoke.db node --env-file=.env.local scripts/test-settings.mjs
// Checks: the desktop dialog (≈ 1220 × 700 at 1366 × 768) and no section scrolling there (1280 × 720: only People may),
// deep links + old addresses, Esc closes and gives the URL back, palette entries, phones (list → page → Back → list,
// no horizontal overflow at 360/390 in English and Hebrew), the space photo (fixture with EXIF GPS → stored 512 px WebP
// without EXIF, shown in the switcher; members/viewers and other origins refused; removing it).
import { createClient } from "@libsql/client";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = (process.env.BASE || "http://localhost:3100").replace(/\/$/, "");
const SECRET = process.env.BETTER_AUTH_SECRET;
const DBURL = process.env.TURSO_DATABASE_URL ?? "file:local.db";
if (!DBURL.startsWith("file:")) throw new Error("test-settings only writes a local file DB");
const db = createClient({ url: DBURL });
// The server writes too (presence beats): wait for the lock instead of failing.
await db.execute("PRAGMA busy_timeout = 10000");
let fails = 0;
const ok = (cond, name, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};

const admin = (await db.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [String(process.env.ADMIN_EMAIL ?? "").toLowerCase()] })).rows[0];
if (!admin || !SECRET) throw new Error("needs ADMIN_EMAIL's user and BETTER_AUTH_SECRET");
const now = Date.now();
const SPACE = "tset_space";
async function cleanup() {
  await db.execute({ sql: "DELETE FROM space_member WHERE space_id = ?", args: [SPACE] });
  await db.execute({ sql: "DELETE FROM space WHERE id = ?", args: [SPACE] });
  await db.execute({ sql: `DELETE FROM session WHERE user_agent = 'test-settings'` });
  await db.execute({ sql: `DELETE FROM "user" WHERE id IN ('tset_noa', 'tset_yoav')` });
}
await cleanup();
await db.execute({ sql: "INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES (?, 'Test home', 's-tset', 'shared', 'ILS', 'blue', 'home', ?, ?)", args: [SPACE, admin.id, now] });
await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES ('tm_a', ?, ?, 'owner', ?)", args: [SPACE, admin.id, now] });
for (const [uid, name, role] of [["tset_noa", "Noa Test", "member"], ["tset_yoav", "Yoav Test", "viewer"]]) {
  await db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'user', ?, ?)`, args: [uid, name, `${uid}@settings.test`, now, now] });
  await db.execute({ sql: "INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)", args: [`tm_${uid}`, SPACE, uid, role, now] });
}
async function session(userId) {
  const token = randomBytes(24).toString("base64url");
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, 'test-settings', 'passkey')`, args: [`ts_${token.slice(0, 10)}`, now + 3_600_000, token, now, now, userId] });
  return encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
}
const cookies = { owner: await session(admin.id), member: await session("tset_noa"), viewer: await session("tset_yoav") };

const browser = await chromium.launch();
async function open(viewport, { who = "owner", he = false, dark = false, space = SPACE } = {}) {
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}), colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript(() => {
    const d = new Date();
    localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    sessionStorage.setItem("nexus.opened", "1");
  });
  await ctx.addCookies([
    { name: "nexus_session_dev", value: cookies[who], url: BASE },
    { name: "nexus_space", value: space, url: BASE },
    { name: "nexus_locale", value: he ? "he" : "en", url: BASE },
  ]);
  return { ctx, page: await ctx.newPage() };
}
const atSection = (page, id) => page.waitForSelector(`[data-settings-section="${id}"]`, { timeout: 30000 });
const scrolls = (page) => page.evaluate(() => {
  const m = document.querySelector(".sx-main, .sx-pscroll");
  return m ? m.scrollHeight - m.clientHeight : -1;
});

const YOU = ["profile", "account", "display", "ai", "calendar", "memory", "data"];
const SPACE_IDS = ["general", "people", "budget", "danger"];

// ---- desktop 1366 × 768 ----
{
  const { ctx, page } = await open({ width: 1366, height: 768 });
  await page.goto(`${BASE}/settings/account`);
  await atSection(page, "account");
  await page.waitForTimeout(400); // the open animation (scale .985 → 1)
  const box = await page.locator(".sx-dialog").boundingBox();
  ok(box && Math.abs(box.width - 1220) <= 2 && Math.abs(box.height - 700) <= 2, "D1 dialog is 1220 × 700 at 1366 × 768", JSON.stringify(box));
  const over = [];
  for (const id of [...YOU, ...SPACE_IDS]) {
    await page.locator(`[data-sx-nav="${id}"]`).click();
    await atSection(page, id);
    await page.waitForTimeout(500);
    const d = await scrolls(page);
    if (d > 1 && id !== "memory") over.push(`${id}:${d}`);
    if (new URL(page.url()).pathname !== `/settings/${id}`) over.push(`${id}:url ${new URL(page.url()).pathname}`);
  }
  ok(over.length === 0, "D1/D2 no section scrolls at 1366 × 768 (memory = a long list) and each has its /settings/<id> URL", over.join(", "));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok((await page.locator("[data-settings]").count()) === 0 && new URL(page.url()).pathname === "/", "D1 Esc closes and the URL goes back to /", page.url());
  // Search: "dark" → Display.
  await page.goto(`${BASE}/settings`);
  await atSection(page, "account");
  await page.keyboard.press("/");
  await page.keyboard.type("dark");
  await page.keyboard.press("Enter");
  await atSection(page, "display").then(() => ok(true, "D1 search “dark” + Enter → Display"), () => ok(false, "D1 search “dark” + Enter → Display"));
  // Old address and a palette entry.
  await page.goto(`${BASE}/settings/security`);
  await atSection(page, "account").then(() => ok(true, "D1 /settings/security → Account & security"), () => ok(false, "D1 /settings/security → Account & security"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  for (let k = 0; k < 6 && !(await page.locator("[cmdk-input]").count()); k++) (await page.keyboard.press("Escape"), await page.waitForTimeout(500));
  await page.keyboard.type("Settings: Budget");
  await page.locator("[cmdk-item]:not([data-cmd-ask])").filter({ hasText: /Settings: Budget/ }).first().click();
  await atSection(page, "budget").then(
    () => ok(true, "D1 palette entry per section (Settings: Budget)"),
    async () => (ok(false, "D1 palette entry per section (Settings: Budget)", page.url()), process.env.SMOKE_OUT && (await page.screenshot({ path: `${process.env.SMOKE_OUT}/settings-palette.png` }))),
  );
  // Sub-page: Account → Activity, Esc goes back, not out.
  await page.goto(`${BASE}/settings/account`);
  await atSection(page, "account");
  await page.locator("[data-settings-activity]").click();
  await atSection(page, "activity");
  await page.keyboard.press("Escape");
  await atSection(page, "account").then(() => ok(true, "D1 sub-page: Esc returns to Account"), () => ok(false, "D1 sub-page: Esc returns to Account"));
  // The space switcher opens Space settings in the same shell.
  await page.keyboard.press("Escape");
  await page.locator("[data-space-switcher]").first().click();
  await page.locator("[data-space-settings]").first().click();
  await atSection(page, "people").then(() => ok(true, "D2 switcher → Space settings opens People in the shell"), () => ok(false, "D2 switcher → Space settings opens People in the shell"));
  await ctx.close();
}

// ---- desktop 1280 × 720: only People may scroll ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 });
  const over = [];
  for (const id of SPACE_IDS.filter((x) => x !== "people")) {
    await page.goto(`${BASE}/settings/${id}`);
    await atSection(page, id);
    await page.waitForTimeout(500);
    const d = await scrolls(page);
    if (d > 1) over.push(`${id}:${d}`);
  }
  ok(over.length === 0, "D2 at 1280 × 720 only People may scroll", over.join(", "));
  await ctx.close();
}

// ---- phones: list → page → Back → list; no horizontal overflow ----
for (const width of [360, 390]) {
  for (const he of [false, true]) {
    const { ctx, page } = await open({ width, height: 800 }, { he });
    await page.goto(`${BASE}/settings`);
    await atSection(page, "list");
    const bad = [];
    for (const id of [...YOU, "space", ...SPACE_IDS]) {
      await page.goto(`${BASE}/settings/${id}`);
      await atSection(page, id === "space" ? "space" : id).catch(() => bad.push(`${id}:missing`));
      await page.waitForTimeout(350);
      const wide = await page.evaluate(() => {
        const m = document.querySelector(".sx-phone");
        return m ? Math.max(m.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth : -1;
      });
      if (wide > 1) bad.push(`${id}:+${wide}px`);
    }
    ok(bad.length === 0, `D3 phone ${width} ${he ? "he" : "en"}: every section opens, no horizontal overflow`, bad.join(", "));
    if (width === 390 && !he) {
      await page.goto(`${BASE}/settings`);
      await atSection(page, "list");
      await page.locator('[data-sx-nav="display"]').click();
      await atSection(page, "display");
      await page.goBack();
      await atSection(page, "list").then(() => ok(true, "D3 phone: Back from a section returns to the list"), () => ok(false, "D3 phone: Back from a section returns to the list"));
      await page.goBack();
      await page.waitForTimeout(500);
      ok((await page.locator("[data-settings]").count()) === 0, "D3 phone: Back again closes Settings");
    }
    await ctx.close();
  }
}

// ---- R17 P3: Profile — from the profile block and the Me sheet, name → sidebar + facepiles, photo upload + remove ----
{
  const orig = (await db.execute({ sql: `SELECT name, image FROM "user" WHERE id = ?`, args: [admin.id] })).rows[0];
  const NEW = "Tal Profile Test";
  for (const he of [false, true]) {
    const { ctx, page } = await open({ width: 1366, height: 768 }, { he });
    await page.goto(`${BASE}/`);
    await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 });
    const label = await page.locator("[data-profile-block]").getAttribute("aria-label");
    await page.locator("[data-profile-block]").click();
    await atSection(page, "profile");
    await page.waitForURL(/\/settings\/profile$/, { timeout: 5000 }).catch(async () => console.log("  url after the block:", page.url(), await page.evaluate(() => history.length)));
    await Promise.resolve().then(
      () => ok(new URL(page.url()).pathname === "/settings/profile" && !!label && label.includes(orig.name), `P3 ${he ? "he" : "en"}: the profile block opens Settings → Profile (one button, “${label}”)`, page.url()),
      () => ok(false, `P3 ${he ? "he" : "en"}: the profile block opens Settings → Profile`),
    );
    ok((await page.locator('[data-sx-nav]').first().getAttribute("data-sx-nav")) === "profile", `P3 ${he ? "he" : "en"}: Profile is the first section under You`);
    if (!he) {
      // Name: 1–40, then it shows in the sidebar and in the switcher's facepile.
      const input = page.locator("[data-profile-name-input]");
      await input.fill("");
      ok(await page.locator("[data-profile-name-save]").isDisabled(), "P3 an empty name can't be saved");
      await input.fill(NEW);
      await page.locator("[data-profile-name-save]").click();
      await page.waitForFunction((n) => document.querySelector("[data-profile-block] b")?.textContent === n, NEW, { timeout: 15000 }).catch(() => {});
      ok((await page.locator("[data-profile-block] b").textContent()) === NEW, "P3 a new name shows in the sidebar at once");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      ok((await page.locator(`[data-space-switcher] [data-facepile] [data-avatar][aria-label="${NEW}"]`).count()) >= 1, "P3 … and in the switcher's facepile");
      // Photo: upload (a 900 × 600 JPEG) → cropped circle → stored 512 px WebP, shown in the sidebar + facepile; remove → initials.
      await page.goto(`${BASE}/settings/profile`);
      await atSection(page, "profile");
      const jpg = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();
      await page.locator("[data-profile-file]").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: jpg });
      await page.waitForSelector("[data-profile-crop] [data-identity-cropper]", { timeout: 10000 });
      await page.locator("[data-profile-use]").click();
      await page.waitForSelector('[data-profile-avatar="photo"]', { timeout: 15000 }).catch(() => {});
      const img = (await db.execute({ sql: `SELECT image FROM "user" WHERE id = ?`, args: [admin.id] })).rows[0].image;
      const meta = img?.startsWith("data:image/webp;base64,") ? await sharp(Buffer.from(img.split(",")[1], "base64")).metadata() : null;
      ok(meta?.format === "webp" && meta.width === 512 && meta.height === 512 && !meta.exif, "P3 the photo is stored as a 512 px WebP without metadata", String(img).slice(0, 40));
      ok((await page.locator('[data-profile-avatar="photo"] [data-person-photo]').count()) === 1 && (await page.locator("[data-profile-block] [data-person-photo]").count()) === 1, "P3 the photo shows in Profile and the sidebar");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      ok((await page.locator(`[data-space-switcher] [data-facepile] [data-avatar][aria-label="${NEW}"] [data-person-photo]`).count()) >= 1, "P3 … and in the facepile");
      await page.goto(`${BASE}/settings/profile`);
      await atSection(page, "profile");
      await page.locator("[data-profile-remove]").click();
      await page.waitForSelector('[data-profile-avatar="initials"]', { timeout: 15000 }).catch(() => {});
      const gone = (await db.execute({ sql: `SELECT image FROM "user" WHERE id = ?`, args: [admin.id] })).rows[0].image;
      ok(gone === null && (await page.locator("[data-profile-block] [data-person-photo]").count()) === 0, "P3 Remove photo → initials everywhere", String(gone));
      // Server side: Better Auth's update-user stays off the HTTP allow-list (nobody points their avatar at any URL).
      const r = await page.evaluate(async () => (await fetch("/api/auth/update-user", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "https://example.com/x.png" }) })).status);
      const row = (await db.execute({ sql: `SELECT image FROM "user" WHERE id = ?`, args: [admin.id] })).rows[0];
      ok(r === 404 && row.image === null, "P3 update-user is not reachable (the photo only changes through /api/me-photo)", JSON.stringify({ r, row }));
      // (A page can't set Origin itself — Node can.)
      const other = (await fetch(`${BASE}/api/me-photo`, { method: "DELETE", headers: { origin: "https://evil.example", cookie: `nexus_session_dev=${cookies.owner}` } })).status;
      ok(other === 403, "P3 /api/me-photo refuses another origin", String(other));
    }
    await ctx.close();
  }
  // Phone: the top of the Me sheet opens Profile.
  for (const he of [false, true]) {
    const { ctx, page } = await open({ width: 390, height: 844 }, { he });
    await page.goto(`${BASE}/`);
    await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 });
    await page.locator("[data-me-open]").click();
    await page.locator("[data-me-profile]").click();
    await atSection(page, "profile").then(() => ok(true, `P3 phone ${he ? "he" : "en"}: tapping the name in the Me sheet opens Profile`), () => ok(false, `P3 phone ${he ? "he" : "en"}: tapping the name in the Me sheet opens Profile`));
    await ctx.close();
  }
  await db.execute({ sql: `UPDATE "user" SET name = ?, image = ? WHERE id = ?`, args: [orig.name, orig.image, admin.id] });
}

// ---- D4: the switch moment ----
for (const reduce of [false, true]) {
  const { ctx, page } = await open({ width: 1366, height: 768 });
  if (reduce) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BASE}/`);
  await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 });
  const from = await page.locator("[data-space-switcher]").first().getAttribute("data-space-id");
  await page.locator("[data-space-switcher]").first().click();
  const target = await page.locator("[data-space-item]").evaluateAll((els, h) => els.map((e) => e.getAttribute("data-space-item")).find((x) => x && x !== h), from);
  // Frame deltas + the sidebar's box on every frame while the moment runs.
  await page.evaluate(() => {
    const w = window;
    w.__f = [];
    w.__box = new Set();
    let last = performance.now();
    const tick = (t) => {
      w.__f.push(t - last);
      last = t;
      const r = document.querySelector("[data-sidebar-logo]")?.closest("nav")?.getBoundingClientRect();
      if (r) w.__box.add(`${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
      if (w.__f.length < 150) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await page.locator(`[data-space-item="${target}"]`).first().click();
  const seen = await page.waitForSelector("[data-space-moment]", { timeout: 2000 }).then(() => true, () => false);
  await page.waitForSelector("[data-space-moment]", { state: "detached", timeout: 6000 }).catch(() => {});
  const ms = Date.now() - t0;
  const now = await page.locator("[data-space-switcher]").first().getAttribute("data-space-id");
  await page.waitForTimeout(800);
  const { frames, boxes } = await page.evaluate(() => ({ frames: window.__f.slice(1), boxes: [...window.__box] }));
  const sorted = [...frames].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const fps = p50 ? Math.round(1000 / p50) : 0;
  const long = frames.filter((d) => d > 50).length;
  const home = (await page.locator("[data-home], [data-home-empty]").count()) > 0;
  ok(seen && now === target && home && boxes.length === 1, `D4 switch moment${reduce ? " (reduced motion)" : ""}: overlay, lands on Home in the new space, sidebar box constant`, JSON.stringify({ seen, now, target, home, boxes }));
  console.log(`  D4 timing${reduce ? " reduced" : ""}: overlay ${ms} ms, median ${fps} fps, frames > 50 ms: ${long}, worst ${Math.round(sorted[sorted.length - 1] ?? 0)} ms`);
  if (!reduce) ok(fps >= 55, "D4 moment runs at ≥ 55 fps (median frame)", String(fps));
  // Back to where we were.
  await page.locator("[data-space-switcher]").first().click();
  await page.locator(`[data-space-item="${from}"]`).first().click();
  await page.waitForSelector("[data-space-moment]", { state: "detached", timeout: 6000 }).catch(() => {});
  await ctx.close();
}

// ---- D5: the space photo ----
{
  const fixture = readFileSync("scripts/fixtures/space-photo-gps.jpg");
  ok(fixture.indexOf(Buffer.from([0x25, 0x88])) > 0, "D5 fixture carries an EXIF GPS block");
  const { ctx, page } = await open({ width: 1366, height: 768 });
  await page.goto(`${BASE}/settings/general`);
  await atSection(page, "general");
  await page.locator("[data-space-look-change]").click();
  await page.locator('[data-identity="edit"]').waitFor();
  await page.locator('[data-identity-icon="garden"]').click();
  await page.locator('[data-identity-color="rose"]').click();
  await page.setInputFiles("[data-identity-file]", "scripts/fixtures/space-photo-gps.jpg");
  await page.locator("[data-identity-cropper]").waitFor();
  await page.locator("[data-identity-zoom]").fill("160");
  await page.locator("[data-identity-rotate]").click();
  await page.locator("[data-identity-save]").click();
  await page.locator("[data-identity]").waitFor({ state: "detached", timeout: 20000 });
  const row = (await db.execute({ sql: "SELECT icon, color, logo FROM space WHERE id = ?", args: [SPACE] })).rows[0];
  const m = String(row?.logo ?? "").match(/^data:image\/webp;base64,(.+)$/);
  const out = m ? Buffer.from(m[1], "base64") : null;
  const meta = out ? await sharp(out).metadata() : null;
  ok(row?.icon === "garden" && row?.color === "rose", "D5 icon × colour saved", JSON.stringify({ icon: row?.icon, color: row?.color }));
  ok(!!meta && meta.format === "webp" && meta.width === 512 && meta.height === 512 && !meta.exif && !out.includes(Buffer.from("NexusTestCam")) && out.indexOf(Buffer.from([0x25, 0x88])) < 0, "D5 stored photo = 512 px WebP with no EXIF/GPS", JSON.stringify(meta && { f: meta.format, w: meta.width, exif: !!meta.exif }));
  await page.waitForTimeout(800);
  ok((await page.locator("[data-space-switcher] [data-space-photo], [data-space-cover]").count()) > 0 && (await page.locator("[data-space-photo]").count()) > 0, "D5 the photo shows where the tile does (switcher, cover)");
  // Raw upload straight to the route still comes out clean (the server re-encodes everything).
  const raw = await page.evaluate(async (b64) => {
    const r = await fetch("/api/space-photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) });
    return r.status;
  }, fixture.toString("base64"));
  const row2 = (await db.execute({ sql: "SELECT logo FROM space WHERE id = ?", args: [SPACE] })).rows[0];
  const out2 = Buffer.from(String(row2.logo).split(",")[1] ?? "", "base64");
  ok(raw === 200 && !(await sharp(out2).metadata()).exif && !out2.includes(Buffer.from("NexusTestCam")), "D5 a raw JPEG with GPS posted to the route is stored without EXIF", String(raw));
  const cross = await ctx.request.post(`${BASE}/api/space-photo`, { headers: { "content-type": "image/jpeg", origin: "https://evil.example" }, data: fixture });
  ok(cross.status() === 403, "D5 another origin is refused", String(cross.status()));
  const del = await page.evaluate(() => fetch("/api/space-photo", { method: "DELETE" }).then((r) => r.status));
  const row3 = (await db.execute({ sql: "SELECT logo FROM space WHERE id = ?", args: [SPACE] })).rows[0];
  ok(del === 200 && row3.logo == null, "D5 Remove photo → back to the icon");
  await ctx.close();
  for (const who of ["member", "viewer"]) {
    const o = await open({ width: 1366, height: 768 }, { who });
    await o.page.goto(`${BASE}/settings/general`);
    await atSection(o.page, "general");
    const st = await o.page.evaluate(async (b64) => (await fetch("/api/space-photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) })).status, fixture.toString("base64"));
    const change = await o.page.locator("[data-space-look-change], [data-edit-look]").count();
    ok(st === 403 && change === 0, `D5 a ${who} can't change the look (403, no Edit look)`, JSON.stringify({ st, change }));
    await o.ctx.close();
  }
}


// ---- E1: Home customise (the admin's personal space has the demo data) ----
{
  const personal = (await db.execute({ sql: "SELECT s.id FROM space s JOIN space_member m ON m.space_id = s.id WHERE m.user_id = ? AND s.kind = 'personal' LIMIT 1", args: [admin.id] })).rows[0]?.id;
  await db.execute({ sql: "DELETE FROM user_pref WHERE user_id = ? AND key LIKE 'pref:home:layout%'", args: [admin.id] });
  const order = (page) => page.$$eval("[data-home-grid] [data-widget]", (els) => els.map((e) => e.getAttribute("data-widget")));
  const { ctx, page } = await open({ width: 1366, height: 768 }, { space: personal });
  await page.goto(`${BASE}/`);
  await page.waitForSelector("[data-home-grid]", { timeout: 30000 });
  await page.locator("[data-home-customize]").click();
  await page.waitForSelector("[data-home-customizing]");
  ok((await page.locator('[data-home-preset="household"]').getAttribute("aria-checked")) === "true", "E1 default = Household preset");
  // Drag "This week" onto "Left to buy" with the mouse; sample frames while dragging.
  const before = await order(page);
  const h = await page.locator('[data-widget-handle="week"]').boundingBox();
  const target = await page.locator('[data-widget="left"]').boundingBox();
  await page.evaluate(() => {
    window.__f = [];
    let last = performance.now();
    const tick = (t) => (window.__f.push(t - last), (last = t), window.__run && requestAnimationFrame(tick));
    window.__run = true;
    requestAnimationFrame(tick);
  });
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  const steps = 40;
  let lifted = false;
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(h.x + ((target.x + 40 - h.x) * k) / steps, h.y + ((target.y + 40 - h.y) * k) / steps);
    await page.waitForTimeout(16);
    if (k === steps / 2) lifted = (await page.locator('[data-widget="week"]').evaluate((e) => e.style.transform)).includes("translate");
  }
  await page.mouse.up();
  const frames = await page.evaluate(() => ((window.__run = false), window.__f.slice(2)));
  await page.waitForTimeout(300);
  const after = await order(page);
  const sorted = [...frames].sort((a, b) => a - b);
  const fps = Math.round(1000 / sorted[Math.floor(sorted.length / 2)]);
  console.log(`  E1 drag timing: median ${fps} fps, frames > 32 ms: ${frames.filter((d) => d > 32).length}/${frames.length}, worst ${Math.round(sorted[sorted.length - 1])} ms`);
  ok(lifted && after.indexOf("week") < before.indexOf("week") && after.indexOf("week") <= after.indexOf("left"), "E1 drag reorders (the widget follows the pointer, lands before Left to buy)", `${before.join(",")} → ${after.join(",")}`);
  ok(fps >= 55, "E1 drag runs at ≥ 55 fps (median frame)", String(fps));
  ok((await page.locator('[data-home-preset="custom"]').count()) === 1, "E1 an edit turns the layout Custom");
  // Keyboard: the grip moves with the arrows.
  const k0 = (await order(page)).indexOf("needs");
  await page.locator('[data-widget-handle="needs"]').focus();
  await page.keyboard.press("ArrowUp");
  ok((await order(page)).indexOf("needs") === k0 - 1, "E1 keyboard: ArrowUp on the grip moves the widget one place");
  // Size menu: Budget → L, 2×.
  await page.locator('[data-widget-size="budget"]').click();
  await page.locator('[data-size-w="L"]').click();
  await page.locator('[data-size-h="2"]').click();
  await page.keyboard.press("Escape");
  const b = page.locator('[data-home-grid] [data-widget="budget"]');
  ok((await b.getAttribute("data-w")) === "L" && (await b.getAttribute("data-h")) === "2", "E1 size menu: width L, height 2×");
  // Corner resize: Left to buy S → M by pulling right.
  const r = await page.locator('[data-widget-resize="left"]').boundingBox();
  await page.mouse.move(r.x + 8, r.y + 8);
  await page.mouse.down();
  await page.mouse.move(r.x + 8 + 200, r.y + 8, { steps: 8 });
  await page.mouse.up();
  ok((await page.locator('[data-home-grid] [data-widget="left"]').getAttribute("data-w")) === "M", "E1 corner handle resizes (S → M)");
  // Hide + add from the tray.
  await page.locator('[data-widget-hide="saved"]').click();
  ok((await page.locator('[data-home-grid] [data-widget="saved"]').count()) === 0 && (await page.locator('[data-tray-item="saved"]').count()) === 1, "E1 hide → back in the tray");
  await page.locator('[data-tray-add="drops"]').click();
  ok((await page.locator('[data-home-grid] [data-widget="drops"]').count()) === 1, "E1 + adds a new widget (Price drops)");
  // Drag in from the tray.
  const ti = await page.locator('[data-tray-item="most"]').boundingBox();
  const g = await page.locator("[data-home-grid]").boundingBox();
  await page.mouse.move(ti.x + 30, ti.y + ti.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 100, g.y + 60, { steps: 12 });
  await page.mouse.move(g.x + 110, g.y + 70, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const draft = await order(page);
  ok(draft.includes("most") && draft.indexOf("most") < 3, "E1 drag a widget in from the tray", draft.join(","));
  await page.locator("[data-home-done]").click();
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector("[data-home-grid]", { timeout: 30000 });
  const saved = await order(page);
  const pref = (await db.execute({ sql: "SELECT value FROM user_pref WHERE user_id = ? AND key = ?", args: [admin.id, `pref:home:layout:${personal}`] })).rows[0]?.value;
  ok(saved.includes("drops") && saved.includes("most") && !saved.includes("saved") && !!pref && JSON.parse(pref).preset === null, "E1 Done saves the layout per user per space; it survives a reload", saved.join(","));
  // Preset: Minimal.
  await page.locator("[data-home-customize]").click();
  await page.locator('[data-home-preset="minimal"]').click();
  await page.locator("[data-home-done]").click();
  await page.waitForTimeout(500);
  const min = await order(page);
  ok(min.length >= 1 && min.every((id) => ["left", "budget", "suggest"].includes(id)), "E1 preset Minimal → Left to buy, Budget, Nexus suggests", min.join(","));
  await ctx.close();
  const other = (await db.execute({ sql: "SELECT value FROM user_pref WHERE user_id = ? AND key = ?", args: [admin.id, `pref:home:layout:${SPACE}`] })).rows[0];
  ok(!other, "E1 a layout is saved for its own space only");
  // Phone: half/full and 2× per widget, the add sheet; no overflow at 360 (Hebrew).
  await db.execute({ sql: "DELETE FROM user_pref WHERE user_id = ? AND key LIKE 'pref:home:layout%'", args: [admin.id] });
  for (const width of [390, 360]) {
    const o = await open({ width, height: 800 }, { space: personal, he: width === 360 });
    await o.page.goto(`${BASE}/`);
    await o.page.waitForSelector("[data-home-grid]", { timeout: 30000 });
    await o.page.locator("[data-home-customize]").click();
    await o.page.waitForSelector("[data-home-customizing]");
    const left = o.page.locator('[data-home-grid] [data-widget="left"]');
    const w0 = (await left.boundingBox()).width;
    await left.locator('[data-widget-p="full"]').click();
    const w1 = (await left.boundingBox()).width;
    await left.locator('[data-widget-h2="left"]').click();
    const wide = await o.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await o.page.locator("[data-home-add-widget]").click();
    await o.page.locator('[data-tray-add="most"]').click();
    const most = await o.page.locator('[data-home-grid] [data-widget="most"]').count();
    ok(w1 > w0 * 1.7 && (await left.getAttribute("data-h")) === "2" && most === 1 && wide <= 1, `E1 phone ${width}: half → full, 2×, add from the sheet, no overflow`, JSON.stringify({ w0, w1, most, wide }));
    await o.ctx.close();
  }
  await db.execute({ sql: "DELETE FROM user_pref WHERE user_id = ? AND key LIKE 'pref:home:layout%'", args: [admin.id] });
}

await cleanup();
db.close();
await browser.close();
console.log(fails ? `FAIL ${fails}` : "OK test:settings");
process.exit(fails ? 1 : 0);
