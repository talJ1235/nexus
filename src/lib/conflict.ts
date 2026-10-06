import { and, eq, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { Scoped } from "@/lib/db-scoped";

// R16 B3 — "already changed by Noa". An edit of an existing row may carry the base the client saw: the row's rev and
// its old values of the fields it changes. If the row moved on but those fields still hold the old values, nobody
// touched them → apply silently (A moves the item, B edits its price: both kept). Otherwise → { conflict, row, by }.

export const BaseZ = z.object({ rev: z.number().int().nonnegative(), values: z.record(z.string(), z.unknown()) }).strict();
export type Base = z.infer<typeof BaseZ>;
export type Conflict<T> = { conflict: true; row: T; by: string | null };
export const isConflict = <T,>(x: unknown): x is Conflict<T> => !!x && typeof x === "object" && (x as { conflict?: unknown }).conflict === true;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Someone else changed one of `keys` since `base` → who (else null). */
export function clash(row: Record<string, unknown> & { rev: number; revBy: string | null }, keys: string[], base: Base | undefined): { by: string | null } | null {
  if (!base || row.rev === base.rev) return null;
  for (const k of keys) if (k in base.values && !same(row[k], base.values[k])) return { by: row.revBy };
  return null;
}

type Row = Record<string, unknown> & { rev: number; revBy: string | null };
type Guarded = SQLiteTable & { id: SQLiteColumn; rev: SQLiteColumn; spaceId: SQLiteColumn; $inferInsert: { spaceId: string } };

/**
 * Update one row by id unless it clashes with `base`. The write is conditioned on the rev it checked (`rev = ?`); if
 * another write lands in between (0 rows), it re-reads and checks once more. Returns the clash, or null when applied.
 */
export async function guardedUpdate<T extends Guarded>(s: Scoped, t: T, id: string, patch: Record<string, unknown> | ((row: T["$inferSelect"]) => Record<string, unknown>), base: Base | undefined): Promise<{ by: string | null } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = (await s.mustGet(t, id)) as unknown as Row;
    const set = typeof patch === "function" ? patch(row as T["$inferSelect"]) : patch;
    // The fields the user changed = the base's keys (the client sends the old value of each field it edits).
    // A row last written by this same person (fast taps, a second tab) is never a conflict — only other people are.
    const c = row.revBy === s.actor ? null : clash(row, Object.keys(base?.values ?? {}), base);
    if (c) return c;
    // Without a base (older callers): last write wins, as before — no rev condition.
    const cond = (base ? and(eq(t.id, id), eq(t.rev, row.rev)) : eq(t.id, id)) as SQL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await s.update(t, set as any, cond)) as { rowsAffected?: number };
    if (!base || (r?.rowsAffected ?? 1) > 0) return null;
  }
  const row = (await s.mustGet(t, id)) as unknown as Row;
  return { by: row.revBy };
}
