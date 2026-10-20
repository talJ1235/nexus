// R17 G0 acceptance — the admin panel is the admin's only: every /admin route is a 404 for anyone else (and a sign-in
// redirect when signed out), robots noindex, and every admin server action refuses a non-admin (called over HTTP the
// way the browser does). Plus a static guard: every export of the admin action files goes through its admin() gate.
//   npm run build && npm run test:admin-access
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { actionTable, callAction } from "./lib/actions.mjs";
import { walkAdmin } from "./lib/admin-walk.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { startApp } from "./lib/test-app.mjs";
import webpush from "web-push";
import { PHONE } from "./lib/phone.mjs";

let fails = 0;
const ok = (c, m, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : ` ${extra}`}`);
  if (!c) fails++;
};

// Static: every exported function in the admin action files starts with the gate.
const ADMIN_FILES = ["src/app/admin-actions.ts", "src/app/invite-admin-actions.ts", "src/app/error-actions.ts"];
for (const f of ADMIN_FILES) {
  const src = readFileSync(f, "utf8");
  const fns = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\r?\n([^\r\n]*)/g)];
  const bad = fns.filter(([, , first]) => !/\badmin\(\)/.test(first)).map(([, n]) => n);
  ok(fns.length > 0 && bad.length === 0, `${f}: all ${fns.length} actions start with admin()`, bad.join(", "));
}

// R17 P8: a second admin address in ADMIN_EMAILS only (its stored role is still "user").
const LISTED = "listed-admin@example.com";
const vapid = webpush.generateVAPIDKeys();
const app = await startApp({ db: "admin-access-test.db", port: Number(process.env.PORT || 3121), env: { ADMIN_EMAILS: `test-admin@example.com,${LISTED}`, TZ: "UTC", VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "https://nexus.test" } });
try {
  await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
  const noa = await app.sessionFor("ad_noa");
  const admin = app.cookieHeader;
  const ROUTES = ["/admin", "/admin/live", "/admin/people", "/admin/people/ad_noa", "/admin/invites", "/admin/ai", "/admin/reports", "/admin/reports/r_admin_demo", "/admin/errors", "/admin/system", "/admin/more"];
  for (const r of ROUTES) {
    const asNoa = await fetch(`${app.base}${r}`, { headers: { cookie: noa.header }, redirect: "manual" });
    const asAdmin = await fetch(`${app.base}${r}`, { headers: { cookie: admin }, redirect: "manual" });
    const out = await fetch(`${app.base}${r}`, { redirect: "manual" });
    const html = await asAdmin.text();
    ok(asNoa.status === 404, `${r}: non-admin → 404`, String(asNoa.status));
    ok(asAdmin.status === 200 && /<meta name="robots" content="noindex, nofollow"/.test(html), `${r}: admin → 200, noindex`, String(asAdmin.status));
    ok(out.status === 307 || out.status === 308 || out.status === 302, `${r}: signed out → sign-in redirect`, String(out.status));
  }
  // R17 P8: an address in ADMIN_EMAILS gets the panel at once (role still "user" in the row); wrong paths stay 404.
  await app.db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES ('p8_listed', 'Listed', ?, 1, 'user', ?, ?)`, args: [LISTED, Date.now(), Date.now()] });
  const listed = await app.sessionFor("p8_listed");
  const asListed = await fetch(`${app.base}/admin`, { headers: { cookie: listed.header }, redirect: "manual" });
  ok(asListed.status === 200, "P8 /admin: an ADMIN_EMAILS address → 200 before its role is stored", String(asListed.status));
  for (const p of ["/api/admin", "/api/admin/people", "/admin.php", "/api/auth/admin/list-users"]) {
    const r = await fetch(`${app.base}${p}`, { headers: { cookie: admin }, redirect: "manual" });
    ok(r.status === 404, `P8 ${p} → 404 (even for the admin)`, String(r.status));
  }
  // The desktop sidebar shows the Admin entry to admins only.
  const home = async (cookie) => (await fetch(`${app.base}/`, { headers: { cookie } })).text();
  ok(/data-sidebar-admin/.test(await home(admin)) && !/data-sidebar-admin/.test(await home(noa.header)), "P8 the sidebar's Admin entry: the admin sees it, a member doesn't");

  // /settings/invites moved into the panel.
  const inv = await fetch(`${app.base}/settings/invites`, { headers: { cookie: admin }, redirect: "manual" });
  ok([307, 308].includes(inv.status) && (inv.headers.get("location") ?? "").endsWith("/admin/invites"), "/settings/invites → /admin/invites", `${inv.status} ${inv.headers.get("location")}`);

  // Every admin action (as the client calls them) refuses Noa; the admin's call of the same goes through.
  const table = actionTable().filter((a) => ADMIN_FILES.includes(a.file) || (a.file === "src/app/report-actions.ts" && ["setReportStatus", "openReportIssue"].includes(a.name)));
  const ARGS = { getPerson: ["ad_yoav"], getAiAllowance: ["ad_yoav"], setAiQuota: ["ad_yoav", 80], resetAiToday: ["ad_yoav"], signOutDevice: ["ad_yoav", "ads_yoav"], signOutEverywhere: ["ad_ron"], setBan: ["ad_eden", true], deleteUserAccount: ["ad_eden"], getAiStats: [30], getAdminReport: ["r_admin_demo"], setAdminReportStatus: ["r_admin_demo", "in_progress"], setReportStatus: ["r_admin_demo", "open"], openReportIssue: ["r_admin_demo"], revokeInviteCode: ["nope"], inviteFromWaitlist: ["x@example.com"], createInviteCode: [{ note: "t", maxUses: 1, days: 1 }], setErrorStatus: ["nope", "fixed"], createErrorIssue: ["nope"], listErrorEvents: [{}] };
  ok(table.length >= 15, `found ${table.length} admin actions in the manifest`);
  const before = (await app.db.execute("SELECT banned, deletion_requested_at FROM \"user\" WHERE id = 'ad_eden'")).rows[0];
  for (const a of table) {
    const r = await callAction(app.base, noa.header, a, ARGS[a.name] ?? []);
    ok(r.failed, `${a.name}: refused for a non-admin`, `${r.status} ${r.text.slice(0, 160)}`);
  }
  const after = (await app.db.execute("SELECT banned, deletion_requested_at FROM \"user\" WHERE id = 'ad_eden'")).rows[0];
  ok(!after.banned && after.deletion_requested_at == null && !before.banned, "nothing changed by the refused calls (ban / delete)");
  const live = table.find((a) => a.name === "getLive");
  const r = await callAction(app.base, admin, live, [null]);
  ok(!r.failed && r.text.includes("ad_noa"), "the admin's getLive answers", `${r.status} ${r.text.slice(0, 160)}`);

  // R17 S5 S1: the panel in a real browser (server in UTC, browser in Asia/Jerusalem — like Vercel and Tal), every tab,
  // desktop 1366×768 + phone 390, en + he: no console error, no hydration warning, no 5xx, never a blank page.
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1366, 768], [390, 844]])
      for (const locale of ["en", "he"]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 640 ? PHONE : {}), timezoneId: "Asia/Jerusalem", locale: locale === "he" ? "he-IL" : "en-US", colorScheme: "dark" });
        await ctx.addCookies(app.cookies(app.personal, locale));
        const page = await ctx.newPage();
        const res = await walkAdmin(page, app.base, { locale });
        ok(res.problems.length === 0, `S1 /admin ${w} ${locale}: ${res.tabs} tabs, no console error / hydration warning / 5xx / blank`, res.problems.join(" | "));
        await ctx.close();
      }
    // R17 S6 U1: System → Push — the dispatcher's last run (3 h ago → warning), rows by push state with the oldest
    // waiting one (2 h → warning), the devices (person · label · last failure code), and the test push answering per
    // device (an address outside the push services → "gone", removed — no network).
    const now = Date.now();
    const x = (sql, args = []) => app.db.execute({ sql, args });
    await x("INSERT INTO kv (key, value, updated_at) VALUES ('pref:last_notify', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify({ at: now - 3 * 3_600_000, ms: 800, sent: 2, failed: 1 }), now]);
    await x("INSERT INTO notification (id, user_id, space_id, kind, group_key, data, created_at, updated_at, send_after, push_state) VALUES ('u1_due', 'ad_noa', NULL, 'week', 'week:u1', '{}', ?, ?, ?, 'due')", [now, now, now - 2 * 3_600_000]);
    await x("INSERT INTO notification (id, user_id, space_id, kind, group_key, data, created_at, updated_at, send_after, sent_at, push_state) VALUES ('u1_failed', 'ad_noa', NULL, 'week', 'week:u1b', '{}', ?, ?, ?, ?, 'failed')", [now, now, now, now]);
    await x("INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, device, label, created_at, last_fail_at, last_code, fail_count) VALUES ('ps_u1a', 'ad_noa', 'https://fcm.googleapis.com/fcm/send/u1-noa', 'k', 'a', 'phone', 'Chrome · Android', ?, ?, 500, 1)", [now, now - 60_000]);
    await x("INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, device, label, created_at, fail_count) VALUES ('ps_u1b', ?, 'https://example.com/not-a-push-service', 'k', 'a', 'computer', 'Chrome · Windows', ?, 0)", [app.admin, now]);
    for (const [w, h] of [[1366, 768], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 640 ? PHONE : {}), timezoneId: "Asia/Jerusalem" });
      await ctx.addCookies(app.cookies(app.personal, "en"));
      const page = await ctx.newPage();
      await page.goto(`${app.base}/admin/system`);
      const panel = page.locator("[data-system-push-panel]");
      await panel.waitFor({ timeout: 20000 });
      const st = await panel.evaluate((el) => ({
        old: el.getAttribute("data-dispatch-old"),
        dueOld: el.getAttribute("data-due-old"),
        oldest: Number(el.querySelector("[data-push-oldest]")?.getAttribute("data-push-oldest")),
        states: Object.fromEntries([...el.querySelectorAll("[data-push-state]")].map((r) => [r.getAttribute("data-push-state"), r.querySelector(".r")?.textContent])),
        devices: [...el.querySelectorAll("[data-push-device]")].map((r) => r.textContent),
        overflow: el.scrollWidth > el.clientWidth + 1,
      }));
      ok(st.old === "yes" && st.dueOld === "yes" && st.oldest >= 119, `U1 System → Push ${w}: an old dispatcher run and a 2 h waiting row are flagged`, JSON.stringify(st));
      ok(Number(st.states.due) >= 1 && Number(st.states.failed) >= 1 && "sent" in st.states && "skipped" in st.states && "off" in st.states, `U1 System → Push ${w}: rows by push state`, JSON.stringify(st.states));
      ok(st.devices.some((d) => /Noa · Chrome · Android/.test(d) && /failed 500/.test(d)) && !st.devices.join().includes("fcm.googleapis"), `U1 System → Push ${w}: devices with person, label and last failure code, no address`, JSON.stringify(st.devices));
      ok(!st.overflow, `U1 System → Push ${w}: fits`);
      await ctx.close();
    }
    // R19 B5: Prices — a chain whose newest file is 30 h old is flagged "Prices may be old", a fresh one shows today's rows.
    await x("INSERT OR REPLACE INTO chain (id, gov_id, he, en, branches, last_file_at, last_ok_at, updated_at) VALUES ('rami-levy', '7290058140886', 'רמי לוי', 'Rami Levy', 99, ?, ?, ?)", [now - 3_600_000, now, now]);
    await x("INSERT OR REPLACE INTO chain (id, gov_id, he, en, branches, last_file_at, last_ok_at, updated_at) VALUES ('king-store', '7290058108879', 'קינג סטור', 'King Store', 48, ?, ?, ?)", [now - 30 * 3_600_000, now - 30 * 3_600_000, now]);
    await x("INSERT OR REPLACE INTO price_file (name, chain_id, store_id, kind, stamp, read_at, rows, changed, ms) VALUES ('PriceFull7290058140886-001-001-x', 'rami-levy', 1, 'PriceFull', '202610200300', ?, 12953, 140, 200)", [now]);
    {
      const pc = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await pc.addCookies(app.cookies(app.personal, "en"));
      const pp = await pc.newPage();
      await pp.goto(`${app.base}/admin/system`);
      await pp.locator("[data-system-prices]").waitFor({ timeout: 20000 });
      const pr = await pp.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-price-chain]")].map((e) => [e.getAttribute("data-price-chain"), [e.getAttribute("data-stale"), e.textContent]])));
      ok(pr["king-store"]?.[0] === "yes" && /may be old/.test(pr["king-store"][1]) && pr["rami-levy"]?.[0] === "no" && /1\d,\d{3} rows/.test(pr["rami-levy"][1]), "R19 B5 System → Prices: a stale chain (30 h) is flagged, a fresh one shows today's rows", JSON.stringify(pr));
      await pc.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.addCookies(app.cookies(app.personal, "en"));
    const page = await ctx.newPage();
    await page.goto(`${app.base}/admin/system`);
    await page.click("[data-push-test]");
    const res = await page.waitForSelector("[data-push-result]", { timeout: 15000 }).then((e) => e.evaluate((el) => [el.getAttribute("data-push-result"), el.textContent])).catch(() => null);
    const left = (await x("SELECT count(*) n FROM push_subscription WHERE id = 'ps_u1b'")).rows[0].n;
    ok(res?.[0] === "gone" && /Chrome · Windows/.test(res[1]) && Number(left) === 0, "U1 test push: the answer per device (outside the push services → gone, removed)", JSON.stringify(res));
    await ctx.close();
  } finally {
    await browser.close();
  }
} finally {
  app.stop();
}
console.log(fails ? `FAIL admin-access: ${fails}` : "OK admin-access");
process.exit(fails ? 1 : 0);
