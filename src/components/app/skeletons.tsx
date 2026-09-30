"use client";

import { useI18n } from "@/components/providers";
import { cn } from "@/lib/utils";
import { ItemCardSkeleton } from "./item-card";
import { useStore } from "./store";

/** A flat placeholder block; every block shares one slow light sweep (see `.skeleton` in globals.css). */
export function Skel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("skeleton block rounded", className)} style={style} />;
}

/** Content area while the data streams in: same geometry as the real grid / table / spending page. */
export function ContentSkeleton() {
  const s = useStore();
  if (s.view.type === "spending") return <SpendingSkeleton />;
  if (s.layout === "table" && s.view.type !== "orders") return <TableSkeleton />;
  return (
    <div className="skeleton-in grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-4" aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => (
        <ItemCardSkeleton key={i} />
      ))}
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
