// Server actions on this page may fetch store pages and call Gemini.
export const maxDuration = 60;

import { Suspense } from "react";
import { cookies } from "next/headers";
import { after } from "next/server";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { rememberOwner } from "@/lib/tracker";
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
  // The weekly Telegram summary is written in the owner's language and currency (the cron has no cookies).
  const locale = (await cookies()).get(LOCALE_COOKIE)?.value === "he" ? "he" : "en";
  after(() => rememberOwner(locale, currency).catch(() => {}));
  return (
    <>
      {/* Read by the Nexus Clipper extension to pair itself with this site. */}
      <meta name="nexus-ext-token" content={token} />
      {/* The loading shell below is static HTML until the data streams in: remember its last [data-carry] click
          (shown as pressed) for the store to replay once the app is ready (store.tsx). */}
      <script dangerouslySetInnerHTML={{ __html: CARRY_SCRIPT }} />
      <Suspense fallback={<NexusApp boot={boot} />}>
        <LoadedApp boot={boot} />
      </Suspense>
    </>
  );
}

const CARRY_SCRIPT = `document.addEventListener("click",function(e){var el=e.target.closest&&e.target.closest("[data-carry]");var shell=el&&el.closest("[data-app-shell]");if(!shell||shell.hasAttribute("data-ready"))return;e.preventDefault();var p=document.querySelector("[data-carry-armed]");if(p)p.removeAttribute("data-carry-armed");el.setAttribute("data-carry-armed","");window.__nexusCarry=el.getAttribute("data-carry")},true)`;

async function LoadedApp({ boot }: { boot: AppBoot }) {
  // Local load traces only (scripts/smoke.mjs): simulate a slow database. Unset in production.
  const delay = Number(process.env.NEXUS_TRACE_DELAY_MS) || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  return <NexusApp boot={boot} initial={await getAppData()} />;
}
