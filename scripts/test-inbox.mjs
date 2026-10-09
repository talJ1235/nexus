// R17 S3 K — the inbox in a real browser on a throwaway DB (needs a build): the desktop popover (bell → popover, badge
// count, mark all read, Esc closes + focus back on the bell), the phone page (in from the inline-end, Home under it,
// swipe to delete, tap = read + open, Received → the item is received, browser Back closes, /inbox opens it), the media
// column (every kind badge / face box inside its row — the board's v2 fix), in English (LTR) and Hebrew (RTL).
//   npm run build && npm run test:inbox        (SHOTS=dir keeps the screenshots; default test-data/inbox)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { startApp } from "./lib/test-app.mjs";
import { seedInbox } from "./lib/seed-notify.mjs";

const SHOTS = process.env.SHOTS || "test-data/inbox";
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (c, name, info = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${name}${c ? "" : `  ${info}`}`);
  if (!c) fails++;
};

const app = await startApp({ db: "inbox-test.db", port: 3111 });
const browser = await chromium.launch();
try {
  const { ids, items } = await seedInbox(app.db, { userId: app.admin, spaceId: app.personal });

  /** Every badge / face / picture box sits inside its row (and inside the 40×40 media block). */
  const mediaInside = (page) =>
    page.evaluate(() => {
      const bad = [];
      for (const row of document.querySelectorAll("[data-nt]")) {
        const r = row.getBoundingClientRect();
        const m = row.querySelector("[data-media]").getBoundingClientRect();
        if (Math.round(m.width) !== 40 || Math.round(m.height) !== 40) bad.push(`${row.dataset.nt}: media ${m.width}×${m.height}`);
        for (const b of row.querySelectorAll("[data-badge]")) {
          const x = b.getBoundingClientRect();
          if (x.width === 0 || x.left < r.left - 0.5 || x.right > r.right + 0.5 || x.top < r.top - 0.5 || x.bottom > r.bottom + 0.5) bad.push(`${row.dataset.nt}: badge outside`);
        }
      }
      return { rows: document.querySelectorAll("[data-nt]").length, bad };
    });

  // ---------- desktop popover (1366×768, light, Graphite, English) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: "light" });
    await ctx.addCookies(app.cookies(app.personal, "en"));
    const page = await ctx.newPage();
    await page.goto(app.base);
    await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 });
    const bell = page.locator("[data-nt-bell=desk]");
    await bell.waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector("[data-nt-bell=desk] .nt-bd")?.textContent === "6", null, { timeout: 15000 }).catch(() => {});
    ok((await bell.locator(".nt-bd").textContent()) === "6", "desktop: the bell shows 6 unread");
    await bell.click();
    const pop = page.locator("[data-nt-popover]");
    await pop.waitFor();
    await page.waitForSelector("[data-nt]");
    await page.waitForTimeout(350);
    const geo = await page.evaluate(() => {
      const p = document.querySelector("[data-nt-popover]").getBoundingClientRect();
      const b = document.querySelector("[data-nt-bell=desk]").getBoundingClientRect();
      return { w: Math.round(p.width), below: p.top >= b.bottom, endAligned: Math.abs(p.right - b.right) <= 12, inView: p.bottom <= innerHeight, groups: [...document.querySelectorAll("[data-nt-popover] .igrp")].map((g) => g.textContent) };
    });
    ok(geo.w === 420 && geo.below && geo.endAligned && geo.inView, "desktop: popover 420 wide, under the bell, end-aligned, inside the window", JSON.stringify(geo));
    ok(geo.groups.join("|") === "Today|Earlier", "desktop: Today / Earlier groups", geo.groups.join("|"));
    const m = await mediaInside(page);
    ok(m.rows === 7 && m.bad.length === 0, "desktop: 7 rows, every media block 40×40 with its badges inside the row", JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/desktop-popover-en.png` });
    await page.click("[data-nt-popover] [data-nt-markall]");
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({ unread: document.querySelectorAll("[data-nt-popover] .nt.unread").length, badge: !!document.querySelector("[data-nt-bell=desk] .nt-bd") }));
    ok(after.unread === 0 && !after.badge, "desktop: Mark all read clears the tint, the dots and the badge (optimistic)", JSON.stringify(after));
    await page.keyboard.press("Escape");
    await pop.waitFor({ state: "detached", timeout: 3000 });
    ok((await page.evaluate(() => document.activeElement?.getAttribute("data-nt-bell"))) === "desk", "desktop: Esc closes, focus back on the bell");
    // Outside click closes too.
    await bell.click();
    await pop.waitFor();
    await page.mouse.click(300, 600);
    await pop.waitFor({ state: "detached", timeout: 3000 });
    ok(true, "desktop: an outside click closes");
    const dbUnread = (await app.db.execute({ sql: `SELECT count(*) AS n FROM notification WHERE user_id = ? AND read_at IS NULL`, args: [app.admin] })).rows[0].n;
    ok(Number(dbUnread) === 0, "desktop: mark all read reached the server", String(dbUnread));
    await ctx.close();
  }

  // Fresh unread rows for the phone.
  await app.db.execute({ sql: `UPDATE notification SET read_at = NULL WHERE user_id = ? AND group_key <> 'price:seed-run0:3'`, args: [app.admin] });
  await app.db.execute({ sql: `UPDATE items SET status = 'ordered', ordered_at = ? WHERE id = ?`, args: [Date.now() - 86_400_000, items[1]] });

  // ---------- phone page (390×844, Hebrew RTL, dark, Plum) ----------
  for (const [locale, scheme, palette] of [
    ["he", "dark", "plum"],
    ["en", "light", "graphite"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme });
    await ctx.addCookies([...app.cookies(app.personal, locale), { name: "nexus_palette", value: palette, url: app.base }]);
    const page = await ctx.newPage();
    await page.goto(app.base);
    await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30000 });
    const bell = page.locator("[data-nt-bell=phone]");
    await bell.waitFor({ timeout: 30000 });
    await bell.click();
    const pg = page.locator("[data-nt-page]");
    await pg.waitFor();
    await page.waitForSelector("[data-nt-page] [data-nt]");
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => {
      const p = document.querySelector("[data-nt-page]").getBoundingClientRect();
      const dock = document.querySelector("[data-dock]");
      const under = getComputedStyle(document.querySelector("[data-nt-under]")).transform;
      const dockHidden = !dock || dock.getBoundingClientRect().top >= innerHeight || document.elementFromPoint(innerWidth / 2, innerHeight - 40)?.closest("[data-nt-page]") != null;
      return { full: p.left === 0 && p.width === innerWidth && p.height === innerHeight, html: document.documentElement.dataset.inbox, under, dockHidden, rtl: document.documentElement.dir };
    });
    ok(st.full && st.html === "open" && st.under !== "none" && st.dockHidden, `phone ${locale}: a full page over Home (Home moved back, the dock covered)`, JSON.stringify(st));
    const m = await mediaInside(page);
    ok(m.rows === (locale === "he" ? 7 : 6) && m.bad.length === 0, `phone ${locale} (${st.rtl}): every media block 40×40, badges inside the rows`, JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/phone-page-${locale}-${scheme}-${palette}.png` });

    if (locale === "he") {
      // Swipe to delete (RTL: the row goes to the right).
      const row = page.locator(`[data-nt-id="${ids["week:seed"]}"]`).locator("xpath=ancestor::div[contains(@class,'sw-row')]");
      const b = await row.boundingBox();
      const sgn = st.rtl === "rtl" ? 1 : -1;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + sgn * 34 * i, b.y + b.height / 2, { steps: 2 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      const gone = await page.locator(`[data-nt-id="${ids["week:seed"]}"]`).count();
      await page.waitForTimeout(300);
      const del = (await app.db.execute({ sql: `SELECT deleted_at FROM notification WHERE id = ?`, args: [ids["week:seed"]] })).rows[0].deleted_at;
      ok(gone === 0 && del != null, "phone: a long swipe deletes the row (here and on the server)", JSON.stringify({ gone, del }));
      // Received on the delivery row → the item is received.
      await page.click(`[data-nt-id="${ids["delivery:seed:1"]}"] [data-nt-received]`);
      await page.waitForSelector(`[data-nt-id="${ids["delivery:seed:1"]}"] [data-nt-done]`, { timeout: 5000 });
      await page.waitForTimeout(400);
      const it = (await app.db.execute({ sql: `SELECT status FROM items WHERE id = ?`, args: [items[1]] })).rows[0].status;
      ok(it === "purchased", "phone: Received marks the item received (On the way → bought) and the row says so", it);
      await page.screenshot({ path: `${SHOTS}/phone-received-he.png` });
    }

    // Browser Back closes the page and Home comes back.
    await page.goBack();
    await pg.waitFor({ state: "detached", timeout: 4000 });
    ok((await page.evaluate(() => document.documentElement.dataset.inbox)) === undefined, `phone ${locale}: browser Back closes the page`);
    // Tap = read + open (the price row opens its item).
    await bell.click();
    await pg.waitFor();
    await page.waitForSelector(`[data-nt-id="${ids["price:seed-run:1"]}"]`);
    await page.click(`[data-nt-id="${ids["price:seed-run:1"]}"] .nt-hit`);
    await pg.waitFor({ state: "detached", timeout: 4000 });
    const read = (await app.db.execute({ sql: `SELECT read_at FROM notification WHERE id = ?`, args: [ids["price:seed-run:1"]] })).rows[0].read_at;
    await page.waitForTimeout(600);
    const sheet = await page.locator("[role=dialog]").count();
    ok(read != null && sheet > 0, `phone ${locale}: tap marks read and opens the item`, JSON.stringify({ read, sheet }));
    await app.db.execute({ sql: `UPDATE notification SET read_at = NULL WHERE id = ?`, args: [ids["price:seed-run:1"]] });
    await ctx.close();
  }

  // /inbox (a grouped push) opens the page directly; closing leaves "/".
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addCookies(app.cookies(app.personal, "en"));
    const page = await ctx.newPage();
    await page.goto(`${app.base}/inbox`);
    await page.locator("[data-nt-page]").waitFor({ timeout: 30000 });
    await page.click("[data-nt-back]");
    await page.locator("[data-nt-page]").waitFor({ state: "detached", timeout: 4000 });
    await page.waitForTimeout(200);
    ok(new URL(page.url()).pathname === "/", "/inbox opens the page; Back leaves Home's own address", page.url());
    // Empty state.
    await app.db.execute({ sql: `UPDATE notification SET deleted_at = ? WHERE user_id = ?`, args: [Date.now(), app.admin] });
    await page.click("[data-nt-bell=phone]");
    await page.locator("[data-nt-empty]").waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/phone-empty-en.png` });
    ok(true, "empty state");
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  fails++;
} finally {
  await browser.close();
  app.stop();
}
console.log(fails ? `FAIL inbox: ${fails} failed` : "OK inbox");
process.exit(fails ? 1 : 0);
