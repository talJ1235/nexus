"use client";

import { useMemo, useState } from "react";
import { moveItems } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { BuyFilter } from "@/lib/views";
import { useStore } from "./store";

/** Items dragged from a card / table row (item-card.tsx, item-table.tsx). */
export const DRAG_TYPE = "application/x-nexus-items";

/** Move items to a project / list (null = out of every project), with an Undo toast. */
export function useMoveItems() {
  const s = useStore();
  const { t, f } = useI18n();
  return async (ids: string[], collectionId: string | null) => {
    const prev = s.items.filter((i) => ids.includes(i.id));
    s.upsertItems(prev.map((i) => ({ ...i, collectionId })));
    const req = moveItems(ids, collectionId);
    const name = collectionId ? s.collections.find((c) => c.id === collectionId)?.name ?? "" : t.home.noProject;
    let id: string | number | undefined;
    try {
      id = toast.success(f(t.select.moved, { name }), {
        description: ids.length > 1 ? f(t.collection.itemsCount, { n: ids.length }) : prev[0]?.title,
        action: {
          label: t.item.undo,
          onClick: async () => {
            s.upsertItems(prev);
            await req.catch(() => null);
            for (const p of prev) await moveItems([p.id], p.collectionId);
          },
        },
      });
      s.clearSelection();
      await req;
    } catch {
      s.upsertItems(prev);
      toast.error(t.errors.generic, { id });
    }
  };
}

/**
 * R14 B4: one To buy with filter chips — All · Urgent · No project, each with its count (`?v=to_buy&f=urgent|none`).
 * Desktop: in the toolbar; phone: under the Shopping switch. Dropping items on "No project" takes them out of their
 * project (what the old Unsorted row did).
 */
export function BuyFilterChips({ className }: { className?: string }) {
  const s = useStore();
  const { t } = useI18n();
  const move = useMoveItems();
  const [over, setOver] = useState(false);
  const counts = useMemo(() => {
    const toBuy = s.items.filter((i) => i.status === "to_buy");
    return { all: toBuy.length, urgent: toBuy.filter((i) => i.priority === "urgent").length, none: toBuy.filter((i) => !i.collectionId).length };
  }, [s.items]);
  const current: BuyFilter | "all" = s.view.type === "to_buy" ? (s.view.f ?? "all") : "all";
  const chips = [
    { key: "all" as const, label: t.home.all, n: counts.all },
    { key: "urgent" as const, label: t.nav.urgent, n: counts.urgent },
    { key: "none" as const, label: t.home.noProject, n: counts.none },
  ];
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)} role="group" aria-label={t.home.filtersLabel} data-buy-filters>
      {chips.map((c) => {
        const on = current === c.key;
        const drop = c.key === "none";
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            onClick={() => s.setView(c.key === "all" ? { type: "to_buy" } : { type: "to_buy", f: c.key })}
            onDragOver={
              drop
                ? (e) => {
                    if (!accepts(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (!over) setOver(true);
                  }
                : undefined
            }
            onDragLeave={drop ? () => setOver(false) : undefined}
            onDrop={
              drop
                ? (e) => {
                    setOver(false);
                    if (!accepts(e)) return;
                    e.preventDefault();
                    try {
                      const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
                      if (Array.isArray(ids) && ids.length) void move(ids, null);
                    } catch {}
                  }
                : undefined
            }
            className={cn(
              "flex h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition active:scale-[0.97]",
              on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:bg-surface-2",
              drop && over && "border-brand bg-tint text-ink ring-2 ring-brand",
            )}
            data-buy-filter={c.key}
          >
            {c.label}
            <span className={cn("tabular text-xs font-medium", on ? "opacity-70" : "text-muted")} data-buy-count>
              {c.n}
            </span>
          </button>
        );
      })}
    </div>
  );
}
