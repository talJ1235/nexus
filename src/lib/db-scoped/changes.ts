import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadBudgetHistory, loadBudgetWarn, loadImportLimit, loadItems } from "@/lib/data";
import type { AltGroup, Alert, Collection, ItemWithSources, StoreSetting } from "@/lib/types";
import type { BudgetHistory } from "@/lib/budget";
import { readRev } from "./feed";
import type { Scoped } from "./index";

// R16 B1 — the change feed's read side: everything in this space written after revision `since`.

export type Removed = { tbl: string; id: string; by: string | null };
export type Changes = {
  rev: number;
  /** The client is too far behind (tombstones purged) or a bulk move happened: reload the data instead. */
  reset?: true;
  items: ItemWithSources[];
  collections: Collection[];
  altGroups: AltGroup[];
  storeSettings: StoreSetting[];
  alerts: Alert[];
  budget?: BudgetHistory;
  importLimitUsd?: number;
  budgetWarn?: boolean;
  removed: Removed[];
};

const EMPTY = { items: [], collections: [], altGroups: [], storeSettings: [], alerts: [], removed: [] };
/** More changed items than this → reload instead (cheaper than a huge diff). */
const MAX_ITEMS = 400;

export async function changesFor(s: Scoped, since: number): Promise<Changes> {
  const meta = await readRev(s.spaceId);
  if (since === meta.rev) return { rev: meta.rev, ...EMPTY };
  if (since > meta.rev || since < meta.floor || since < meta.resetRev) return { rev: meta.rev, reset: true, ...EMPTY };
  const [itemRows, collections, altGroups, storeSettings, alerts, prefs, removed] = await Promise.all([
    s.pick({ id: schema.items.id }, schema.items, gt(schema.items.rev, since)),
    s.select(schema.collections, gt(schema.collections.rev, since)),
    s.select(schema.altGroups, gt(schema.altGroups.rev, since)),
    s.select(schema.storeSettings, gt(schema.storeSettings.rev, since)),
    s.select(schema.alerts, gt(schema.alerts.rev, since)),
    db.select({ key: schema.spacePref.key }).from(schema.spacePref).where(and(eq(schema.spacePref.spaceId, s.spaceId), gt(schema.spacePref.rev, since))),
    db
      .select({ tbl: schema.tombstone.tbl, id: schema.tombstone.rowId, by: schema.tombstone.by })
      .from(schema.tombstone)
      .where(and(eq(schema.tombstone.spaceId, s.spaceId), gt(schema.tombstone.rev, since))),
  ]);
  if (itemRows.length > MAX_ITEMS) return { rev: meta.rev, reset: true, ...EMPTY };
  const items = itemRows.length ? await loadItems(s, itemRows.map((r) => r.id)) : [];
  const prefsChanged = prefs.length > 0 || removed.some((r) => r.tbl === "space_pref");
  const [budget, importLimitUsd, budgetWarn] = prefsChanged ? await Promise.all([loadBudgetHistory(s), loadImportLimit(s), loadBudgetWarn(s)]) : [undefined, undefined, undefined];
  return { rev: meta.rev, items, collections, altGroups, storeSettings, alerts, removed, ...(budget ? { budget, importLimitUsd, budgetWarn } : {}) };
}

/** Just the space's revision (the polling fallback's cheap check). */
export async function spaceRevOf(s: Scoped) {
  return (await readRev(s.spaceId)).rev;
}
