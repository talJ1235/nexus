import "server-only";
import { and, count as countFn, eq, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, schema } from "@/db";
import type { Ctx } from "@/lib/ctx";
import { AccessError } from "@/lib/ctx";

// R15 B3 — the scoped data layer. The ONLY place that touches data tables with the raw `db` (test:scope enforces it).
// Every read is filtered by `space_id = ctx.space.id`; every write takes space_id from the ctx, never from input
// (insert overrides it, update strips it). Loading by id = `id = ? AND space_id = ?` → null → 404, never 403.

type SpaceTable = SQLiteTable & { spaceId: SQLiteColumn; $inferInsert: { spaceId: string } };
type IdTable = SpaceTable & { id: SQLiteColumn };
type Insert<T extends SpaceTable> = Omit<T["$inferInsert"], "spaceId">;
type Update<T extends SpaceTable> = Partial<Omit<T["$inferInsert"], "spaceId">>;

/** The minimal scope the layer needs: a space (and the user, for personal rows). */
export type Scope = { spaceId: string; userId: string | null };

export function scopeOf(ctx: { space: { id: string }; user: { id: string } }): Scope {
  return { spaceId: ctx.space.id, userId: ctx.user.id };
}

export class Scoped {
  constructor(readonly scope: Scope) {}

  get spaceId() {
    return this.scope.spaceId;
  }

  /** `space_id = <this space>` [AND cond] for table t. */
  in<T extends SpaceTable>(t: T, cond?: SQL): SQL {
    const own = eq(t.spaceId, this.scope.spaceId);
    return cond ? (and(own, cond) as SQL) : own;
  }

  /** All columns of t in this space. Chain orderBy / limit / joins (join conditions should use `in` too). */
  select<T extends SpaceTable>(t: T, cond?: SQL) {
    return db.select().from(t as SQLiteTable).where(this.in(t, cond)).$dynamic() as unknown as SelectAll<T>;
  }

  /** Chosen fields from t in this space. */
  pick<F extends Record<string, SQLiteColumn | SQL | SQL.Aliased>, T extends SpaceTable>(fields: F, t: T, cond?: SQL) {
    return db.select(fields).from(t as SQLiteTable).where(this.in(t, cond)).$dynamic();
  }

  async byId<T extends IdTable>(t: T, id: string): Promise<T["$inferSelect"] | null> {
    if (typeof id !== "string" || !id) return null;
    const rows = await db.select().from(t as SQLiteTable).where(this.in(t, eq(t.id, id))).limit(1);
    return (rows[0] as T["$inferSelect"]) ?? null;
  }

  /** byId or AccessError("not_found"). */
  async mustGet<T extends IdTable>(t: T, id: string): Promise<T["$inferSelect"]> {
    const row = await this.byId(t, id);
    if (!row) throw new AccessError("not_found");
    return row;
  }

  /** A client-supplied reference (collectionId, itemId…) must point into this space: returns it, or not_found. */
  async ref<T extends IdTable>(t: T, id: string | null | undefined): Promise<string | null> {
    if (id == null) return null;
    await this.mustGet(t, id);
    return id;
  }

  insert<T extends SpaceTable>(t: T, values: Insert<T> | Insert<T>[]) {
    const withSpace = (v: Insert<T>) => ({ ...(v as object), spaceId: this.scope.spaceId }) as T["$inferInsert"];
    const rows = Array.isArray(values) ? values.map(withSpace) : withSpace(values);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.insert(t as any).values(rows as any);
  }

  update<T extends SpaceTable>(t: T, set: Update<T>, cond?: SQL) {
    const clean = { ...(set as Record<string, unknown>) };
    delete clean.spaceId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.update(t as any).set(clean as any).where(this.in(t, cond));
  }

  delete<T extends SpaceTable>(t: T, cond?: SQL) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.delete(t as any).where(this.in(t, cond));
  }

  async count<T extends SpaceTable>(t: T, cond?: SQL) {
    const [r] = await db.select({ n: countFn() }).from(t as SQLiteTable).where(this.in(t, cond));
    return r?.n ?? 0;
  }

  /** Run several scoped statements atomically. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batch(queries: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.batch(queries as any);
  }

  // ---- personal rows (chats per user within the space; memory per user) ----

  mine<T extends SpaceTable & { userId: SQLiteColumn }>(t: T, cond?: SQL): SQL {
    if (!this.scope.userId) throw new AccessError("unauthorized");
    const own = eq(t.userId, this.scope.userId);
    return this.in(t, cond ? (and(own, cond) as SQL) : own);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SelectAll<T extends SpaceTable> = Promise<T["$inferSelect"][]> & { orderBy: (...a: any[]) => SelectAll<T>; limit: (n: number) => SelectAll<T>; offset: (n: number) => SelectAll<T>; innerJoin: any; leftJoin: any };

export function scoped(ctx: { space: { id: string }; user: { id: string } }) {
  return new Scoped(scopeOf(ctx));
}

/** Rows that belong to a user, not a space (memory). */
export class UserScoped {
  constructor(readonly userId: string) {}
  in<T extends SQLiteTable & { userId: SQLiteColumn }>(t: T, cond?: SQL): SQL {
    const own = eq(t.userId, this.userId);
    return cond ? (and(own, cond) as SQL) : own;
  }
  select<T extends SQLiteTable & { userId: SQLiteColumn }>(t: T, cond?: SQL) {
    return db.select().from(t as SQLiteTable).where(this.in(t, cond)).$dynamic() as unknown as Promise<T["$inferSelect"][]> & { orderBy: (...a: unknown[]) => Promise<T["$inferSelect"][]> & { limit: (n: number) => Promise<T["$inferSelect"][]> }; limit: (n: number) => Promise<T["$inferSelect"][]> };
  }
  insert<T extends SQLiteTable & { userId: SQLiteColumn; $inferInsert: { userId: string } }>(t: T, values: Omit<T["$inferInsert"], "userId"> | Omit<T["$inferInsert"], "userId">[]) {
    const add = (v: object) => ({ ...v, userId: this.userId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.insert(t as any).values((Array.isArray(values) ? values.map(add) : add(values)) as any);
  }
  update<T extends SQLiteTable & { userId: SQLiteColumn; $inferInsert: { userId: string } }>(t: T, set: Partial<Omit<T["$inferInsert"], "userId">>, cond?: SQL) {
    const clean = { ...(set as Record<string, unknown>) };
    delete clean.userId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.update(t as any).set(clean as any).where(this.in(t, cond));
  }
  delete<T extends SQLiteTable & { userId: SQLiteColumn }>(t: T, cond?: SQL) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.delete(t as any).where(this.in(t, cond));
  }
}

export function userScoped(ctx: { user: { id: string } }) {
  return new UserScoped(ctx.user.id);
}

export { schema };

export * as joins from "./joins";
