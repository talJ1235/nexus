// Round 19 — additive only (new tables + nullable columns). Called from migrate.ts; re-running is a no-op.
// Prices (B1–B5): the chains and their branches from the Stores files, the catalog of every barcode, current prices
// (per chain for every product, per branch for the branches people use), a daily point when a chain's price changes,
// deals, and the file log the freshness checks read. Matching (C1–C3): which catalog product a list row is, and the
// household's remembered choice per typed name. The store directory (A10): a space's store → a real branch.
import type { Client } from "@libsql/client";

export async function migrateR19(client: Client, log: (s: string) => void = console.log) {
  const tables = new Set((await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => String(r.name)));
  const make = async (name: string, sql: string, indexes: string[] = []) => {
    await client.execute(sql);
    for (const i of indexes) await client.execute(i);
    if (!tables.has(name)) log(`created ${name}`);
  };
  await make(
    "chain",
    `CREATE TABLE IF NOT EXISTS chain (
      id text PRIMARY KEY NOT NULL, gov_id text NOT NULL, he text NOT NULL, en text NOT NULL, logo text, color text,
      branches integer NOT NULL DEFAULT 0, rep_store integer, last_file_at integer, last_ok_at integer, last_error text, updated_at integer)`,
    ["CREATE UNIQUE INDEX IF NOT EXISTS chain_gov_idx ON chain (gov_id)"],
  );
  await make(
    "branch",
    `CREATE TABLE IF NOT EXISTS branch (
      id text PRIMARY KEY NOT NULL, chain_id text NOT NULL, store_id integer NOT NULL, sub_chain text, name text NOT NULL,
      address text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', city_en text NOT NULL DEFAULT '', city_code integer,
      zip text, kind integer, lat real, lng real, geo_at integer, search text NOT NULL DEFAULT '',
      prices_at integer, updated_at integer, gone_at integer)`,
    ["CREATE INDEX IF NOT EXISTS branch_chain_idx ON branch (chain_id)", "CREATE INDEX IF NOT EXISTS branch_city_idx ON branch (city_code)"],
  );
  await make(
    "catalog",
    `CREATE TABLE IF NOT EXISTS catalog (
      gtin text PRIMARY KEY NOT NULL, name text NOT NULL, short text, brand text, manufacturer text, qty real, unit text,
      weighted integer NOT NULL DEFAULT 0, internal integer NOT NULL DEFAULT 0, section text, search text NOT NULL DEFAULT '',
      chains integer NOT NULL DEFAULT 0, branches integer NOT NULL DEFAULT 0, image_url text, image_src text, image_at integer,
      image_tries integer NOT NULL DEFAULT 0, seen_at integer, updated_at integer)`,
    ["CREATE INDEX IF NOT EXISTS catalog_section_idx ON catalog (section)"],
  );
  await make(
    "chain_price",
    `CREATE TABLE IF NOT EXISTS chain_price (
      chain_id text NOT NULL, gtin text NOT NULL, price real NOT NULL, low real, high real, branches integer NOT NULL DEFAULT 1,
      unit_price real, price_at integer, seen_at integer NOT NULL, PRIMARY KEY (chain_id, gtin))`,
    ["CREATE INDEX IF NOT EXISTS chain_price_gtin_idx ON chain_price (gtin)"],
  );
  await make(
    "branch_price",
    `CREATE TABLE IF NOT EXISTS branch_price (
      branch_id text NOT NULL, gtin text NOT NULL, price real NOT NULL, unit_price real, price_at integer,
      seen_at integer NOT NULL, PRIMARY KEY (branch_id, gtin))`,
    ["CREATE INDEX IF NOT EXISTS branch_price_gtin_idx ON branch_price (gtin)"],
  );
  await make(
    "price_day",
    `CREATE TABLE IF NOT EXISTS price_day (
      chain_id text NOT NULL, gtin text NOT NULL, day text NOT NULL, price real NOT NULL, deal real,
      PRIMARY KEY (gtin, chain_id, day))`,
  );
  await make(
    "promo",
    `CREATE TABLE IF NOT EXISTS promo (
      id text PRIMARY KEY NOT NULL, chain_id text NOT NULL, promo_id text NOT NULL, description text NOT NULL,
      kind text NOT NULL, min_qty real, price real, rate real, club integer NOT NULL DEFAULT 0, min_basket real,
      starts integer, ends integer, stores text, items integer NOT NULL DEFAULT 0, updated_at integer, seen_at integer NOT NULL)`,
    ["CREATE INDEX IF NOT EXISTS promo_chain_idx ON promo (chain_id, ends)"],
  );
  await make(
    "promo_item",
    `CREATE TABLE IF NOT EXISTS promo_item (promo_id text NOT NULL, gtin text NOT NULL, PRIMARY KEY (gtin, promo_id))`,
    ["CREATE INDEX IF NOT EXISTS promo_item_promo_idx ON promo_item (promo_id)"],
  );
  await make(
    "price_file",
    `CREATE TABLE IF NOT EXISTS price_file (
      name text PRIMARY KEY NOT NULL, chain_id text NOT NULL, store_id integer, kind text NOT NULL, stamp text NOT NULL,
      read_at integer NOT NULL, rows integer NOT NULL DEFAULT 0, changed integer NOT NULL DEFAULT 0, ms integer, error text)`,
    ["CREATE INDEX IF NOT EXISTS price_file_chain_idx ON price_file (chain_id, read_at)"],
  );
  // D5: the catalog search — FTS5 trigram over the normalized names (≥ 3 letters, any position, Hebrew too).
  await client.execute("CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(search, gtin UNINDEXED, tokenize='trigram')");
  if (!tables.has("catalog_fts")) {
    await client.execute("INSERT INTO catalog_fts (search, gtin) SELECT search, gtin FROM catalog");
    log("created catalog_fts");
  }
  // C1: the household's choice per typed name ("milk" → this gtin, or "any" = the cheapest of its type).
  await make(
    "product_choice",
    `CREATE TABLE IF NOT EXISTS product_choice (
      space_id text NOT NULL, name_key text NOT NULL, gtin text, any_type text, by_user text, at integer NOT NULL,
      PRIMARY KEY (space_id, name_key))`,
  );
  // Nullable columns: a list row's catalog product (C1), a space's store → its branch (A10).
  const itemCols = (await client.execute("PRAGMA table_info(items)")).rows.map((r) => String(r.name));
  if (!itemCols.includes("catalog_gtin")) await client.execute("ALTER TABLE items ADD COLUMN catalog_gtin text");
  if (!itemCols.includes("match_state")) await client.execute("ALTER TABLE items ADD COLUMN match_state text");
  if (!itemCols.includes("match_at")) await client.execute("ALTER TABLE items ADD COLUMN match_at integer");
  const storeCols = (await client.execute("PRAGMA table_info(space_store)")).rows.map((r) => String(r.name));
  if (!storeCols.includes("branch_id")) await client.execute("ALTER TABLE space_store ADD COLUMN branch_id text");
}
