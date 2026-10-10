import "server-only";
import { createClient, type InStatement } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { noteDb } from "@/lib/timing";
import * as schema from "./schema";
import { isReadStatement, isTransientDbError } from "./transient";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Local file DBs are shared with test/seed scripts: wait for their locks instead of failing with SQLITE_BUSY.
if ((process.env.TURSO_DATABASE_URL ?? "file:").startsWith("file:")) void client.execute("PRAGMA busy_timeout = 5000").catch(() => {});

// R16 G1: each statement's time goes to the request's Server-Timing (a no-op outside a timed route).
const sqlOf = (s: InStatement) => (typeof s === "string" ? s : s.sql);
const execute = client.execute.bind(client);
const batch = client.batch.bind(client);
client.execute = (async (stmt: InStatement, args?: unknown) => {
  const t = performance.now();
  const run = () => (execute as (s: InStatement, a?: unknown) => ReturnType<typeof execute>)(stmt, args);
  try {
    return await run();
  } catch (e) {
    // R17 S5 S1: a read that failed on the way (not the SQL) gets one more try.
    if (!isTransientDbError(e) || !isReadStatement(sqlOf(stmt))) throw e;
    await new Promise((r) => setTimeout(r, 120));
    return await run();
  } finally {
    noteDb(sqlOf(stmt), performance.now() - t);
  }
}) as typeof client.execute;
client.batch = (async (stmts: InStatement[], mode?: Parameters<typeof batch>[1]) => {
  const t = performance.now();
  try {
    return await batch(stmts, mode);
  } finally {
    noteDb(stmts.map(sqlOf).join(";"), performance.now() - t);
  }
}) as typeof client.batch;

export const db = drizzle(client, { schema });
export { schema };
