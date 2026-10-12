// R18 Session 1 — additive only (new tables, new nullable / defaulted columns, indexes). Called from migrate.ts;
// re-running is a no-op. The one data change: items in a collection whose name looks like groceries move to the
// supermarket list (section + product key from the dictionary), once per database (kv marker `migrate:r18:groceries`).
import type { Client } from "@libsql/client";
import { classifyLocal } from "../lib/grocery/classify";

async function cols(c: Client, table: string) {
  return (await c.execute(`PRAGMA table_info("${table}")`)).rows.map((r) => String(r.name));
}

async function addColumn(c: Client, table: string, name: string, def: string, log: (s: string) => void) {
  if ((await cols(c, table)).includes(name)) return;
  await c.execute(`ALTER TABLE "${table}" ADD COLUMN ${name} ${def}`);
  log(`added ${table}.${name}`);
}

/** Collection names that mean "the grocery list" (A1). */
export const GROCERY_NAME = /groceries|grocery|מצרכים|סופר|supermarket/i;
export const GROCERY_MARKER = "migrate:r18:groceries";

export async function migrateR18(client: Client, log: (s: string) => void = console.log) {
  // A1: supermarket items live in `items` next to Products.
  await addColumn(client, "items", "list", "text DEFAULT 'products' NOT NULL", log);
  await addColumn(client, "items", "section", "text", log);
  await addColumn(client, "items", "unit", "text", log);
  await addColumn(client, "items", "amount", "real", log);
  await addColumn(client, "items", "product_key", "text", log);
  await addColumn(client, "items", "staple", "text DEFAULT 'off' NOT NULL", log);
  await addColumn(client, "items", "pinned_store", "text", log);
  await addColumn(client, "items", "prefer_brand", "text", log);
  await addColumn(client, "items", "substitutes", "text", log);
  await addColumn(client, "items", "art_key", "text", log);
  await client.execute("CREATE INDEX IF NOT EXISTS items_space_list_idx ON items (space_id, list, status)");
  // A2: trips and the ordered check log.
  await client.execute(`CREATE TABLE IF NOT EXISTS trip (
    id text PRIMARY KEY NOT NULL, space_id text NOT NULL, user_id text NOT NULL, chain text, branch text,
    started_at integer NOT NULL, finished_at integer, est_total real, total real, currency text DEFAULT 'ILS' NOT NULL,
    planned integer DEFAULT 0 NOT NULL, bought integer DEFAULT 0 NOT NULL, not_found integer DEFAULT 0 NOT NULL,
    receipt_id text, notify_key text, left_count integer, rev integer DEFAULT 0 NOT NULL)`);
  await client.execute("CREATE INDEX IF NOT EXISTS trip_space_started_idx ON trip (space_id, started_at)");
  await client.execute("CREATE INDEX IF NOT EXISTS trip_user_open_idx ON trip (user_id, finished_at)");
  await client.execute(`CREATE TABLE IF NOT EXISTS trip_check (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL, space_id text NOT NULL, trip_id text NOT NULL, item_id text, product_key text,
    section text, action text NOT NULL, qty real, amount real, unit text, price real, gtin text, by_user text, at integer NOT NULL,
    seq integer NOT NULL)`);
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS trip_check_seq_idx ON trip_check (trip_id, seq)");
  await client.execute("CREATE INDEX IF NOT EXISTS trip_check_space_idx ON trip_check (space_id, product_key)");
  // A2: a price seen during a trip carries the branch + barcode (R19 matches transparency files by gtin + chain + branch).
  await addColumn(client, "price_points", "trip_id", "text", log);
  await addColumn(client, "price_points", "chain", "text", log);
  await addColumn(client, "price_points", "branch", "text", log);
  await addColumn(client, "price_points", "gtin", "text", log);
  // A3: the stores a space shops at, with the confirmed / suggested section order.
  await client.execute(`CREATE TABLE IF NOT EXISTS space_store (
    space_id text NOT NULL, chain text NOT NULL, branch text DEFAULT '' NOT NULL, is_default integer DEFAULT 0 NOT NULL,
    section_order text, suggested_order text, suggested_at integer, dismissed_at integer, PRIMARY KEY (space_id, chain, branch))`);
  // B2 / B4: dismissed suggestions, templates, auto staples.
  await client.execute(`CREATE TABLE IF NOT EXISTS suggest_dismiss (
    space_id text NOT NULL, product_key text NOT NULL, until integer NOT NULL, PRIMARY KEY (space_id, product_key))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS template (
    id text PRIMARY KEY NOT NULL, space_id text NOT NULL, name text NOT NULL, items text NOT NULL, created_by text,
    created_at integer NOT NULL, rev integer DEFAULT 0 NOT NULL)`);
  await client.execute("CREATE INDEX IF NOT EXISTS template_space_idx ON template (space_id)");
  await client.execute(`CREATE TABLE IF NOT EXISTS staple_add (
    space_id text NOT NULL, product_key text NOT NULL, due_day text NOT NULL, item_id text, at integer NOT NULL, undone_at integer,
    PRIMARY KEY (space_id, product_key, due_day))`);
  await moveGroceries(client, log);
}

/** A1 data step, once: grocery-named collections' items → the supermarket list. Returns counts per space. */
async function moveGroceries(client: Client, log: (s: string) => void) {
  const done = await client.execute({ sql: "SELECT value FROM kv WHERE key = ?", args: [GROCERY_MARKER] });
  if (done.rows.length) return;
  const colls = (await client.execute("SELECT id, space_id, name FROM collections")).rows.filter((r) => GROCERY_NAME.test(String(r.name)));
  const perSpace: Record<string, number> = {};
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  for (const c of colls) {
    const items = (await client.execute({ sql: "SELECT id, title, gtin FROM items WHERE collection_id = ? AND list = 'products'", args: [String(c.id)] })).rows;
    for (const it of items) {
      const k = classifyLocal(String(it.title), it.gtin ? String(it.gtin) : null);
      stmts.push({
        sql: "UPDATE items SET list = 'supermarket', section = ?, product_key = ?, art_key = ? WHERE id = ?",
        args: [k.section, k.productKey, k.art, String(it.id)],
      });
      perSpace[String(c.space_id)] = (perSpace[String(c.space_id)] ?? 0) + 1;
    }
  }
  // Clients holding those items reload instead of replaying (a bulk change, like a list moved between spaces).
  for (const sp of Object.keys(perSpace)) stmts.push({ sql: "UPDATE space_rev SET rev = rev + 1, reset_rev = rev + 1 WHERE space_id = ?", args: [sp] });
  stmts.push({ sql: "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)", args: [GROCERY_MARKER, JSON.stringify({ collections: colls.length, moved: perSpace }), Date.now()] });
  await client.batch(stmts, "write");
  const total = Object.values(perSpace).reduce((a, b) => a + b, 0);
  log(`groceries: ${colls.length} grocery-named collection(s), ${total} item(s) moved to the supermarket list (${Object.keys(perSpace).length} space(s))`);
}
