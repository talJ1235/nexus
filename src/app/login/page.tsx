import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { BrandArt } from "@/components/auth/brand-art";
import { InviteOnly } from "@/components/auth/invite-only";
import { LangSwitch, LegalLine, LoginForm, type LoginError } from "@/components/auth/login-form";
import "@/components/auth/nx.css";
import { ClearOffline } from "@/components/clear-offline";
import { authMode, safeNext, testIdpEnabled } from "@/lib/auth/config";
import { LAST_ACCOUNT_COOKIE, readLastAccount } from "@/lib/auth/device";
import { pendingSignupEmail } from "@/lib/auth/invites";
import { requestHost } from "@/lib/auth/server";
import { getSessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/brand";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = { title: `Sign in · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 A2 — mockups SignIn-desktop / SignIn-phone / SignIn-he; InviteOnly-phone for refused sign-ups (A3).
// Error codes arrive from the Google callback (Better Auth errorCallbackURL).
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
  // R17 G2: an account the admin blocked (Better Auth admin plugin, session create refused).
  BANNED_USER: "banned",
  banned_user: "banned",
  banned: "banned",
};

type SP = { error?: string; error_description?: string; next?: string; reauth?: string };

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

  return (
    <div className="nx">
      <ClearOffline />
      <div className="auth-shell">
        <BrandArt />
        <section className="auth-side">
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <LangSwitch />
          </div>
          <div className="auth-center">
            <LoginForm full={mode === "full"} next={next} error={error} returning={returning} app={APP_NAME} testIdp={testIdpEnabled()} googleClientId={testIdpEnabled() ? null : (process.env.GOOGLE_CLIENT_ID ?? null)} />
          </div>
          <LegalLine />
        </section>
      </div>
    </div>
  );
}
