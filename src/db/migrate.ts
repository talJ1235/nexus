import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { LEGACY_CATEGORIES } from "../lib/categories";
import { migrateR15 } from "./migrate-r15";
import { migrateR16 } from "./migrate-r16";
import { migrateR17 } from "./migrate-r17";

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) {
    console.warn("[migrate] TURSO_DATABASE_URL not set on Vercel — skipping migrations.");
    return;
  }
  // R15 local guard: from a PC only file DBs are migrated (prod is migrated by the Vercel build only).
  if (!url.startsWith("file:") && process.env.VERCEL !== "1") {
    throw new Error("refusing to migrate a non-file database outside the Vercel build (R15 local guard)");
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
  // Round 9 C3: learned notes.
  await client.execute(`CREATE TABLE IF NOT EXISTS memories (
    id text PRIMARY KEY NOT NULL,
    text text NOT NULL,
    source text DEFAULT 'chat' NOT NULL,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`);
  const itemCols = (await client.execute("PRAGMA table_info(items)")).rows.map((r) => String(r.name));
  if (!itemCols.includes("order_number")) await client.execute("ALTER TABLE items ADD COLUMN order_number text");
  // Round 7: barcodes (D1).
  if (!itemCols.includes("gtin")) await client.execute("ALTER TABLE items ADD COLUMN gtin text");
  if (!itemCols.includes("image_source")) await client.execute("ALTER TABLE items ADD COLUMN image_source text");
  if (!itemCols.includes("product_info")) await client.execute("ALTER TABLE items ADD COLUMN product_info text");
  if (!itemCols.includes("image_candidates")) await client.execute("ALTER TABLE items ADD COLUMN image_candidates text");
  if (!itemCols.includes("image_check")) await client.execute("ALTER TABLE items ADD COLUMN image_check integer NOT NULL DEFAULT 0");
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
  // Round 15: accounts, spaces, space_id everywhere (refuses a remote DB outside the Vercel build).
  await migrateR15(client, url, (m) => console.log(`[migrate-r15] ${m}`));
  // Round 16: additive only (last paid price, change feed, error log).
  await migrateR16(client, (m) => console.log(`[migrate-r16] ${m}`));
  // Round 17: additive only (short names, AI usage, account deletion).
  await migrateR17(client, (m) => console.log(`[migrate-r17] ${m}`));
  console.log("[migrate] done:", url.replace(/\/\/.*@/, "//***@").split("?")[0]);
  client.close();
}

main().catch((e) => {
  console.error("[migrate] failed", e);
  process.exit(1);
});
