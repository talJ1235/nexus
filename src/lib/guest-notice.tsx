import { cookies } from "next/headers";
import "@/components/auth/nx.css";
import { GuestNotice } from "@/components/auth/guest-notice";
import { sha256 } from "@/lib/auth/crypto";
import { APP_NAME } from "@/lib/brand";
import { legacyShareOwnerName } from "@/lib/db-scoped/system";
import { dictionaries, fmt, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** The page body for every retired guest URL (R15 D1). `token` = an old /i/<token> link, if any. */
export async function GuestNoticePage({ token }: { token?: string }) {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaries[isLocale(raw) ? raw : "en"];
  const ok = token && /^[\w-]{10,100}$/.test(token);
  const owner = await legacyShareOwnerName(process.env.ADMIN_EMAIL ?? null).catch(() => null);
  return (
    <div className="nx">
      <GuestNotice app={APP_NAME} title={t.guest.title} body={owner ? fmt(t.guest.body, { name: owner }) : t.guest.bodyAnon} login={t.guest.login} />
    </div>
  );
}
