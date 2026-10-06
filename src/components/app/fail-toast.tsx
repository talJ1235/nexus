"use client";

import { useCallback } from "react";
import { useI18n } from "@/components/providers";
import { toast } from "@/lib/toast";
import { useStore } from "./store";

export type FailKind = "link" | "picture" | "receipt" | "barcode" | "ai" | "import" | "sync";
export type FailInfo = { code: string; link?: string | null; image?: string | null; message?: string };

/**
 * R16 C1 — a failed user action can be reported in one tap: the error toast gets "Report", which opens the report
 * dialog pre-filled (bug, what failed, diagnostics attached; the link opt-out, the picture opt-in). `report()` alone
 * opens the dialog (for failures shown inline, like the assistant's error bubble or the receipt's failed state).
 */
export function useFailReport() {
  const s = useStore();
  const { t } = useI18n();
  const report = useCallback(
    (kind: FailKind, info: FailInfo) => {
      const what = t.report.fail[kind];
      s.openReport({ type: "bug", title: what, happened: what, failure: { code: `${kind}:${info.code}`.slice(0, 60), what, link: info.link ?? null, image: info.image ?? null } });
    },
    [s, t],
  );
  const fail = useCallback(
    (kind: FailKind, info: FailInfo) => toast.error(info.message ?? t.report.fail[kind], { action: { label: t.report.report, onClick: () => report(kind, info) }, duration: 8000 }),
    [report, t],
  );
  return { fail, report, reportAction: (kind: FailKind, info: FailInfo) => ({ label: t.report.report, onClick: () => report(kind, info) }) };
}
