"use client";

import { Bell, ChevronRight, Download, FileSpreadsheet, History, Inbox, LogOut, MessageSquareWarning, Monitor, Moon, Settings, ShieldCheck, Sun, X } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { usePalette } from "@/components/use-palette";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { download, exportUrl } from "@/lib/export-url";
import { cn } from "@/lib/utils";
import { PaletteSwatch, Segmented } from "./settings-dialog";
import { useStore } from "./store";
import { useNotifyUnread } from "../notify/inbox";
import { useMeName } from "./spaces/space-ui";
import { SpaceRows } from "./spaces/switcher";
import { initialOf } from "@/lib/initial";
import { PersonPhoto } from "./person-photo";

/** Phone "Me" sheet (Round 9 A1), from the avatar in the phone top bar: everything that lives in the sidebar's owner
 * card and Settings on desktop, within thumb reach. Rows are ≥ 52 px. */
export function MeSheet() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [palette, setPalette] = usePalette();
  const open = s.meOpen;
  const unread = useNotifyUnread();
  const meName = useMeName();


  // Close the sheet first, then open the next thing (one overlay at a time on a phone).
  const go = (fn: () => void) => () => {
    s.setMeOpen(false);
    setTimeout(fn, 120);
  };
  const row = "flex min-h-[52px] w-full items-center gap-3.5 rounded-[16px] px-3 text-start text-[15px] font-semibold transition active:bg-surface-2 hover:bg-surface-2 [&>svg:first-child]:size-5 [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-muted";

  return (
    <Sheet open={open} onOpenChange={s.setMeOpen} title={t.me.open} side="start">
      <div className="flex items-center gap-3 border-b border-line px-4 pb-4 pt-2 sm:pt-4" data-sheet-grip data-me>
        {/* R17 P3: tapping who you are opens Settings → Profile. */}
        <button
          type="button"
          onClick={go(() => s.openSettings("profile"))}
          aria-label={f(t.sx.pf.open, { name: s.me?.name || meName })}
          className="-my-1 -ms-1 flex min-w-0 flex-1 items-center gap-3 rounded-[18px] p-1 text-start transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[.97] active:bg-surface-2 motion-reduce:active:scale-100"
          data-me-profile
        >
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-ink text-[22px] font-extrabold text-bg">
            <PersonPhoto url={s.me?.image} fallback={initialOf(meName, "")} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="bidi block truncate text-[18px] font-extrabold">{s.me?.name || meName}</b>
            {s.me && <span className="bidi block truncate text-[13px] text-muted">{s.me.email}</span>}
          </span>
        </button>
        <SheetClose className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label={t.phone.closeMenu}>
          <X className="size-5" />
        </SheetClose>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        <SpaceRows close={go} />

        <section className="space-y-3 rounded-[22px] bg-surface-2 p-4">
          <h3 className="text-[12.5px] font-bold uppercase tracking-wide text-muted">{t.me.look}</h3>
          <Segmented
            value={palette}
            label={t.settings.palette}
            onChange={setPalette}
            options={(["graphite", "plum"] as const).map((p) => ({
              value: p,
              label: (
                <span className="flex items-center justify-center gap-2">
                  <PaletteSwatch palette={p} /> {p === "graphite" ? t.settings.graphite : t.settings.plum}
                </span>
              ),
            }))}
          />
          <Segmented
            value={(theme as "light" | "dark" | "system") ?? "system"}
            label={t.settings.theme}
            onChange={setTheme}
            options={[
              { value: "light", label: <span className="flex items-center justify-center gap-1.5"><Sun className="size-4" /> {t.settings.light}</span> },
              { value: "dark", label: <span className="flex items-center justify-center gap-1.5"><Moon className="size-4" /> {t.settings.dark}</span> },
              { value: "system", label: <span className="flex items-center justify-center gap-1.5"><Monitor className="size-4" /> {t.settings.system}</span> },
            ]}
          />
        </section>

        <nav className="space-y-0.5">
          <button type="button" className={row} onClick={() => (s.setSettingsOpen(true), s.setMeOpen(false))} data-me-settings>
            <Settings /> <span className="flex-1">{t.nav.settings}</span> <ChevronRight className="size-4 text-faint rtl:-scale-x-100" />
          </button>
          {/* R17 G0: the admin panel — the admin only. */}
          {s.admin && (
            <Link className={row} href="/admin" prefetch={false} data-me-admin>
              <ShieldCheck /> <span className="flex-1">{t.adm.entry}</span> <ChevronRight className="size-4 text-faint rtl:-scale-x-100" />
            </Link>
          )}
          <button type="button" className={row} onClick={go(() => s.setView({ type: "history" }))} data-me-history>
            <History /> <span className="flex-1">{t.insights.history}</span> <ChevronRight className="size-4 text-faint rtl:-scale-x-100" />
          </button>
          {/* R17 S3: the inbox (the phone header has its bell again); kept here as a second way in. */}
          <button type="button" className={row} onClick={go(() => s.setPanel("alerts"))} data-me-alerts>
            <Bell /> <span className="flex-1">{t.nt.title}</span>
            {unread > 0 && <span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-spark px-1.5 text-[11px] font-bold text-white">{unread}</span>}
          </button>
          <button type="button" className={row} onClick={go(() => s.setReportsOpen(true))} data-me-reports>
            <Inbox /> <span className="flex-1">{t.report.reports}</span> <ChevronRight className="size-4 text-faint rtl:-scale-x-100" />
          </button>
          <button type="button" className={row} onClick={go(() => s.openReport())}>
            <MessageSquareWarning /> <span className="flex-1">{t.report.menu}</span> <ChevronRight className="size-4 text-faint rtl:-scale-x-100" />
          </button>
        </nav>

        <nav className="space-y-0.5 border-t border-line pt-4">
          <button type="button" className={row} onClick={() => download(exportUrl({ view: "to_buy" }, s.currency, locale))} data-me-export>
            <FileSpreadsheet />
            <span className="flex-1">
              {t.me.export}
              <span className="block text-[12.5px] font-medium text-muted">{t.me.exportHint}</span>
            </span>
          </button>
          <button type="button" className={row} onClick={() => download("/api/backup")}>
            <Download /> <span className="flex-1">{t.io.backup}</span>
          </button>
          <form action="/api/logout" method="post">
            <button type="submit" className={cn(row, "text-danger [&>svg:first-child]:text-danger")}>
              <LogOut /> <span className="flex-1">{t.nav.signOut}</span>
            </button>
          </form>
          {/* R17 E3: About — the privacy and terms pages. */}
          <p className="flex justify-center gap-3 pt-2 text-[12.5px] text-muted" data-me-legal>
            <a className="underline underline-offset-2" href="/privacy" target="_blank" rel="noreferrer">
              {t.account.privacy}
            </a>
            <a className="underline underline-offset-2" href="/terms" target="_blank" rel="noreferrer">
              {t.auth.legal.termsTitle}
            </a>
          </p>
        </nav>
      </div>
    </Sheet>
  );
}
