import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GuestApp } from "@/components/guest/guest-app";
import { LogoMark } from "@/components/logo";
import { getGuest, getGuestData } from "@/lib/guest";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { getCurrencyPref } from "@/lib/server-prefs";

export const metadata: Metadata = { title: "Nexus · Shared", robots: { index: false, follow: false } };

export default async function GuestPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const guest = await getGuest();
  if (!guest) {
    const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
    const t = dictionaries[isLocale(raw) ? raw : "en"];
    return (
      <main className="grid min-h-dvh place-items-center px-4 text-center">
        <div>
          <LogoMark className="mx-auto size-10" />
          <p className="mt-4 text-muted">{t.share.accessEnded}</p>
        </div>
      </main>
    );
  }
  const [data, currency] = await Promise.all([getGuestData(guest), getCurrencyPref()]);
  return <GuestApp data={data} initialCollection={c ?? null} initialCurrency={currency} />;
}
