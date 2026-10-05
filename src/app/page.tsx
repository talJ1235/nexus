// Server actions on this page may fetch store pages and call Gemini.
export const maxDuration = 60;

import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { rememberOwner } from "@/lib/tracker";
import { NexusApp, type AppBoot } from "@/components/app/nexus-app";
import { aiEnabled } from "@/lib/ai";
import { currentCtx, meInfo, spaceInfo, type Ctx } from "@/lib/ctx";
import { getAppData } from "@/lib/data";
import { scoped } from "@/lib/db-scoped";
import { needsRecoveryPasskey } from "@/lib/auth/security";
import { getCurrencyPref, getUiPrefs } from "@/lib/server-prefs";

/**
 * The shell streams at once (same component, empty store, skeleton content); the data-dependent app replaces it
 * in the same response when `getAppData` resolves — no blank page and no whole-page loading swap.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ v?: string; f?: string }> }) {
  const ctx = await currentCtx();
  if (!ctx) redirect("/login");
  if (await needsRecoveryPasskey(ctx.user.id, ctx.session)) redirect("/passkey?forced=1");
  const [{ v, f }, currency, prefs] = await Promise.all([searchParams, getCurrencyPref(), getUiPrefs()]);
  const jar = await cookies();
  const tz = decodeURIComponent(jar.get("nexus_tz")?.value ?? "").slice(0, 60) || null;
  // `now` + `tz`: Home's first paint matches on server and client (store.tsx Clock). A server component renders once.
  // eslint-disable-next-line react-hooks/purity
  const boot: AppBoot = { currency, ...prefs, view: typeof v === "string" ? v : null, filter: typeof f === "string" ? f : null, aiEnabled: aiEnabled(), now: Date.now(), tz: tz && isTimeZone(tz) ? tz : null };
  // The user's language and currency for what the cron writes (it has no cookies).
  const locale = jar.get(LOCALE_COOKIE)?.value === "he" ? "he" : "en";
  after(() => rememberOwner(ctx.user.id, locale, currency).catch(() => {}));
  return (
    <>
      {/* The loading shell below is static HTML until the data streams in: remember its last [data-carry] click
          (shown as pressed) for the store to replay once the app is ready (store.tsx). */}
      <script nonce={(await headers()).get("x-nonce") ?? undefined} dangerouslySetInnerHTML={{ __html: CARRY_SCRIPT }} />
      <Suspense fallback={<NexusApp boot={boot} />}>
        <LoadedApp boot={boot} ctx={ctx} />
      </Suspense>
    </>
  );
}

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const CARRY_SCRIPT = `document.addEventListener("click",function(e){var el=e.target.closest&&e.target.closest("[data-carry]");var shell=el&&el.closest("[data-app-shell]");if(!shell||shell.hasAttribute("data-ready"))return;e.preventDefault();var p=document.querySelector("[data-carry-armed]");if(p)p.removeAttribute("data-carry-armed");el.setAttribute("data-carry-armed","");window.__nexusCarry=el.getAttribute("data-carry")},true)`;

async function LoadedApp({ boot, ctx }: { boot: AppBoot; ctx: Ctx }) {
  // Local load traces only (scripts/smoke.mjs): simulate a slow database. Unset in production.
  const delay = Number(process.env.NEXUS_TRACE_DELAY_MS) || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  return <NexusApp boot={boot} initial={await getAppData(scoped(ctx), ctx.user.id, spaceInfo(ctx), meInfo(ctx))} />;
}
