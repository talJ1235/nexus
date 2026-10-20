// R17 S7 X1 — no ad blocker hides a part of the app. EasyList's generic cosmetic rules (`##.ad-main` …, the base list of
// uBlock Origin / AdBlock / Adblock Plus / Brave) once hid the whole admin panel on Tal's PC — silently: a user-level
// sheet, nothing in the console. Snapshot: scripts/fixtures/easylist-generic.txt (refresh: node scripts/refresh-easylist.mjs).
//   1. static: every class / id the app's sources name, against the snapshot's plain `.class` / `#id` rules (no build);
//   2. browser: every rule's selector run on Home, Shopping, Settings, Inbox, onboarding and every /admin tab, computer
//      + phone, en + he — any matched element fails (rule + element).
//   npm run build && npm run test:adblock          (ADBLOCK_STATIC=1 → step 1 only)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "playwright";

let fails = 0;
const ok = (c, m, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : ` ${extra}`}`);
  if (!c) fails++;
};

const RULES = readFileSync("scripts/fixtures/easylist-generic.txt", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("!"));
ok(RULES.length > 5000, `snapshot: ${RULES.length} generic rules`);

// ---- 1. Static: class names in className strings / class lists and CSS selectors, ids in id="…".
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(f)) files.push(p);
  }
};
walk("src");
const plainClass = new Set(RULES.filter((r) => /^\.[\w-]+$/.test(r)).map((r) => r.slice(1)));
const plainId = new Set(RULES.filter((r) => /^#[\w-]+$/.test(r)).map((r) => r.slice(1)));
const hits = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const names = new Set();
  if (f.endsWith(".css")) for (const m of src.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) names.add(m[1]);
  else for (const m of src.matchAll(/(?:className|class)=\{?[`"']([^`"']+)[`"']/g)) for (const n of m[1].split(/\s+/)) names.add(n);
  for (const n of names) if (plainClass.has(n)) hits.push(`${f}: .${n}`);
  for (const m of src.matchAll(/\bid="([\w-]+)"/g)) if (plainId.has(m[1])) hits.push(`${f}: #${m[1]}`);
}
ok(hits.length === 0, `static: no class / id in src/ is a generic EasyList rule (${files.length} files)`, hits.join(" | "));
if (process.env.ADBLOCK_STATIC) process.exit(fails ? 1 : 0);

// ---- 2. Browser: run every rule on the real pages.
const { startApp } = await import("./lib/test-app.mjs");
const { seedAdmin } = await import("./lib/seed-admin.mjs");
const { seedInbox } = await import("./lib/seed-notify.mjs");
const app = await startApp({ db: "adblock-test.db", port: Number(process.env.PORT || 3126) });
// R19 F1: the Supermarket with prices, deal lines, the basket card (new deal / price class names).
const PAGES = ["/", "/?v=to_buy", "/supermarket", "/settings/display", "/settings/notifications", "/inbox", "/welcome"];
const ADMIN = ["/admin", "/admin/live", "/admin/people", "/admin/people/ad_noa", "/admin/invites", "/admin/ai", "/admin/reports", "/admin/errors", "/admin/system", "/admin/more"];
const PHONE = devices["Pixel 7"];
const CONTEXTS = [
  { tag: "computer", opts: { viewport: { width: 1366, height: 768 } } },
  { tag: "phone", opts: { ...PHONE } },
];
// Runs in the page: each rule's selector (invalid ones skipped); a match inside <head> or on <html>/<body> is still a hit.
const scan = (rules) => {
  const out = [];
  for (const r of rules) {
    let els;
    try {
      els = document.querySelectorAll(r);
    } catch {
      continue;
    }
    for (const el of [...els].slice(0, 2)) {
      if (el.closest("nextjs-portal, script, style, noscript, template")) continue;
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 4).join(".")}` : "";
      out.push(`${r} → <${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}>`);
    }
  }
  return out;
};
try {
  await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
  await seedInbox(app.db, { userId: app.admin, spaceId: app.personal });
  const obBefore = (await app.db.execute({ sql: "SELECT value FROM user_pref WHERE user_id = ? AND key = 'pref:onboarding'", args: [app.admin] })).rows[0]?.value ?? null;
  const browser = await chromium.launch();
  try {
    for (const { tag, opts } of CONTEXTS)
      for (const locale of ["en", "he"]) {
        const ctx = await browser.newContext({ ...opts, locale: locale === "he" ? "he-IL" : "en-US" });
        await ctx.addCookies(app.cookies(app.personal, locale));
        const page = await ctx.newPage();
        for (const r of [...PAGES, ...ADMIN]) {
          if (r === "/admin/more" && tag === "computer") continue;
          if (r === "/welcome")
            await app.db.execute({
              sql: "INSERT INTO user_pref (user_id, key, value, updated_at) VALUES (?, 'pref:onboarding', ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value",
              args: [app.admin, JSON.stringify({ v: 1, status: "active", step: 2, why: ["home", "super"], stores: ["shufersal"], custom: [], budget: 0, currency: "ILS", who: "family", sharedSpaceId: null, notif: null, installed: false, at: Date.now() }), Date.now()],
            });
          await page.goto(app.base + r);
          await page.waitForSelector("html[data-booted]", { timeout: 30_000 }).catch(() => {});
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(600);
          const found = await page.evaluate(scan, RULES);
          ok(found.length === 0, `${tag} ${locale} ${r}: no element matched by a generic rule`, found.slice(0, 12).join(" | "));
          if (r === "/welcome")
            await app.db.execute(obBefore == null ? { sql: "DELETE FROM user_pref WHERE user_id = ? AND key = 'pref:onboarding'", args: [app.admin] } : { sql: "UPDATE user_pref SET value = ? WHERE user_id = ? AND key = 'pref:onboarding'", args: [obBefore, app.admin] });
        }
        await ctx.close();
      }
  } finally {
    await browser.close();
  }
} finally {
  await app.stop();
}
console.log(fails ? `FAIL ${fails} check(s)` : "OK adblock");
process.exit(fails ? 1 : 0);
