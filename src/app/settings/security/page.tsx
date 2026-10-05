import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SecurityPanel } from "@/components/auth/security-panel";
import { SettingsPage } from "@/components/auth/settings-page";
import { APP_NAME } from "@/lib/brand";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = { title: `Security · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 A5 (behind the session proxy; every action re-checks the session).
export default async function Page() {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  return (
    <SettingsPage title={dictionaries[isLocale(raw) ? raw : "en"].security.title}>
      <SecurityPanel />
    </SettingsPage>
  );
}
