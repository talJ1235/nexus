"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import { calendarInfo, markCalendarSubscribed, regenerateCalendar, type CalendarInfo } from "@/app/cal-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { googleSubscribeUrl } from "@/lib/ics";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Settings → Calendar (Round 14 C2): subscribe to the app's calendar feed (Google / Apple / Outlook), copy the link,
 * or regenerate it (kills the old URL). Subscribed calendars follow additions, moved dates and deletions.
 */
export function CalendarSection() {
  const { t } = useI18n();
  const [cal, setCal] = useState<CalendarInfo | null>(null);
  useEffect(() => {
    let alive = true;
    calendarInfo()
      .then((c) => alive && setCal(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const subscribe = () => {
    setCal((c) => (c ? { ...c, subscribed: true } : c));
    void markCalendarSubscribed().catch(() => {});
  };
  const btn = "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-ink transition hover:bg-surface-2";
  return (
    <section className="space-y-3 border-t border-line pt-5" data-settings-calendar>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium text-faint">{t.cal.section}</h3>
        {cal?.subscribed && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok" data-cal-subscribed>{t.cal.subscribed}</span>}
      </div>
      <p className="text-xs leading-relaxed text-muted">{t.cal.hint}</p>
      <div className="flex flex-wrap gap-2">
        <a className={cn(btn, !cal && "pointer-events-none opacity-50")} href={cal ? googleSubscribeUrl(cal.webcal) : undefined} target="_blank" rel="noreferrer" onClick={subscribe} data-cal-google>
          <CalendarPlus className="size-4" />
          {t.cal.google}
        </a>
        <a className={cn(btn, !cal && "pointer-events-none opacity-50")} href={cal?.webcal} onClick={subscribe} data-cal-webcal>
          {t.cal.apple}
        </a>
      </div>
      <div className="flex items-center gap-2">
        <input readOnly value={cal?.https ?? ""} aria-label={t.cal.section} className="h-10 min-w-0 flex-1 truncate rounded-xl border border-line bg-surface-2 px-3 text-xs text-muted" data-cal-url onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="outline"
          className="h-10"
          disabled={!cal}
          onClick={async () => {
            if (!cal) return;
            await navigator.clipboard?.writeText(cal.https).catch(() => {});
            toast.success(t.cal.copied);
          }}
          data-cal-copy
        >
          <Copy />
          <span className="max-sm:sr-only">{t.cal.copy}</span>
        </Button>
        <Button
          variant="ghost"
          className="h-10"
          disabled={!cal}
          title={t.cal.regenerate}
          aria-label={t.cal.regenerate}
          onClick={async () => {
            if (!window.confirm(t.cal.regenerateConfirm)) return;
            try {
              setCal(await regenerateCalendar());
              toast.success(t.cal.regenerated);
            } catch {
              toast.error(t.errors.generic);
            }
          }}
          data-cal-regenerate
        >
          <RefreshCw />
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t.cal.note}</p>
    </section>
  );
}
