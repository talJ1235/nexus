import { NexusApp } from "@/components/app/nexus-app";
import { getAppData } from "@/lib/data";
import { getCurrencyPref } from "@/lib/server-prefs";

export default async function Home() {
  const [data, currency] = await Promise.all([getAppData(), getCurrencyPref()]);
  return <NexusApp initial={data} currency={currency} />;
}
