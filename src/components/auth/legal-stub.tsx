import { cookies } from "next/headers";
import "./nx.css";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

// R15 A2 stub for /privacy and /terms: the text comes in R16 (Tal approves it first). Public (proxy) so the sign-in
// links work signed out.
export async function LegalStub({ kind }: { kind: "privacy" | "terms" }) {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaries[isLocale(raw) ? raw : "en"].auth.legal;
  return (
    <div className="nx">
      <main className="page">
        <div style={{ height: 44 }} />
        <h1 className="t-title" style={{ marginTop: 20 }}>
          {kind === "privacy" ? t.privacyTitle : t.termsTitle}
        </h1>
        <p className="badge info" style={{ marginTop: 12, alignSelf: "flex-start" }}>
          {t.soon}
        </p>
        <p className="t-body" style={{ marginTop: 12 }}>
          {t.soonBody}
        </p>
        {/* R16 C2: the one part that's already true and needs saying. */}
        {kind === "privacy" && (
          <p className="t-body" style={{ marginTop: 12 }} data-privacy-errors>
            {t.errorLog}
          </p>
        )}
        <a className="link" href="/login" style={{ marginTop: 24 }}>
          {t.back}
        </a>
      </main>
    </div>
  );
}
