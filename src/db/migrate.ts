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
  console.log("[migrate] done:", url.replace(/\/\/.*@/, "//***@").split("?")[0]);
  client.close();
}

main().catch((e) => {
  console.error("[migrate] failed", e);
  process.exit(1);
});
