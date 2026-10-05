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
for (const a of actions) {
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
for (const a of actions) {
  const h0 = await hashSpaces([SP.S]);
  for (const args of variants(ids.S)) await callAction("V", a, args, SP.S);
  if ((await hashSpaces([SP.S])) !== h0) vWrites.push(a.name);
}
ok((await hashSpaces([SP.S])) === beforeS, `viewer V called ${actions.length} actions with S's ids in S → S's rows unchanged`, vWrites.join(", "));

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

stop();
db.close();
console.log(`${out.fail ? "FAIL" : "OK"} tenancy: ${out.pass} passed, ${out.fail} failed`);
if (out.fail) console.log(log.split("\n").filter((l) => /error/i.test(l)).slice(-10).join("\n"));
process.exit(out.fail ? 1 : 0);
