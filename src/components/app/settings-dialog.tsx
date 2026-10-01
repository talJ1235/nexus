"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, LogOut, Monitor, Moon, Puzzle, Sun, Upload } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { CURRENCIES, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BookmarkletDialog } from "./bookmarklet";
import { BudgetEditor } from "./budget-card";
import { useStore } from "./store";
import { useExtension } from "./use-extension";
import { usePalette } from "@/components/use-palette";
import { PALETTES, type Palette } from "@/lib/palette";

/** Two dots (brand + spark) of a palette, whichever palette is active (colours in globals.css). */
export function PaletteSwatch({ palette }: { palette: Palette }) {
  return (
    <span className="palette-swatch inline-flex -space-x-1 rtl:space-x-reverse" data-swatch={palette} aria-hidden>
      <i className="size-2.5 rounded-full bg-[var(--sw-a)] ring-1 ring-surface" />
      <i className="size-2.5 rounded-full bg-[var(--sw-b)] ring-1 ring-surface" />
    </span>
  );
}

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
      className={cn("grid rounded-full border border-line bg-surface-2 p-0.5", size === "sm" ? "text-xs" : "text-[13px]")}
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
            "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition [&_svg]:size-3.5",
            size === "sm" ? "h-7 min-w-8 px-2" : "h-8",
            value === o.value ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
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
  const [palette, setPalette] = usePalette();
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
            <Row title={t.budget.cap} hint={t.budget.capHint}>
              <BudgetEditor />
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
            <Row title={t.settings.palette}>
              <Segmented<Palette>
                label={t.settings.palette}
                value={palette}
                onChange={setPalette}
                options={PALETTES.map((p) => ({ value: p, label: <><PaletteSwatch palette={p} />{t.settings[p]}</> }))}
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

          <DataSection />

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

function DataSection() {
  const s = useStore();
  const { t, f } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState(false);

  const restore = async (file: File | undefined) => {
    if (!file) return;
    if (mode === "replace" && !window.confirm(t.io.replaceConfirm)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/backup?mode=${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(f(t.io.restored, { n: json.counts.items ?? 0 }));
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      toast.error(String((e as Error).message) === "not_a_backup" ? t.io.notBackup : t.errors.generic);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="space-y-4 border-t border-line pt-5">
      <h3 className="text-xs font-medium text-faint">{t.io.data}</h3>
      <Row title={t.io.importSheet} hint={t.io.importSheetHint}>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              s.setSettingsOpen(false);
              s.setPanel("import");
            }}
          >
            <FileSpreadsheet />
            {t.io.open}
          </Button>
        </div>
      </Row>
      <Row title={t.io.backup} hint={t.io.backupHint}>
        <div className="flex justify-end">
          <a href="/api/backup" download className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium transition hover:bg-sunken [&_svg]:size-4">
            <Download />
            {t.io.download}
          </a>
        </div>
      </Row>
      <Row title={t.io.restore} hint={t.io.restoreHint}>
        <div className="flex items-center justify-end gap-2">
          <Segmented
            size="sm"
            label={t.io.restore}
            value={mode}
            onChange={setMode}
            options={[
              { value: "merge", label: t.io.merge },
              { value: "replace", label: t.io.replace },
            ]}
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : <Upload />}
            {t.io.restore}
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void restore(e.target.files?.[0])} />
        </div>
      </Row>
    </section>
  );
}
