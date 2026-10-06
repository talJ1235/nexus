"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, KeyRound, LogOut, Monitor, Moon, Puzzle, ShieldCheck, Sun, Upload, MessageSquareWarning, Users } from "lucide-react";
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
import { saveImportLimit } from "@/app/money-actions";
import { pictureSearchStatus } from "@/app/picture-actions";
import { MemorySection } from "./memory-section";
import { CalendarSection } from "./calendar-section";
import { homeDiag, setAiSuggestions, type HomeDiag } from "@/app/home-actions";
import { rememberThisDevice } from "@/app/security-actions";
import { ReportsSubpage } from "./reports-sheet";
import { useStore } from "./store";
import { openSpaces, SpaceTile } from "./spaces/space-ui";
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
  /** "touch": the phone search's inline controls (≥ 40 px targets). */
  size?: "md" | "sm" | "touch";
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
            size === "sm" ? "h-7 min-w-8 px-2" : size === "touch" ? "h-9 min-w-10 px-2.5 [&_svg]:size-4" : "h-8",
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

/** Product pictures (Round 10 D2): whether Google image search is set up; without it, a note to add the key. */
function PictureSearchRow() {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void pictureSearchStatus()
      .then((r) => setOn(r.search))
      .catch(() => {});
  }, []);
  if (on == null) return null;
  return (
    <Row title={t.pictures.settingsTitle} hint={on ? t.pictures.searchOn : t.pictures.needsKey}>
      <div className="flex items-center justify-end gap-2" data-picture-search-status={on ? "on" : "off"}>
        <span className={cn("size-2 rounded-full", on ? "bg-ok" : "bg-faint")} aria-hidden />
      </div>
    </Row>
  );
}

function ImportLimitField() {
  const s = useStore();
  const { t } = useI18n();
  return (
    <label className="flex items-center gap-2">
      <span className="text-sm font-semibold text-muted">$</span>
      <input
        key={s.importLimitUsd}
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        defaultValue={s.importLimitUsd}
        aria-label={t.importVat.title}
        data-import-limit
        onBlur={async (e) => {
          const v = Number(e.target.value);
          if (!(v > 0) || v === s.importLimitUsd) return;
          try {
            s.setImportLimitUsd(await saveImportLimit(v));
            toast.success(t.importVat.saved);
          } catch {
            toast.error(t.errors.generic);
          }
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="tabular h-10 w-full rounded-full border border-line-strong bg-bg px-4 text-sm outline-none focus:border-ink/40"
      />
    </label>
  );
}

export function SettingsDialog() {
  const s = useStore();
  const { t, f, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [palette, setPalette] = usePalette();
  const ext = useExtension();
  // Sub-pages slide in inside the same modal (Round 11 B1): back arrow / Esc → report list → Settings.
  const [sub, setSub] = useState<null | "reports">(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [dir, setDir] = useState<"in" | "back">("in");
  // /?panel=settings (back from Settings → Security / Invite codes) reopens Settings. Once a session, this device
  // remembers who signed in for the sign-in screen's "Continue as …" chip (R15 A2).
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("panel") === "settings") {
      s.setSettingsOpen(true);
      u.searchParams.delete("panel");
      window.history.replaceState(null, "", u);
    }
    try {
      if (!sessionStorage.getItem("nexus.remembered")) {
        sessionStorage.setItem("nexus.remembered", "1");
        void rememberThisDevice().catch(() => {});
      }
    } catch {
      /* private mode */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (to: null | "reports") => {
    setDir(to ? "in" : "back");
    setSub(to);
    setReportId(null);
  };
  const back = !sub
    ? undefined
    : () => {
        if (!reportId) return go(null);
        setDir("back");
        setReportId(null);
      };
  const rates = s.rates.fetchedAt
    ? f(t.settings.rates, { time: new Date(s.rates.fetchedAt).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })
    : t.settings.ratesFallback;

  return (
    <>
      <Modal
        open={s.settingsOpen}
        onOpenChange={(o) => {
          s.setSettingsOpen(o);
          if (o) return;
          setSub(null);
          setReportId(null);
          setDir("in");
        }}
        title={sub === "reports" ? t.report.reports : t.settings.title}
        onBack={back}
        backLabel={t.report.back}
        className="max-w-xl"
      >
        {sub === "reports" ? (
          <div key={`reports-${reportId ?? ""}`} className={dir === "in" ? "subpage-in" : "subpage-back"}>
            <ReportsSubpage
              openId={reportId}
              onOpen={(id) => {
                setDir("in");
                setReportId(id);
              }}
            />
          </div>
        ) : (
        <div key="main" className={cn("space-y-6", dir === "back" && "subpage-back")}>
          {/* R15 C3: grouped as in the mockup — the current space first, then "You". Nothing removed. */}
          {s.space && (
            <section className="space-y-4" data-settings-space>
              <h3 className="flex items-center gap-2 text-xs font-medium text-faint">
                <SpaceTile name={s.space.name} color={s.space.color} size={18} />
                {s.space.name}
              </h3>
              <Row title={t.spaces.spacePeople} hint={t.spaces.peopleHint}>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      s.setSettingsOpen(false);
                      setTimeout(() => openSpaces({ kind: "settings" }), 120);
                    }}
                    data-settings-space-people
                  >
                    <Users />
                    {t.security.open}
                  </Button>
                </div>
              </Row>
              {!s.readOnly && (
                <>
                  <Row title={t.budget.cap} hint={t.budget.capHint}>
                    <BudgetEditor />
                  </Row>
                  <Row title={t.importVat.title} hint={t.importVat.hint}>
                    <ImportLimitField />
                  </Row>
                </>
              )}
            </section>
          )}

          {s.space?.role === "owner" && <DataSection />}

          <section className="space-y-4 border-t border-line pt-5">
            <h3 className="text-xs font-medium text-faint">{t.spaces.youGroup} · {t.settings.display}</h3>
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

          <AssistantSection />

          <CalendarSection />

          <MemorySection />

          <section className="space-y-4 border-t border-line pt-5">
            <h3 className="text-xs font-medium text-faint">{t.settings.account}</h3>
            <Row title={t.settings.extension} hint={ext.available ? `${t.ext.connected} · v${ext.version}` : t.ext.notInstalled}>
              <div className="flex items-center justify-end gap-2">
                <span className={cn("size-2 rounded-full", ext.available ? "bg-ok" : "bg-faint")} aria-hidden />
                <Button size="sm" variant={ext.available ? "outline" : "accent"} onClick={() => s.setExtOpen(true)} data-settings-ext>
                  <Puzzle />
                  {ext.available ? t.settings.manage : t.settings.setUp}
                </Button>
              </div>
            </Row>
            <Row title={t.security.title} hint={t.security.hint}>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => window.location.assign("/settings/security")} data-settings-security>
                  <ShieldCheck />
                  {t.security.open}
                </Button>
              </div>
            </Row>
            {s.admin && (
              <Row title={t.invites.title} hint={t.invites.hint}>
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => window.location.assign("/settings/invites")} data-settings-invites>
                    <KeyRound />
                    {t.security.open}
                  </Button>
                </div>
              </Row>
            )}
            <PictureSearchRow />
            <Row title={t.report.menu}>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => go("reports")} data-settings-reports>
                  {t.report.reports}
                </Button>
                <Button size="sm" variant="outline" onClick={() => s.openReport()} data-settings-report>
                  <MessageSquareWarning />
                  {t.report.menu}
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
        )}
      </Modal>
      <BookmarkletDialog open={s.extOpen} onOpenChange={s.setExtOpen} />
    </>
  );
}

/** Settings → Assistant (Round 13 A3): AI phrasing of Home's suggestions — the switch for AI cost in the multi-user version. */
function AssistantSection() {
  const { t } = useI18n();
  return (
    <section className="space-y-4 border-t border-line pt-5" data-settings-assistant>
      <h3 className="text-xs font-medium text-faint">{t.dash.assistant}</h3>
      <Row title={t.dash.aiSetting} hint={t.dash.aiSettingHint}>
        <AiSuggestionsSwitch />
      </Row>
      <HomeDiagLine />
    </section>
  );
}

/** R14 A2: why Home's suggestions look the way they do (last run, source, count, last error). */
function HomeDiagLine() {
  const { t, f, locale } = useI18n();
  const [d, setD] = useState<HomeDiag | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    homeDiag()
      .then((x) => alive && setD(x))
      .catch(() => alive && setD(null));
    return () => {
      alive = false;
    };
  }, []);
  if (d === undefined) return null;
  const time = d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d.at) : "";
  return (
    <p className="text-xs leading-relaxed text-muted" data-home-diag={d?.source ?? "never"}>
      {d ? f(t.dash.diag, { time, source: d.source === "ai" ? t.dash.diagAi : t.dash.diagRules, n: d.n }) : t.dash.diagNever}
      {d?.error && <span className="block text-warn">{f(t.dash.diagError, { error: d.error })}</span>}
    </p>
  );
}

export function AiSuggestionsSwitch({ className }: { className?: string }) {
  const s = useStore();
  const { t } = useI18n();
  const on = s.homePrefs.aiSuggestions;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t.dash.aiSetting}
      disabled={s.offlineAt != null}
      onClick={() => {
        const before = s.homePrefs;
        s.setHomePrefs({ ...before, aiSuggestions: !on });
        setAiSuggestions(!on).catch(() => {
          s.setHomePrefs(before);
          toast.error(t.errors.generic);
        });
      }}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50", on ? "bg-brand" : "bg-line-strong", className)}
      data-ai-suggestions-switch
    >
      <span className={cn("absolute top-0.5 size-6 rounded-full bg-surface shadow transition-[inset-inline-start]", on ? "start-[22px]" : "start-0.5")} />
    </button>
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
