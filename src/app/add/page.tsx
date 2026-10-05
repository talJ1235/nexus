// Server actions on this page may fetch store pages and call Gemini.
export const maxDuration = 60;

import { NexusApp } from "@/components/app/nexus-app";
import type { Incoming } from "@/components/app/add-bar";
import { redirect } from "next/navigation";
import { getAppData } from "@/lib/data";
import { aiEnabled } from "@/lib/ai";
import { currentCtx, spaceInfo } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { getCurrencyPref, getUiPrefs } from "@/lib/server-prefs";
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
  const ctx = await currentCtx();
  if (!ctx) redirect("/login");
  const [data, currency, prefs] = await Promise.all([getAppData(scoped(ctx), ctx.user.id, spaceInfo(ctx)), getCurrencyPref(), getUiPrefs()]);
  return (
    <>
      <NexusApp boot={{ currency, ...prefs, view: "to_buy", aiEnabled: aiEnabled() }} initial={data} incoming={incoming} />
    </>
  );
}
