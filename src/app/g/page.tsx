import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LogoMark } from "@/components/logo";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = { title: "Nexus · Shared", robots: { index: false, follow: false } };

// R15 D1: the guest app is retired — shared access now needs an account (the full notice screen comes in Part D).
export default async function GuestPage() {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaries[isLocale(raw) ? raw : "en"];
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <LogoMark className="mx-auto size-10" />
        <p className="mt-4 text-muted">{t.share.accessEnded}</p>
        <a href="/login" className="mt-6 inline-block text-sm font-medium text-accent underline-offset-4 hover:underline">
          {t.login.submit}
        </a>
      </div>
    </main>
  );
}
