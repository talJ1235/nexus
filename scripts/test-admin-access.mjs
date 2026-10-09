// R17 G0 acceptance — the admin panel is the admin's only: every /admin route is a 404 for anyone else (and a sign-in
// redirect when signed out), robots noindex, and every admin server action refuses a non-admin (called over HTTP the
// way the browser does). Plus a static guard: every export of the admin action files goes through its admin() gate.
//   npm run build && npm run test:admin-access
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionTable, callAction } from "./lib/actions.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { startApp } from "./lib/test-app.mjs";

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

const app = await startApp({ db: "admin-access-test.db", port: Number(process.env.PORT || 3121) });
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
} finally {
  app.stop();
}
console.log(fails ? `FAIL admin-access: ${fails}` : "OK admin-access");
process.exit(fails ? 1 : 0);
