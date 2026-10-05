import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { BrandArt } from "@/components/auth/brand-art";
import { InviteOnly } from "@/components/auth/invite-only";
import { LangSwitch, LegalLine, LoginForm, type LoginError } from "@/components/auth/login-form";
import "@/components/auth/nx.css";
import { ClearOffline } from "@/components/clear-offline";
import { authMode, fallbackEnabled, safeNext, testIdpEnabled } from "@/lib/auth/config";
import { LAST_ACCOUNT_COOKIE, readLastAccount } from "@/lib/auth/device";
import { pendingSignupEmail } from "@/lib/auth/invites";
import { requestHost } from "@/lib/auth/server";
import { getSessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/brand";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = { title: `Sign in · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 A2 — mockups SignIn-desktop / SignIn-phone / SignIn-he; InviteOnly-phone for refused sign-ups (A3).
// Error codes arrive from the Google callback (Better Auth errorCallbackURL) or from the admin fallback route.
const ERRORS: Record<string, LoginError> = {
  access_denied: "cancelled",
  email_not_verified: "unverified",
  account_not_linked: "noAccess",
  "account not linked": "noAccess",
  admin_must_link: "noAccess",
  invite_expired: "expired",
  invite_used_up: "usedUp",
  invite_revoked: "revoked",
  limit: "limit",
  off: "fallbackOff",
  "1": "password",
};

type SP = { error?: string; error_description?: string; next?: string; admin?: string; reauth?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const h = await headers();
  const next = safeNext(sp.next);
  // Signed in already → straight on, unless this is a step-up ("Confirm it's you": sign in again for a sensitive change).
  if (!sp.error && sp.reauth !== "1" && (await getSessionUser(h))) redirect(next);
  const jar = await cookies();
  const raw = jar.get(LOCALE_COOKIE)?.value;
  const t = dictionaries[isLocale(raw) ? raw : "en"];
  const mode = authMode(requestHost(h));
  const fallback = fallbackEnabled(mode);

  // No invite for this Google account → InviteOnly (code / waitlist / switch account).
  if (sp.error === "invite_required" || sp.error?.startsWith("invite_")) {
    const ref = sp.error_description ?? null;
    const email = await pendingSignupEmail(ref);
    return (
      <div className="nx">
        <ClearOffline />
        <InviteOnly email={email} pendingRef={email ? ref : null} error={sp.error === "invite_required" ? null : (ERRORS[sp.error] ?? "badCode")} app={APP_NAME} next={next} provider={testIdpEnabled() ? "test-idp" : "google"} turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? null} />
      </div>
    );
  }

  const error = sp.error ? (ERRORS[sp.error] ?? "generic") : null;
  const returning = readLastAccount(jar.get(LAST_ACCOUNT_COOKIE)?.value);
  const admin = sp.admin === "1" && fallback;

  return (
    <div className="nx">
      <ClearOffline />
      <div className="auth-shell">
        <BrandArt />
        <section className="auth-side">
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <LangSwitch />
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 0" }}>
            {admin ? (
              <form action="/api/login" method="post" className="auth-col fade" data-auth="admin">
                <h1 className="t-title">{t.auth.admin.title}</h1>
                {error && (
                  <div className="alert dng" role="alert">
                    <span>{t.auth.errors[error]}</span>
                  </div>
                )}
                <div className="field">
                  <label className="label" htmlFor="password">
                    {t.auth.admin.password}
                  </label>
                  <div className="input">
                    <input id="password" name="password" type="password" required autoFocus autoComplete="current-password" />
                  </div>
                </div>
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="btn lg pri block">
                  {t.auth.admin.submit}
                </button>
                <a className="sub link" href="/login" style={{ textAlign: "center" }}>
                  {t.auth.admin.back}
                </a>
              </form>
            ) : (
              <LoginForm full={mode === "full"} next={next} error={error} returning={returning} app={APP_NAME} testIdp={testIdpEnabled()} />
            )}
          </div>
          <LegalLine />
        </section>
      </div>
    </div>
  );
}
