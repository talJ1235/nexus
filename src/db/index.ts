import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Local file DBs are shared with test/seed scripts: wait for their locks instead of failing with SQLITE_BUSY.
if ((process.env.TURSO_DATABASE_URL ?? "file:").startsWith("file:")) void client.execute("PRAGMA busy_timeout = 5000").catch(() => {});

export const db = drizzle(client, { schema });
export { schema };
