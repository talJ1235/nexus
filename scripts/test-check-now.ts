// R17 Q2 — "Check now" on the item page: one item's link read now through the daily check's ladder and bookkeeping
// (lib/tracker checkItemOnServer), against a local fake store on a throwaway DB. The outcomes the sheet shows (no
// change / dropped n % / up n % / the store didn't answer / no link), the price history row and the stored alert.
// The action around it (editors only, 10 an hour) is covered by test:authz-coverage / test:roles.   npm run test:check-now
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";

const DB = "check-now-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.CF_FETCH_URL = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

// The fake store: a product page whose price the test sets; `block` answers like a bot wall.
let price = 899;
let block = false;
const page = () => `<!doctype html><html><head><title>Standing fan</title>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Standing fan", offers: { "@type": "Offer", price: String(price), priceCurrency: "ILS", availability: "https://schema.org/InStock" } })}</script>
</head><body><h1>Standing fan</h1></body></html>`;
const store = createServer((_req, res) => {
  if (block) return void res.writeHead(403, { "content-type": "text/html" }).end("<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page());
});

async function main() {
  await new Promise<void>((r) => store.listen(0, "127.0.0.1", () => r()));
  const port = String((store.address() as { port: number }).port);
  // A public-looking store name that resolves to the fake store (the app refuses a literal local address before the fetch).
  const { __setResolverForTests, __setTestAllow } = await import("../src/lib/safe-fetch");
  __setTestAllow({ addresses: ["127.0.0.1"], ports: [port] });
  __setResolverForTests(((_h: string, _o: unknown, cb: (e: Error | null, a: { address: string; family: number }[]) => void) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as never);
  const { db, schema } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { Scoped } = await import("../src/lib/db-scoped");
  const { checkItemOnServer } = await import("../src/lib/tracker");
  const t0 = Date.now() - 86_400_000;
  await db.insert(schema.user).values({ id: "u1", name: "Tal", email: "tal@check.test", emailVerified: true, createdAt: new Date(t0), updatedAt: new Date(t0) });
  await db.insert(schema.space).values({ id: "sp", name: "Home", slug: "home", kind: "personal", createdBy: "u1", createdAt: new Date(t0) } as never);
  const url = `http://shop.check-now.example:${port}/p/fan`;
  await db.insert(schema.items).values({ id: "fan", spaceId: "sp", title: "Standing fan", status: "to_buy", watch: true, chosenSourceId: "src1", createdAt: t0, updatedAt: t0 } as never);
  await db.insert(schema.sources).values({ id: "src1", spaceId: "sp", itemId: "fan", url, normalizedUrl: url, store: "Fake store", storeKey: "fake", price: 999, currency: "ILS", createdAt: t0 } as never);
  await db.insert(schema.items).values({ id: "nolink", spaceId: "sp", title: "Note only", status: "to_buy", createdAt: t0, updatedAt: t0 } as never);
  const s = new Scoped({ spaceId: "sp", userId: "u1" });

  // ₪999 → ₪899: dropped 10 %, the link's price updated, a price point and a drop alert (default minDropPct 5).
  const a = await checkItemOnServer(s, "fan");
  assert.ok(a.ok, JSON.stringify(a));
  assert.equal(a.ok && a.outcome, "down");
  assert.equal(a.ok && a.price, 899);
  assert.equal(a.ok && a.pct, 10);
  assert.equal(a.item?.sources[0].price, 899, "the answer carries the updated item");
  assert.equal((await db.select().from(schema.pricePoints).where(eq(schema.pricePoints.itemId, "fan"))).length, 1, "a price point");
  assert.equal((await db.select().from(schema.alerts).where(eq(schema.alerts.itemId, "fan"))).filter((x) => x.kind === "drop").length, 1, "a drop alert");

  // Same price again → no change.
  const b = await checkItemOnServer(s, "fan");
  assert.equal(b.ok && b.outcome, "same");
  // ₪899 → ₪1,049 → up 17 %.
  price = 1049;
  const c = await checkItemOnServer(s, "fan");
  assert.equal(c.ok && c.outcome, "up");
  assert.equal(c.ok && c.pct, 17);
  // The store blocks → "didn't answer", the stored price untouched.
  block = true;
  const d = await checkItemOnServer(s, "fan");
  assert.deepEqual([d.ok, !d.ok && d.reason], [false, "blocked"]);
  assert.equal((await db.select().from(schema.sources).where(eq(schema.sources.id, "src1")))[0].price, 1049);
  // No link → nothing to check.
  const e = await checkItemOnServer(s, "nolink");
  assert.deepEqual(e, { ok: false, reason: "no_link" });
  // Another space's item isn't reachable through this space.
  const other = new Scoped({ spaceId: "elsewhere", userId: "u1" });
  assert.deepEqual(await checkItemOnServer(other, "fan"), { ok: false, reason: "no_link" });
  console.log("OK check now: dropped 10 %, no change, up 17 %, blocked, no link, other space");
}
main().then(
  () => (store.close(), process.exit(0)),
  (e) => (console.error(e), store.close(), process.exit(1)),
);
