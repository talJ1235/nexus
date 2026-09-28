"use client";

import { AlertTriangle, Link2, RotateCw, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { PendingAdd } from "./store";
import { useStore } from "./store";

/** Placeholder card for a pasted link that is still being read — appears instantly, then gives way to the real card. */
export function PendingCard({ p }: { p: PendingAdd }) {
  const s = useStore();
  const { t } = useI18n();
  const failed = p.state === "failed";
  return (
    <article
      aria-live="polite"
      aria-busy={!failed}
      className={cn(
        "relative flex animate-pop-in flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface",
        failed ? "border-danger/40" : "border-accent/45 shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]",
      )}
    >
      <div className={cn("relative grid aspect-[5/4] w-full place-items-center", failed ? "bg-danger-soft" : "shimmer bg-accent-soft/60")}>
        {failed ? (
          <AlertTriangle className="size-8 text-danger" strokeWidth={1.6} />
        ) : (
          <span className="grid size-12 place-items-center rounded-2xl bg-surface/80 text-accent-ink shadow-card">
            <Link2 className="size-5" />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5 pt-3">
        {failed ? (
          <>
            <p className="text-[14.5px] font-medium leading-snug text-fg">{t.add.couldNotRead}</p>
            <p className="truncate text-[12px] text-muted" dir="ltr">
              {p.url ?? p.label}
            </p>
            <div className="mt-auto flex gap-1.5 pt-1">
              {p.retry && (
                <button type="button" onClick={p.retry} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-[13px] font-medium text-bg transition hover:opacity-90">
                  <RotateCw className="size-3.5" />
                  {t.add.retry}
                </button>
              )}
              <button type="button" onClick={() => s.dropPending(p.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted transition hover:bg-sunken hover:text-fg">
                <X className="size-3.5" />
                {t.add.dismiss}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[12px] font-medium text-accent-ink">
              <Spinner className="size-3.5" />
              <span className="min-w-0 truncate">{t.add.fetching}</span>
            </div>
            <p className="truncate text-[12px] text-faint" dir="ltr">
              {p.label}
            </p>
            <div className="shimmer mt-1 h-3.5 w-full rounded bg-line/80" />
            <div className="shimmer h-3.5 w-2/3 rounded bg-line/80" />
            <div className="shimmer mt-auto h-6 w-20 rounded-md bg-line/80" />
          </>
        )}
      </div>
    </article>
  );
}

/** Table version of the placeholder. */
export function PendingRow({ p, cols }: { p: PendingAdd; cols: number }) {
  const s = useStore();
  const { t } = useI18n();
  const failed = p.state === "failed";
  return (
    <tr className={cn("animate-pop-in border-b border-line", failed ? "bg-danger-soft/50" : "bg-accent-soft/40")} aria-live="polite">
      <td />
      <td className="py-1.5">
        <div className={cn("grid size-10 place-items-center rounded-md", failed ? "bg-danger-soft text-danger" : "shimmer bg-sunken text-accent-ink")}>
          {failed ? <AlertTriangle className="size-4" /> : <Spinner className="size-4" />}
        </div>
      </td>
      <td colSpan={cols - 2} className="py-2 ps-2">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <div className={cn("text-sm font-medium", failed ? "text-danger" : "text-accent-ink")}>{failed ? t.add.couldNotRead : t.add.fetching}</div>
            <div className="truncate text-xs text-faint" dir="ltr">
              {failed ? (p.url ?? p.label) : p.label}
            </div>
          </div>
          {!failed && <div className="shimmer hidden h-3 flex-1 rounded bg-sunken sm:block" />}
          {failed && (
            <div className="ms-auto flex gap-1 pe-3">
              {p.retry && (
                <button type="button" onClick={p.retry} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-[13px] font-medium text-bg hover:opacity-90">
                  <RotateCw className="size-3.5" />
                  {t.add.retry}
                </button>
              )}
              <button type="button" onClick={() => s.dropPending(p.id)} aria-label={t.add.dismiss} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
