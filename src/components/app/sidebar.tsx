"use client";

import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { moveItems } from "@/app/actions";
import { ChartColumn, ChevronLeft, Flag, History, House, Inbox, Plus, Settings, ShoppingCart, Store, Truck } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoPill } from "@/components/logo";
import { Ring } from "@/components/ui/ring";
import { budgetStats } from "@/lib/calc";
import { cn } from "@/lib/utils";
import { useStore, type View } from "./store";
import { COLLECTION_COLORS, itemsForView } from "./view-items";
import { NavRowsSkeleton, Skel } from "./skeletons";
import { useExtension } from "./use-extension";

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
  trailing,
  onDropItems,
  carry,
  collapsed,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** null = still loading (placeholder); undefined = no count for this entry. */
  count?: number | null;
  /** Shown instead of the count (a project's budget ring). */
  trailing?: React.ReactNode;
  onDropItems?: (ids: string[]) => void;
  carry?: string;
  collapsed?: boolean;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: React.DragEvent) => !!onDropItems && e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <button
      type="button"
      onClick={onClick}
      data-carry={carry}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
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
        "group relative flex h-11 w-full shrink-0 items-center gap-[11px] whitespace-nowrap rounded-full px-[13px] text-start text-[14px] font-semibold transition-[background-color,color,box-shadow,padding] duration-200 active:scale-[0.98]",
        over ? "bg-tint text-ink ring-2 ring-brand" : active ? "bg-ink text-bg" : "text-ink/85 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <span className="flex size-[19px] shrink-0 items-center justify-center [&_svg]:size-[19px] [&_svg]:stroke-[1.8]">{icon}</span>
      <span className={cn("min-w-0 flex-1 truncate transition-opacity duration-200", collapsed && "opacity-0")}>{label}</span>
      {!collapsed &&
        (trailing ??
          (count === null ? (
            <Skel className="skeleton-in h-2.5 w-3.5" />
          ) : (
            count != null && count > 0 && <span className={cn("tabular load-in text-xs font-medium", active ? "opacity-70" : "text-muted")}>{count}</span>
          )))}
    </button>
  );
}

function SectionHeader({ label, onAdd, addLabel, carry, collapsed, onLabel }: { label: string; onAdd?: () => void; addLabel?: string; carry?: string; collapsed?: boolean; onLabel?: () => void }) {
  if (collapsed) return <div className="mx-auto my-[11px] h-px w-6 shrink-0 bg-line" aria-hidden />;
  return (
    <div className="flex h-8 items-center justify-between ps-3 pe-1.5">
      {onLabel ? (
        <button type="button" onClick={onLabel} className="text-xs font-semibold text-muted transition hover:text-ink">
          {label}
        </button>
      ) : (
        <span className="text-xs font-semibold text-muted">{label}</span>
      )}
      {onAdd && (
        <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} data-carry={carry} className="grid size-7 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink">
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** The floating sidebar (desktop ≥1024 px), collapsible to 76 px icons. Also used inside the phone nav sheet
 *  (`floating={false}`, never collapsed). */
export function Sidebar({ collapsed, onToggle, floating = true }: { collapsed?: boolean; onToggle?: () => void; floating?: boolean }) {
  const s = useStore();
  const { t, f } = useI18n();
  const ext = useExtension();

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
    const req = moveItems(ids, collectionId);
    const name = collectionId ? s.collections.find((c) => c.id === collectionId)?.name ?? "" : t.nav.unsorted;
    let id: string | number | undefined;
    try {
      id = toast.success(f(t.select.moved, { name }), {
        description: ids.length > 1 ? (ids.length === 1 ? t.collection.itemsCountOne : f(t.collection.itemsCount, { n: ids.length })) : prev[0]?.title,
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

  const active = (v: View) => sameView(s.view, v);
  const n = (v: number) => (s.loading ? null : v);
  const fade = s.navSeq === 0 ? "load-in" : undefined;
  const projects = s.collections.filter((c) => c.kind === "project" && !c.archived);
  const lists = s.collections.filter((c) => c.kind === "list" && !c.archived);
  const c = !!collapsed;

  return (
    <nav
      className={cn("flex h-full flex-col gap-4 overflow-hidden p-3", floating ? "rounded-[28px] border border-line bg-surface" : "bg-transparent")}
      aria-label="Main"
      data-collapsed={c ? "" : undefined}
    >
      <div className={cn("flex shrink-0 items-center gap-2", c && "flex-col")}>
        <button type="button" onClick={() => s.setView({ type: "home" })} aria-label={t.dash.title} data-sidebar-logo data-carry="view:home" className="shrink-0 rounded-full">
          <LogoPill collapsed={c} />
        </button>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={c ? t.shell.expand : t.shell.collapse}
            title={c ? t.shell.expand : t.shell.collapse}
            aria-expanded={!c}
            data-sidebar-toggle
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted transition-transform duration-[450ms] ease-[var(--ease-out)] hover:text-ink",
              c ? "rotate-180" : "ms-auto",
            )}
          >
            <ChevronLeft className="size-4 rtl:-scale-x-100" strokeWidth={2.2} />
          </button>
        )}
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-1">
        <div className="flex flex-col gap-[3px]">
          <NavItem collapsed={c} active={active({ type: "home" })} onClick={() => s.setView({ type: "home" })} carry="view:home" icon={<House />} label={t.dash.title} />
          <NavItem collapsed={c} active={active({ type: "to_buy" })} onClick={() => s.setView({ type: "to_buy" })} carry="view:to_buy" icon={<ShoppingCart />} label={t.nav.toBuy} count={n(counts.to_buy)} />
          <NavItem collapsed={c} active={active({ type: "urgent" })} onClick={() => s.setView({ type: "urgent" })} carry="view:urgent" icon={<Flag />} label={t.nav.urgent} count={n(counts.urgent)} />
          {counts.unsorted > 0 && (
            <NavItem collapsed={c} active={active({ type: "unsorted" })} onClick={() => s.setView({ type: "unsorted" })} carry="view:unsorted" icon={<Inbox />} label={t.nav.unsorted} count={counts.unsorted} onDropItems={(ids) => move(ids, null)} />
          )}
          <NavItem collapsed={c} active={active({ type: "ordered" })} onClick={() => s.setView({ type: "ordered" })} carry="view:ordered" icon={<Truck />} label={t.nav.onTheWay} count={n(counts.ordered)} />
          <NavItem collapsed={c} active={active({ type: "orders" })} onClick={() => s.setView({ type: "orders" })} carry="view:orders" icon={<Store />} label={t.nav.orders} />
          <NavItem collapsed={c} active={active({ type: "history" })} onClick={() => s.setView({ type: "history" })} carry="view:history" icon={<History />} label={t.nav.history} count={n(counts.history)} />
          <NavItem collapsed={c} active={active({ type: "spending" })} onClick={() => s.setView({ type: "spending" })} carry="view:spending" icon={<ChartColumn />} label={t.nav.spending} />
        </div>

        <div className="flex flex-col gap-[3px]">
          <SectionHeader collapsed={c} label={t.nav.projects} onLabel={() => s.setView({ type: "projects" })} carry="editor:project" onAdd={() => s.setEditor({ mode: "create", kind: "project" })} addLabel={t.nav.newProject} />
          {s.loading && !c && <NavRowsSkeleton rows={[58, 42]} />}
          <div className={cn("flex flex-col gap-[3px]", fade)}>
            {projects.map((p) => {
              const b = budgetStats(p, s.items, s.altGroups, s.rates, s.currency);
              const inProject = s.items.filter((i) => i.collectionId === p.id);
              const bought = inProject.filter((i) => i.status !== "to_buy").length;
              const ratio = b.budget != null ? (b.pct ?? 0) / 100 : inProject.length ? bought / inProject.length : 0;
              const color = COLLECTION_COLORS[p.color] ?? COLLECTION_COLORS.amber;
              return (
                <NavItem
                  key={p.id}
                  collapsed={c}
                  active={active({ type: "collection", id: p.id })}
                  onClick={() => s.setView({ type: "collection", id: p.id })}
                  onDropItems={(ids) => move(ids, p.id)}
                  icon={<span className="size-2.5 rounded-[4px]" style={{ background: color }} />}
                  label={p.name}
                  trailing={<Ring value={ratio} color={b.state === "over" ? "var(--danger)" : color} />}
                />
              );
            })}
            {!c && !s.loading && (
              <button
                type="button"
                onClick={() => s.setEditor({ mode: "create", kind: "project" })}
                className="flex h-10 w-full items-center gap-[11px] rounded-full px-[13px] text-start text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
              >
                <Plus className="size-[19px] stroke-[1.8]" />
                {t.nav.newProject}
              </button>
            )}
          </div>
        </div>

        {(lists.length > 0 || s.loading) && (
          <div className="flex flex-col gap-[3px]">
            <SectionHeader collapsed={c} label={t.nav.lists} carry="editor:list" onAdd={() => s.setEditor({ mode: "create", kind: "list" })} addLabel={t.nav.newList} />
            {s.loading && !c && <NavRowsSkeleton rows={[46, 62]} round />}
            <div className={cn("flex flex-col gap-[3px]", fade)}>
              {lists.map((l) => (
                <NavItem
                  key={l.id}
                  collapsed={c}
                  active={active({ type: "collection", id: l.id })}
                  onClick={() => s.setView({ type: "collection", id: l.id })}
                  onDropItems={(ids) => move(ids, l.id)}
                  icon={<span className="size-2.5 rounded-full" style={{ background: COLLECTION_COLORS[l.color] ?? COLLECTION_COLORS.amber }} />}
                  label={l.name}
                  count={s.items.filter((i) => i.collectionId === l.id && i.status === "to_buy").length}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={cn("flex shrink-0 items-center gap-2.5 rounded-[22px] p-1.5 transition-colors", c ? "justify-center bg-transparent" : "bg-surface-2")}>
        <button
          type="button"
          onClick={() => s.setSettingsOpen(true)}
          data-carry="settings"
          title={c ? t.nav.settings : undefined}
          aria-label={c ? t.nav.settings : undefined}
          tabIndex={c ? 0 : -1}
          className="grid size-[38px] shrink-0 place-items-center rounded-full bg-ink text-[15px] font-extrabold text-bg"
        >
          {t.shell.owner.slice(0, 1).toUpperCase()}
        </button>
        {!c && (
          <>
            <div className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[14px] font-bold">{t.shell.owner}</b>
              <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                <span className={cn("size-1.5 shrink-0 rounded-full", ext.available ? "bg-ok" : "bg-faint")} aria-hidden />
                {ext.available ? t.ext.connected : t.ext.notInstalled}
              </span>
            </div>
            <button
              type="button"
              onClick={() => s.setSettingsOpen(true)}
              data-carry="settings"
              aria-label={t.nav.settings}
              title={t.nav.settings}
              className="grid size-[34px] shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-ink"
            >
              <Settings className="size-[18px]" />
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
