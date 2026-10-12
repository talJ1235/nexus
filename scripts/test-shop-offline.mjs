// R18 D1 — the trip outbox in a real browser (built app, port 3128, throwaway DB). The phone goes offline, checks 5,
// unchecks 1, adds 2 (one already on the list), changes a price; meanwhile a second session edits a note; the phone comes
// back → the server state equals the expected one (the note kept, the duplicate merged, no double rows), and sending
// the same actions again changes nothing. Drives the engines through the S1 bridge (`window.__nexusSm`).
//   npm run build && npm run test:shop-offline
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startApp } from "./lib/test-app.mjs";

const app = await startApp({ db: "shop-offline-test.db", port: Number(process.env.PORT || 3128) });
const browser = await chromium.launch();
let failed = false;
try {
  const bridge = async (ctx) => {
    await ctx.addCookies(app.cookies(app.personal, "he"));
    await ctx.addInitScript(() => localStorage.setItem("nexus.smBridge", "1"));
    const page = await ctx.newPage();
    if (process.env.DEBUG_SM) page.on("response", async (r) => r.request().method() === "POST" && console.log("POST", JSON.stringify((await r.text().catch(() => "")).slice(0, 400))));
    await page.goto(`${app.base}/`);
    await page.waitForFunction(() => !!window.__nexusSm, null, { timeout: 30_000 });
    return page;
  };
  const phone = await browser.newContext();
  const page = await bridge(phone);
  const names = ["חלב 3%", "ביצים", "לחם", "עגבניות", "מלפפונים", "גבינה צהובה", "פיתות", "טחינה"];
  const items = await page.evaluate(async (names) => {
    const sm = window.__nexusSm;
    const out = [];
    for (const title of names) out.push((await sm.addToSupermarket({ title })).item);
    await sm.startSupermarketTrip({ chain: "Shufersal", branch: "Test" });
    return out.map((i) => ({ id: i.id, rev: i.rev, title: i.title }));
  }, names);
  assert.equal(items.length, 8);

  // Offline in the store.
  await phone.setOffline(true);
  const queued = await page.evaluate(async (items) => {
    const sm = window.__nexusSm;
    for (const i of items.slice(0, 5)) await sm.queueTripOp({ kind: "check", itemId: i.id, rev: i.rev });
    await sm.queueTripOp({ kind: "uncheck", itemId: items[2].id, rev: items[2].rev });
    await sm.queueTripOp({ kind: "add", title: "גבינה צהובה" }); // already on the list → merged
    await sm.queueTripOp({ kind: "add", title: "במבה", qty: 2 });
    await sm.queueTripOp({ kind: "price", itemId: items[0].id, price: 6.9, rev: items[0].rev });
    const sent = await sm.flush();
    return { sent, left: (await sm.loadTripOps()).length, online: navigator.onLine };
  }, items);
  assert.equal(queued.online, false);
  assert.equal(queued.sent, null, "offline: nothing sent");
  assert.equal(queued.left, 9, "9 actions queued");

  // A second session edits a note meanwhile.
  const other = await browser.newContext();
  const page2 = await bridge(other);
  const noted = await page2.evaluate(async (it) => (await window.__nexusSm.syncTripOps([{ id: "note-1", kind: "note", itemId: it.id, notes: "רק החבילה הגדולה", rev: it.rev, at: Date.now() }])).applied, items[1]);
  assert.equal(noted, 1);

  // Back online: the outbox goes out by itself (the bridge listens to `online`).
  const ops = await page.evaluate(async () => window.__nexusSm.loadTripOps());
  if (process.env.DEBUG_SM) page.on("requestfailed", (r) => console.log("FAILED", r.method(), r.url(), r.failure()?.errorText));
  if (process.env.DEBUG_SM) page.on("console", (m) => console.log("console:", m.text().slice(0, 200)));
  await phone.setOffline(false);
  if (process.env.DEBUG_SM) { await page.waitForTimeout(3000); console.log("after online:", await page.evaluate(async () => JSON.stringify({ n: (await window.__nexusSm.loadTripOps()).length, online: navigator.onLine }))); }
  for (let i = 0; (await page.evaluate(async () => (await window.__nexusSm.loadTripOps()).length)) > 0; i++) {
    if (i > 60) throw new Error("the outbox never emptied");
    await page.waitForTimeout(300);
  }

  const q = async (sql, args = []) => (await app.db.execute({ sql, args })).rows;
  const state = async () =>
    Object.fromEntries(
      (await q("SELECT title, status, quantity, purchased_price, notes FROM items WHERE list = 'supermarket' AND space_id = ? ORDER BY title, created_at", [app.personal])).map((r, i) => [
        `${r.title}#${i}`,
        { status: r.status, qty: Number(r.quantity), price: r.purchased_price == null ? null : Number(r.purchased_price), notes: r.notes ?? null },
      ]),
    );
  const got = await state();
  if (process.env.DEBUG_SM) console.log(JSON.stringify(got, null, 1), JSON.stringify(await q("SELECT action, item_id, seq FROM trip_check")), JSON.stringify(await q("SELECT id, user_id, space_id, finished_at FROM trip")));
  const row = (t) => Object.entries(got).filter(([k]) => k.startsWith(`${t}#`)).map(([, v]) => v);
  const want = (t, status, extra = {}) => assert.deepEqual(row(t), [{ status, qty: 1, price: null, notes: null, ...extra }], `${t}: ${JSON.stringify(row(t))}`);
  want("חלב 3%", "purchased", { price: 6.9 });
  want("ביצים", "purchased", { notes: "רק החבילה הגדולה" }); // the check didn't touch the other session's note
  want("לחם", "to_buy"); // checked, then unchecked
  want("עגבניות", "purchased");
  want("מלפפונים", "purchased");
  want("גבינה צהובה", "to_buy", { qty: 2 }); // the duplicate add merged
  want("פיתות", "to_buy");
  want("טחינה", "to_buy");
  want("במבה", "to_buy", { qty: 2 });
  assert.equal(Object.keys(got).length, 9, "no double rows");
  const [trip] = await q("SELECT id, bought FROM trip WHERE space_id = ? AND finished_at IS NULL", [app.personal]);
  assert.equal(Number(trip.bought), 4, "the trip's count: 5 checked − 1 unchecked");
  const log = await q("SELECT action FROM trip_check WHERE trip_id = ? ORDER BY seq", [trip.id]);
  assert.deepEqual(log.map((r) => r.action), ["check", "check", "check", "check", "check", "uncheck", "add", "add", "price"], "the log keeps the shopper's order");

  // The same actions again (a resend after a lost answer) change nothing.
  const again = await page.evaluate(async (ops) => window.__nexusSm.syncTripOps(ops), ops);
  assert.equal(again.idMap && Object.keys(again.idMap).length, 2, "the offline adds map to the same rows (applied once)");
  assert.deepEqual(await state(), got, "same state after a resend");
  console.log("ok shop-offline: 9 queued offline, merged per field on return (note kept, duplicate merged, 1 uncheck), resend is a no-op");
} catch (e) {
  failed = true;
  console.error("FAIL", e);
  console.error(app.log().slice(-3000));
} finally {
  await browser.close();
  app.stop();
}
process.exit(failed ? 1 : 0);
