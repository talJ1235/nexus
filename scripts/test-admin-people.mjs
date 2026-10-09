// R17 G2 acceptance — People: a daily-limit change is what E2's gate uses, "Reset today" frees the day, ban ends the
// sessions (sign-in refusal itself: test:auth-flow G2), hold-to-delete < 2 s does nothing and ≥ 2 s starts the E4
// deletion (pointer and keyboard), the admin can't delete or ban themselves; and a break-ui pass on the people list
// (long names / emails, 0 / 1 / 500 people, 360 + 1366: no sideways scroll, rows render).
//   npm run build && npm run test:admin-people
import { chromium } from "playwright";
import { actionTable, callAction } from "./lib/actions.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { startApp } from "./lib/test-app.mjs";

let fails = 0;
const ok = (c, m, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : ` ${extra}`}`);
  if (!c) fails++;
};

const app = await startApp({ db: "admin-people-test.db", port: Number(process.env.PORT || 3124) });
const browser = await chromium.launch();
try {
  const x = async (sql, args = []) => (await app.db.execute({ sql, args })).rows;
  await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
  const A = Object.fromEntries(actionTable().filter((a) => a.file === "src/app/admin-actions.ts").map((a) => [a.name, a]));
  const call = (name, ...args) => callAction(app.base, app.cookieHeader, A[name], args);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());

  // ---- Quota → the gate (E2's aiAllowance reads the same pref), reset.
  await x("DELETE FROM ai_usage WHERE user_id = 'ad_noa'");
  for (let k = 0; k < 20; k++) await x("INSERT INTO ai_usage (user_id, feature, provider, ok, ms, system, day, at) VALUES ('ad_noa', 'assistant', 'gemini', 1, 5, 0, ?, ?)", [day, Date.now() - k]);
  let r = await call("setAiQuota", "ad_noa", 20);
  ok(!r.failed && (await x("SELECT value FROM user_pref WHERE user_id = 'ad_noa' AND key = 'ai:quota'"))[0]?.value === "20", "daily limit 20 stored where the gate reads it");
  ok(/"limit":20,"used":20,"left":0/.test(r.text), "the gate's allowance: 20 of 20, nothing left (E2 refuses the next call)", r.text.slice(0, 200));
  r = await call("resetAiToday", "ad_noa");
  ok(/"limit":20,"used":0,"left":20/.test(r.text), "Reset today → 0 used, 20 left", r.text.slice(0, 200));
  r = await call("setAiQuota", "ad_noa", null);
  ok(/"limit":40/.test(r.text), "back to the default (40)", r.text.slice(0, 120));

  // ---- Ban: sessions end, the old session is refused; lift it.
  const noa = await app.sessionFor("ad_noa");
  ok((await fetch(`${app.base}/`, { headers: { cookie: noa.header }, redirect: "manual" })).status === 200, "Noa's session opens the app");
  r = await call("setBan", "ad_noa", true);
  const u = (await x(`SELECT banned FROM "user" WHERE id = 'ad_noa'`))[0];
  const s = await x("SELECT count(*) n FROM session WHERE user_id = 'ad_noa'");
  const after = await fetch(`${app.base}/`, { headers: { cookie: noa.header }, redirect: "manual" });
  ok(!r.failed && u.banned && Number(s[0].n) === 0, "ban: banned + every session ended");
  ok([302, 307, 308].includes(after.status) && /\/login/.test(after.headers.get("location") ?? ""), "ban: her old session gets /login", String(after.status));
  ok((await x("SELECT count(*) n FROM security_event WHERE user_id = 'ad_noa' AND kind = 'admin_ban'"))[0].n == 1, "ban: in her security log");
  await call("setBan", "ad_noa", false);
  ok(!(await x(`SELECT banned FROM "user" WHERE id = 'ad_noa'`))[0].banned, "unban");

  // ---- Self: refused.
  r = await call("deleteUserAccount", app.admin);
  ok(/"reason":"self"/.test(r.text) && (await x(`SELECT deletion_requested_at d FROM "user" WHERE id = ?`, [app.admin]))[0].d == null, "deleting yourself is refused");
  r = await call("setBan", app.admin, true);
  ok(/"reason":"self"/.test(r.text), "banning yourself is refused");

  // ---- Hold to delete (desktop drawer): < 2 s nothing, ≥ 2 s the E4 deletion; keyboard hold on the phone page.
  const desk = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await desk.addCookies(app.cookies(app.personal));
  const p = await desk.newPage();
  await p.goto(`${app.base}/admin/people/ad_eden`);
  await p.waitForSelector("[data-person-hold]", { timeout: 30_000 });
  const hold = p.locator("[data-person-hold]");
  const box = await hold.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(1200);
  await p.mouse.up();
  await p.waitForTimeout(1500);
  ok((await x(`SELECT deletion_requested_at d FROM "user" WHERE id = 'ad_eden'`))[0].d == null, "hold 1.2 s → nothing");
  await p.mouse.down();
  await p.waitForTimeout(2300);
  await p.mouse.up();
  await p.waitForSelector("[data-person-deleting]", { timeout: 10_000 }).catch(() => {});
  ok((await x(`SELECT deletion_requested_at d FROM "user" WHERE id = 'ad_eden'`))[0].d != null, "hold 2.3 s → deletion started (7-day undo)");
  ok((await p.locator("[data-person-deleting]").count()) === 1, "the drawer shows \"Deleting — 7 days left\"");
  // Own drawer: no hold button.
  await p.goto(`${app.base}/admin/people/${app.admin}`);
  await p.waitForSelector("[data-person-ai]", { timeout: 30_000 });
  ok((await p.locator("[data-person-hold]").count()) === 0, "your own drawer has no hold-to-delete");
  // Esc closes the drawer and focus goes back.
  await p.goto(`${app.base}/admin/people`);
  await p.waitForSelector('[data-person-row="ad_ron"]');
  await p.click('[data-person-row="ad_ron"]');
  await p.waitForSelector("[data-person-ai]");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  ok((await p.locator("aside.drawer").count()) === 0 && (await p.evaluate(() => document.activeElement?.getAttribute("data-person-row"))) === "ad_ron", "Esc closes the drawer, focus returns to the row");

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.addCookies(app.cookies(app.personal));
  const pp = await phone.newPage();
  await pp.goto(`${app.base}/admin/people/ad_ron`);
  await pp.waitForSelector("[data-person-hold]", { timeout: 30_000 });
  await pp.focus("[data-person-hold]");
  await pp.keyboard.down(" ");
  await pp.waitForTimeout(800);
  await pp.keyboard.up(" ");
  await pp.waitForTimeout(1200);
  ok((await x(`SELECT deletion_requested_at d FROM "user" WHERE id = 'ad_ron'`))[0].d == null, "keyboard: Space held 0.8 s → nothing");
  await pp.focus("[data-person-hold]");
  await pp.keyboard.down(" ");
  await pp.waitForTimeout(2300);
  await pp.keyboard.up(" ");
  await pp.waitForTimeout(1500);
  ok((await x(`SELECT deletion_requested_at d FROM "user" WHERE id = 'ad_ron'`))[0].d != null, "keyboard: Space held 2.3 s → deletion started");

  // ---- break-ui: long names (seed-worst), 500 people, 0 and 1 match; 360 + 1366.
  const many = [];
  for (let k = 0; k < 500; k++) many.push([`bulk_${k}`, `Person ${k} ${"Verylongfamilyname".repeat(k % 3)}`, `p${k}.${"x".repeat(k % 40)}@sub.example-domain.co.il`]);
  for (let i = 0; i < many.length; i += 100) {
    const chunk = many.slice(i, i + 100);
    await x(`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES ${chunk.map(() => "(?, ?, ?, 1, 'user', 0, 0)").join(", ")}`, chunk.flat());
  }
  for (const [vw, ctx] of [[1366, desk], [360, null]]) {
    const c = ctx ?? (await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }));
    if (!ctx) await c.addCookies(app.cookies(app.personal));
    const q = await c.newPage();
    const t0 = Date.now();
    await q.goto(`${app.base}/admin/people`);
    await q.waitForSelector('[data-person-row="bulk_499"]', { timeout: 30_000 }).catch(() => {});
    const ms = Date.now() - t0;
    const rows = await q.locator("[data-person-row]").count();
    const side = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(rows >= 510 && side <= 0, `${vw}: 500+ people render (${rows} rows, ${ms} ms), no sideways scroll`, `side=${side}`);
    const cut = await q.evaluate(() => [...document.querySelectorAll("[data-person-row] b")].filter((b) => b.scrollWidth > b.clientWidth + 1 && getComputedStyle(b).textOverflow !== "ellipsis").length);
    ok(cut === 0, `${vw}: long names truncate with an ellipsis (never cut)`, String(cut));
    await q.fill("[data-people-search]", "Montgomery");
    ok((await q.locator("[data-person-row]").count()) === 1, `${vw}: 1 match`);
    await q.fill("[data-people-search]", "zzzz-nobody");
    ok((await q.locator("[data-person-row]").count()) === 0 && (await q.locator("text=No one matches.").count()) === 1, `${vw}: 0 matches → "No one matches."`);
  }
} finally {
  await browser.close();
  app.stop();
}
console.log(fails ? `FAIL admin-people: ${fails}` : "OK admin-people");
process.exit(fails ? 1 : 0);
