"use client";

import { startTransition, useState } from "react";
import { useI18n } from "@/components/providers";
import { cn } from "@/lib/utils";

/**
 * R18 S3 A2: a segmented control whose thumb slides between options (the Products switch's look, `.shop-thumb`). The
 * thumb moves on the tap itself (a compositor transition); the new segment renders in a transition after it, so a slow
 * pane never holds the thumb back. RTL slides the other way. Tabs, not radios: each option shows its own pane.
 */
export function SegPill<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  data,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; count?: number }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  /** data-* hooks for tests: the root gets `data-<root>={value}`, each option `data-<tab>={option}`. */
  data?: { root: string; tab: string };
}) {
  const { dir } = useI18n();
  const [pending, setPending] = useState<T | null>(null);
  if (pending != null && pending === value) setPending(null);
  const on = pending ?? value;
  const k = Math.max(0, options.findIndex((o) => o.value === on));
  const n = options.length;
  return (
    <div
      className={cn("relative grid rounded-[14px] border border-card-line bg-surface-2 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      role="tablist"
      aria-label={label}
      {...(data ? { [`data-${data.root}`]: on } : {})}
    >
      <span
        aria-hidden
        className="shop-thumb absolute bottom-1 start-1 top-1 rounded-[11px] border border-card-line bg-surface shadow-[0_2px_10px_rgb(0_0_0/0.08)]"
        style={{ width: `calc((100% - 8px) / ${n})`, transform: `translateX(${dir === "rtl" ? -k * 100 : k * 100}%)` }}
        data-seg-thumb
      />
      {options.map((o) => {
        const active = o.value === on;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (active) return;
              setPending(o.value);
              requestAnimationFrame(() => startTransition(() => onChange(o.value)));
            }}
            className={cn("relative z-[1] flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-[11px] px-1.5 text-[13.5px] font-bold transition-colors duration-300 active:opacity-70", active ? "text-ink" : "text-muted")}
            {...(data ? { [`data-${data.tab}`]: o.value } : {})}
          >
            <span className="truncate">{o.label}</span>
            {!!o.count && <small className={cn("tabular shrink-0 text-[11.5px] font-semibold", active ? "text-muted" : "text-faint")}>{o.count}</small>}
          </button>
        );
      })}
    </div>
  );
}
