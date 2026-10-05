import Link from "next/link";
import { cookies } from "next/headers";
import "./nx.css";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** A full-page settings section (R15): phone = full screen with a back bar; desktop = a centred column. Part C moves
 *  these panels into the regrouped Settings dialog ("You" → Security; Admin → Invite codes). */
export async function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaries[isLocale(raw) ? raw : "en"];
  return (
    <div className="nx">
      <div className="settings-page">
        <div className="settings-bar">
          <Link className="btn icon ghost" href="/?panel=settings" aria-label={t.auth.recover.back}>
            <svg className="i flip" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <b style={{ fontSize: 16 }}>{title}</b>
        </div>
        <main className="settings-body">{children}</main>
      </div>
    </div>
  );
}
