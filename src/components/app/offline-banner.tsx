"use client";

import { Eye, WifiOff } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useDataStore, useStore } from "./store";

/** Offline (read-only v1) or the viewer role (R15 C1): editing controls check this and show why they're off. */
export function useReadOnly() {
  const s = useDataStore();
  const { t } = useI18n();
  return { ro: s.readOnly, title: s.offlineAt != null ? t.offline.readOnly : s.readOnly ? t.spaces.viewOnly : undefined };
}

export function OfflineBanner() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  // R15 C1 (LiveList-phone, viewer state): one calm line that this space is view-only.
  if (s.offlineAt == null && s.space?.role === "viewer")
    return (
      <div role="status" data-viewer-banner className="border-b border-line bg-sunken px-4 py-2 text-center text-[13px] text-muted lg:rounded-full lg:border">
        <span className="inline-flex items-center gap-2">
          <Eye className="size-4 shrink-0" />
          {t.spaces.viewBanner}
        </span>
      </div>
    );
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
