// R17 S5 S1 — opens /admin (every tab) as the admin at 1366×768 and 390, en + he, and lists console errors, hydration
// warnings, 5xx responses and blank pages. One sign-in for all four runs (the emergency path is rate-limited).
//   BASE=https://… node --env-file=.env.local scripts/probe-admin.mjs     (SMOKE_ADMIN_TOKEN + SMOKE_ADMIN_EMAIL)
//   BASE=http://localhost:3000 node scripts/probe-admin.mjs               (after scripts/serve-smoke.sh)
import { chromium } from "playwright";
import { walkAdmin } from "./lib/admin-walk.mjs";
import { signIn } from "./lib/sign-in.mjs";

const base = process.env.BASE || "http://localhost:3000";
const browser = await chromium.launch();
let bad = 0;
try {
  const first = await browser.newContext();
  await signIn(await first.newPage(), base);
  const storageState = await first.storageState();
  await first.close();
  for (const [w, h] of [[1366, 768], [390, 844]])
    for (const locale of ["en", "he"]) {
      const ctx = await browser.newContext({ storageState, viewport: { width: w, height: h }, locale: locale === "he" ? "he-IL" : "en-US", timezoneId: "Asia/Jerusalem", colorScheme: "dark" });
      const r = await walkAdmin(await ctx.newPage(), base, { locale });
      for (const p of r.problems) console.log(`FAIL ${w} ${locale} ${p}`);
      if (!r.problems.length) console.log(`PASS ${w} ${locale} /admin: ${r.tabs} tabs, no console error / hydration warning / 5xx / blank`);
      bad += r.problems.length;
      await ctx.close();
    }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
