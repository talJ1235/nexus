import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { InvitesAdmin } from "@/components/auth/invites-admin";
import { SettingsPage } from "@/components/auth/settings-page";
import { APP_NAME } from "@/lib/brand";
import { currentCtx, isAdmin } from "@/lib/ctx";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = { title: `Invite codes · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 A3: admin only (ADMIN_EMAIL's user); anyone else gets a 404.
export default async function Page() {
  const ctx = await currentCtx();
  if (!ctx || !isAdmin(ctx)) notFound();
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  return (
    <SettingsPage title={dictionaries[isLocale(raw) ? raw : "en"].invites.title}>
      <InvitesAdmin />
    </SettingsPage>
  );
}
