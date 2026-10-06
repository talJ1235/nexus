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

export async function migrateR16(client: Client, log: (s: string) => void = console.log) {
  // A1: last paid price (kept when an item goes back to To buy).
  await addColumn(client, "items", "last_paid_price", "real", log);
  await addColumn(client, "items", "last_paid_currency", "text", log);
}
