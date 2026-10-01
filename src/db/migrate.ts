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
  const itemCols = (await client.execute("PRAGMA table_info(items)")).rows.map((r) => String(r.name));
  if (!itemCols.includes("order_number")) await client.execute("ALTER TABLE items ADD COLUMN order_number text");
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
