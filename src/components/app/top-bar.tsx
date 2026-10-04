"use client";

import { useState } from "react";
import { ChevronRight, Search, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { matchCommands } from "@/lib/commands";
import { cn } from "@/lib/utils";
import { AlertsBell } from "./alerts-panel";
import { useStore } from "./store";
import { useCommands } from "./use-commands";

/** Desktop top bar: live item search (Esc → command menu), "Ask Nexus" (Hairline), alerts. */
export function TopBar() {
  const s = useStore();
  const { t } = useI18n();
  const cmds = useCommands();
  const [focus, setFocus] = useState(false);
  // Round 13 C1: the search also finds settings and actions (same list as the command menu), shown under the field.
  const found = s.query.trim().length > 1 ? matchCommands(cmds, s.query).slice(0, 4) : [];
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative min-w-0 flex-1">
      <label className="group flex h-[50px] min-w-0 flex-1 items-center gap-2.5 rounded-full border border-line bg-surface pe-2 ps-[18px] text-muted transition focus-within:border-ink/30 focus-within:shadow-card">
        <Search className="size-[19px] shrink-0" strokeWidth={2} />
        <input
          value={s.query}
          onChange={(e) => {
            // Home has no list to filter: typing goes to To buy, where the items filter as you type.
            if (s.view.type === "home" && e.target.value) s.setView({ type: "to_buy" });
            s.setQuery(e.target.value);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
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
      {focus && found.length > 0 && (
        <div className="absolute inset-x-3 top-[54px] z-30 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-pop" data-search-commands>
          <div className="px-2.5 pb-1 pt-1.5 text-xs text-faint">{t.search.settingsActions}</div>
          {found.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                s.setQuery("");
                c.run();
              }}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-start text-sm hover:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted"
              data-search-cmd={c.id}
            >
              {c.icon}
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => s.setPaletteOpen(true)}
            className="flex h-9 w-full items-center gap-1 rounded-lg px-2.5 text-start text-[12.5px] font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            {t.search.moreCommands}
            <ChevronRight className="size-3.5 rtl:-scale-x-100" />
          </button>
        </div>
      )}
      </div>
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
