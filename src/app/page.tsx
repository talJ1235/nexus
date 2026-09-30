// Server actions on this page may fetch store pages and call Gemini.
export const maxDuration = 60;

import { Suspense } from "react";
import { NexusApp, type AppBoot } from "@/components/app/nexus-app";
import { aiEnabled } from "@/lib/ai";
import { getAppData } from "@/lib/data";
import { getCurrencyPref, getUiPrefs } from "@/lib/server-prefs";
import { extensionToken } from "@/lib/ext-token";

/**
 * The shell streams at once (same component, empty store, skeleton content); the data-dependent app replaces it
 * in the same response when `getAppData` resolves — no blank page and no whole-page loading swap.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const [{ v }, currency, prefs, token] = await Promise.all([searchParams, getCurrencyPref(), getUiPrefs(), extensionToken()]);
  const boot: AppBoot = { currency, ...prefs, view: typeof v === "string" ? v : null, aiEnabled: aiEnabled() };
  return (
    <>
      {/* Read by the Nexus Clipper extension to pair itself with this site. */}
      <meta name="nexus-ext-token" content={token} />
      <Suspense fallback={<NexusApp boot={boot} />}>
        <LoadedApp boot={boot} />
      </Suspense>
    </>
  );
}

async function LoadedApp({ boot }: { boot: AppBoot }) {
  // Local load traces only (scripts/smoke.mjs): simulate a slow database. Unset in production.
  const delay = Number(process.env.NEXUS_TRACE_DELAY_MS) || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  return <NexusApp boot={boot} initial={await getAppData()} />;
}
