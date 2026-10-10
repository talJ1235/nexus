"use client";

import { Component, type ReactNode, useEffect, useState } from "react";
import { createReport } from "@/app/report-actions";
import { Button } from "@/components/ui/button";
import { flushReports, recordClientError } from "@/lib/client-errors";
import { collectDiag } from "@/lib/client-diag";
import { dictionaries, fmt, isLocale } from "@/lib/i18n";

// R17 S5 S1 — what a crashed page shows instead of a blank screen (app/error.tsx, app/global-error.tsx and the admin
// panel's own boundary): "Something went wrong · Reload · Report". The error goes to the error log on its own (once);
// Report also files a problem report with the diagnostics. Reads the locale from <html lang> so it works outside the
// providers too (global-error replaces the root layout).

export function Crash({ error, where, onRetry, inline }: { error: Error & { digest?: string }; where: string; onRetry?: () => void; inline?: boolean }) {
  const lang = typeof document === "undefined" ? "en" : document.documentElement.lang;
  const locale = isLocale(lang) ? lang : "en";
  const t = dictionaries[locale].crash;
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const message = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`.slice(0, 280);
  const page = typeof window === "undefined" ? where : window.location.pathname;

  useEffect(() => {
    recordClientError("error", message, `boundary:${where} ${page}${error?.digest ? ` digest ${error.digest}` : ""}`);
    flushReports(false);
  }, [message, where, page, error?.digest]);

  const report = async () => {
    setState("sending");
    try {
      await createReport({ type: "bug", happened: fmt(t.happened, { where: page, message }), diag: collectDiag(page, locale, null) });
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <div role="alert" data-crash={where} className={`grid place-items-center px-6 py-10 text-fg ${inline ? "min-h-[60dvh]" : "min-h-dvh bg-bg"}`} style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))" }}>
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-sunken text-muted" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01" />
          </svg>
        </span>
        <h1 className="text-lg font-semibold">{t.title}</h1>
        <p className="text-sm text-muted">{t.body}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button variant="primary" className="min-h-11 bg-fg text-bg hover:bg-fg hover:opacity-90" onClick={() => (onRetry ? onRetry() : window.location.reload())} data-crash-reload>
            {t.reload}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={state === "sending" || state === "sent"} onClick={report} data-crash-report>
            {state === "sending" ? t.sending : t.report}
          </Button>
        </div>
        <p className="min-h-5 text-xs text-muted" aria-live="polite">
          {state === "sent" ? t.sent : state === "failed" ? t.failed : ""}
        </p>
      </div>
    </div>
  );
}

/** A boundary for one part of a page (the admin panel's tab body): the rest of the page stays. */
export class CrashBoundary extends Component<{ where: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <Crash error={this.state.error} where={this.props.where} inline onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
