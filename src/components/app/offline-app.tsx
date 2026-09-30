"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { loadSnapshot, type Snapshot } from "@/lib/offline";
import { CURRENCIES, type Currency } from "@/lib/money";
import { NexusApp } from "./nexus-app";

/** Renders the owner app read-only from the last snapshot on this device (served by the SW when offline). */
export function OfflineApp() {
  const { t } = useI18n();
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  useEffect(() => {
    loadSnapshot().then(setSnap);
    // Opened while the server is reachable (e.g. from history) → the live app instead.
    if (navigator.onLine)
      fetch("/", { method: "HEAD", cache: "no-store" })
        .then((r) => r.ok && !r.redirected && window.location.replace(`/${window.location.search}`))
        .catch(() => {});
  }, []);

  if (snap === undefined) return <div className="min-h-dvh bg-bg" />;
  if (!snap)
    return (
      <main className="grid min-h-dvh place-items-center px-4" data-offline-banner="none">
        <div className="max-w-sm text-center">
          <WifiOff className="mx-auto size-8 text-faint" />
          <p className="mt-4 text-[15px] text-muted">{t.offline.none}</p>
          <Button variant="outline" className="mt-5" onClick={() => window.location.replace("/")}>
            {t.offline.retry}
          </Button>
        </div>
      </main>
    );
  const view = new URLSearchParams(window.location.search).get("v");
  const currency = ((CURRENCIES as readonly string[]).includes(snap.currency) ? snap.currency : "ILS") as Currency;
  return <NexusApp boot={{ currency, layout: null, sort: null, view, aiEnabled: false }} initial={{ ...snap.data, aiEnabled: false }} offline={{ at: snap.at }} />;
}
