import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

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
  console.log("[migrate] done:", url.replace(/\/\/.*@/, "//***@").split("?")[0]);
  client.close();
}

main().catch((e) => {
  console.error("[migrate] failed", e);
  process.exit(1);
});
