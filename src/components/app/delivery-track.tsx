"use client";

import { useI18n } from "@/components/providers";
import type { Track } from "@/lib/home";
import { cn } from "@/lib/utils";

const TONE = { info: "bg-info", warn: "bg-warn", ok: "bg-ok", faint: "bg-line-strong" } as const;

/**
 * The one delivery track (Round 13 B4): Ordered · Shipped · In country · Delivered, filled by `deliveryTrack()` in
 * lib/home (time-based; late = all four in the warn colour; no eta = one segment). Used on Home, in the On the way
 * list and cards, and in the item sheet. `labels` adds the tiny stage names under the segments.
 */
export function DeliveryTrack({ track, labels, className }: { track: Track; labels?: boolean; className?: string }) {
  const { t } = useI18n();
  const names = [t.dash.stages.ordered, t.dash.stages.shipped, t.dash.stages.country, t.dash.stages.delivered];
  return (
    <div className={cn("min-w-0", className)} data-track={track.filled} data-track-tone={track.tone}>
      <div className="grid grid-cols-4 gap-[3px]" role="img" aria-label={track.noDate ? t.dash.noDate : names[Math.max(0, track.filled - 1)]}>
        {names.map((n, k) => (
          <i key={n} className={cn("block h-1 rounded-full", k < track.filled ? TONE[track.tone] : "bg-surface-2")} />
        ))}
      </div>
      {labels && (
        <div className="mt-1 grid grid-cols-4 gap-[3px] text-[9.5px] leading-tight text-muted" aria-hidden>
          {names.map((n, k) => (
            <span key={n} className={cn("truncate", k < track.filled && "font-semibold text-ink")}>
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
