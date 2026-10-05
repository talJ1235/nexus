// R15 B2 — accounts + spaces. One idempotent step called from migrate.ts:
//   1. new tables (Better Auth + Nexus account tables), 2. admin user (ADMIN_EMAIL) + their personal space,
//   3. space_id / user_id / added_by_user_id columns + backfill, 4. owner kv keys → user_pref / space_pref,
//   5. space_id NOT NULL (and store_settings keyed by space) via table rebuilds — one transaction per table, row count
//      checked before commit, 6. indexes. Re-running changes nothing.
// Never runs against a remote DB from a PC: non-file URLs are refused unless VERCEL=1 (the prod build).
import type { Client, InStatement, Transaction } from "@libsql/client";
import { randomBytes } from "node:crypto";

const id = () => randomBytes(16).toString("base64url").slice(0, 21);

/** Tables that get space_id (all rows of today's single owner go to the admin's personal space). */
export const SPACE_TABLES = ["collections", "items", "sources", "price_points", "attachments", "alerts", "alt_groups", "store_settings", "receipts", "conversations", "conversation_messages"] as const;
const USER_TABLES = ["conversations", "memories", "reports"] as const;

const USER_KEYS = new Set(["pref:alerts", "pref:owner", "pref:memory", "profile:v1", "cal:token", "cal:subscribed", "cal:seq"]);
const isUserKey = (k: string) => USER_KEYS.has(k) || k.startsWith("pref:home:");
const isSpaceKey = (k: string) => k.startsWith("pref:budget:") || k === "pref:import-limit" || (k.startsWith("home:ai:") && k !== "home:ai:diag") || k.startsWith("home:look:") || k.startsWith("compare:");

const NEW_TABLES = [
  `CREATE TABLE IF NOT EXISTS "user" (
    id text PRIMARY KEY NOT NULL, name text NOT NULL, email text NOT NULL UNIQUE, email_verified integer DEFAULT 0 NOT NULL,
    image text, created_at integer DEFAULT (unixepoch() * 1000) NOT NULL, updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    role text, banned integer DEFAULT 0, ban_reason text, ban_expires integer)`,
  `CREATE TABLE IF NOT EXISTS session (
    id text PRIMARY KEY NOT NULL, expires_at integer NOT NULL, token text NOT NULL UNIQUE,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL, updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    ip_address text, user_agent text, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    impersonated_by text, active_organization_id text, method text, city text)`,
  `CREATE INDEX IF NOT EXISTS session_user_idx ON session (user_id)`,
  `CREATE TABLE IF NOT EXISTS account (
    id text PRIMARY KEY NOT NULL, account_id text NOT NULL, provider_id text NOT NULL,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text,
    access_token_expires_at integer, refresh_token_expires_at integer, scope text, password text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL, updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS account_user_idx ON account (user_id)`,
  `CREATE TABLE IF NOT EXISTS verification (
    id text PRIMARY KEY NOT NULL, identifier text NOT NULL, value text NOT NULL, expires_at integer NOT NULL,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL, updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier)`,
  `CREATE TABLE IF NOT EXISTS passkey (
    id text PRIMARY KEY NOT NULL, name text, public_key text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    credential_id text NOT NULL, counter integer NOT NULL, device_type text NOT NULL, backed_up integer NOT NULL,
    transports text, created_at integer, aaguid text, last_used_at integer)`,
  `CREATE INDEX IF NOT EXISTS passkey_user_idx ON passkey (user_id)`,
  `CREATE INDEX IF NOT EXISTS passkey_credential_idx ON passkey (credential_id)`,
  `CREATE TABLE IF NOT EXISTS space (
    id text PRIMARY KEY NOT NULL, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL, kind text DEFAULT 'shared' NOT NULL, currency text DEFAULT 'ILS' NOT NULL,
    color text DEFAULT 'plum' NOT NULL, icon text DEFAULT 'home' NOT NULL, created_by text, deleted_at integer)`,
  `CREATE TABLE IF NOT EXISTS space_member (
    id text PRIMARY KEY NOT NULL, space_id text NOT NULL REFERENCES space(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, role text DEFAULT 'member' NOT NULL,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS space_member_unique ON space_member (space_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS space_member_user_idx ON space_member (user_id)`,
  `CREATE TABLE IF NOT EXISTS space_invitation (
    id text PRIMARY KEY NOT NULL, space_id text NOT NULL REFERENCES space(id) ON DELETE CASCADE, email text NOT NULL, role text,
    status text DEFAULT 'pending' NOT NULL, expires_at integer NOT NULL, created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    inviter_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS auth_rate_limit (id text PRIMARY KEY NOT NULL, key text NOT NULL UNIQUE, count integer NOT NULL, last_request integer NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS signup_invite (
    id text PRIMARY KEY NOT NULL, code_hash text NOT NULL UNIQUE, hint text NOT NULL, code_enc text, note text, max_uses integer DEFAULT 1 NOT NULL,
    uses integer DEFAULT 0 NOT NULL, used_by text DEFAULT '[]' NOT NULL, expires_at integer NOT NULL, revoked_at integer, created_by text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS space_invite (
    id text PRIMARY KEY NOT NULL, token_hash text NOT NULL UNIQUE, space_id text NOT NULL, role text NOT NULL,
    max_uses integer DEFAULT 5 NOT NULL, uses integer DEFAULT 0 NOT NULL, expires_at integer NOT NULL, revoked_at integer,
    created_by text NOT NULL, created_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS space_invite_space_idx ON space_invite (space_id)`,
  `CREATE TABLE IF NOT EXISTS waitlist (email text PRIMARY KEY NOT NULL, created_at integer DEFAULT (unixepoch() * 1000) NOT NULL, ip_hash text, invited_at integer)`,
  `CREATE TABLE IF NOT EXISTS security_event (
    id text PRIMARY KEY NOT NULL, user_id text NOT NULL, kind text NOT NULL, meta text, ip_hash text, ua text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS security_event_user_idx ON security_event (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS rate_limit (key text PRIMARY KEY NOT NULL, count integer NOT NULL, window_start integer NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS recovery_code (
    id text PRIMARY KEY NOT NULL, user_id text NOT NULL, code_hash text NOT NULL, used_at integer,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS recovery_code_user_idx ON recovery_code (user_id)`,
  `CREATE TABLE IF NOT EXISTS user_pref (user_id text NOT NULL, key text NOT NULL, value text NOT NULL, updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL, PRIMARY KEY (user_id, key))`,
  `CREATE TABLE IF NOT EXISTS space_pref (space_id text NOT NULL, key text NOT NULL, value text NOT NULL, updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL, PRIMARY KEY (space_id, key))`,
];

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS items_space_status_idx ON items (space_id, status)",
  "CREATE INDEX IF NOT EXISTS items_space_created_idx ON items (space_id, created_at)",
  "CREATE INDEX IF NOT EXISTS collections_space_idx ON collections (space_id, created_at)",
  "CREATE INDEX IF NOT EXISTS sources_space_idx ON sources (space_id)",
  "CREATE INDEX IF NOT EXISTS price_points_space_idx ON price_points (space_id)",
  "CREATE INDEX IF NOT EXISTS attachments_space_idx ON attachments (space_id)",
  "CREATE INDEX IF NOT EXISTS alerts_space_idx ON alerts (space_id, created_at)",
  "CREATE INDEX IF NOT EXISTS alt_groups_space_idx ON alt_groups (space_id)",
  "CREATE INDEX IF NOT EXISTS receipts_space_idx ON receipts (space_id, created_at)",
  "CREATE INDEX IF NOT EXISTS conversations_space_user_idx ON conversations (space_id, user_id, updated_at)",
  "CREATE INDEX IF NOT EXISTS conversation_messages_space_idx ON conversation_messages (space_id)",
  "CREATE INDEX IF NOT EXISTS memories_user_idx ON memories (user_id)",
  "CREATE INDEX IF NOT EXISTS reports_user_idx ON reports (user_id)",
];

type Col = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };

async function columns(c: Client | Transaction, table: string): Promise<Col[]> {
  return (await c.execute(`PRAGMA table_info("${table}")`)).rows.map((r) => ({
    name: String(r.name),
    type: String(r.type),
    notnull: Number(r.notnull),
    dflt_value: r.dflt_value == null ? null : String(r.dflt_value),
    pk: Number(r.pk),
  }));
}

async function count(c: Client | Transaction, table: string) {
  return Number((await c.execute(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
}

/**
 * Rebuild `table` so space_id is NOT NULL (and, for store_settings, the key is (space_id, store_key)).
 * Columns, defaults and indexes are carried over from the live table; one transaction; the row count must match.
 */
async function rebuildNotNull(client: Client, table: string, log: (s: string) => void) {
  const cols = await columns(client, table);
  const sc = cols.find((c) => c.name === "space_id");
  const compositePk = table === "store_settings";
  const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
  const pkDone = !compositePk || (pkCols.length === 2 && pkCols.includes("space_id"));
  if (!sc || (sc.notnull === 1 && pkDone)) return false;
  const indexes = (await client.execute({ sql: "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL", args: [table] })).rows.map((r) => String(r.sql));
  const defs = cols.map((c) => {
    let d = `"${c.name}" ${c.type || "text"}`;
    if (!compositePk && c.pk === 1) d += " PRIMARY KEY";
    if (c.notnull || c.name === "space_id" || (compositePk && c.name === "store_key")) d += " NOT NULL";
    if (c.dflt_value != null) d += ` DEFAULT ${/^[\w'.-]+$/.test(c.dflt_value) ? c.dflt_value : `(${c.dflt_value.replace(/^\((.*)\)$/, "$1")})`}`;
    return d;
  });
  if (compositePk) defs.push(`PRIMARY KEY ("space_id", "store_key")`);
  const tmp = `__r15_${table}`;
  const names = cols.map((c) => `"${c.name}"`).join(", ");
  const tx = await client.transaction("write");
  try {
    const before = await count(tx, table);
    const nulls = Number((await tx.execute(`SELECT count(*) AS n FROM "${table}" WHERE space_id IS NULL`)).rows[0].n);
    if (nulls) throw new Error(`${table}: ${nulls} rows without space_id`);
    await tx.execute(`DROP TABLE IF EXISTS "${tmp}"`);
    await tx.execute(`CREATE TABLE "${tmp}" (${defs.join(", ")})`);
    await tx.execute(`INSERT INTO "${tmp}" (${names}) SELECT ${names} FROM "${table}"`);
    const after = await count(tx, tmp);
    if (after !== before) throw new Error(`${table}: copied ${after} of ${before} rows`);
    await tx.execute(`DROP TABLE "${table}"`);
    await tx.execute(`ALTER TABLE "${tmp}" RENAME TO "${table}"`);
    for (const ix of indexes) await tx.execute(ix);
    if ((await count(tx, table)) !== before) throw new Error(`${table}: count changed`);
    await tx.commit();
    log(`rebuilt ${table} (${before} rows, space_id NOT NULL${compositePk ? ", key (space_id, store_key)" : ""})`);
    return true;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

export async function migrateR15(client: Client, url: string, log: (s: string) => void = console.log) {
  if (!url.startsWith("file:") && process.env.VERCEL !== "1") {
    throw new Error("[migrate-r15] refusing a non-file database outside the Vercel build (R15 local guard)");
  }
  for (const s of NEW_TABLES) await client.execute(s);

  // 3. Columns.
  for (const t of SPACE_TABLES) {
    if (!(await columns(client, t)).some((c) => c.name === "space_id")) await client.execute(`ALTER TABLE "${t}" ADD COLUMN space_id text`);
  }
  for (const t of USER_TABLES) {
    if (!(await columns(client, t)).some((c) => c.name === "user_id")) await client.execute(`ALTER TABLE "${t}" ADD COLUMN user_id text`);
  }
  if (!(await columns(client, "items")).some((c) => c.name === "added_by_user_id")) await client.execute("ALTER TABLE items ADD COLUMN added_by_user_id text");
  if (!(await columns(client, "signup_invite")).some((c) => c.name === "code_enc")) await client.execute("ALTER TABLE signup_invite ADD COLUMN code_enc text");

  // 2. Admin user + personal space (only when there is an admin to own today's data).
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  let adminId: string | null = null;
  let spaceId: string | null = null;
  if (email) {
    const u = (await client.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [email] })).rows[0];
    adminId = u ? String(u.id) : id();
    if (!u) {
      const now = Date.now();
      await client.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'admin', ?, ?)`, args: [adminId, process.env.ADMIN_NAME || "Tal", email, now, now] });
      log(`created admin user ${email.replace(/^(.).*@/, "$1…@")}`);
    }
    const sp = (
      await client.execute({
        sql: `SELECT s.id FROM space s JOIN space_member m ON m.space_id = s.id WHERE m.user_id = ? AND s.kind = 'personal' AND s.created_by = ? ORDER BY s.created_at LIMIT 1`,
        args: [adminId, adminId],
      })
    ).rows[0];
    spaceId = sp ? String(sp.id) : id();
    if (!sp) {
      const now = Date.now();
      await client.batch(
        [
          { sql: `INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES (?, ?, ?, 'personal', 'ILS', 'plum', 'user', ?, ?)`, args: [spaceId, process.env.ADMIN_NAME || "Tal", `p-${spaceId}`, adminId, now] },
          { sql: `INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`, args: [id(), spaceId, adminId, now] },
        ],
        "write",
      );
      log("created the admin's personal space");
    }
  }

  // Backfill (only NULLs, so re-runs and post-R15 rows are untouched).
  const pending: string[] = [];
  for (const t of SPACE_TABLES) if (Number((await client.execute(`SELECT count(*) AS n FROM "${t}" WHERE space_id IS NULL`)).rows[0].n)) pending.push(t);
  for (const t of USER_TABLES) if (Number((await client.execute(`SELECT count(*) AS n FROM "${t}" WHERE user_id IS NULL`)).rows[0].n)) pending.push(`${t}.user_id`);
  if (pending.length && (!adminId || !spaceId)) throw new Error(`[migrate-r15] rows need an owner (${pending.join(", ")}) but ADMIN_EMAIL is not set`);
  if (adminId && spaceId) {
    const stmts: InStatement[] = [
      ...SPACE_TABLES.map((t) => ({ sql: `UPDATE "${t}" SET space_id = ? WHERE space_id IS NULL`, args: [spaceId] })),
      ...USER_TABLES.map((t) => ({ sql: `UPDATE "${t}" SET user_id = ? WHERE user_id IS NULL`, args: [adminId] })),
      { sql: "UPDATE items SET added_by_user_id = ? WHERE added_by_user_id IS NULL AND added_by_member_id IS NULL", args: [adminId] },
    ];
    await client.batch(stmts, "write");
    if (pending.length) log(`backfilled ${pending.join(", ")}`);

    // 4. kv: owner keys → user_pref / space_pref (insert-or-ignore, then delete — idempotent).
    const keys = (await client.execute("SELECT key FROM kv")).rows.map((r) => String(r.key));
    const moves: InStatement[] = [];
    for (const k of keys) {
      if (isUserKey(k)) moves.push({ sql: "INSERT OR IGNORE INTO user_pref (user_id, key, value, updated_at) SELECT ?, key, value, updated_at FROM kv WHERE key = ?", args: [adminId, k] });
      else if (isSpaceKey(k)) moves.push({ sql: "INSERT OR IGNORE INTO space_pref (space_id, key, value, updated_at) SELECT ?, key, value, updated_at FROM kv WHERE key = ?", args: [spaceId, k] });
      else continue;
      moves.push({ sql: "DELETE FROM kv WHERE key = ?", args: [k] });
    }
    if (moves.length) {
      await client.batch(moves, "write");
      log(`moved ${moves.length / 2} kv keys to user_pref / space_pref`);
    }
  }

  // 5. NOT NULL (+ store_settings key) — needs every row owned.
  for (const t of SPACE_TABLES) await rebuildNotNull(client, t, log);

  // 6. Indexes.
  for (const s of INDEXES) await client.execute(s);
}
