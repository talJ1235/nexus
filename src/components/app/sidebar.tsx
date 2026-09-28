"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { moveItems } from "@/app/actions";
import { ChartColumn, History, Inbox, Plus, Settings2, ShoppingBag, Store, Truck, Zap } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoMark } from "@/components/logo";
import { Kbd } from "@/components/ui/button";
import { budgetStats } from "@/lib/calc";
import { cn } from "@/lib/utils";
import { useStore, type View } from "./store";
import { COLLECTION_COLORS, itemsForView } from "./view-items";

function sameView(a: View, b: View) {
  if (a.type !== b.type) return false;
  if (a.type === "collection" && b.type === "collection") return a.id === b.id;
  if (a.type === "store" && b.type === "store") return a.key === b.key;
  return true;
}

const DRAG_TYPE = "application/x-nexus-items";

function NavItem({
  active,
  onClick,
  icon,
  label,
  count,
  children,
  onDropItems,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  children?: React.ReactNode;
  onDropItems?: (ids: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: React.DragEvent) => !!onDropItems && e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        try {
          const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
          if (Array.isArray(ids) && ids.length) onDropItems!(ids);
        } catch {}
      }}
      className={cn(
        "group relative flex w-full flex-col rounded-lg px-2.5 py-[7px] text-start text-[14px] transition",
        over ? "bg-accent-soft text-fg ring-2 ring-accent" : active ? "bg-raised text-fg shadow-card" : "text-muted hover:bg-sunken hover:text-fg",
      )}
    >
      <span className="flex w-full items-center gap-2.5">
        <span className={cn("flex size-4 shrink-0 items-center justify-center [&_svg]:size-4", active ? "text-fg" : "text-faint group-hover:text-muted")}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count != null && count > 0 && <span className="tabular text-xs text-faint">{count}</span>}
      </span>
      {children}
    </button>
  );
}

function SectionHeader({ label, onAdd, addLabel }: { label: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="mb-1 mt-5 flex items-center justify-between px-2.5">
      <span className="text-xs font-medium text-faint">{label}</span>
      {onAdd && (
        <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} className="rounded-md p-0.5 text-faint transition hover:bg-sunken hover:text-fg">
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const s = useStore();
  const { t, f } = useI18n();

  const counts = useMemo(
    () => ({
      to_buy: itemsForView(s.items, { type: "to_buy" }).length,
      urgent: itemsForView(s.items, { type: "urgent" }).length,
      history: itemsForView(s.items, { type: "history" }).length,
      unsorted: itemsForView(s.items, { type: "unsorted" }).length,
      ordered: itemsForView(s.items, { type: "ordered" }).length,
    }),
    [s.items],
  );

  const move = async (ids: string[], collectionId: string | null) => {
    const prev = s.items.filter((i) => ids.includes(i.id));
    s.upsertItems(prev.map((i) => ({ ...i, collectionId })));
    try {
      await moveItems(ids, collectionId);
      const name = collectionId ? s.collections.find((c) => c.id === collectionId)?.name ?? "" : t.nav.unsorted;
      toast.success(f(t.select.moved, { name }), {
        description: ids.length > 1 ? (ids.length === 1 ? t.collection.itemsCountOne : f(t.collection.itemsCount, { n: ids.length })) : prev[0]?.title,
        action: {
          label: t.item.undo,
          onClick: async () => {
            s.upsertItems(prev);
            for (const p of prev) await moveItems([p.id], p.collectionId);
          },
        },
      });
      s.clearSelection();
    } catch {
      s.upsertItems(prev);
      toast.error(t.errors.generic);
    }
  };

  const stores = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const i of s.items) {
      if (i.status !== "to_buy") continue;
      const seen = new Set<string>();
      for (const src of i.sources) {
        if (seen.has(src.storeKey) || src.storeKey === "manual") continue;
        seen.add(src.storeKey);
        const e = m.get(src.storeKey) ?? { name: src.store, count: 0 };
        e.count++;
        m.set(src.storeKey, e);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  }, [s.items]);

  const active = (v: View) => sameView(s.view, v);
  const projects = s.collections.filter((c) => c.kind === "project" && !c.archived);
  const lists = s.collections.filter((c) => c.kind === "list" && !c.archived);

  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="inline-flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-[-0.01em]">{t.appName}</span>
        </span>
        <button
          type="button"
          onClick={() => s.setPaletteOpen(true)}
          className="hidden items-center gap-1 rounded-md px-1.5 py-1 text-faint transition hover:bg-sunken hover:text-fg lg:flex"
          title={t.cmd.placeholder}
        >
          <Kbd>Esc</Kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="mt-2 space-y-0.5">
          <NavItem active={active({ type: "to_buy" })} onClick={() => s.setView({ type: "to_buy" })} icon={<ShoppingBag />} label={t.nav.toBuy} count={counts.to_buy} />
          <NavItem active={active({ type: "urgent" })} onClick={() => s.setView({ type: "urgent" })} icon={<Zap />} label={t.nav.urgent} count={counts.urgent} />
          {counts.unsorted > 0 && (
            <NavItem active={active({ type: "unsorted" })} onClick={() => s.setView({ type: "unsorted" })} icon={<Inbox />} label={t.nav.unsorted} count={counts.unsorted} onDropItems={(ids) => move(ids, null)} />
          )}
          <NavItem active={active({ type: "orders" })} onClick={() => s.setView({ type: "orders" })} icon={<Store />} label={t.nav.orders} />
          <NavItem active={active({ type: "ordered" })} onClick={() => s.setView({ type: "ordered" })} icon={<Truck />} label={t.nav.onTheWay} count={counts.ordered} />
          <NavItem active={active({ type: "history" })} onClick={() => s.setView({ type: "history" })} icon={<History />} label={t.nav.history} count={counts.history} />
          <NavItem active={active({ type: "spending" })} onClick={() => s.setView({ type: "spending" })} icon={<ChartColumn />} label={t.nav.spending} />
        </div>

        <SectionHeader label={t.nav.projects} onAdd={() => s.setEditor({ mode: "create", kind: "project" })} addLabel={t.nav.newProject} />
        <div className="space-y-0.5">
          {projects.map((c) => {
            const b = budgetStats(c, s.items, s.altGroups, s.rates, s.currency);
            return (
              <NavItem
                key={c.id}
                active={active({ type: "collection", id: c.id })}
                onClick={() => s.setView({ type: "collection", id: c.id })}
                onDropItems={(ids) => move(ids, c.id)}
                icon={<span className="size-2.5 rounded-[3px]" style={{ background: COLLECTION_COLORS[c.color] ?? COLLECTION_COLORS.amber }} />}
                label={c.name}
                count={b.count}
              >
                {b.budget != null && (
                  <span className="mt-1.5 ms-[26px] block h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                    <span
                      className={cn("block h-full rounded-full", b.state === "over" ? "bg-danger" : b.state === "near" ? "bg-accent" : "bg-ok")}
                      style={{ width: `${Math.min(100, b.pct ?? 0)}%` }}
                    />
                  </span>
                )}
              </NavItem>
            );
          })}
          {projects.length === 0 && (
            <button type="button" onClick={() => s.setEditor({ mode: "create", kind: "project" })} className="w-full rounded-lg px-2.5 py-1.5 text-start text-[13px] text-faint hover:bg-sunken hover:text-muted">
              + {t.nav.newProject}
            </button>
          )}
        </div>

        <SectionHeader label={t.nav.lists} onAdd={() => s.setEditor({ mode: "create", kind: "list" })} addLabel={t.nav.newList} />
        <div className="space-y-0.5">
          {lists.map((c) => (
            <NavItem
              key={c.id}
              active={active({ type: "collection", id: c.id })}
              onClick={() => s.setView({ type: "collection", id: c.id })}
                onDropItems={(ids) => move(ids, c.id)}
              icon={<span className="size-2.5 rounded-full" style={{ background: COLLECTION_COLORS[c.color] ?? COLLECTION_COLORS.amber }} />}
              label={c.name}
              count={s.items.filter((i) => i.collectionId === c.id && i.status === "to_buy").length}
            />
          ))}
          {lists.length === 0 && (
            <button type="button" onClick={() => s.setEditor({ mode: "create", kind: "list" })} className="w-full rounded-lg px-2.5 py-1.5 text-start text-[13px] text-faint hover:bg-sunken hover:text-muted">
              + {t.nav.newList}
            </button>
          )}
        </div>

        {stores.length > 0 && (
          <>
            <SectionHeader label={t.nav.stores} />
            <div className="space-y-0.5">
              {stores.map(([key, v]) => (
                <NavItem key={key} active={active({ type: "store", key })} onClick={() => s.setView({ type: "store", key })} icon={<Store />} label={v.name} count={v.count} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={() => s.setSettingsOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-muted transition hover:bg-sunken hover:text-fg"
        >
          <Settings2 className="size-4" />
          <span className="flex-1 text-start">{t.nav.settings}</span>
          <span className="tabular text-xs text-faint">{s.currency}</span>
        </button>
      </div>
    </nav>
  );
}
