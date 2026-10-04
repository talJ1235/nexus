"use client";

import { Search, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { cn } from "@/lib/utils";
import { AlertsBell } from "./alerts-panel";
import { useStore } from "./store";

/** Desktop top bar: live item search (Esc → command menu), "Ask Nexus" (Hairline), alerts. */
export function TopBar() {
  const s = useStore();
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      <label className="group flex h-[50px] min-w-0 flex-1 items-center gap-2.5 rounded-full border border-line bg-surface pe-2 ps-[18px] text-muted transition focus-within:border-ink/30 focus-within:shadow-card">
        <Search className="size-[19px] shrink-0" strokeWidth={2} />
        <input
          value={s.query}
          onChange={(e) => s.setQuery(e.target.value)}
          placeholder={t.shell.searchPlaceholder}
          aria-label={t.view.search}
          data-search-input
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
        />
        {s.query ? (
          <button type="button" onClick={() => s.setQuery("")} className="grid size-8 place-items-center rounded-full hover:bg-surface-2 hover:text-ink" aria-label={t.view.clear}>
            <X className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => s.setPaletteOpen(true)}
            data-carry="palette"
            className="shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted transition hover:text-ink"
          >
            {t.shell.searchHint}
          </button>
        )}
      </label>
      {s.aiEnabled && <AskButton />}
      <AlertsBell />
    </div>
  );
}

/**
 * "Ask Nexus", Hairline variant. `iconOnly` on phones. Always a fully rounded pill (circle when icon-only) — Tal's
 * call (Round 12 #4); the radius is part of `.ask-hairline`. Any new entry point (empty states etc.) uses this button.
 */
export function AskButton({ iconOnly, className }: { iconOnly?: boolean; className?: string }) {
  const s = useStore();
  const { t } = useI18n();
  return (
    <button
      type="button"
      disabled={s.offlineAt != null}
      onClick={() => s.setPanel("assistant")}
      aria-label={t.ai.title}
      title={t.ai.openAssistant}
      data-carry="panel:assistant"
      data-ask
      className={cn(
        "ask-hairline inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-[14px] font-bold transition active:scale-[0.97] disabled:opacity-50",
        iconOnly ? "size-[46px]" : "h-[50px] pe-5 ps-4",
        className,
      )}
    >
      <Sparkles className="size-[19px]" strokeWidth={2} />
      {!iconOnly && t.shell.ask}
    </button>
  );
}
