"use client";

import { useMemo, useState } from "react";
import { ChartColumn, History, House, PanelLeftClose, Plus, Settings, ShoppingCart, Store, Truck } from "lucide-react";
import { useI18n } from "@/components/providers";
import { LogoMark } from "@/components/logo";
import { Ring } from "@/components/ui/ring";
import { budgetStats } from "@/lib/calc";
import { cn } from "@/lib/utils";
import { useStore, type View } from "./store";
import { COLLECTION_COLORS, itemsForView } from "./view-items";
import { NavRowsSkeleton, Skel } from "./skeletons";
import { DRAG_TYPE, useMoveItems } from "./buy-filters";
import { SpaceSwitcher } from "./spaces/switcher";
import { useMeName } from "./spaces/space-ui";
import { initialOf } from "@/lib/initial";

function sameView(a: View, b: View) {
  if (a.type !== b.type) return false;
  if (a.type === "collection" && b.type === "collection") return a.id === b.id;
  if (a.type === "store" && b.type === "store") return a.key === b.key;
  return true;
}


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
      // R14 B1 (home-v4 sidebar): 34 px rows, 13.5 px / 500, 17 px muted icons; active = a soft tint, ink 600 and a
      // 3 px accent bar on the start edge (Tal: never a solid black pill).
      className={cn(
        "group relative flex h-[34px] w-full shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-start text-[13.5px] transition-[background-color,color,box-shadow,padding] duration-200 active:scale-[0.98]",
        "before:absolute before:inset-y-[9px] before:start-0 before:w-[3px] before:rounded-full before:bg-[var(--nav-bar)] before:transition-opacity before:duration-200",
        collapsed && "justify-center px-0",
        over ? "bg-tint font-medium text-ink ring-2 ring-brand before:opacity-0" : active ? "bg-[var(--nav-active)] font-semibold text-ink" : "font-medium text-ink/80 before:opacity-0 hover:bg-surface-2 hover:text-ink",
      )}
      data-nav-row
    >
      <span className={cn("flex size-[17px] shrink-0 items-center justify-center [&_svg]:size-[17px] [&_svg]:stroke-[1.8]", active ? "text-ink" : "text-muted")}>{icon}</span>
      {!collapsed && <span className="bidi min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed &&
        (trailing ??
          (count === null ? (
            <Skel className="skeleton-in h-2.5 w-3.5" />
          ) : (
            count != null && count > 0 && <span className="tabular load-in text-xs font-normal text-muted">{count}</span>
          )))}
    </button>
  );
}

function SectionHeader({ label, onAdd, addLabel, carry, collapsed, onLabel }: { label: string; onAdd?: () => void; addLabel?: string; carry?: string; collapsed?: boolean; onLabel?: () => void }) {
  if (collapsed) return <div className="mx-auto my-[9px] h-px w-6 shrink-0 bg-line" aria-hidden />;
  return (
    <div className="flex h-7 items-center justify-between ps-2.5 pe-1">
      {onLabel ? (
        <button type="button" onClick={onLabel} className="text-[11px] font-semibold text-muted transition hover:text-ink">
          {label}
        </button>
      ) : (
        <span className="text-[11px] font-semibold text-muted">{label}</span>
      )}
      {onAdd && (
        <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} data-carry={carry} className="grid size-6 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink">
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** The desktop sidebar (≥1024 px, R14 B1 = home-v4): on the page background, no card; collapsible to icons.
 *  Also used inside the phone nav sheet (`floating={false}`, never collapsed). */
export function Sidebar({ collapsed, onToggle, floating = true }: { collapsed?: boolean; onToggle?: () => void; floating?: boolean }) {
  const s = useStore();
  const { t } = useI18n();

  const counts = useMemo(
    () => ({
      to_buy: itemsForView(s.items, { type: "to_buy" }).length,
      history: itemsForView(s.items, { type: "history" }).length,
      ordered: itemsForView(s.items, { type: "ordered" }).length,
    }),
    [s.items],
  );

  const move = useMoveItems();

  const active = (v: View) => sameView(s.view, v);
  const n = (v: number) => (s.loading ? null : v);
  const fade = s.navSeq === 0 ? "load-in" : undefined;
  const projects = s.collections.filter((c) => c.kind === "project" && !c.archived);
  const lists = s.collections.filter((c) => c.kind === "list" && !c.archived);
  const c = !!collapsed;
  const meName = useMeName();

  return (
    <nav
      className={cn("flex h-full flex-col gap-[18px] overflow-hidden bg-transparent px-2.5 py-3.5", !floating && "px-1")}
      aria-label="Main"
      data-collapsed={c ? "" : undefined}
    >
      <div className={cn("flex shrink-0 items-center justify-between gap-2 px-2 py-1", c && "flex-col gap-2.5 px-0")}>
        <button type="button" onClick={() => s.setView({ type: "home" })} aria-label={t.dash.title} data-sidebar-logo data-carry="view:home" className="flex shrink-0 items-center gap-[9px] rounded-lg">
          <LogoMark className="size-[22px]" />
          {!c && <span className="text-[17px] font-extrabold tracking-[-0.01em]">Nexus</span>}
        </button>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={`${c ? t.shell.expand : t.shell.collapse} (Ctrl+B)`}
            title={`${c ? t.shell.expand : t.shell.collapse} · Ctrl+B`}
            aria-expanded={!c}
            data-sidebar-toggle
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-[7px] border border-transparent text-muted transition-[transform,color,background-color,border-color] duration-[400ms] ease-[var(--ease-out)] hover:border-line hover:bg-surface hover:text-ink",
              c && "rotate-180",
            )}
          >
            <PanelLeftClose className="size-4 rtl:-scale-x-100" strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* R17 P1: the switcher sits 8 px closer to the header than the 18 px gap — the scroll box moves up instead of the
          switcher (a negative margin inside it cut the switcher's top corners and focus ring); pt-1 leaves its ring room. */}
      <div className="-mx-1 -mt-3 flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto overflow-x-hidden px-1 pt-1">
        <div className="-mb-2.5">
          <SpaceSwitcher collapsed={c} />
        </div>
        <div className="flex flex-col gap-px">
          <NavItem collapsed={c} active={active({ type: "home" })} onClick={() => s.setView({ type: "home" })} carry="view:home" icon={<House />} label={t.dash.title} />
          <NavItem collapsed={c} active={active({ type: "to_buy" })} onClick={() => s.setView({ type: "to_buy" })} carry="view:to_buy" icon={<ShoppingCart />} label={t.nav.toBuy} count={n(counts.to_buy)} />
          <NavItem collapsed={c} active={active({ type: "ordered" })} onClick={() => s.setView({ type: "ordered" })} carry="view:ordered" icon={<Truck />} label={t.nav.onTheWay} count={n(counts.ordered)} />
          <NavItem collapsed={c} active={active({ type: "orders" })} onClick={() => s.setView({ type: "orders" })} carry="view:orders" icon={<Store />} label={t.nav.orders} />
          <NavItem collapsed={c} active={active({ type: "history" })} onClick={() => s.setView({ type: "history" })} carry="view:history" icon={<History />} label={t.nav.history} count={n(counts.history)} />
          <NavItem collapsed={c} active={active({ type: "spending" })} onClick={() => s.setView({ type: "spending" })} carry="view:spending" icon={<ChartColumn />} label={t.nav.spending} />
        </div>

        <div className="flex flex-col gap-px">
          <SectionHeader collapsed={c} label={t.nav.projects} onLabel={() => s.setView({ type: "projects" })} carry="editor:project" onAdd={s.readOnly ? undefined : () => s.setEditor({ mode: "create", kind: "project" })} addLabel={t.nav.newProject} />
          {s.loading && !c && <NavRowsSkeleton rows={[58, 42]} />}
          <div className={cn("flex flex-col gap-px", fade)}>
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
                  icon={<span className="size-2 rounded-full" style={{ background: color }} />}
                  label={p.name}
                  // The budget ring only when the project has a budget; otherwise the dot says it all.
                  trailing={b.budget != null ? <Ring value={ratio} size={18} stroke={3.5} color={b.state === "over" ? "var(--danger)" : color} /> : <span />}
                />
              );
            })}
            {!c && !s.loading && !s.readOnly && (
              <button
                type="button"
                onClick={() => s.setEditor({ mode: "create", kind: "project" })}
                className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
              >
                <Plus className="size-[17px] stroke-[1.8]" />
                {t.nav.newProject}
              </button>
            )}
          </div>
        </div>

        {(lists.length > 0 || s.loading) && (
          <div className="flex flex-col gap-px">
            <SectionHeader collapsed={c} label={t.nav.lists} carry="editor:list" onAdd={s.readOnly ? undefined : () => s.setEditor({ mode: "create", kind: "list" })} addLabel={t.nav.newList} />
            {s.loading && !c && <NavRowsSkeleton rows={[46, 62]} round />}
            <div className={cn("flex flex-col gap-px", fade)}>
              {lists.map((l) => (
                <NavItem
                  key={l.id}
                  collapsed={c}
                  active={active({ type: "collection", id: l.id })}
                  onClick={() => s.setView({ type: "collection", id: l.id })}
                  onDropItems={(ids) => move(ids, l.id)}
                  icon={<span className="size-2 rounded-full" style={{ background: COLLECTION_COLORS[l.color] ?? COLLECTION_COLORS.amber }} />}
                  label={l.name}
                  count={s.items.filter((i) => i.collectionId === l.id && i.status === "to_buy").length}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: avatar + name + extension state, under a hairline. */}
      <div className={cn("-mx-0.5 flex shrink-0 items-center gap-2.5 border-t border-line px-2 pt-2.5", c && "justify-center px-0")}>
        <button
          type="button"
          onClick={() => s.setSettingsOpen(true)}
          data-carry="settings"
          title={c ? t.nav.settings : undefined}
          aria-label={c ? t.nav.settings : undefined}
          tabIndex={c ? 0 : -1}
          className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-bg"
        >
          {initialOf(meName, "")}
        </button>
        {!c && (
          <>
            <div className="min-w-0 flex-1 leading-tight">
              <b className="bidi block truncate text-[13px] font-semibold">{meName}</b>
              <span className="bidi block truncate text-[11.5px] text-muted">{s.me?.email}</span>
            </div>
            <button
              type="button"
              onClick={() => s.setSettingsOpen(true)}
              data-carry="settings"
              aria-label={t.nav.settings}
              title={t.nav.settings}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
            >
              <Settings className="size-4" />
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
