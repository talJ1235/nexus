"use client";

import { useCallback } from "react";
import { setStatus as setStatusAction, updateItem, updateSource, type BulkResult } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { isConflict, type Base, type Conflict } from "@/lib/conflict";
import { toast } from "@/lib/toast";
import type { Paid, Status } from "@/lib/status";
import type { ItemWithSources, Source } from "@/lib/types";
import { useDataStore, useStore } from "./store";

// R16 B3 — client side of "already changed by Noa". Edits send the base they started from (the row's rev + its old
// values of the fields they change). On a conflict the optimistic change rolls back to the fresh row and a toast offers
// Show (open it) and Apply mine (send again from the fresh row).

/** The base for a patch: the row's rev and its current values of the patch's fields. */
export function baseFor(row: { rev: number }, patch: object): Base {
  const r = row as unknown as Record<string, unknown>;
  return { rev: row.rev, values: Object.fromEntries(Object.keys(patch).map((k) => [k, r[k] ?? null])) };
}
/** Bases for a bulk patch, per item. */
export const basesFor = (rows: { id: string; rev: number }[], patch: object) => Object.fromEntries(rows.map((r) => [r.id, baseFor(r, patch)]));

export function useConflictToast() {
  const full = useStore();
  const { t, f } = useI18n();
  const nameOf = useCallback((by: string | null) => (full.people.find((p) => p.id === by)?.name || t.live.someone).split(/\s+/)[0], [full.people, t]);
  const one = useCallback(
    (by: string | null, o: { show?: () => void; applyMine: () => void }) =>
      toast(f(t.live.conflict, { name: nameOf(by) }), {
        duration: 9000,
        action: { label: t.live.applyMine, onClick: o.applyMine },
        ...(o.show ? { cancel: { label: t.live.show, onClick: o.show } } : {}),
      }),
    [f, t, nameOf],
  );
  const many = useCallback((n: number, applyMine: () => void) => toast(f(t.live.conflictN, { n }), { duration: 9000, action: { label: t.live.applyMine, onClick: applyMine } }), [f, t]);
  return { one, many, nameOf };
}

/** Save an item patch: optimistic, then the server's row; a conflict rolls back and asks. */
export function useSaveItem() {
  const s = useDataStore();
  const open = useStore().openItem;
  const { t } = useI18n();
  const c = useConflictToast();
  return useCallback(
    async (item: ItemWithSources, patch: Parameters<typeof updateItem>[1]) => {
      s.upsertItem({ ...item, ...patch } as ItemWithSources);
      const send = async (from: ItemWithSources): Promise<void> => {
        const res = await updateItem(item.id, patch, baseFor(from, patch));
        if (!isConflict<ItemWithSources>(res)) return s.upsertItem(res);
        s.upsertItem(res.row);
        c.one(res.by, { show: () => open(item.id), applyMine: () => void send(res.row).catch(() => toast.error(t.errors.generic)) });
      };
      try {
        await send(item);
      } catch {
        s.upsertItem(item);
        toast.error(t.errors.generic);
      }
    },
    [s, open, t, c],
  );
}

/** Save a store link's price / shipping / name (the price conflict of B3's acceptance). */
export function useSaveSource() {
  const s = useDataStore();
  const open = useStore().openItem;
  const { t } = useI18n();
  const c = useConflictToast();
  return useCallback(
    async (item: ItemWithSources, source: Source, p: Parameters<typeof updateSource>[1]) => {
      s.upsertItem({ ...item, sources: item.sources.map((x) => (x.id === source.id ? { ...x, ...p } : x)) });
      const send = async (from: Source): Promise<void> => {
        const res = await updateSource(source.id, p, baseFor(from, p));
        if (!isConflict<ItemWithSources>(res)) return s.upsertItem(res);
        s.upsertItem(res.row);
        const fresh = res.row.sources.find((x) => x.id === source.id) ?? from;
        c.one(res.by, { show: () => open(item.id), applyMine: () => void send(fresh).catch(() => toast.error(t.errors.generic)) });
      };
      try {
        await send(source);
      } catch {
        s.upsertItem(item);
        toast.error(t.errors.generic);
      }
    },
    [s, open, t, c],
  );
}

/** Single status change against the base; returns the saved item, or null after a conflict (already handled). */
export function useGuardedStatus() {
  const s = useDataStore();
  const open = useStore().openItem;
  const { t } = useI18n();
  const c = useConflictToast();
  return useCallback(
    async (item: ItemWithSources, status: Status, paid: Paid | null): Promise<ItemWithSources | null> => {
      const send = async (from: ItemWithSources): Promise<ItemWithSources | null> => {
        const res: ItemWithSources | Conflict<ItemWithSources> = await setStatusAction(item.id, status, paid ?? undefined, { rev: from.rev, values: { status: from.status } });
        if (!isConflict<ItemWithSources>(res)) return res;
        s.upsertItem(res.row);
        c.one(res.by, {
          show: () => open(item.id),
          applyMine: () =>
            void send(res.row).then(
              (x) => x && s.upsertItem(x),
              () => toast.error(t.errors.generic),
            ),
        });
        return null;
      };
      return send(item);
    },
    [s, open, t, c],
  );
}

/**
 * Bulk results (move, priority, status of a selection): the rows that went through are kept, the ones someone else
 * changed meanwhile roll back to their fresh state, and ONE toast reports them with "Apply mine" (re-sent from fresh).
 */
export function useBulkConflicts() {
  const s = useDataStore();
  const { t } = useI18n();
  const c = useConflictToast();
  return useCallback(
    (res: BulkResult, resend: (fresh: ItemWithSources[]) => Promise<BulkResult>) => {
      const go = (r: BulkResult) => {
        s.upsertItems([...r.items, ...r.conflicts.map((x) => x.row)]);
        if (!r.conflicts.length) return;
        const fresh = r.conflicts.map((x) => x.row);
        c.many(r.conflicts.length, () => void resend(fresh).then(go, () => toast.error(t.errors.generic)));
      };
      go(res);
    },
    [s, t, c],
  );
}
