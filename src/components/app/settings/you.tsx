"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { calendarInfo, markCalendarSubscribed, regenerateCalendar, setCalendarKinds, type CalendarInfo } from "@/app/cal-actions";
import { homeDiag, setAiSuggestions, type HomeDiag } from "@/app/home-actions";
import { pictureSearchStatus } from "@/app/picture-actions";
import { useI18n } from "@/components/providers";
import { usePalette } from "@/components/use-palette";
import { useMedia } from "@/components/ui/use-media";
import { exportUrl } from "@/lib/export-url";
import { dayKeyIn, weekDays } from "@/lib/home";
import { calendarEvents, googleSubscribeUrl, type CalKinds } from "@/lib/ics";
import { CURRENCIES, type Currency } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { MemorySection } from "../memory-section";
import { useStore } from "../store";
import { AskButton } from "../top-bar";
import { AccountPage, ActivityPage, ReportsPage } from "./account";
import { NotificationsPage } from "./notifications";
import type { PageProps } from "./shell";
import { I, Li, P, SectionHead, Sel, Seg, Tick, Toggle } from "./ui";

// Settings → the "You" sections (R16 D1, board Settings-desktop): Display, Notifications, Assistant & AI, Calendar,
// Memory, Data. Account & security lives in ./account.

// ---------------- Display ----------------

export const MOTION_KEY = "nexus.motion";
export function motionPref(): "device" | "reduce" {
  try {
    return localStorage.getItem(MOTION_KEY) === "reduce" ? "reduce" : "device";
  } catch {
    return "device";
  }
}
function setMotionPref(v: "device" | "reduce") {
  try {
    if (v === "reduce") localStorage.setItem(MOTION_KEY, "reduce");
    else localStorage.removeItem(MOTION_KEY);
  } catch {
    /* private mode */
  }
  if (v === "reduce") document.documentElement.setAttribute("data-motion", "reduce");
  else document.documentElement.removeAttribute("data-motion");
}

const MINI = {
  light: { bg: "#eeede9", side: "#f8f7f4", line: "#dcdad3", bar: "#c9c6be", card: "#fff" },
  dark: { bg: "#0b0b0b", side: "#141414", line: "#2c2c2c", bar: "#3a3a3a", card: "#181818" },
};
function Mini({ kind }: { kind: "light" | "dark" | "system" }) {
  if (kind === "system")
    return (
      <span className="mini" style={{ background: "linear-gradient(105deg,#eeede9 50%,#0b0b0b 50%)" }}>
        <i style={{ width: "26%", background: "#f8f7f4" }} />
        <i style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          <i style={{ height: 7, width: "60%", borderRadius: 3, background: "#8a8984" }} />
          <i style={{ height: 20, borderRadius: 5, background: "linear-gradient(105deg,#fff 40%,#181818 40%)" }} />
        </i>
      </span>
    );
  const m = MINI[kind];
  return (
    <span className="mini" style={{ background: m.bg }}>
      <i style={{ width: "26%", background: m.side, borderInlineEnd: `1px solid ${m.line}` }} />
      <i style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        <i style={{ height: 7, width: "60%", borderRadius: 3, background: m.bar }} />
        <i style={{ height: 20, borderRadius: 5, background: m.card, border: `1px solid ${m.line}` }} />
      </i>
    </span>
  );
}

function DisplayPage() {
  const s = useStore();
  const router = useRouter();
  const { t, f, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [palette, setPalette] = usePalette();
  const [motion, setMotion] = useState(motionPref);
  const cur = (theme ?? "system") as "light" | "dark" | "system";
  const rates = s.rates.fetchedAt
    ? f(t.settings.rates, { time: new Date(s.rates.fetchedAt).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })
    : t.settings.ratesFallback;
  const swatch: Record<string, [string, string]> = { graphite: ["#171717", "#f59e0b"], plum: ["#7c4dff", "#fb7a3c"] };
  return (
    <>
      <SectionHead title={t.sx.sections.display} />
      <div>
        <p className="sec">{t.settings.theme}</p>
        <div className="grid3" role="radiogroup" aria-label={t.settings.theme}>
          {(["light", "dark", "system"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={cur === k} className={cn("pick", cur === k && "on")} onClick={() => setTheme(k)} data-theme-pick={k}>
              <Mini kind={k} />
              <span className="lbl">
                {k === "light" ? t.settings.light : k === "dark" ? t.settings.dark : t.sx.matchDevice}
                {cur === k && <Tick />}
              </span>
            </button>
          ))}
        </div>
      </div>
      {/* R17 D2: colour and language one under the other on phones (the Graphite chip was cut at 360). */}
      <div className="grid2 stack">
        <div>
          <p className="sec">{t.sx.colour}</p>
          <div className="grid2" style={{ gap: 12 }} role="radiogroup" aria-label={t.sx.colour}>
            {(["graphite", "plum"] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={palette === p} className={cn("pick", palette === p && "on")} style={{ flexDirection: "row", alignItems: "center", padding: 12 }} onClick={() => setPalette(p)} data-palette-pick={p}>
                <span style={{ display: "flex" }}>
                  <span className="sw" style={{ background: swatch[p][0], width: 24, height: 24 }} />
                  <span className="sw" style={{ background: swatch[p][1], width: 24, height: 24, marginInlineStart: -6, boxShadow: "0 0 0 2px var(--raised)" }} />
                </span>
                <span className="lbl" style={{ flex: 1, padding: 0 }}>
                  {t.sx[p]}
                  {palette === p && <Tick />}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="sec">{t.settings.language}</p>
          <Seg
            large
            block
            label={t.settings.language}
            value={locale}
            onChange={(l) => l !== locale && setLocale(l)}
            options={[
              { value: "en", label: "English" },
              { value: "he", label: "עברית", lang: "he" },
            ]}
          />
        </div>
      </div>
      <div className="card">
        <Li icon={P.coin} title={t.sx.currency} sub={rates}>
          <Sel<Currency> label={t.sx.currency} value={s.currency} onChange={s.setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c === "ILS" ? "₪ ILS" : c === "USD" ? "$ USD" : "€ EUR" }))} data-display-currency />
        </Li>
        <Li icon={P.motion} title={t.sx.motion} sub={t.sx.motionSub}>
          <Sel<"device" | "reduce">
            label={t.sx.motion}
            value={motion}
            onChange={(v) => {
              setMotion(v);
              setMotionPref(v);
            }}
            options={[
              { value: "device", label: t.sx.matchDevice },
              { value: "reduce", label: t.sx.motionReduce },
            ]}
            data-display-motion
          />
        </Li>
        {/* R17 H: go through the first questions again (every answer can be changed). */}
        <Li icon={P.history} title={t.ob.again} sub={t.ob.againSub}>
          <button type="button" className="btn sm" onClick={() => router.push("/welcome")} data-display-onboarding>
            {t.sx.open}
          </button>
        </Li>
      </div>
    </>
  );
}

// ---------------- Assistant & AI ----------------

function AiPage({ go, close }: PageProps) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const on = s.homePrefs.aiSuggestions;
  const [pics, setPics] = useState<boolean | null>(null);
  const [diag, setDiag] = useState<HomeDiag | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    pictureSearchStatus()
      .then((r) => alive && setPics(r.search))
      .catch(() => {});
    homeDiag()
      .then((x) => alive && setDiag(x))
      .catch(() => alive && setDiag(null));
    return () => {
      alive = false;
    };
  }, []);
  const pick = (v: boolean) => {
    if (v === on) return;
    const before = s.homePrefs;
    s.setHomePrefs({ ...before, aiSuggestions: v });
    setAiSuggestions(v).catch(() => {
      s.setHomePrefs(before);
      toast.error(t.errors.generic);
    });
  };
  const time = diag ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(diag.at) : "";
  return (
    <>
      <SectionHead title={t.sx.sections.ai}>
        <span onClickCapture={close} style={{ display: "inline-flex" }}>
          <AskButton className="!h-9 !ps-3 !pe-4 !text-[13px]" />
        </span>
      </SectionHead>
      <div>
        <p className="sec">{t.sx.suggestsOnHome}</p>
        <div className="grid2" role="radiogroup" aria-label={t.dash.aiSetting}>
          <button type="button" role="radio" aria-checked={on} className={cn("pick", on && "on")} style={{ padding: 16, gap: 12 }} onClick={() => pick(true)} data-ai-suggestions-switch data-ai-pick="ai">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="ic" style={{ background: "var(--warn-t)", color: "var(--spark)" }}>
                <I d={P.ai} />
              </span>
              <b style={{ flex: 1 }}>{t.sx.aiRules}</b>
              {on && <Tick />}
            </span>
            <span style={{ borderRadius: 10, background: "var(--s)", padding: "10px 12px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.4 }}>{t.sx.aiEg}</span>
          </button>
          <button type="button" role="radio" aria-checked={!on} className={cn("pick", !on && "on")} style={{ padding: 16, gap: 12 }} onClick={() => pick(false)} data-ai-pick="rules">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="ic">
                <I d={P.lines} />
              </span>
              <b style={{ flex: 1 }}>{t.sx.rulesOnly}</b>
              {!on ? <Tick /> : <span className="badge">{t.sx.noAi}</span>}
            </span>
            <span style={{ borderRadius: 10, background: "var(--s)", padding: "10px 12px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.4 }}>{t.sx.rulesEg}</span>
          </button>
        </div>
      </div>
      <div className="card" data-settings-assistant>
        <Li icon={P.picture} title={t.pictures.settingsTitle} sub={pics === false ? t.sx.picturesOff : t.sx.picturesSub} data-picture-search-status={pics == null ? undefined : pics ? "on" : "off"}>
          {pics != null && <span className={cn("badge", pics && "ok")}>{pics ? t.sx.on : t.sx.off}</span>}
        </Li>
        <Li icon={P.memory} title={t.sx.sections.memory} sub={t.memory.hint}>
          <button type="button" className="btn sm" onClick={() => go("memory")} data-settings-memory>
            {t.sx.open}
          </button>
        </Li>
        <Li icon={P.check} tone={diag?.error ? "warn" : "ok"} title={t.sx.status} sub={diag ? f(t.dash.diag, { time, source: diag.source === "ai" ? t.dash.diagAi : t.dash.diagRules, n: diag.n }) : diag === null ? t.dash.diagNever : ""} data-home-diag={diag?.source ?? "never"}>
          {diag && <span className={cn("badge", diag.error ? "warn" : "ok")}>{diag.error ? diag.error.slice(0, 24) : t.sx.working}</span>}
          {diag === null && <span className="badge">{t.sx.notYet}</span>}
        </Li>
      </div>
    </>
  );
}

// ---------------- Calendar ----------------

function CalendarPage() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [cal, setCal] = useState<CalendarInfo | null>(null);
  useEffect(() => {
    let alive = true;
    calendarInfo()
      .then((c) => alive && setCal(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const kinds: CalKinds = useMemo(() => cal?.kinds ?? { deliveries: true, reorders: true }, [cal?.kinds]);
  const setKinds = (k: CalKinds) => {
    setCal((c) => (c ? { ...c, kinds: k } : c));
    setCalendarKinds(k).catch(() => toast.error(t.errors.generic));
  };
  const subscribe = () => {
    setCal((c) => (c ? { ...c, subscribed: true } : c));
    void markCalendarSubscribed().catch(() => {});
  };
  // This week, as the feed has it.
  const week = useMemo(() => {
    const now = s.clock.now;
    const today = dayKeyIn(now, s.clock.tz);
    const days = weekDays(today, s.clock.weekStartsOn);
    const evs = calendarEvents(s.items, now, s.clock.tz, { arrives: t.cal.arrives, late: t.cal.late, reorder: t.cal.reorder }, kinds);
    return days.map((d) => ({ d, today: d === today, evs: evs.filter((e) => e.day === d) }));
  }, [s.items, s.clock, t, kinds]);
  // R17 B2: how many events the feed carries right now (the whole window, not just this week) — an empty feed is the
  // usual reason "nothing shows in Google".
  const feedSize = useMemo(() => calendarEvents(s.items, s.clock.now, s.clock.tz, { arrives: t.cal.arrives, late: t.cal.late, reorder: t.cal.reorder }, kinds).length, [s.items, s.clock, t, kinds]);
  const phone = useMedia("(max-width: 1023px)");
  const wd = (key: string) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  return (
    <>
      <SectionHead title={t.sx.sections.calendar} />
      <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", padding: 18, borderRadius: 14, background: "var(--s)", flexWrap: "wrap" }} data-settings-calendar>
        <span className="ic" style={{ width: 48, height: 48, borderRadius: 12, background: "var(--raised)", border: "1px solid var(--line)" }}>
          <I d={P.calendar} size="lg" />
        </span>
        <span style={{ flex: 1, minWidth: 180, lineHeight: 1.4 }}>
          <b>{t.sx.calFeed}</b> {cal?.subscribed && <span className="badge ok" data-cal-subscribed>{t.cal.subscribed}</span>}
          <br />
          <input readOnly value={cal?.https ?? ""} aria-label={t.sx.calFeed} className="mono tiny" style={{ border: 0, background: "transparent", width: "100%", padding: 0, outline: 0 }} onFocus={(e) => e.currentTarget.select()} data-cal-url />
        </span>
        <button
          type="button"
          className="btn sm"
          disabled={!cal}
          onClick={async () => {
            if (!cal) return;
            await navigator.clipboard?.writeText(cal.https).catch(() => {});
            toast.success(t.cal.copied);
          }}
          data-cal-copy
        >
          <I d={P.copy} size="sm" />
          {t.cal.copy}
        </button>
        <a className={cn("btn sm", !cal && "off")} href={cal?.webcal} onClick={subscribe} data-cal-webcal>
          {t.cal.apple}
        </a>
        <a className={cn("btn sm pri", !cal && "off")} href={cal ? googleSubscribeUrl(cal.webcal) : undefined} target="_blank" rel="noreferrer" onClick={subscribe} data-cal-google>
          {t.cal.google}
        </a>
      </div>
      <div>
        <p className="sec">{t.sx.thisWeek}</p>
        <div className="wk" data-cal-week>
          {week.map((w) => (
            <div key={w.d} className={cn(w.today && "today")}>
              {wd(w.d)}
              {w.evs.slice(0, 2).map((e) => (
                <span key={e.uid} className={cn("ev", e.uid.includes("-reorder") && "w")} title={e.title}>
                  {e.title}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <Li icon={P.truck} tone="info" title={t.sx.calDeliveries}>
          <Toggle on={kinds.deliveries} label={t.sx.calDeliveries} disabled={!cal} onChange={(v) => setKinds({ ...kinds, deliveries: v })} data-cal-kind="deliveries" />
        </Li>
        <Li icon={P.refresh} tone="warn" title={t.sx.calReorders}>
          <Toggle on={kinds.reorders} label={t.sx.calReorders} disabled={!cal} onChange={(v) => setKinds({ ...kinds, reorders: v })} data-cal-kind="reorders" />
        </Li>
        <Li icon={P.tag} title={t.sx.calSales}>
          <span className="badge">{t.sx.soon}</span>
          <Toggle on={false} disabled label={t.sx.calSales} onChange={() => {}} />
        </Li>
      </div>
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="sub" style={{ flex: 1, minWidth: 200 }}>
          {t.cal.note}
          <br />
          <span data-cal-feed-size={feedSize}>{feedSize ? f(t.cal.feedCount, { n: feedSize }) : t.cal.feedEmpty}</span>
          {phone && (
            <>
              <br />
              <span data-cal-phone-google>{t.cal.phoneGoogle}</span>
            </>
          )}
        </span>
        <button
          type="button"
          className="btn sm dng-o"
          disabled={!cal}
          onClick={async () => {
            if (!window.confirm(t.cal.regenerateConfirm)) return;
            try {
              setCal(await regenerateCalendar());
              toast.success(t.cal.regenerated);
            } catch {
              toast.error(t.errors.generic);
            }
          }}
          data-cal-regenerate
        >
          {t.sx.resetLink}
        </button>
      </div>
    </>
  );
}

// ---------------- Memory ----------------

function MemoryPage() {
  const { t } = useI18n();
  return (
    <>
      <SectionHead title={t.sx.sections.memory} />
      <MemorySection bare />
    </>
  );
}

// ---------------- Data ----------------

const BACKUP_KEY = "nexus.lastBackup";

function Tile({ icon, tone, title, sub, onClick, disabled, data }: { icon: string; tone?: string; title: string; sub: string; onClick: () => void; disabled: boolean; data: string }) {
  const { t } = useI18n();
  return (
    <button type="button" className="tile4" onClick={onClick} disabled={disabled} title={disabled ? t.sx.ownerOnly : undefined} data-data-tile={data}>
      <span className={cn("ic", tone)} style={{ width: 44, height: 44 }}>
        <I d={icon} size="lg" />
      </span>
      <span>
        <b style={{ fontSize: 15 }}>{title}</b>
        <br />
        <span className="sub">{disabled ? t.sx.ownerOnly : sub}</span>
      </span>
    </button>
  );
}

function DataPage({ close }: PageProps) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const owner = s.space?.role === "owner";
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(BACKUP_KEY)) || null;
    } catch {
      return null;
    }
  });
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
  const date = last ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(last) : "";
  return (
    <>
      <SectionHead title={t.sx.sections.data}>
        {last && (
          <span className="badge ok">
            <I d={P.check} size="sm" />
            {f(t.sx.lastBackup, { date })}
          </span>
        )}
      </SectionHead>
      <div className="grid2" style={{ gap: 14 }}>
        <Tile
          icon={P.download}
          tone="ok"
          title={t.sx.backUp}
          sub={t.sx.backUpSub}
          onClick={() => {
            const a = document.createElement("a");
            a.href = "/api/backup";
            a.download = "";
            a.click();
            const now = Date.now();
            setLast(now);
            try {
              localStorage.setItem(BACKUP_KEY, String(now));
            } catch {}
          }}
          disabled={!owner}
          data="backup"
        />
        <Tile icon={P.upload} tone="info" title={t.io.restore} sub={t.sx.restoreSub} onClick={() => fileRef.current?.click()} disabled={!owner || busy} data="restore" />
        <Tile icon={P.sheet} title={t.io.importSheet} sub={t.sx.importSheetSub} onClick={() => (close(), s.setPanel("import"))} disabled={!!s.readOnly} data="import" />
        <Tile icon={P.receipt} title={t.sx.importReceipts} sub={t.sx.importReceiptsSub} onClick={() => (close(), s.openReceipt())} disabled={!!s.readOnly} data="receipts" />
      </div>
      {owner && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="sub" style={{ flex: 1 }}>
            {t.io.restoreHint}
          </span>
          <Seg
            label={t.io.restore}
            value={mode}
            onChange={setMode}
            options={[
              { value: "merge", label: t.io.merge },
              { value: "replace", label: t.io.replace },
            ]}
          />
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void restore(e.target.files?.[0])} />
        </div>
      )}
      <div className="card">
        <Li icon={P.table} title={t.sx.exportItems} sub={t.sx.exportItemsSub}>
          <a className="btn sm" href={exportUrl({ view: "all" }, s.currency, locale)} download data-export-all>
            {t.sx.exportBtn}
          </a>
        </Li>
      </div>
    </>
  );
}

export const YOU_PAGES = {
  account: AccountPage,
  activity: ActivityPage,
  reports: ReportsPage,
  notifications: NotificationsPage,
  display: DisplayPage,
  ai: AiPage,
  calendar: CalendarPage,
  memory: MemoryPage,
  data: DataPage,
};

