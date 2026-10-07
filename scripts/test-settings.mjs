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
async function open(viewport, { who = "owner", he = false, dark = false } = {}) {
  const phone = viewport.width < 640;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}), colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript(() => {
    localStorage.setItem("nexus.bootDay", "x");
    sessionStorage.setItem("nexus.opened", "1");
  });
  await ctx.addCookies([
    { name: "nexus_session_dev", value: cookies[who], url: BASE },
    { name: "nexus_space", value: SPACE, url: BASE },
    { name: "nexus_locale", value: he ? "he" : "en", url: BASE },
  ]);
  return { ctx, page: await ctx.newPage() };
}
const atSection = (page, id) => page.waitForSelector(`[data-settings-section="${id}"]`, { timeout: 30000 });
const scrolls = (page) => page.evaluate(() => {
  const m = document.querySelector(".sx-main, .sx-pscroll");
  return m ? m.scrollHeight - m.clientHeight : -1;
});

const YOU = ["account", "display", "notif", "ai", "calendar", "memory", "data"];
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

await cleanup();
db.close();
await browser.close();
console.log(fails ? `FAIL ${fails}` : "OK test:settings");
process.exit(fails ? 1 : 0);
