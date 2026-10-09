// R17 G — demo data for the admin panel (parity shots, test:admin-*): a few people like the board's (Noa shopping on her
// phone, Yoav on Home on his computer, Maya new and getting started, Ron earlier today, Gal deleting, Eden quiet),
// presence rows, activity counts, 30 days of AI calls, one open report. Into a test DB only (file:…).
//   await seedAdmin(db, { adminId, now })
export async function seedAdmin(db, { adminId, now = Date.now(), personal }) {
  const DAY = 86_400_000;
  const MIN = 60_000;
  const x = (sql, args = []) => db.execute({ sql, args });
  const people = [
    ["ad_noa", "Noa", "noa.levi@example.com", now - 40 * DAY],
    ["ad_yoav", "Yoav", "yoav.cohen@example.com", now - 38 * DAY],
    ["ad_maya", "Maya", "maya.bendavid@example.com", now - 20 * MIN],
    ["ad_ron", "Ron", "ron.shalev@example.com", now - 30 * DAY],
    ["ad_gal", "Gal", "gal.rosen@example.com", now - 60 * DAY],
    ["ad_eden", "Eden", "eden.m@example.com", now - 90 * DAY],
  ];
  for (const t of ["presence", "activity"]) await x(`DELETE FROM ${t} WHERE user_id LIKE 'ad_%' OR user_id = ?`, [adminId]);
  await x(`DELETE FROM ai_usage WHERE user_id LIKE 'ad_%' OR user_id = ?`, [adminId]);
  await x(`DELETE FROM session WHERE id LIKE 'ads_%'`);
  await x(`DELETE FROM space_member WHERE id LIKE 'adm_%'`);
  await x(`DELETE FROM space WHERE id = 'ad_home'`);
  await x(`DELETE FROM "user" WHERE id LIKE 'ad_%'`);
  await x(`DELETE FROM reports WHERE id = 'r_admin_demo'`);
  for (const [id, name, email, at] of people)
    await x(`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at, deletion_requested_at) VALUES (?, ?, ?, 1, 'user', ?, ?, ?)`, [id, name, email, at, at, id === "ad_gal" ? now - 2 * DAY : null]);
  // A shared "Jacoby Home": the admin + Noa + Yoav.
  await x("INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES ('ad_home', 'Jacoby Home', 's-ad-home', 'shared', 'ILS', 'green', 'home', ?, ?)", [adminId, now - 40 * DAY]);
  for (const [uid, role] of [[adminId, "owner"], ["ad_noa", "member"], ["ad_yoav", "member"]]) await x("INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, 'ad_home', ?, ?, ?)", [`adm_${uid}`, uid, role, now - 39 * DAY]);
  // Sessions (devices) + presence.
  const UA = {
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  };
  const sess = async (id, user, ua, at) => x(`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, ?, 'google')`, [id, now + 30 * DAY, `tok_${id}`, at, at, user, ua]);
  await sess("ads_noa_p", "ad_noa", UA.android, now - 14 * MIN);
  await sess("ads_noa_c", "ad_noa", UA.windows, now - DAY);
  await sess("ads_yoav", "ad_yoav", UA.windows, now - 3 * MIN);
  await sess("ads_maya", "ad_maya", UA.iphone, now - MIN);
  await sess("ads_ron", "ad_ron", UA.android, now - 18 * MIN);
  const pres = (sid, user, device, app, platform, screen, left, space, since, at) =>
    x(`INSERT INTO presence (session_id, user_id, device, app, platform, screen, shopping_left, space_id, since, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [sid, user, device, app, platform, screen, left, space, since, at]);
  await pres("ads_noa_p", "ad_noa", "phone", "installed", "Android · Chrome", "shopping-mode", 6, "ad_home", now - 14 * MIN, now - 10_000);
  await pres("ads_yoav", "ad_yoav", "computer", "browser", "Windows · Chrome", "home", null, "ad_home", now - 3 * MIN, now - 20_000);
  await pres("ads_maya", "ad_maya", "phone", "browser", "iPhone · Safari", "onboarding-2", null, null, now - MIN, now - 5_000);
  await pres("ads_ron", "ad_ron", "phone", "installed", "Android · Chrome", "on-the-way", null, null, now - 40 * MIN, now - 18 * MIN);
  // Activity (kinds + counts) and the by-hour marks.
  const act = (user, space, kind, n, at) => x("INSERT INTO activity (user_id, space_id, kind, n, at) VALUES (?, ?, ?, ?, ?)", [user, space, kind, n, at]);
  await act("ad_gal", null, "deletion_requested", 1, now - 2 * 3_600_000);
  await act("ad_ron", personal ?? null, "delivery_received", 1, now - 18 * MIN);
  await act("ad_noa", "ad_home", "shopping_started", 1, now - 12 * MIN);
  await act("ad_yoav", "ad_home", "opened", 1, now - 3 * MIN);
  await act("ad_maya", null, "joined_code", 1, now - 2 * MIN);
  await act("ad_noa", "ad_home", "checked_off", 2, now - 50_000);
  await act("ad_yoav", "ad_home", "link_added", 1, now - 30_000);
  await act("ad_maya", null, "onboarding_step", 1, now - 15_000);
  const startHour = now - (now % 3_600_000);
  for (let h = 1; h < 14; h++) for (const u of ["ad_noa", "ad_yoav", "ad_ron"].slice(0, 1 + (h % 3))) await act(u, null, "hour", 1, startHour - h * 3_600_000);
  for (const u of ["ad_noa", "ad_yoav", "ad_maya"]) await act(u, null, "hour", 1, now - 1000);
  // AI calls: 30 days, mostly Gemini, some Groq, a few failures; Yoav at his limit today.
  const day = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const rows = [];
  for (let d = 29; d >= 0; d--) {
    const tot = 14 + ((d * 7) % 13);
    for (let k = 0; k < tot; k++) {
      const provider = k % 9 === 4 ? "openrouter" : k % 5 === 2 ? "groq" : "gemini";
      const model = provider === "gemini" ? "gemini-2.5-flash" : provider === "groq" ? "llama-3.3-70b-versatile" : "meta-llama/llama-3.3-70b-instruct:free";
      const feature = ["extract", "assistant", "extract", "receipt", "short_name", "suggestions"][k % 6];
      rows.push([d === 0 && k < 40 ? "ad_yoav" : ["ad_noa", "ad_yoav", adminId][k % 3], feature, provider, model, k % 23 === 7 ? 0 : 1, day(now - d * DAY), now - d * DAY - k * MIN]);
    }
  }
  for (let k = 0; k < 40 - rows.filter((r) => r[0] === "ad_yoav" && r[5] === day(now)).length; k++) rows.push(["ad_yoav", "assistant", "gemini", "gemini-2.5-flash", 1, day(now), now - k * MIN]);
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await x(`INSERT INTO ai_usage (user_id, space_id, feature, provider, model, ok, ms, system, day, at) VALUES ${chunk.map(() => "(?, NULL, ?, ?, ?, ?, 900, 0, ?, ?)").join(", ")}`, chunk.flat());
  }
  // One open report (Noa, Home, phone, dark, Hebrew).
  const diag = { client: { view: "home", device: "phone", viewport: "384×784", palette: "graphite", mode: "dark", locale: "he", online: true, extension: null, version: "a41c9e2", errors: [], standalone: true }, server: { commit: "a41c9e2" }, space: { id: "ad_home", name: "Jacoby Home" } };
  await x(`INSERT INTO reports (id, user_id, type, title, body, diagnostics, status, created_at, updated_at) VALUES ('r_admin_demo', 'ad_noa', 'complaint', 'Suggestions border stops abruptly', 'The animation around the suggestions card ends suddenly instead of fading.', ?, 'open', ?, ?)`, [JSON.stringify(diag), now - 5 * 3_600_000, now - 5 * 3_600_000]);
}
