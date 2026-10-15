// R18 Session 3 — additive only (a new table). Called from migrate.ts; re-running is a no-op.
import type { Client } from "@libsql/client";

export async function migrateR18s3(client: Client, log: (s: string) => void = console.log) {
  // C6: the brand a home buys per product type (barcode adds, store-mode checks of a barcoded row, receipt lines).
  const had = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'brand_buy'")).rows.length > 0;
  await client.execute(`CREATE TABLE IF NOT EXISTS brand_buy (
    id text PRIMARY KEY NOT NULL, space_id text NOT NULL, type text NOT NULL, brand text NOT NULL, brand_key text NOT NULL,
    source text NOT NULL, ref text, by_user text, at integer NOT NULL)`);
  await client.execute("CREATE INDEX IF NOT EXISTS brand_buy_space_type_idx ON brand_buy (space_id, type)");
  if (!had) log("created brand_buy");
}
