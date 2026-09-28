"use client";

import { LogOut, Monitor, Moon, Puzzle, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { CURRENCIES, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BookmarkletDialog } from "./bookmarklet";
import { useStore } from "./store";
import { useExtension } from "./use-extension";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "md" | "sm";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid rounded-lg border border-line-strong bg-bg p-0.5", size === "sm" ? "text-xs" : "text-[13px]")}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md transition [&_svg]:size-3.5",
            size === "sm" ? "h-7 min-w-8 px-2" : "h-8",
            value === o.value ? "bg-fg text-bg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_minmax(0,260px)] sm:items-center sm:gap-6">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog() {
  const s = useStore();
  const { t, f, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const ext = useExtension();
  const rates = s.rates.fetchedAt
    ? f(t.settings.rates, { time: new Date(s.rates.fetchedAt).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })
    : t.settings.ratesFallback;

  return (
    <>
      <Modal open={s.settingsOpen} onOpenChange={s.setSettingsOpen} title={t.settings.title} className="max-w-xl">
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-xs font-medium text-faint">{t.settings.display}</h3>
            <Row title={t.settings.currency} hint={rates}>
              <Segmented<Currency>
                label={t.settings.currency}
                value={s.currency}
                onChange={s.setCurrency}
                options={CURRENCIES.map((c) => ({ value: c, label: c === "ILS" ? "₪ ILS" : c === "USD" ? "$ USD" : "€ EUR" }))}
              />
            </Row>
            <Row title={t.settings.theme}>
              <Segmented
                label={t.settings.theme}
                value={(theme ?? "system") as "system" | "dark" | "light"}
                onChange={setTheme}
                options={[
                  { value: "system", label: <><Monitor />{t.settings.system}</> },
                  { value: "dark", label: <><Moon />{t.settings.dark}</> },
                  { value: "light", label: <><Sun />{t.settings.light}</> },
                ]}
              />
            </Row>
            <Row title={t.settings.language}>
              <Segmented
                label={t.settings.language}
                value={locale}
                onChange={(l) => l !== locale && setLocale(l)}
                options={[
                  { value: "en", label: "English" },
                  { value: "he", label: "עברית" },
                ]}
              />
            </Row>
          </section>

          <section className="space-y-4 border-t border-line pt-5">
            <h3 className="text-xs font-medium text-faint">{t.settings.account}</h3>
            <Row title={t.settings.extension} hint={ext.available ? `${t.ext.connected} · v${ext.version}` : t.ext.notInstalled}>
              <div className="flex items-center justify-end gap-2">
                <span className={cn("size-2 rounded-full", ext.available ? "bg-ok" : "bg-faint")} aria-hidden />
                <Button size="sm" variant={ext.available ? "outline" : "accent"} onClick={() => s.setExtOpen(true)}>
                  <Puzzle />
                  {ext.available ? t.settings.manage : t.settings.setUp}
                </Button>
              </div>
            </Row>
            <form action="/api/logout" method="post" className="flex justify-end">
              <Button type="submit" size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger">
                <LogOut />
                {t.nav.signOut}
              </Button>
            </form>
          </section>
        </div>
      </Modal>
      <BookmarkletDialog open={s.extOpen} onOpenChange={s.setExtOpen} />
    </>
  );
}
