import { cookies } from "next/headers";
import Link from "next/link";
import "./nx.css";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { legal, LEGAL_UPDATED } from "@/lib/i18n/legal";

// R17 E3 — /privacy and /terms (en + he, the text in lib/i18n/legal.ts). Public (proxy) so the sign-in links work signed
// out; the same page from the login footer, Settings → Account and About. Not legal advice (docs/ROUND17.md Open).
export async function LegalStub({ kind }: { kind: "privacy" | "terms" }) {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : "en";
  const doc = legal[locale][kind];
  return (
    <div className="nx" dir={locale === "he" ? "rtl" : "ltr"} lang={locale}>
      <main className="page" style={{ maxWidth: 720, marginInline: "auto", paddingInline: 16, paddingBottom: 48 }} data-legal={kind}>
        <div style={{ height: 32 }} />
        <h1 className="t-title" style={{ marginTop: 20 }}>
          {doc.title}
        </h1>
        <p className="sub" style={{ marginTop: 6 }}>
          {doc.updated}: {LEGAL_UPDATED}
        </p>
        <p className="t-body" style={{ marginTop: 16 }}>
          {doc.intro}
        </p>
        {doc.sections.map((s) => (
          <section key={s.h} style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{s.h}</h2>
            {s.p.map((p, k) => (
              <p key={k} className="t-body" style={{ marginTop: k ? 8 : 0, overflowWrap: "anywhere" }}>
                {p}
              </p>
            ))}
          </section>
        ))}
        <p style={{ marginTop: 28, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <a className="link" href={kind === "privacy" ? "/terms" : "/privacy"}>
            {legal[locale][kind === "privacy" ? "terms" : "privacy"].title}
          </a>
          <Link className="link" href="/">
            {doc.back}
          </Link>
        </p>
      </main>
    </div>
  );
}
