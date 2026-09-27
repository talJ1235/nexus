// Server actions on this page may fetch store pages and call Gemini.
export const maxDuration = 60;

import { NexusApp } from "@/components/app/nexus-app";
import { getAppData } from "@/lib/data";
import { getCurrencyPref } from "@/lib/server-prefs";
import { extensionToken } from "@/lib/ext-token";

export default async function Home() {
  const [data, currency, token] = await Promise.all([getAppData(), getCurrencyPref(), extensionToken()]);
  return (
    <>
      {/* Read by the Nexus Clipper extension to pair itself with this site. */}
      <meta name="nexus-ext-token" content={token} />
      <NexusApp initial={data} currency={currency} />
    </>
  );
}
