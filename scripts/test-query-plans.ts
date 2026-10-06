// R15 E1: the main space-scoped queries use an index (EXPLAIN QUERY PLAN), on a fresh migrated file DB.
// A bare "SCAN <table>" (full table scan) on a data table fails; "SCAN … USING INDEX" / "SEARCH …" pass.
//   npx tsx --conditions=react-server scripts/test-query-plans.ts
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import assert from "node:assert/strict";

const DB = "query-plans-test.db";
for (const f of [DB, `${DB}-journal`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: { ...process.env, ADMIN_EMAIL: "" }, stdio: "ignore" });

async function main() {
  const { and, asc, desc, eq, inArray, like } = await import("drizzle-orm");
  const { db, schema } = await import("../src/db");
  const { Scoped } = await import("../src/lib/db-scoped");
  const { systemWatchedSourcesQuery } = await import("../src/lib/db-scoped/system");
  const s = new Scoped({ spaceId: "sp", userId: "u" });
  const ids = ["a", "b"];

  type Q = { toSQL: () => { sql: string; params: unknown[] } };
  const QUERIES: [string, Q][] = [
    ["items (Home / Shopping load)", s.select(schema.items).orderBy(desc(schema.items.createdAt)) as unknown as Q],
    ["items by status", s.select(schema.items, eq(schema.items.status, "to_buy")) as unknown as Q],
    ["items by id", s.select(schema.items, inArray(schema.items.id, ids)) as unknown as Q],
    ["sources", s.select(schema.sources).orderBy(asc(schema.sources.createdAt)) as unknown as Q],
    ["sources of items", s.select(schema.sources, inArray(schema.sources.itemId, ids)) as unknown as Q],
    ["price points", s.select(schema.pricePoints).orderBy(asc(schema.pricePoints.recordedAt)) as unknown as Q],
    ["attachments", s.select(schema.attachments).orderBy(asc(schema.attachments.createdAt)) as unknown as Q],
    ["collections", s.select(schema.collections).orderBy(asc(schema.collections.sortOrder), asc(schema.collections.createdAt)) as unknown as Q],
    ["alt groups", s.select(schema.altGroups) as unknown as Q],
    ["store settings", s.select(schema.storeSettings) as unknown as Q],
    ["alerts (recent 60)", s.select(schema.alerts).orderBy(desc(schema.alerts.createdAt)).limit(60) as unknown as Q],
    ["receipts", s.select(schema.receipts).orderBy(desc(schema.receipts.createdAt)) as unknown as Q],
    ["conversations (mine)", db.select().from(schema.conversations).where(s.mine(schema.conversations)).orderBy(desc(schema.conversations.updatedAt)) as unknown as Q],
    ["space prefs (budget)", db.select().from(schema.spacePref).where(and(eq(schema.spacePref.spaceId, "sp"), like(schema.spacePref.key, "pref:budget:%"))) as unknown as Q],
    ["memberships of a user", db.select().from(schema.member).innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId)).where(eq(schema.member.userId, "u")) as unknown as Q],
    ["people of a space", db.select().from(schema.member).where(eq(schema.member.organizationId, "sp")) as unknown as Q],
    ["invite links of a space", db.select().from(schema.spaceInvite).where(eq(schema.spaceInvite.spaceId, "sp")) as unknown as Q],
  ];
  const TABLES = ["items", "sources", "price_points", "attachments", "collections", "alt_groups", "store_settings", "alerts", "receipts", "conversations", "conversation_messages", "space_pref", "space_member", "space_invite"];
  const bad: string[] = [];
  for (const [name, q] of QUERIES) {
    const { sql, params } = q.toSQL();
    const plan = (await db.$client.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args: params as never[] })).rows.map((r) => String(r.detail));
    const scans = plan.filter((d) => TABLES.some((t) => new RegExp(`^SCAN ${t}\\b`).test(d)) && !/USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY/.test(d));
    if (scans.length) bad.push(`${name}: ${plan.join(" | ")}`);
  }
  // The cron fan-out joins sources to items by item id (not by walking each space: R15 E1 bench, 422 ms → 10 ms).
  const cron = systemWatchedSourcesQuery().toSQL();
  const cronPlan = (await db.$client.execute({ sql: `EXPLAIN QUERY PLAN ${cron.sql}`, args: cron.params as never[] })).rows.map((r) => String(r.detail));
  if (!cronPlan.some((d) => /sources_item_idx/.test(d))) bad.push(`cron watched links: ${cronPlan.join(" | ")}`);
  // Control: an unscoped read of items IS a full scan (the detector works).
  const ctl = (await db.$client.execute("EXPLAIN QUERY PLAN SELECT * FROM items")).rows.map((r) => String(r.detail));
  assert.ok(ctl.some((d) => /^SCAN items$/.test(d)), `control: unscoped items read is a full scan (${ctl.join(" | ")})`);
  for (const b of bad) console.log(`FAIL full scan — ${b}`);
  assert.equal(bad.length, 0);
  console.log(`OK query plans: ${QUERIES.length} space-scoped queries + the cron fan-out use an index`);
}

main()
  .then(() => {
    for (const f of [DB, `${DB}-journal`]) if (existsSync(f)) rmSync(f);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
