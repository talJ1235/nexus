"use client";

import { WifiOff } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useStore } from "./store";

/** Offline (read-only v1): editing controls check this and show why they're disabled. */
export function useReadOnly() {
  const s = useStore();
  const { t } = useI18n();
  const ro = s.offlineAt != null;
  return { ro, title: ro ? t.offline.readOnly : undefined };
}

export function OfflineBanner() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  if (s.offlineAt == null) return null;
  const time = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(s.offlineAt);
  return (
    <div role="status" data-offline-banner={s.offlineShell ? "snapshot" : "lost"} className="border-b border-line bg-sunken px-4 py-2 text-center text-[13px] text-muted lg:rounded-full lg:border">
      <span className="inline-flex items-center gap-2">
        <WifiOff className="size-4 shrink-0" />
        {f(t.offline.banner, { time })}
      </span>
    </div>
  );
}
