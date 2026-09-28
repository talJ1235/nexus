import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LogoMark } from "@/components/logo";
import { dictionaries, fmt, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { findInvite } from "@/lib/invites";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaries[isLocale(raw) ? raw : "en"];
  const found = await findInvite(token);

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:radial-gradient(var(--line-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      {!found ? (
        <div className="relative w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7 text-center shadow-pop">
          <LogoMark className="mx-auto size-10" />
          <p className="mt-4 text-muted">{t.share.inviteGone}</p>
        </div>
      ) : (
        <form action="/api/invite/accept" method="post" className="relative w-full max-w-[380px] animate-pop-in rounded-2xl border border-line bg-surface p-7 shadow-pop">
          <LogoMark className="size-10" />
          <p className="mt-5 text-sm text-muted">{t.share.invitedTo}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight" dir="auto">
            {found.collection.name}
          </h1>
          <p className="mt-1 text-sm text-muted">{found.invite.role === "editor" ? t.share.canEdit : t.share.canView}</p>
          <label htmlFor="name" className="mt-6 block text-sm font-medium">
            {t.share.yourName}
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={40}
            autoFocus
            autoComplete="given-name"
            dir="auto"
            className="mt-1.5 h-11 w-full rounded-lg border border-line-strong bg-bg px-3 text-[15px] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <input type="hidden" name="token" value={token} />
          {error && <p className="mt-2 text-sm text-danger">{t.share.inviteGone}</p>}
          <button type="submit" className="mt-5 h-11 w-full rounded-lg bg-fg font-medium text-bg transition hover:opacity-90 active:scale-[0.99]">
            {fmt(t.share.open, { name: found.collection.name })}
          </button>
          <p className="mt-4 text-xs text-faint">{t.share.remembered}</p>
        </form>
      )}
    </main>
  );
}
