"use client";

import { toast } from "@/lib/toast";
import { useI18n } from "@/components/providers";
import { cn } from "@/lib/utils";
import { setAiSuggestions } from "@/app/home-actions";
import { useStore } from "./store";
import type { Palette } from "@/lib/palette";

// Shared settings controls (R16: the Settings screen itself is components/app/settings/shell.tsx).

/** Two dots (brand + spark) of a palette, whichever palette is active (colours in globals.css). */
export function PaletteSwatch({ palette }: { palette: Palette }) {
  return (
    <span className="palette-swatch inline-flex -space-x-1 rtl:space-x-reverse" data-swatch={palette} aria-hidden>
      <i className="size-2.5 rounded-full bg-[var(--sw-a)] ring-1 ring-surface" />
      <i className="size-2.5 rounded-full bg-[var(--sw-b)] ring-1 ring-surface" />
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  /** "touch": the phone search's inline controls (≥ 40 px targets). */
  size?: "md" | "sm" | "touch";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid rounded-full border border-line bg-surface-2 p-0.5", size === "sm" ? "text-xs" : "text-[13px]")}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition [&_svg]:size-3.5",
            size === "sm" ? "h-7 min-w-8 px-2" : size === "touch" ? "h-9 min-w-10 px-2.5 [&_svg]:size-4" : "h-8",
            value === o.value ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AiSuggestionsSwitch({ className }: { className?: string }) {
  const s = useStore();
  const { t } = useI18n();
  const on = s.homePrefs.aiSuggestions;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t.dash.aiSetting}
      disabled={s.offlineAt != null}
      onClick={() => {
        const before = s.homePrefs;
        s.setHomePrefs({ ...before, aiSuggestions: !on });
        setAiSuggestions(!on).catch(() => {
          s.setHomePrefs(before);
          toast.error(t.errors.generic);
        });
      }}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50", on ? "bg-brand" : "bg-line-strong", className)}
      data-ai-suggestions-switch
    >
      <span className={cn("absolute top-0.5 size-6 rounded-full bg-surface shadow transition-[inset-inline-start]", on ? "start-[22px]" : "start-0.5")} />
    </button>
  );
}
