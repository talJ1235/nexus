import "server-only";
import { getTableColumns, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Everything needed to rebuild Nexus. Secrets (Telegram token, etc.) in `kv` are never exported.
const EXPORTABLE_KV = /^(pref:|fx_rates$|telegram_bot$)/;

export async function buildBackup() {
  const [collections, items, sources, pricePoints, attachments, altGroups, alerts, members, grants, invites, storeSettings, receipts, reports, conversations, conversationMessages, memories, kv] = await Promise.all([
    db.select().from(schema.collections),
    db.select().from(schema.items),
    db.select().from(schema.sources),
    db.select().from(schema.pricePoints),
    db.select().from(schema.attachments),
    db.select().from(schema.altGroups),
    db.select().from(schema.alerts),
    db.select().from(schema.members),
    db.select().from(schema.grants),
    db.select().from(schema.invites),
    db.select().from(schema.storeSettings),
    db.select().from(schema.receipts),
    db.select().from(schema.reports),
    db.select().from(schema.conversations),
    db.select().from(schema.conversationMessages),
    db.select().from(schema.memories),
    db.select().from(schema.kv),
  ]);
  return {
    app: "nexus",
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: { collections: collections.length, items: items.length, sources: sources.length },
    data: { collections, items, sources, pricePoints, attachments, altGroups, alerts, members, grants, invites, storeSettings, receipts, reports, conversations, conversationMessages, memories, kv: kv.filter((r) => EXPORTABLE_KV.test(r.key)) },
  };
}

export type Backup = Awaited<ReturnType<typeof buildBackup>>;

const TABLES = ["collections", "items", "sources", "pricePoints", "attachments", "altGroups", "alerts", "members", "grants", "invites", "storeSettings", "receipts", "reports", "conversations", "conversationMessages", "memories", "kv"] as const;
type TableName = (typeof TABLES)[number];

function table(name: TableName) {
  return schema[name];
}

/** Restore a backup. "merge" upserts by id (keeps anything not in the file); "replace" wipes first. */
export async function restoreBackup(raw: unknown, mode: "merge" | "replace") {
  const b = raw as Partial<Backup>;
  if (!b || b.app !== "nexus" || !b.data || typeof b.data !== "object") throw new Error("not_a_backup");
  const data = b.data as Record<string, unknown>;
  const counts: Record<string, number> = {};

  if (mode === "replace") {
    // Children first.
    for (const name of ["memories", "conversationMessages", "conversations", "reports", "receipts", "storeSettings", "invites", "grants", "members", "alerts", "pricePoints", "attachments", "sources", "items", "altGroups", "collections"] as const) {
      await db.delete(table(name));
    }
  }

  for (const name of TABLES) {
    const rows = Array.isArray(data[name]) ? (data[name] as Record<string, unknown>[]) : [];
    const safe = name === "kv" ? rows.filter((r) => typeof r.key === "string" && EXPORTABLE_KV.test(r.key)) : rows;
    counts[name] = safe.length;
    const t = table(name);
    const pk = name === "kv" ? schema.kv.key : name === "storeSettings" ? schema.storeSettings.storeKey : (t as typeof schema.items).id;
    // libSQL has a variable limit per statement; insert in modest chunks.
    for (let i = 0; i < safe.length; i += 40) {
      const chunk = safe.slice(i, i + 40);
      const cols = Object.keys(chunk[0] ?? {});
      if (!cols.length) continue;
      const set = Object.fromEntries(cols.filter((c) => c !== "id" && c !== "key" && c !== "storeKey").map((c) => [c, sqlExcluded(t, c)]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.insert(t) as any).values(chunk).onConflictDoUpdate({ target: pk, set });
    }
  }
  return counts;
}


function sqlExcluded(t: Parameters<typeof getTableColumns>[0], key: string) {
  const col = getTableColumns(t)[key];
  return col ? sql.raw(`excluded."${col.name}"`) : sql`NULL`;
}
