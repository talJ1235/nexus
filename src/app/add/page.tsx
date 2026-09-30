// Server actions on this page may fetch store pages and call Gemini.
export const maxDuration = 60;

import { NexusApp } from "@/components/app/nexus-app";
import type { Incoming } from "@/components/app/add-bar";
import { getAppData } from "@/lib/data";
import { aiEnabled } from "@/lib/ai";
import { getCurrencyPref, getUiPrefs } from "@/lib/server-prefs";
import { extensionToken } from "@/lib/ext-token";
import { extractUrls } from "@/lib/utils";

export default async function AddPage({ searchParams }: { searchParams: Promise<{ d?: string; url?: string }> }) {
  const { d, url } = await searchParams;
  let incoming: Incoming = null;
  if (d) {
    try {
      incoming = { payload: JSON.parse(d) };
    } catch {
      incoming = null;
    }
  } else if (url) {
    const u = extractUrls(url)[0];
    if (u) incoming = { url: u };
  }
  const [data, currency, prefs, token] = await Promise.all([getAppData(), getCurrencyPref(), getUiPrefs(), extensionToken()]);
  return (
    <>
      <meta name="nexus-ext-token" content={token} />
      <NexusApp boot={{ currency, ...prefs, view: null, aiEnabled: aiEnabled() }} initial={data} incoming={incoming} />
    </>
  );
}
