// Server actions on this page may fetch store pages and call Gemini.
export const maxDuration = 60;

import { NexusApp } from "@/components/app/nexus-app";
import type { Incoming } from "@/components/app/add-bar";
import { getAppData } from "@/lib/data";
import { getCurrencyPref } from "@/lib/server-prefs";
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
  const [data, currency] = await Promise.all([getAppData(), getCurrencyPref()]);
  return <NexusApp initial={data} currency={currency} incoming={incoming} />;
}
