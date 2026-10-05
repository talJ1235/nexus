import "server-only";
import { and, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, schema } from "@/db";
import type { Scoped } from "./index";

// Everything needed to rebuild ONE space (R15 B3: /api/backup is the current space only, owner role). Restore writes
// only into the caller's space: space_id comes from the scope, never from the file, and a row whose id already
// belongs to another space is left untouched (upsert guarded by space_id). Secrets are never exported.

const SPACE_TABLES = ["collections", "items", "sources", "pricePoints", "attachments", "altGroups", "alerts", "storeSettings", "receipts", "conversations", "conversationMessages"] as const;
type SpaceTableName = (typeof SPACE_TABLES)[number];
const SPACE_PREFS = (k: string) => k.startsWith("pref:budget:") || k === "pref:import-limit";

export async function buildBackup(s: Scoped) {
  const uid = s.scope.userId ?? "";
  const rows = await Promise.all(
    SPACE_TABLES.map((n) => {
      const t = schema[n] as unknown as SQLiteTable & { spaceId: never };
      // Chats are personal: only the caller's own conversations (and their messages).
      if (n === "conversations") return s.select(schema.conversations, eq(schema.conversations.userId, uid));
      if (n === "conversationMessages")
        return db
          .select({ m: schema.conversationMessages })
          .from(schema.conversationMessages)
          .innerJoin(schema.conversations, and(eq(schema.conversations.id, schema.conversationMessages.conversationId), eq(schema.conversations.userId, uid), s.in(schema.conversations)))
          .where(s.in(schema.conversationMessages))
          .then((r) => r.map((x) => x.m));
      return s.select(t as never);
    }),
  );
  const data = Object.fromEntries(SPACE_TABLES.map((n, i) => [n, rows[i]])) as Record<SpaceTableName, unknown[]>;
  const prefs = (await db.select().from(schema.spacePref).where(eq(schema.spacePref.spaceId, s.spaceId))).filter((r) => SPACE_PREFS(r.key));
  const memories = uid ? await db.select().from(schema.memories).where(eq(schema.memories.userId, uid)) : [];
  return {
    app: "nexus",
    version: 2,
    exportedAt: new Date().toISOString(),
    counts: { collections: data.collections.length, items: data.items.length, sources: data.sources.length },
    data: { ...data, memories, spacePrefs: prefs.map((p) => ({ key: p.key, value: p.value, updatedAt: p.updatedAt })) },
  };
}

export type Backup = Awaited<ReturnType<typeof buildBackup>>;

const pkOf = (n: SpaceTableName) => (n === "storeSettings" ? [schema.storeSettings.spaceId, schema.storeSettings.storeKey] : [(schema[n] as typeof schema.items).id]);

function excluded(t: SQLiteTable, key: string) {
  const col = (getTableColumns(t) as Record<string, { name: string }>)[key];
  return col ? sql.raw(`excluded."${col.name}"`) : sql`NULL`;
}

/** Restore a backup into the caller's space. "merge" upserts by id (keeps anything not in the file); "replace" wipes this space's rows first. */
export async function restoreBackup(s: Scoped, raw: unknown, mode: "merge" | "replace") {
  const b = raw as Partial<Backup> & { data?: Record<string, unknown> };
  if (!b || b.app !== "nexus" || !b.data || typeof b.data !== "object") throw new Error("not_a_backup");
  const data = b.data as Record<string, unknown>;
  const counts: Record<string, number> = {};
  const uid = s.scope.userId;

  if (mode === "replace") {
    // Children first; only this space (and only the caller's own chats).
    for (const n of ["conversationMessages", "conversations", "receipts", "storeSettings", "alerts", "pricePoints", "attachments", "sources", "items", "altGroups", "collections"] as const) {
      const t = schema[n] as unknown as SQLiteTable & { spaceId: never };
      if (n === "conversations") await s.delete(schema.conversations, eq(schema.conversations.userId, uid ?? ""));
      else if (n === "conversationMessages") {
        const mine = (await s.pick({ id: schema.conversations.id }, schema.conversations, eq(schema.conversations.userId, uid ?? ""))).map((r) => r.id);
        for (let i = 0; i < mine.length; i += 200) await s.delete(schema.conversationMessages, sql`${schema.conversationMessages.conversationId} IN ${mine.slice(i, i + 200)}`);
      } else await s.delete(t as never);
    }
  }

  for (const n of SPACE_TABLES) {
    const t = schema[n] as unknown as SQLiteTable & { spaceId: never };
    const cols = getTableColumns(t) as Record<string, unknown>;
    const rows = (Array.isArray(data[n]) ? (data[n] as Record<string, unknown>[]) : [])
      .filter((r) => r && typeof r === "object")
      .map((r) => {
        const clean: Record<string, unknown> = Object.fromEntries(Object.entries(r).filter(([k]) => k in cols && k !== "spaceId"));
        if (n === "conversations") clean.userId = uid;
        return clean;
      });
    counts[n] = rows.length;
    for (let i = 0; i < rows.length; i += 40) {
      const chunk = rows.slice(i, i + 40);
      const keys = Object.keys(chunk[0] ?? {});
      if (!keys.length) continue;
      const set = Object.fromEntries(keys.filter((k) => k !== "id" && k !== "storeKey").map((k) => [k, excluded(t, k)]));
      // Guard: the conflicting row must already be this space's (a foreign id is never overwritten).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (s.insert(t as never, chunk as never) as any).onConflictDoUpdate({ target: pkOf(n), set, setWhere: eq((t as unknown as { spaceId: never }).spaceId, s.spaceId as never) as SQL });
    }
  }

  const mems = Array.isArray(data.memories) ? (data.memories as Record<string, unknown>[]) : [];
  counts.memories = 0;
  if (uid) {
    for (const m of mems) {
      if (typeof m?.id !== "string" || typeof m.text !== "string") continue;
      await db
        .insert(schema.memories)
        .values({ id: m.id, userId: uid, text: m.text.slice(0, 200), source: m.source === "manual" ? "manual" : "chat", createdAt: Number(m.createdAt) || Date.now(), updatedAt: Number(m.updatedAt) || Date.now() })
        .onConflictDoNothing();
      counts.memories++;
    }
  }

  // Space prefs (v2) or the v1 file's kv rows (budget months, import limit).
  const prefRows = Array.isArray(data.spacePrefs) ? (data.spacePrefs as { key?: unknown; value?: unknown }[]) : Array.isArray(data.kv) ? (data.kv as { key?: unknown; value?: unknown }[]) : [];
  counts.spacePrefs = 0;
  for (const p of prefRows) {
    if (typeof p.key !== "string" || typeof p.value !== "string" || !SPACE_PREFS(p.key)) continue;
    await db
      .insert(schema.spacePref)
      .values({ spaceId: s.spaceId, key: p.key, value: p.value, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: [schema.spacePref.spaceId, schema.spacePref.key], set: { value: p.value, updatedAt: Date.now() } });
    counts.spacePrefs++;
  }
  return counts;
}
