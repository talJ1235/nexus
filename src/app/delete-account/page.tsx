import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@/components/auth/nx.css";
import { APP_NAME } from "@/lib/brand";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { PRIVACY_CONTACT } from "@/lib/i18n/legal";

export const metadata: Metadata = { title: `${APP_NAME} · Delete account` };

// R17 E4 — public: how to delete a Nexus account and what happens (Google Play asks for a web link like this).
// ?done=1 after a request: "your account is hidden; sign in within 7 days to restore it".
export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : "en";
  const t = dictionaries[locale].account;
  const done = (await searchParams).done === "1";
  return (
    <div className="nx" dir={locale === "he" ? "rtl" : "ltr"}>
      <main className="page" style={{ maxWidth: 640, marginInline: "auto", paddingInline: 16, paddingBottom: 40 }} data-delete-account-page>
        <div style={{ height: 40 }} />
        <h1 className="t-title">{t.pageTitle}</h1>
        {done && (
          <p className="alert" role="status" style={{ marginTop: 14 }} data-delete-done>
            {t.doneBody}
          </p>
        )}
        <p className="t-body" style={{ marginTop: 14 }}>
          {t.howTo}
        </p>
        <ul className="t-body" style={{ marginTop: 10, paddingInlineStart: 20, display: "grid", gap: 6 }}>
          {t.what.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="t-body" style={{ marginTop: 14 }}>
          {t.noAccess.replace("{contact}", PRIVACY_CONTACT)}
        </p>
        <p style={{ marginTop: 24, display: "flex", gap: 16 }}>
          <a className="link" href="/privacy">
            {t.privacy}
          </a>
          <a className="link" href="/login">
            {t.signIn}
          </a>
        </p>
      </main>
    </div>
  );
}
