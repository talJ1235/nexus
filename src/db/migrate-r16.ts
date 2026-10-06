// R16 — additive only (new tables, new nullable/defaulted columns, indexes). Called from migrate.ts; re-running is a no-op.
import type { Client } from "@libsql/client";

async function cols(c: Client, table: string) {
  return (await c.execute(`PRAGMA table_info("${table}")`)).rows.map((r) => String(r.name));
}

async function addColumn(c: Client, table: string, name: string, def: string, log: (s: string) => void) {
  if ((await cols(c, table)).includes(name)) return;
  await c.execute(`ALTER TABLE "${table}" ADD COLUMN ${name} ${def}`);
  log(`added ${table}.${name}`);
}

/** B1: tables whose rows the client store holds — each gets rev / rev_by and a (space_id, rev) index. */
export const SYNCED_TABLES = ["items", "sources", "price_points", "attachments", "collections", "alt_groups", "store_settings", "alerts", "space_pref"] as const;

export async function migrateR16(client: Client, log: (s: string) => void = console.log) {
  // A1: last paid price (kept when an item goes back to To buy).
  await addColumn(client, "items", "last_paid_price", "real", log);
  await addColumn(client, "items", "last_paid_currency", "text", log);
  // B1: change feed.
  await client.execute(`CREATE TABLE IF NOT EXISTS space_rev (
    space_id text PRIMARY KEY NOT NULL, rev integer DEFAULT 0 NOT NULL, floor integer DEFAULT 0 NOT NULL, reset_rev integer DEFAULT 0 NOT NULL)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS tombstone (
    space_id text NOT NULL, tbl text NOT NULL, row_id text NOT NULL, rev integer NOT NULL, by text, at integer NOT NULL,
    PRIMARY KEY (space_id, tbl, row_id))`);
  await client.execute("CREATE INDEX IF NOT EXISTS tombstone_space_rev_idx ON tombstone (space_id, rev)");
  await client.execute("CREATE INDEX IF NOT EXISTS tombstone_at_idx ON tombstone (at)");
  for (const t of SYNCED_TABLES) {
    await addColumn(client, t, "rev", "integer DEFAULT 0 NOT NULL", log);
    await addColumn(client, t, "rev_by", "text", log);
    await client.execute(`CREATE INDEX IF NOT EXISTS ${t}_space_rev_idx ON "${t}" (space_id, rev)`);
  }
}
