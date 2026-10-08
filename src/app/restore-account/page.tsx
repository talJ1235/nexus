import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import "@/components/auth/nx.css";
import { restoreMyAccount } from "@/app/account-actions";
import { APP_NAME } from "@/lib/brand";
import { currentCtx } from "@/lib/ctx";
import { ACCOUNT_UNDO_MS, deletionRequestedAt } from "@/lib/db-scoped/account";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = { title: APP_NAME, robots: { index: false, follow: false } };

// R17 E4: signed in again within 7 days of "Delete account" → restore it, or sign out (it's deleted on the day shown).
export default async function RestoreAccountPage() {
  const ctx = await currentCtx();
  if (!ctx) redirect("/login");
  const at = await deletionRequestedAt(ctx.user.id);
  if (at == null) redirect("/");
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : "en";
  const t = dictionaries[locale].account;
  const day = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "long" }).format(at + ACCOUNT_UNDO_MS);
  async function restore() {
    "use server";
    await restoreMyAccount();
    redirect("/");
  }
  return (
    <div className="nx" dir={locale === "he" ? "rtl" : "ltr"}>
      <main className="page" style={{ maxWidth: 520, marginInline: "auto", paddingInline: 16 }} data-restore-account>
        <div style={{ height: 48 }} />
        <h1 className="t-title">{t.restoreTitle}</h1>
        <p className="t-body" style={{ marginTop: 12 }}>
          {t.restoreBody.replace("{date}", day)}
        </p>
        <form action={restore} style={{ marginTop: 20 }}>
          <button type="submit" className="btn lg pri block" data-restore-yes>
            {t.restoreYes}
          </button>
        </form>
        <form action="/api/logout" method="post" style={{ marginTop: 10 }}>
          <button type="submit" className="btn lg block" data-restore-no>
            {t.restoreNo}
          </button>
        </form>
      </main>
    </div>
  );
}
