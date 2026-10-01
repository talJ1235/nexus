import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { LEGACY_CATEGORIES } from "../lib/categories";

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) {
    console.warn("[migrate] TURSO_DATABASE_URL not set on Vercel — skipping migrations.");
    return;
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  // Tables added after the drizzle-kit migrations: created idempotently here.
  await client.execute(`CREATE TABLE IF NOT EXISTS store_settings (
    store_key text PRIMARY KEY NOT NULL,
    free_shipping_min real,
    currency text DEFAULT 'ILS' NOT NULL,
    shipping_fee real,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS receipts (
    id text PRIMARY KEY NOT NULL,
    url text,
    name text NOT NULL,
    content_type text,
    size integer,
    text text,
    status text DEFAULT 'new' NOT NULL,
    data text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    applied_at integer
  )`);
  // Round 8 D3: problem reports.
  await client.execute(`CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    diagnostics text,
    screenshot text,
    status text DEFAULT 'open' NOT NULL,
    github_issue integer,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`);
  // Round 9 C2: assistant conversations.
  await client.execute(`CREATE TABLE IF NOT EXISTS conversations (
    id text PRIMARY KEY NOT NULL,
    title text DEFAULT '' NOT NULL,
    modes text,
    links text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    deleted_at integer
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS conversation_messages (
    id text PRIMARY KEY NOT NULL,
    conversation_id text NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    data text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`);
  await client.execute("CREATE INDEX IF NOT EXISTS conversation_messages_conv ON conversation_messages (conversation_id, created_at)");
  const itemCols = (await client.execute("PRAGMA table_info(items)")).rows.map((r) => String(r.name));
  if (!itemCols.includes("order_number")) await client.execute("ALTER TABLE items ADD COLUMN order_number text");
  // Round 7: barcodes (D1).
  if (!itemCols.includes("gtin")) await client.execute("ALTER TABLE items ADD COLUMN gtin text");
  if (!itemCols.includes("image_source")) await client.execute("ALTER TABLE items ADD COLUMN image_source text");
  const sourceCols = (await client.execute("PRAGMA table_info(sources)")).rows.map((r) => String(r.name));
  if (!sourceCols.includes("gtin")) await client.execute("ALTER TABLE sources ADD COLUMN gtin text");
  // Round 7: receipts made of several photos (E1/E2).
  const receiptCols = (await client.execute("PRAGMA table_info(receipts)")).rows.map((r) => String(r.name));
  if (!receiptCols.includes("parts")) await client.execute("ALTER TABLE receipts ADD COLUMN parts text");
  // Round 7: the short fixed category list. Idempotent (only rows still holding an old value change).
  const legacy = Object.entries(LEGACY_CATEGORIES);
  await client.execute({
    sql: `UPDATE items SET category = CASE category ${legacy.map(() => "WHEN ? THEN ?").join(" ")} END WHERE category IN (${legacy.map(() => "?").join(",")})`,
    args: [...legacy.flat(), ...legacy.map(([k]) => k)],
  });
  console.log("[migrate] done:", url.replace(/\/\/.*@/, "//***@").split("?")[0]);
  client.close();
}

main().catch((e) => {
  console.error("[migrate] failed", e);
  process.exit(1);
});
