"use client";

import { useI18n } from "@/components/providers";
import { cn } from "@/lib/utils";
import { ItemCardSkeleton } from "./item-card";
import { useStore } from "./store";
import { useTable } from "./view-items";

/** A flat placeholder block; every block shares one slow light sweep (see `.skeleton` in globals.css). */
export function Skel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("skeleton block rounded", className)} style={style} />;
}

/**
 * Content area while the data streams in: the shape of the view being loaded, chosen from the view in the URL (known
 * on the server, so the streamed shell already has it — Round 10 C3): Projects → wide project cards, Order by store →
 * store groups, Stats → the spending page, On the way / History → cards with their status pill, else the item grid.
 */
export function ContentSkeleton() {
  const s = useStore();
  const table = useTable();
  const v = s.view.type;
  if (v === "spending") return <SpendingSkeleton />;
  if (v === "projects") return <ProjectsSkeleton />;
  if (v === "orders") return <OrdersSkeleton />;
  if (table) return <TableSkeleton />;
  return (
    <div className="skeleton-in grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-4" aria-busy="true" data-skeleton="items">
      {Array.from({ length: 8 }, (_, i) => (
        <ItemCardSkeleton key={i} badge={v === "ordered" || v === "history"} />
      ))}
    </div>
  );
}

/** One project card's shape: cover, name + line, ring, bar, footer. `small` = a list card. */
function ProjectCardSkeleton({ small }: { small?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-line bg-surface">
      <Skel className={cn("w-full rounded-none", small ? "h-[64px] sm:h-[76px]" : "h-[84px] sm:h-[104px]")} />
      <div className="flex flex-col gap-2.5 p-4 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <Skel className={cn("rounded-md", small ? "h-4 w-28" : "h-[18px] w-36")} />
            <Skel className="h-3 w-3/4" />
          </div>
          <Skel className={cn("shrink-0 rounded-full", small ? "size-10" : "size-12")} />
        </div>
        <Skel className="mt-1 h-2 w-full rounded-full" />
        <Skel className="h-3 w-24" />
      </div>
    </div>
  );
}

function ProjectsSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-8" aria-busy="true" data-skeleton="projects">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] lg:text-[28px]">{t.projects.title}</h1>
          <Skel className="skeleton-in h-10 w-[84px] rounded-full" />
        </div>
        <div className="skeleton-in flex flex-wrap gap-2">
          {[132, 124, 176].map((w, i) => (
            <Skel key={i} className="h-8 rounded-full" style={{ width: w }} />
          ))}
        </div>
      </header>
      <section className="skeleton-in flex flex-col gap-3.5">
        <Skel className="h-5 w-28 rounded-md" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      </section>
      <section className="skeleton-in flex flex-col gap-3.5">
        <Skel className="h-5 w-20 rounded-md" />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 2 }, (_, i) => (
            <ProjectCardSkeleton key={i} small />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Order by store: a note line, then store groups (logo, name, subtotal, actions) with item rows. */
function OrdersSkeleton() {
  return (
    <div className="skeleton-in space-y-3.5" aria-busy="true" data-skeleton="orders">
      <Skel className="h-3 w-72 max-w-full" />
      {[1, 1, 2].map((rows, g) => (
        <div key={g} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-3">
            <Skel className="size-7 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skel className="h-3.5 w-28" />
              <Skel className="h-2.5 w-12" />
            </div>
            <Skel className="h-5 w-16" />
            <Skel className="h-9 w-9 rounded-full sm:w-[72px]" />
            <Skel className="hidden h-9 w-32 rounded-full sm:block" />
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <Skel className="size-10 rounded-md" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skel className="h-3 w-3/5 max-w-[320px]" />
                <Skel className="h-2.5 w-14" />
              </div>
              <Skel className="h-3.5 w-14" />
              <Skel className="h-9 w-9 rounded-full sm:w-[68px]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A project/list page while loading: its header (cover, name, numbers, ring, actions). The item grid follows. */
export function ProjectHeaderSkeleton() {
  return (
    <div className="skeleton-in mb-4 overflow-hidden rounded-[26px] border border-line bg-surface" aria-hidden data-skeleton="project-header">
      <Skel className="h-[120px] w-full rounded-none sm:h-[160px]" />
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 space-y-2.5 pt-1">
            <Skel className="h-7 w-48 rounded-lg" />
            <Skel className="h-3.5 w-64 max-w-full" />
          </div>
          <Skel className="size-16 shrink-0 rounded-full" />
        </div>
        <div className="flex gap-2">
          {[150, 150, 44, 44].map((w, i) => (
            <Skel key={i} className="h-10 rounded-full" style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="skeleton-in overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" aria-busy="true">
      <div className="flex h-[37px] items-center gap-4 border-b border-line px-3">
        <Skel className="h-2.5 w-16" />
      </div>
      {[64, 48, 72, 56, 40, 60].map((w, i) => (
        <div key={i} className="flex h-[53px] items-center gap-3 border-b border-line px-3 last:border-0">
          <Skel className="size-4" />
          <Skel className="size-10 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skel className="h-3 max-w-[340px]" style={{ width: `${w}%` }} />
            <Skel className="h-2.5 w-16" />
          </div>
          <Skel className="hidden h-3 w-20 sm:block" />
          <Skel className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

function SpendingSkeleton() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t.spending.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.spending.note}</p>
      </div>
      <div className="skeleton-in space-y-4" aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <Skel className="h-3 w-20" />
              <Skel className="mt-2.5 h-7 w-28 rounded-md" />
            </div>
          ))}
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <Skel className="h-3.5 w-32" />
          <Skel className="mt-4 h-44 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Tag chips row placeholder (same height as the real chip row). */
export function TagsSkeleton() {
  return (
    <div className="skeleton-in mt-4 flex gap-1.5 pb-1" aria-hidden>
      {[64, 58, 84, 76, 70].map((w, i) => (
        <Skel key={i} className="h-7 shrink-0 rounded-full" style={{ width: w }} />
      ))}
    </div>
  );
}

/** Sidebar collection rows placeholder (NavItem height). */
export function NavRowsSkeleton({ rows, round }: { rows: number[]; round?: boolean }) {
  return (
    <div className="skeleton-in space-y-0.5" aria-hidden>
      {rows.map((w, i) => (
        <div key={i} className="flex h-[35px] items-center gap-2.5 px-2.5">
          <Skel className={cn("size-2.5", round ? "rounded-full" : "rounded-[3px]")} />
          <Skel className="h-3" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}
