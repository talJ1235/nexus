// R15 B3 guard 3 — two-user tenancy smoke on a fresh server (built app, throwaway file DB):
//   users A and B, viewer V in A's shared space S.
//   1. B calls EVERY server action (from the build's action manifest) and the API routes with A's ids → A's rows are
//      unchanged (hash before/after) and no response to B contains A's content.
//   2. V calls every action with S's ids while S is V's current space → S's rows are unchanged.
//   3. A's page HTML / RSC payload never contains B's titles; B's never contains A's; B forging nexus_space=<A's space>
//      falls back to B's personal space.
// Usage: npm run build (or scripts/check.sh) once, then `node scripts/test-tenancy.mjs` (PORT=3103).
import { createClient } from "@libsql/client";
import { spawn, execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";

const PORT = Number(process.env.PORT || 3103);
const BASE = `http://localhost:${PORT}`;
const DB = "tenancy-test.db";
const SECRET = "tenancy-test-secret-0123456789abcdef-xyz";
const ENV = {
  ...process.env,
  TURSO_DATABASE_URL: `file:${DB}`,
  TURSO_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: BASE,
  AUTH_FULL_LOCAL: "0",
  AUTH_SESSION_CACHE: "0",
  ADMIN_EMAIL: "",
  APP_PASSWORD: "",
  GEMINI_API_KEY: "",
  GROQ_API_KEY: "",
  OPENROUTER_API_KEY: "",
  SERPER_API_KEY: "",
  BRAVE_API_KEY: "",
  BLOB_READ_WRITE_TOKEN: "",
  GOOGLE_CLIENT_ID: "",
  NEXUS_MOCK_AI: "",
};
const id = () => randomBytes(12).toString("base64url");
const out = { pass: 0, fail: 0 };
const ok = (cond, msg, detail = "") => {
  if (cond) out.pass++;
  else out.fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}${!cond && detail ? ` — ${detail}` : ""}`);
};

// ---------- fresh DB + seed ----------
for (const f of [DB, `${DB}-journal`]) if (existsSync(f)) rmSync(f);
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: ENV, stdio: "ignore" });
const db = createClient({ url: `file:${DB}` });
// The server writes to the same file: wait for its locks instead of failing with SQLITE_BUSY (fast CI runners hit it).
await db.execute("PRAGMA busy_timeout = 10000");
const now = Date.now();
const U = { A: "uA_" + id(), B: "uB_" + id(), V: "uV_" + id() };
const SP = { A: "sA_" + id(), B: "sB_" + id(), V: "sV_" + id(), S: "sS_" + id() };
const MARK = { A: `ATITLE${id()}`, B: `BTITLE${id()}`, S: `STITLE${id()}` };
const ids = {};
async function seedUser(k, email) {
  await db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'user', ?, ?)`, args: [U[k], `User ${k}`, email, now, now] });
  await db.execute({ sql: `INSERT INTO space (id, name, slug, kind, created_by, created_at) VALUES (?, ?, ?, 'personal', ?, ?)`, args: [SP[k], `P${k}`, `p-${SP[k]}`, U[k], now] });
  await db.execute({ sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`, args: [id(), SP[k], U[k], now] });
}
async function seedData(space, mark, owner) {
  const r = { item: "i_" + id(), item2: "i_" + id(), col: "c_" + id(), src: "s_" + id(), att: "a_" + id(), grp: "g_" + id(), rec: "r_" + id(), conv: "c_" + id(), msg: "m_" + id(), alert: "al_" + id(), pp: "pp_" + id() };
  const q = (sql, args) => db.execute({ sql, args });
  await q(`INSERT INTO collections (id, space_id, kind, name, share_token, created_at) VALUES (?, ?, 'list', ?, ?, ?)`, [r.col, space, `${mark} list`, `share${id()}${id()}`, now]);
  await q(`INSERT INTO alt_groups (id, space_id, name, created_at) VALUES (?, ?, ?, ?)`, [r.grp, space, `${mark} group`, now]);
  for (const [iid, n] of [[r.item, 1], [r.item2, 2]])
    await q(`INSERT INTO items (id, space_id, collection_id, title, status, quantity, alt_group_id, added_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'to_buy', 3, ?, ?, ?, ?)`, [iid, space, r.col, `${mark} item ${n}`, r.grp, owner, now, now]);
  await q(`INSERT INTO sources (id, space_id, item_id, url, normalized_url, store, store_key, price, currency, created_at) VALUES (?, ?, ?, ?, ?, 'Shop', 'shop', 100, 'ILS', ?)`, [r.src, space, r.item, `https://shop.example/${mark}`, `shop.example/${mark}`, now]);
  await q(`INSERT INTO price_points (id, space_id, source_id, item_id, price, currency, recorded_at) VALUES (?, ?, ?, ?, 100, 'ILS', ?)`, [r.pp, space, r.src, r.item, now]);
  await q(`INSERT INTO attachments (id, space_id, item_id, url, name, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [r.att, space, r.item, `https://x.public.blob.vercel-storage.com/spaces/${space}/receipts/${mark}.pdf`, `${mark}.pdf`, now]);
  await q(`INSERT INTO alerts (id, space_id, item_id, source_id, kind, old_price, new_price, currency, created_at) VALUES (?, ?, ?, ?, 'drop', 120, 100, 'ILS', ?)`, [r.alert, space, r.item, r.src, now]);
  await q(`INSERT INTO receipts (id, space_id, name, text, status, created_at) VALUES (?, ?, ?, ?, 'extracted', ?)`, [r.rec, space, `${mark} receipt`, `${mark} receipt text line`, now]);
  await q(`INSERT INTO store_settings (space_id, store_key, free_shipping_min, currency, updated_at) VALUES (?, 'shop', 200, 'ILS', ?)`, [space, now]);
  await q(`INSERT INTO conversations (id, space_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [r.conv, space, owner, `${mark} chat`, now, now]);
  await q(`INSERT INTO conversation_messages (id, space_id, conversation_id, role, text, created_at) VALUES (?, ?, ?, 'user', ?, ?)`, [r.msg, space, r.conv, `${mark} message`, now]);
  await q(`INSERT INTO space_pref (space_id, key, value) VALUES (?, 'pref:budget:2026-10', '{"cap":5000,"currency":"ILS"}')`, [space]);
  return r;
}
await seedUser("A", "a@tenancy.test");
await seedUser("B", "b@tenancy.test");
await seedUser("V", "v@tenancy.test");
await db.execute({ sql: `INSERT INTO space (id, name, slug, kind, created_by, created_at) VALUES (?, 'Shared S', ?, 'shared', ?, ?)`, args: [SP.S, `s-${SP.S}`, U.A, now] });
await db.execute({ sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`, args: [id(), SP.S, U.A, now] });
await db.execute({ sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'viewer', ?)`, args: [id(), SP.S, U.V, now] });
ids.A = await seedData(SP.A, MARK.A, U.A);
ids.S = await seedData(SP.S, MARK.S, U.A);
ids.B = await seedData(SP.B, MARK.B, U.B);
const memA = "n_" + id();
await db.execute({ sql: `INSERT INTO memories (id, user_id, text, source, created_at, updated_at) VALUES (?, ?, ?, 'manual', ?, ?)`, args: [memA, U.A, `${MARK.A} likes blue`, now, now] });
await db.execute({ sql: `INSERT INTO reports (id, user_id, type, title, body, status, created_at, updated_at) VALUES (?, ?, 'bug', ?, 'body', 'open', ?, ?)`, args: ["r_" + id(), U.A, `${MARK.A} report`, now, now] });

const sign = (token) => encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
const cookieOf = {};
for (const k of ["A", "B", "V"]) {
  const token = id() + id();
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [id(), now + 30 * 86_400_000, token, now, now, U[k]] });
  cookieOf[k] = `nexus_session_dev=${sign(token)}`;
}

const SPACE_TABLES = ["collections", "items", "sources", "price_points", "attachments", "alerts", "alt_groups", "store_settings", "receipts", "conversations", "conversation_messages", "space_pref"];
async function hashSpaces(spaces) {
  const h = createHash("sha256");
  for (const t of SPACE_TABLES) {
    const rows = await db.execute({ sql: `SELECT * FROM "${t}" WHERE space_id IN (${spaces.map(() => "?").join(",")}) ORDER BY 1, 2`, args: spaces });
    h.update(t + JSON.stringify(rows.rows));
  }
  return h.digest("hex");
}
async function hashUser(uid) {
  const h = createHash("sha256");
  for (const [t, c] of [["memories", "user_id"], ["user_pref", "user_id"], ["reports", "user_id"], ["space_member", "user_id"], ["session", "user_id"]]) {
    const rows = await db.execute({ sql: `SELECT * FROM "${t}" WHERE ${c} = ? ORDER BY 1`, args: [uid] });
    h.update(t + JSON.stringify(t === "session" ? rows.rows.map((r) => r.id) : rows.rows));
  }
  return h.digest("hex");
}

// ---------- server ----------
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
    else server.kill();
  } catch {}
};
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/login`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node;
const actions = Object.entries(manifest).map(([aid, v]) => ({ id: aid, name: `${v.filename.replace("src/app/", "")}#${v.exportedName}` }));
async function callAction(who, a, args, spaceCookie) {
  const res = await fetch(`${BASE}/`, {
    method: "POST",
    headers: { "Next-Action": a.id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Cookie: [cookieOf[who], spaceCookie && `nexus_space=${spaceCookie}`].filter(Boolean).join("; "), Origin: BASE },
    body: JSON.stringify(args),
  });
  return { status: res.status, text: await res.text() };
}

function variants(r) {
  const X = [r.item, r.item2, r.col, r.src, r.att, r.grp, r.rec, r.conv, r.alert, memA];
  const patch = { title: "PWNED", quantity: 7, priority: "urgent", name: "PWNED", price: 1, archived: true, collectionId: null, watch: false, notes: "PWNED" };
  const v = [];
  for (const x of X) v.push([x], [x, patch], [[x]], [[x], { priority: "urgent", collectionId: null }], [x, 1, null], [x, "purchased"], [x, "PWNED"]);
  v.push(
    [r.item, r.item2],
    [[{ id: r.item, paid: null }, { id: r.item2, paid: null }], "purchased"],
    [{ itemId: r.item, currency: "ILS", refresh: true }],
    [{ itemId: r.item, url: null }],
    [{ itemIds: [r.item, r.item2] }],
    [{ items: [{ id: r.item, collectionId: null, status: "purchased", priority: "urgent", quantity: 9, tags: [], orderedAt: 1, purchasedAt: 1, purchasedPrice: 1, purchasedCurrency: "ILS" }], collectionIds: [r.col] }],
    [{ receiptId: r.rec, items: [{ id: r.item, status: "purchased", orderedAt: 1, purchasedAt: 1, purchasedPrice: 1, purchasedCurrency: "ILS", orderNumber: "x" }], splits: [], createdIds: [r.item2], attachmentIds: [r.att], pointIds: [r.pp] }],
    [{ receiptId: r.rec, kind: "receipt", currency: "ILS", orderNumber: null, orderDate: null, lines: [{ mode: "match", unitPrice: 1, allocations: [{ itemId: r.item, qty: 3 }] }] }],
    [{ conversationId: r.conv, mode: "chat", user: { text: "PWNED" }, assistant: { text: "PWNED" } }],
    [[{ id: r.item, title: "PWNED", spaceId: SP.B, sources: [], points: [], attachments: [] }]],
    [{ id: r.item, title: "PWNED", spaceId: SP.B, sources: [], points: [], attachments: [] }],
    [{ storeKey: "shop", freeShippingMin: 1, shippingFee: 1, currency: "ILS" }],
    [{ proposal: { summary: "x", actions: [{ type: "setStatus", itemIds: [r.item], status: "purchased" }] }, currency: "ILS" }],
    [{ parts: [{ name: "x", qty: 1, spec: "", estMin: null, estMax: null, category: "other", essential: true, searchQuery: "x" }], collectionId: r.col, newProject: null, currency: "ILS", estimateLabel: "x" }],
    [{ rows: [{ title: "x", collection: `${MARK.A} list` }], collectionId: r.col, defaultCurrency: "ILS" }],
    [{ file: { url: `https://x.public.blob.vercel-storage.com/spaces/${SP.A}/receipts/x.pdf`, name: "x.pdf" } }],
    [r.item, { url: `https://x.public.blob.vercel-storage.com/spaces/${SP.A}/receipts/x.pdf`, name: "x" }],
    [],
  );
  return v;
}

const marksIn = (text, mark) => text.includes(mark);
// TENANCY_QUICK=1: skip the every-action sweeps (steps 1–2) while working on the later steps. Never in CI.
const QUICK = process.env.TENANCY_QUICK === "1";

// ---------- 0. controls: the calling scheme really reaches the actions ----------
const byName = (n) => actions.find((a) => a.name === n);
const ctl = await callAction("A", byName("actions.ts#reloadAll"), [], SP.A);
ok(ctl.status === 200 && ctl.text.includes(MARK.A), "control: A's reloadAll returns A's items", `${ctl.status} ${ctl.text.slice(0, 120)}`);
const beforeB = await hashSpaces([SP.B]);
const w = await callAction("B", byName("actions.ts#updateItem"), [ids.B.item, { title: `${MARK.B} renamed` }], SP.B);
ok(w.status === 200 && (await hashSpaces([SP.B])) !== beforeB, "control: B's own write changes B's rows", `${w.status} ${w.text.slice(0, 120)}`);

// ---------- 1. B with A's ids ----------
const beforeA = await hashSpaces([SP.A, SP.S]);
const beforeAUser = await hashUser(U.A);
let calls = 0;
const leaks = [];
for (const a of QUICK ? [] : actions) {
  for (const args of variants(ids.A)) {
    const r = await callAction("B", a, args, SP.A);
    calls++;
    if (marksIn(r.text, MARK.A) || marksIn(r.text, MARK.S)) leaks.push(`${a.name} ${JSON.stringify(args).slice(0, 80)}`);
  }
}
// API routes as B (with A's space forged in the cookie).
const bCookie = `${cookieOf.B}; nexus_space=${SP.A}`;
const routes = [
  ["GET", "/api/backup"],
  ["GET", `/api/export?collection=${ids.A.col}`],
  ["GET", "/api/export"],
  ["GET", "/api/debug/extract"],
  ["GET", "/api/debug/ai"],
  ["POST", "/api/backup?mode=merge", JSON.stringify({ app: "nexus", data: { items: [{ id: ids.A.item, title: "PWNED", spaceId: SP.B }], collections: [{ id: ids.A.col, name: "PWNED", kind: "list" }] } })],
  ["POST", "/api/blob/upload", JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: `spaces/${SP.A}/receipts/x.pdf`, callbackUrl: `${BASE}/api/blob/upload`, clientPayload: null, multipart: false } })],
  ["POST", "/api/ask", JSON.stringify({ question: "what do I have", history: [], currency: "ILS", locale: "en" })],
  ["POST", "/api/import", null],
  ["GET", `/api/cal/${"x".repeat(32)}.ics`],
];
for (const [m, path, body] of routes) {
  const res = await fetch(`${BASE}${path}`, { method: m, headers: { Cookie: bCookie, "content-type": "application/json", Origin: BASE }, body: body ?? undefined });
  const text = await res.text();
  calls++;
  if (marksIn(text, MARK.A) || marksIn(text, MARK.S)) leaks.push(`${m} ${path}`);
}
const afterA = await hashSpaces([SP.A, SP.S]);
ok(afterA === beforeA, `B called ${actions.length} actions + ${routes.length} routes (${calls} requests) with A's ids → A's and S's rows unchanged`);
ok((await hashUser(U.A)) === beforeAUser, "A's personal rows (memory, prefs, reports, memberships, sessions) unchanged");
ok(leaks.length === 0, "no response to B contained A's or S's content", leaks.slice(0, 5).join(" | "));

// ---------- 2. V (viewer in S) tries every write in S ----------
const beforeS = await hashSpaces([SP.S]);
const vWrites = [];
for (const a of QUICK ? [] : actions) {
  if (a.name === "space-actions.ts#leaveCurrentSpace") continue; // allowed for viewers; step 4 tests it
  const h0 = await hashSpaces([SP.S]);
  for (const args of variants(ids.S)) await callAction("V", a, args, SP.S);
  if ((await hashSpaces([SP.S])) !== h0) vWrites.push(a.name);
}
ok((await hashSpaces([SP.S])) === beforeS, `viewer V called ${actions.length} actions with S's ids in S → S's rows unchanged`, vWrites.join(", "));
const vMember = (await db.execute({ sql: "SELECT role FROM space_member WHERE space_id = ? AND user_id = ?", args: [SP.S, U.V] })).rows[0]?.role;
ok(vMember === "viewer", "viewer V is still a viewer of S (no action let V change its own role)", String(vMember));

// ---------- 3. pages ----------
const page = async (who, space, rsc = false) => (await fetch(`${BASE}/?v=to_buy`, { headers: { Cookie: [cookieOf[who], space && `nexus_space=${space}`].filter(Boolean).join("; "), ...(rsc ? { RSC: "1" } : {}) } })).text();
const aHtml = await page("A", SP.A);
ok(aHtml.includes(MARK.A) && !aHtml.includes(MARK.B), "A's page shows A's items and none of B's");
const aRsc = await page("A", SP.A, true);
ok(!aRsc.includes(MARK.B), "A's RSC payload has none of B's items");
const bForged = await page("B", SP.A);
ok(bForged.includes(MARK.B) && !bForged.includes(MARK.A) && !bForged.includes(MARK.S), "B forging nexus_space=<A's space> falls back to B's personal space");
const vS = await page("V", SP.S);
ok(vS.includes(MARK.S) && !vS.includes(MARK.A), "viewer V sees S (read) and nothing of A's personal space");
const shareTok = (await db.execute({ sql: "SELECT share_token FROM collections WHERE id = ?", args: [ids.A.col] })).rows[0].share_token;
const pub = await (await fetch(`${BASE}/s/${shareTok}`)).text();
ok(pub.includes(MARK.A) && !pub.includes(MARK.B) && !pub.includes(MARK.S), "public /s/<token> shows only that list");

// ---------- 4. spaces (R15 C1–C4): switching, invite links, roles, step-up, leave, move, delete ----------
const result = (text) => {
  // RSC action response: row 0 is {a: <value or "$@<row>">, …}; an action that sets a cookie also streams the
  // refreshed page tree in other rows, so follow row 0's reference instead of taking the last row.
  const rows = new Map();
  for (const l of text.split("\n")) {
    const m = /^([0-9a-f]+):(.*)$/.exec(l);
    if (m) rows.set(m[1], m[2]);
  }
  try {
    const head = JSON.parse(rows.get("0") ?? "null");
    const a = head?.a;
    if (typeof a === "string" && a.startsWith("$@")) return JSON.parse(rows.get(a.slice(2)) ?? "null");
    return a ?? null;
  } catch {
    return null;
  }
};
const act = async (who, name, args, space) => result((await callAction(who, byName(name), args, space)).text);
const roleOf = async (space, uid) => (await db.execute({ sql: "SELECT role FROM space_member WHERE space_id = ? AND user_id = ?", args: [space, uid] })).rows[0]?.role ?? null;
// More people: D1..D6 (personal spaces + sessions).
for (let i = 1; i <= 6; i++) {
  const k = `D${i}`;
  U[k] = `u${k}_` + id();
  SP[k] = `s${k}_` + id();
  await seedUser(k, `${k.toLowerCase()}@tenancy.test`);
  const token = id() + id();
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [id(), now + 30 * 86_400_000, token, Date.now(), Date.now(), U[k]] });
  cookieOf[k] = `nexus_session_dev=${sign(token)}`;
}
{
  const k = "E";
  U[k] = "uE_" + id();
  SP[k] = "sE_" + id();
  await seedUser(k, "e@tenancy.test");
  const token = id() + id();
  await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [id(), now + 30 * 86_400_000, token, Date.now(), Date.now(), U[k]] });
  cookieOf[k] = `nexus_session_dev=${sign(token)}`;
}
// Switching: only to your own spaces.
const sw = await act("A", "space-actions.ts#switchSpace", [SP.S], SP.A);
ok(sw?.id === SP.S, "A switches to S (a space A is in)", JSON.stringify(sw));
const swB = await act("B", "space-actions.ts#switchSpace", [SP.S], SP.B);
ok(!swB?.id, "B can't switch to S (not a member)");
// Invite as viewer → B joins → B sees S read-only.
const inv = await act("A", "space-actions.ts#createInviteLink", ["viewer"], SP.S);
ok(typeof inv?.token === "string" && inv.token.length >= 40, "A (owner of S) creates a viewer invite link", JSON.stringify(inv)?.slice(0, 80));
const stored = (await db.execute({ sql: "SELECT * FROM space_invite WHERE id = ?", args: [inv?.id ?? ""] })).rows[0];
ok(stored && !JSON.stringify(stored).includes(inv?.token ?? "@"), "the invite token is stored hashed only");
const joinPage = await (await fetch(`${BASE}/join/${inv?.token}`)).text();
ok(joinPage.includes("Shared S") && !joinPage.includes(MARK.S), "/join/<token> previews the space (name, no items) while signed out");
const jB = await act("E", "space-actions.ts#joinSpace", [inv?.token], SP.E);
ok(jB?.ok === true && (await roleOf(SP.S, U.E)) === "viewer", "E joins S with the link → viewer", JSON.stringify(jB));
const bS = await page("E", SP.S);
ok(bS.includes(MARK.S) && !bS.includes(MARK.A), "E now sees S's items (and none of A's personal space)");
const hS = await hashSpaces([SP.S]);
await act("E", "actions.ts#updateItem", [ids.S.item, { title: "PWNED" }], SP.S);
await act("E", "space-actions.ts#createInviteLink", ["member"], SP.S);
ok((await hashSpaces([SP.S])) === hS, "E (viewer) can't write in S");
const bLinks = (await db.execute({ sql: "SELECT count(*) AS n FROM space_invite WHERE space_id = ? AND created_by = ?", args: [SP.S, U.E] })).rows[0].n;
ok(Number(bLinks) === 0, "E (viewer) can't make invite links");
// Revoke → dead.
const inv2 = await act("A", "space-actions.ts#createInviteLink", ["member"], SP.S);
await act("A", "space-actions.ts#revokeInviteLink", [inv2?.id], SP.S);
const jRev = await act("D1", "space-actions.ts#joinSpace", [inv2?.token], SP.D1);
ok(jRev?.ok === false && (await roleOf(SP.S, U.D1)) === null, "a revoked link is dead", JSON.stringify(jRev));
// Max uses (5): D1..D5 join, D6 is refused.
const inv3 = await act("A", "space-actions.ts#createInviteLink", ["member"], SP.S);
for (const k of ["D1", "D2", "D3", "D4", "D5"]) await act(k, "space-actions.ts#joinSpace", [inv3?.token], SP[k]);
const j6 = await act("D6", "space-actions.ts#joinSpace", [inv3?.token], SP.D6);
const joined5 = (await Promise.all(["D1", "D2", "D3", "D4", "D5"].map((k) => roleOf(SP.S, U[k])))).every((r) => r === "member");
ok(joined5 && j6?.ok === false && (await roleOf(SP.S, U.D6)) === null, "5 people join with one link; the 6th is refused (max uses)", JSON.stringify(j6));
// Roles: a member can't change roles; the owner can.
await act("D1", "space-actions.ts#changeMemberRole", [U.D2, "viewer"], SP.S);
ok((await roleOf(SP.S, U.D2)) === "member", "a member can't change someone's role");
await act("A", "space-actions.ts#changeMemberRole", [U.D2, "viewer"], SP.S);
ok((await roleOf(SP.S, U.D2)) === "viewer", "the owner makes D2 a viewer");
// Step-up: removing a member with a sign-in older than 10 minutes asks to sign in again.
const oldTok = id() + id();
await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [id(), now + 30 * 86_400_000, oldTok, Date.now() - 3_600_000, Date.now(), U.A] });
cookieOf.Aold = `nexus_session_dev=${sign(oldTok)}`;
// Steps 1–3 take minutes; a fresh A session for the step-up actions below.
const freshTok = id() + id();
await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, args: [id(), now + 30 * 86_400_000, freshTok, Date.now(), Date.now(), U.A] });
cookieOf.Af = `nexus_session_dev=${sign(freshTok)}`;
const rmOld = await act("Aold", "space-actions.ts#removeSpaceMember", [U.D3], SP.S);
ok(rmOld?.stepUp === true && (await roleOf(SP.S, U.D3)) === "member", "removing a member with an old sign-in → step-up, nothing removed", JSON.stringify(rmOld));
const rm = await act("Af", "space-actions.ts#removeSpaceMember", [U.D3], SP.S);
ok(rm?.ok === true && (await roleOf(SP.S, U.D3)) === null, "the owner (fresh sign-in) removes D3");
// Leave: the last owner can't; a member can.
const leaveA = await act("A", "space-actions.ts#leaveCurrentSpace", [], SP.S);
ok(leaveA?.ok === false && (await roleOf(SP.S, U.A)) === "owner", "the last owner can't leave (transfer first)");
const leaveD4 = await act("D4", "space-actions.ts#leaveCurrentSpace", [], SP.S);
ok(leaveD4?.ok === true && (await roleOf(SP.S, U.D4)) === null, "a member leaves S");
// Move a list (with items, links, price points, attachments, alerts) from A's personal space to S, then back.
const cnt = async (space) => {
  const two = [ids.A.item, ids.A.item2];
  let n = Number((await db.execute({ sql: "SELECT count(*) AS n FROM items WHERE collection_id = ? AND space_id = ?", args: [ids.A.col, space] })).rows[0].n);
  for (const t of ["sources", "price_points", "attachments", "alerts"]) n += Number((await db.execute({ sql: `SELECT count(*) AS n FROM ${t} WHERE item_id IN (?, ?) AND space_id = ?`, args: [...two, space] })).rows[0].n);
  return n;
};
const inA = await cnt(SP.A);
const mv = await act("A", "space-actions.ts#moveCollectionToSpace", [ids.A.col, SP.S], SP.A);
ok(mv?.ok === true && (await cnt(SP.S)) === inA && (await cnt(SP.A)) === 0, `A moves a list to S: all ${inA} rows (items, links, prices, files, alerts) move`, JSON.stringify(mv));
const mvB = await act("E", "space-actions.ts#moveCollectionToSpace", [ids.A.col, SP.E], SP.S);
ok(!mvB?.ok && (await cnt(SP.S)) === inA, "E (viewer in S) can't move it out");
await act("A", "space-actions.ts#moveCollectionBack", [ids.A.col, SP.A, SP.S], SP.S);
ok((await cnt(SP.A)) === inA, "undo moves it back");
// Create + delete (typed name, soft) + restore.
const cs = await act("A", "space-actions.ts#createSpace", [{ name: "Temp T", color: "rose", currency: "ILS" }], SP.A);
ok(typeof cs?.id === "string" && (await roleOf(cs.id, U.A)) === "owner", "A creates a shared space (owner)", JSON.stringify(cs));
const delWrong = await act("Af", "space-actions.ts#deleteCurrentSpace", ["Temp"], cs?.id);
const delOk = await act("Af", "space-actions.ts#deleteCurrentSpace", ["Temp T"], cs?.id);
const deletedAt = (await db.execute({ sql: "SELECT deleted_at FROM space WHERE id = ?", args: [cs?.id ?? ""] })).rows[0]?.deleted_at;
ok(delWrong?.ok === false && delOk?.ok === true && !!deletedAt, "delete needs the exact name, then soft-deletes", JSON.stringify([delWrong, delOk]));
const delPersonal = await act("A", "space-actions.ts#deleteCurrentSpace", ["PA"], SP.A);
ok(delPersonal?.ok === false, "a personal space can't be deleted");
const rs = await act("A", "space-actions.ts#restoreDeletedSpace", [cs?.id], SP.A);
const after = (await db.execute({ sql: "SELECT deleted_at FROM space WHERE id = ?", args: [cs?.id ?? ""] })).rows[0]?.deleted_at;
ok(rs?.ok === true && !after, "the owner restores it within 7 days");

// ---------- 5. spaces in the browser (C1/C2): switch from the menu, viewer controls, join while signed in ----------
if (process.env.TENANCY_UI !== "0") {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const ctxAs = async (who, space, viewport, phone = false) => {
    const c = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
    const [name, value] = cookieOf[who].split("=");
    await c.addCookies([
      { name, value, url: BASE },
      ...(space ? [{ name: "nexus_space", value: space, url: BASE }] : []),
      { name: "nexus_locale", value: "en", url: BASE },
    ]);
    await c.addInitScript(() => {
      try {
        sessionStorage.setItem("nexus.opened", "1");
      } catch {}
    });
    return c;
  };
  const ready = (p) => p.waitForSelector("[data-app-shell][data-ready]", { timeout: 20000 });
  try {
    // A on desktop: personal → S from the switcher menu; the list changes and "Now in …" shows.
    const ca = await ctxAs("Af", SP.A, { width: 1366, height: 860 });
    const pa = await ca.newPage();
    await pa.goto(`${BASE}/?v=to_buy`);
    await ready(pa);
    const before = await pa.content();
    await pa.click("[data-space-switcher]");
    await pa.click(`[data-space-item="${SP.S}"]`);
    await pa.waitForSelector(`[data-space-switcher][data-space-id="${SP.S}"]`, { timeout: 20000 });
    await ready(pa);
    const toastSeen = await pa.getByText("Now in Shared S").waitFor({ timeout: 5000 }).then(() => true, () => false);
    const after = await pa.content();
    ok(before.includes(MARK.A) && !before.includes(MARK.S) && after.includes(MARK.S) && !after.includes(`${MARK.A} item`) && toastSeen, "UI: A switches personal → S from the menu; the items change; \"Now in Shared S\" shows");
    const v1 = new URL(pa.url()).searchParams.get("v");
    ok(v1 === "to_buy", "UI: switching keeps the current view", String(v1));
    await ca.close();

    // V (viewer of S): no add bar on desktop, no "+" on the phone, a view-only line, disabled card actions.
    const cv = await ctxAs("V", SP.S, { width: 1366, height: 860 });
    const pv = await cv.newPage();
    await pv.goto(`${BASE}/?v=to_buy`);
    await ready(pv);
    const addBar = await pv.locator("[data-paste-capsule]").count();
    const banner = await pv.locator("[data-viewer-banner]").count();
    const newProject = await pv.getByRole("button", { name: "New project" }).count();
    ok(addBar === 0 && banner > 0 && newProject === 0, "UI: viewer on desktop — no add bar, no New project, a view-only line", JSON.stringify({ addBar, banner, newProject }));
    await cv.close();
    const cvp = await ctxAs("V", SP.S, { width: 390, height: 844 }, true);
    const pvp = await cvp.newPage();
    await pvp.goto(`${BASE}/?v=to_buy`);
    await ready(pvp);
    const plus = await pvp.locator("[data-plus]").count();
    const phoneSpace = await pvp.locator("[data-phone-space]").innerText();
    ok(plus === 0 && phoneSpace.includes("Shared S"), "UI: viewer on a phone — no \"+\"; the top bar names the space", JSON.stringify({ plus, phoneSpace }));
    await cvp.close();

    // D6 (signed in, not a member) opens a fresh link → Accept → joined → the app opens in S.
    const inv4 = await act("Af", "space-actions.ts#createInviteLink", ["member"], SP.S);
    const cd = await ctxAs("D6", SP.D6, { width: 390, height: 844 }, true);
    const pd = await cd.newPage();
    await pd.goto(`${BASE}/join/${inv4?.token}`);
    const shown = await pd.locator("[data-join-space]").innerText();
    await pd.click("[data-join-accept]");
    await pd.waitForSelector("[data-join-joined]", { timeout: 15000 });
    await pd.click("[data-join-open]");
    await ready(pd);
    const inS = (await pd.locator("[data-phone-space]").innerText()).includes("Shared S");
    ok(shown === "Shared S" && inS && (await roleOf(SP.S, U.D6)) === "member", "UI: signed-in join — preview → Accept → joined → opens S");
    await pd.goto(`${BASE}/join/${"x".repeat(43)}`);
    ok((await pd.locator("[data-join-dead]").count()) === 1, "UI: a dead link shows the calm \"doesn't work\" screen");
    await cd.close();
  } catch (e) {
    ok(false, "UI checks ran", String(e?.message ?? e).slice(0, 300));
  } finally {
    await browser.close();
  }
}

stop();
db.close();
console.log(`${out.fail ? "FAIL" : "OK"} tenancy: ${out.pass} passed, ${out.fail} failed`);
if (out.fail) console.log(log.split("\n").filter((l) => /error/i.test(l)).slice(-10).join("\n"));
process.exit(out.fail ? 1 : 0);
