import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding";
import { APP_NAME } from "@/lib/brand";
import { currentCtx } from "@/lib/ctx";
import { userPrefGet } from "@/lib/db-scoped/prefs";
import { freshOnboarding, ONBOARDING_KEY, parseOnboarding } from "@/lib/onboarding";
import { firstName } from "@/lib/spaces";

export const metadata: Metadata = { title: `Welcome · ${APP_NAME}`, robots: { index: false, follow: false } };

// R17 H1: first sign-in (Better Auth's newUserCallbackURL) — the onboarding, resumed at the saved step. Opened again
// later (Settings → Getting started), it starts over with the earlier answers filled in.
// R18 S5 F1: `?quick=1` = the Home card's "3 quick questions" (steps 2, 4, 5, 6) for people who finished before S5.
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ quick?: string }> }) {
  const ctx = await currentCtx();
  if (!ctx) redirect("/login?next=/welcome");
  const saved = parseOnboarding(await userPrefGet(ctx.user.id, ONBOARDING_KEY));
  if ((await searchParams).quick === "1" && saved && saved.status !== "active")
    return <OnboardingFlow initial={{ ...saved, step: 2 }} joined={false} name={firstName(ctx.user.name, ctx.user.email)} quick />;
  const initial = !saved ? freshOnboarding() : saved.status === "active" ? saved : { ...saved, status: "active" as const, step: 1 };
  // Joined through a space invite (a shared space they don't own) → "who do you shop with" is already answered.
  const joined = ctx.memberships.some((m) => m.kind === "shared" && m.role !== "owner");
  return <OnboardingFlow initial={initial} joined={joined} name={firstName(ctx.user.name, ctx.user.email)} />;
}
