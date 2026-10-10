// R17 G0 acceptance — "counts only, never content" (MULTIUSER §1): call every admin action (as the client calls them,
// over HTTP) on the seeded DB as the admin, and assert that none of the seed's item titles, notes, links, chat text or
// memory strings appear anywhere in the answers. A report's own text may appear (the person sent it to the admin).
//   npm run build && npm run test:admin-privacy
import { actionTable, callAction } from "./lib/actions.mjs";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { startApp } from "./lib/test-app.mjs";

let fails = 0;
const ok = (c, m, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : ` ${extra}`}`);
  if (!c) fails++;
};

const app = await startApp({ db: "admin-privacy-test.db", port: Number(process.env.PORT || 3122) });
try {
  const now = Date.now();
  await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
  const x = (sql, args = []) => app.db.execute({ sql, args });
  // Chats, memory and notes of the admin and of Noa (in the shared space) — none of it may reach the panel.
  for (const [uid, sp] of [[app.admin, app.personal], ["ad_noa", "ad_home"]]) {
    await x("INSERT INTO conversations (id, space_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [`cv_${uid}`, sp, uid, `Secret chat title ${uid.slice(-4)}`, now, now]);
    await x("INSERT INTO conversation_messages (id, space_id, conversation_id, role, text, created_at) VALUES (?, ?, ?, 'user', ?, ?)", [`cm_${uid}`, sp, `cv_${uid}`, `Private chat words zebra-${uid.slice(-4)}`, now]);
    await x("INSERT INTO memories (id, user_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [`mem_${uid}`, uid, `Memory: likes quince jam ${uid.slice(-4)}`, now, now]);
  }
  await x("INSERT INTO items (id, space_id, title, notes, status, added_by_user_id, created_at, updated_at) VALUES ('ad_item1', 'ad_home', 'Velvet armchair Pirouette', 'note: hide from the panel', 'to_buy', 'ad_noa', ?, ?)", [now, now]);
  await x("UPDATE items SET notes = 'private note ' || id WHERE notes IS NULL AND id IN (SELECT id FROM items LIMIT 30)");
  // R17 S3 N3: inbox rows (their data holds names, titles, prices) and a push address — the panel shows counts only.
  await x("INSERT INTO notification (id, user_id, space_id, kind, group_key, data, created_at, updated_at, sent_at, push_state) VALUES ('nt_priv1', 'ad_noa', 'ad_home', 'price', 'price:priv:1', ?, ?, ?, ?, 'sent')", [JSON.stringify({ itemId: "ad_item1", title: "Inbox title Marmalade lamp", store: "Secretstore", now: 12, was: 20, currency: "ILS", run: "priv" }), now, now, now]);
  await x("INSERT INTO notification (id, user_id, space_id, kind, group_key, data, created_at, updated_at, push_state) VALUES ('nt_priv2', ?, ?, 'activity', 'activity:priv', ?, ?, ?, 'due')", [app.admin, app.personal, JSON.stringify({ names: ["Persimmon Person"], byIds: ["ad_noa"], added: 3, checked: 0, space: "Hidden space name" }), now, now]);
  await x("INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, device, label, created_at, fail_count) VALUES ('ps_priv', 'ad_noa', 'https://fcm.googleapis.com/fcm/send/secret-endpoint-abc123', 'p256dh-secret-key', 'auth-secret', 'phone', 'Chrome · Android', ?, 0)", [now]);

  const strings = new Set();
  const add = (v) => typeof v === "string" && v.trim().length >= 6 && strings.add(v.trim());
  for (const r of (await x("SELECT title, notes FROM items")).rows) (add(r.title), add(r.notes));
  for (const r of (await x("SELECT url FROM sources")).rows) add(r.url);
  for (const r of (await x("SELECT text FROM conversation_messages")).rows) add(r.text);
  for (const r of (await x("SELECT title FROM conversations")).rows) add(r.title);
  for (const r of (await x("SELECT text FROM memories")).rows) add(r.text);
  for (const r of (await x("SELECT name FROM collections")).rows) add(r.name);
  for (const v of ["Inbox title Marmalade lamp", "Secretstore", "Persimmon Person", "Hidden space name", "secret-endpoint-abc123", "p256dh-secret-key", "auth-secret"]) strings.add(v);
  ok(strings.size > 20, `${strings.size} content strings from the seed to look for`);

  const FILES = ["src/app/admin-actions.ts", "src/app/invite-admin-actions.ts", "src/app/error-actions.ts"];
  const table = actionTable().filter((a) => FILES.includes(a.file));
  const people = (await x(`SELECT id FROM "user"`)).rows.map((r) => r.id);
  const beat = { device: "computer", app: "browser", screen: "admin", shoppingLeft: null };
  const ARGS = {
    getAdminNav: [[beat]],
    getLive: [[beat]],
    getPerson: people.map((id) => [id]),
    getAiAllowance: [["ad_noa"]],
    setAiQuota: [["ad_noa", 80]],
    resetAiToday: [["ad_noa"]],
    signOutDevice: [["ad_yoav", "ads_yoav"]],
    signOutEverywhere: [["ad_ron"]],
    setBan: [["ad_eden", true], ["ad_eden", false]],
    deleteUserAccount: [["ad_eden"]],
    getAiStats: [[7], [30]],
    getAdminReport: [["r_admin_demo"]],
    setAdminReportStatus: [["r_admin_demo", "in_progress"]],
    listErrorEvents: [[{}]],
    setErrorStatus: [["nope", "known"]],
    createErrorIssue: [["nope"]],
    createInviteCode: [[{ note: "for testing", maxUses: 2, days: 3 }]],
    revokeInviteCode: [["nope"]],
    inviteFromWaitlist: [["waiter@example.com"]],
  };
  let calls = 0;
  let allowed = "";
  for (const a of table) {
    for (const args of ARGS[a.name] ?? [[]]) {
      const r = await callAction(app.base, app.cookieHeader, a, args);
      calls++;
      const body = r.text;
      allowed += body;
      const leaks = [...strings].filter((s) => body.includes(s) || body.includes(JSON.stringify(s).slice(1, -1)));
      ok(!leaks.length, `${a.name}(${JSON.stringify(args).slice(1, -1).slice(0, 40)}): no content in the answer`, leaks.slice(0, 3).join(" | "));
    }
  }
  // Positive control: the same answers do carry what's allowed (names, emails, space names, report text).
  ok(["noa.levi@example.com", "Jacoby Home", "Suggestions border stops abruptly"].every((v) => allowed.includes(v)), "the answers carry people, space names and the report text (the check can see content)");
  ok(calls >= table.length, `${calls} calls over ${table.length} admin actions`);
} finally {
  app.stop();
}
console.log(fails ? `FAIL admin-privacy: ${fails}` : "OK admin-privacy");
process.exit(fails ? 1 : 0);
