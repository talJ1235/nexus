// R18 Session 2 — additive only (new nullable columns / new tables). Called from migrate.ts; re-running is a no-op.
import type { Client } from "@libsql/client";

async function cols(c: Client, table: string) {
  return (await c.execute(`PRAGMA table_info("${table}")`)).rows.map((r) => String(r.name));
}

async function addColumn(c: Client, table: string, name: string, def: string, log: (s: string) => void) {
  if ((await cols(c, table)).includes(name)) return;
  await c.execute(`ALTER TABLE "${table}" ADD COLUMN ${name} ${def}`);
  log(`added ${table}.${name}`);
}

export async function migrateR18s2(client: Client, log: (s: string) => void = console.log) {
  // B1: a supermarket row holds a count (pieces), a weight (amount + unit) or both.
  await addColumn(client, "items", "count", "integer", log);
  // C1: per product per space — skips in a row (× "not this time") and "Don't suggest this again" (who, when).
  await addColumn(client, "suggest_dismiss", "skips", "integer", log);
  await addColumn(client, "suggest_dismiss", "skipped_at", "integer", log);
  await addColumn(client, "suggest_dismiss", "hidden_at", "integer", log);
  await addColumn(client, "suggest_dismiss", "hidden_by", "text", log);
  // E1: templates made by Nexus — the routine (weekday, how many trips), offered → kept / turned down, edited = theirs.
  await addColumn(client, "template", "made_by", "text", log);
  await addColumn(client, "template", "routine_day", "integer", log);
  await addColumn(client, "template", "routine_trips", "integer", log);
  await addColumn(client, "template", "kept_at", "integer", log);
  await addColumn(client, "template", "dismissed_at", "integer", log);
  await addColumn(client, "template", "edited_at", "integer", log);
  await addColumn(client, "template", "updated_at", "integer", log);
  await addColumn(client, "template", "used_at", "integer", log);
}
