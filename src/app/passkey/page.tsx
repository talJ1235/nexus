import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "@/components/auth/nx.css";
import { PasskeyOffer } from "@/components/auth/passkey-offer";
import { authMode, safeNext } from "@/lib/auth/config";
import { requestHost } from "@/lib/auth/server";
import { getSessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Passkey · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 A2: "Add a passkey" — once after the first Google sign-in in full mode (skippable), and forced after a recovery
// sign-in (no "Not now"). Passkeys are bound to the final domain, so closed-circle mode never shows this.
export default async function PasskeyPage({ searchParams }: { searchParams: Promise<{ forced?: string; next?: string }> }) {
  const sp = await searchParams;
  const h = await headers();
  const su = await getSessionUser(h);
  if (!su) redirect("/login");
  const next = safeNext(sp.next);
  if (authMode(requestHost(h)) !== "full") redirect(next);
  const forced = sp.forced === "1" || su.session.method === "email-otp";
  return (
    <div className="nx">
      <PasskeyOffer forced={forced} next={next} />
    </div>
  );
}
