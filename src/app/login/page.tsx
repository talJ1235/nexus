import { cookies } from "next/headers";
import { ClearOffline } from "@/components/clear-offline";
import { LogoMark } from "@/components/logo";
import { dictionaries, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaries[isLocale(raw) ? raw : "en"];

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <ClearOffline />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:radial-gradient(var(--line-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      <form
        action="/api/login"
        method="post"
        className="relative w-full max-w-[360px] animate-pop-in rounded-2xl border border-line bg-surface p-7 shadow-pop"
      >
        <LogoMark className="size-10" />
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{t.login.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.tagline}</p>

        <label htmlFor="password" className="mt-6 block text-sm font-medium">
          {t.login.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-1.5 h-11 w-full rounded-lg border border-line-strong bg-bg px-3 text-[15px] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <input type="hidden" name="next" value={next ?? "/"} />
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {t.login.wrong}
          </p>
        )}
        <button
          type="submit"
          className="mt-5 h-11 w-full rounded-lg bg-fg font-medium text-bg transition hover:opacity-90 active:scale-[0.99]"
        >
          {t.login.submit}
        </button>
        <p className="mt-4 text-xs text-faint">{t.login.remember}</p>
      </form>
    </main>
  );
}
