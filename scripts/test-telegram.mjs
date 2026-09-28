// Local test of the Telegram webhook (writes to the LOCAL db only; refuses non-file DBs).
//   BASE=http://localhost:3100 STORE_HOST=192.0.2.2 node --env-file=.env.local scripts/test-telegram.mjs
// STORE_HOST must be an address the app will fetch (not localhost/private: the SSRF guard blocks those).
// Replies to Telegram fail offline; that's fine — we assert on the database.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { createClient } from "@libsql/client";

const BASE = process.env.BASE || "http://localhost:3100";
// A tiny fake store: /p/<name> serves a product page titled <name>.
const store = createServer((req, res) => {
  const name = decodeURIComponent(req.url.split("?")[0].split("/p/")[1] || "Thing");
  const ld = { "@context": "https://schema.org", "@type": "Product", name, image: "https://example.com/i.jpg", offers: { "@type": "Offer", price: "99", priceCurrency: "ILS" } };
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`);
});
await new Promise((r) => store.listen(3301, process.env.STORE_HOST || "192.0.2.2", r));
const run = Date.now().toString(36);
const STORE = `http://${process.env.STORE_HOST || "192.0.2.2"}:3301/p/`;
if (!process.env.TURSO_DATABASE_URL?.startsWith("file:")) throw new Error("refusing: not a local file DB");
const db = createClient({ url: process.env.TURSO_DATABASE_URL });
const secret = createHmac("sha256", process.env.SESSION_SECRET).update("nexus-telegram-webhook-v1").digest("hex");

let failed = 0;
const ok = (c, m) => (c || failed++, console.log(`${c ? "PASS" : "FAIL"} ${m}`));
const kv = async (k, v) => db.execute({ sql: "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", args: [k, v] });
const post = (update, s = secret) =>
  fetch(`${BASE}/api/telegram`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": s }, body: JSON.stringify({ update_id: 1, ...update }) });
const msg = (text, chat = 4242, extra = {}) => ({ message: { message_id: 7, chat: { id: chat }, text, ...extra } });
const countBySource = async (url) => Number((await db.execute({ sql: "SELECT count(*) n FROM sources WHERE url=?", args: [url] })).rows[0].n);

const saved = (await db.execute("SELECT key, value FROM kv WHERE key IN ('secret:telegram_token','secret:telegram_chat')")).rows;
try {
  await kv("secret:telegram_token", "123456:TEST_TOKEN_TEST_TOKEN_TEST_TOKEN_XX");
  await kv("secret:telegram_chat", "4242");

  ok((await post(msg("/list"), "wrong")).status === 401, "wrong secret → 401");
  ok((await post(msg("/list"), "")).status === 401, "missing secret → 401");

  const url = `${STORE}Bot Test Widget ${run}`.replace(/ /g, "%20");
  let r = await post(msg(`look ${url}`, 999));
  ok(r.status === 200 && (await countBySource(url)) === 0, "message from another chat is ignored");

  const col = (await db.execute("SELECT id, name FROM collections LIMIT 1")).rows[0];
  const tag = col ? `#${String(col.name).replace(/\s+/g, "")}` : "";
  r = await post(msg(`${url} ${tag}`));
  const row = (await db.execute({ sql: "SELECT i.collection_id c, i.title t FROM sources s JOIN items i ON i.id=s.item_id WHERE s.url=?", args: [url] })).rows[0];
  ok(r.status === 200 && !!row, `link from linked chat creates an item (${row?.t})`);
  if (col) ok(row?.c === col.id, `#hashtag files it into "${col.name}"`);

  await post(msg(url));
  ok((await countBySource(url)) === 1, "same link again is not duplicated");

  const hidden = `${STORE}Hidden Link Gadget ${run}`.replace(/ /g, "%20");
  await post(msg("shared item", 4242, { entities: [{ type: "text_link", offset: 0, length: 6, url: hidden }] }));
  ok((await countBySource(hidden)) === 1, "hidden text_link URLs are picked up");

  // Same product title at another "store" URL → attached as a second source, not a new item.
  const other = `${STORE}Bot Test Widget ${run}?store=2`.replace(/ /g, "%20");
  await post(msg(other));
  const items = (await db.execute({ sql: "SELECT count(DISTINCT item_id) n FROM sources WHERE url IN (?,?)", args: [url, other] })).rows[0].n;
  ok(Number(items) === 1, "same product from another link becomes another source");

  ok((await post(msg("/list"))).status === 200, "/list responds");
  ok((await post(msg("hello"))).status === 200, "plain text responds");
  ok((await post({ edited_message: {} })).status === 200, "non-message updates are ignored");
} finally {
  store.close();
  // Restore whatever Telegram config the local DB had.
  await db.execute("DELETE FROM kv WHERE key IN ('secret:telegram_token','secret:telegram_chat')");
  for (const s of saved) await kv(s.key, s.value);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
