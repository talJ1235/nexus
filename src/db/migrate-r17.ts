// R17 — additive only (new tables, new nullable/defaulted columns, indexes). Called from migrate.ts; re-running is a no-op.
import type { Client } from "@libsql/client";

async function cols(c: Client, table: string) {
  return (await c.execute(`PRAGMA table_info("${table}")`)).rows.map((r) => String(r.name));
}

async function addColumn(c: Client, table: string, name: string, def: string, log: (s: string) => void) {
  if ((await cols(c, table)).includes(name)) return;
  await c.execute(`ALTER TABLE "${table}" ADD COLUMN ${name} ${def}`);
  log(`added ${table}.${name}`);
}

export async function migrateR17(client: Client, log: (s: string) => void = console.log) {
  // B1: the store's original long title, when the item shows a short name.
  await addColumn(client, "items", "full_title", "text", log);
  // E2: one row per model call (who, which feature, which provider, ok/fail, how long) — the quota counts these.
  await client.execute(`CREATE TABLE IF NOT EXISTS ai_usage (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL, user_id text, space_id text, feature text NOT NULL, provider text, model text,
    tokens integer, ok integer DEFAULT 1 NOT NULL, ms integer, system integer DEFAULT 0 NOT NULL, day text NOT NULL, at integer NOT NULL)`);
  await client.execute("CREATE INDEX IF NOT EXISTS ai_usage_user_day_idx ON ai_usage (user_id, day)");
  await client.execute("CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage (at)");
  // E4: delete account — requested at (hidden at once, purged 7 days later unless restored).
  await addColumn(client, "user", "deletion_requested_at", "integer", log);
}

/** R17 Session 2 — the admin panel's Live view (presence + activity counts). Additive; re-running is a no-op. */
export async function migrateR17s2(client: Client) {
  // G1: one row per signed-in browser session — device kind, coarse platform, which screen (a fixed key), shopping count.
  await client.execute(`CREATE TABLE IF NOT EXISTS presence (
    session_id text PRIMARY KEY NOT NULL, user_id text NOT NULL, device text NOT NULL, app text NOT NULL, platform text,
    screen text NOT NULL, shopping_left integer, space_id text, since integer NOT NULL, updated_at integer NOT NULL)`);
  await client.execute("CREATE INDEX IF NOT EXISTS presence_updated_idx ON presence (updated_at)");
  await client.execute("CREATE INDEX IF NOT EXISTS presence_user_idx ON presence (user_id)");
  // G1: what happened, as kinds + counts (never item names). 30 days.
  await client.execute(`CREATE TABLE IF NOT EXISTS activity (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL, user_id text NOT NULL, space_id text, kind text NOT NULL, n integer DEFAULT 1 NOT NULL, at integer NOT NULL)`);
  await client.execute("CREATE INDEX IF NOT EXISTS activity_at_idx ON activity (at)");
  await client.execute("CREATE INDEX IF NOT EXISTS activity_user_at_idx ON activity (user_id, at)");
}
