"use client";

import "../../auth/nx.css";
import "./nx16.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { useBackClose } from "@/components/ui/sheet-drag";
import { useMedia } from "@/components/ui/use-media";
import { rememberThisDevice } from "@/app/security-actions";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { avatarColor, Facepile, openSpaces, SpaceLook, usePresence } from "../spaces/space-ui";
import { Av, I, P } from "./ui";
import { SpaceCover, SPACE_PAGES } from "./space";
import { YOU_PAGES } from "./you";

/**
 * R16 D1–D3 — Settings (boards Settings-desktop/-phone, SpaceSettings-desktop/-phone). Desktop (≥ 1024 px): a large
 * two-pane dialog over the app (≈ 1220 × 700, max 92 vw × 92 vh): sections on the start side (You, then the current
 * space), the section on the other; Esc closes (or goes back from a sub-page). Phones: full screen, a section list →
 * the section's page (push), Back / swipe from the edge returns to the list. Deep links: /settings/<section>.
 */

export const YOU = ["account", "display", "notif", "ai", "calendar", "memory", "data"] as const;
export const SPACE = ["general", "people", "budget", "danger"] as const;
/** Sub-pages and their parent. */
const SUB: Record<string, string> = { activity: "account", invites: "account", reports: "account" };
export type SectionId = (typeof YOU)[number] | (typeof SPACE)[number] | "activity" | "invites" | "reports";
const ALL = new Set<string>([...YOU, ...SPACE, ...Object.keys(SUB)]);
export const isSection = (v: string | null | undefined): v is SectionId => !!v && ALL.has(v);

export type PageProps = { go: (id: SectionId) => void; close: () => void; phone: boolean };

const DESK = "(min-width: 1024px)";
const PHONE_NAV = "(max-width: 1023px)";

/** Which space sections the current space has (a personal space can't be shared, left or deleted). */
function useSpaceSections() {
  const s = useStore();
  const shared = s.space?.kind === "shared";
  return SPACE.filter((id) => shared || (id !== "people" && id !== "danger"));
}

function pathFor(section: string, desktop: boolean, shared: boolean): string[] {
  const deskDefault = shared ? "people" : "general";
  if (section === "space") return desktop ? [deskDefault] : ["space"];
  if (!isSection(section)) return desktop ? ["account"] : [];
  if (SUB[section]) return [SUB[section], section];
  if ((SPACE as readonly string[]).includes(section)) return desktop ? [section] : ["space", section];
  return [section];
}

/** Old addresses → sections. */
const ALIAS: Record<string, string> = { security: "account", invites: "invites", space: "space" };

export function SettingsShell() {
  const s = useStore();
  const desktop = useMedia(DESK);
  const open = s.settingsSection != null;
  const { loading, openSettings } = s;
  // Deep link: /settings[/<section>] opens here once the app is ready; /?panel=settings too (older links).
  useEffect(() => {
    if (loading) return;
    const m = window.location.pathname.match(/^\/settings(?:\/([\w-]+))?\/?$/);
    const u = new URL(window.location.href);
    if (m) openSettings(ALIAS[m[1] ?? ""] ?? m[1] ?? "");
    else if (u.searchParams.get("panel") === "settings") {
      u.searchParams.delete("panel");
      window.history.replaceState(null, "", u);
      openSettings("");
    }
  }, [loading, openSettings]);
  // Mounted only while open: a fresh path each time.
  return open ? <Shell key={desktop ? "d" : "p"} desktop={desktop} /> : null;
}

function Shell({ desktop }: { desktop: boolean }) {
  const s = useStore();
  const shared = s.space?.kind === "shared";
  const [path, setPath] = useState<string[]>(() => pathFor(s.settingsSection ?? "", desktop, shared));
  const [dir, setDir] = useState<"in" | "back">("in");
  const close = () => s.setSettingsOpen(false);

  // A section asked for while open (palette, deep link, "Space settings") moves the shell there.
  const asked = s.settingsSection;
  const lastAsked = useRef(asked);
  useEffect(() => {
    if (asked === lastAsked.current) return;
    lastAsked.current = asked;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the store's request
    if (asked) setPath(pathFor(asked, desktop, shared));
  }, [asked, desktop, shared]);

  // Once a session, this device remembers who signed in (sign-in screen's "Continue as …", R15 A2).
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("nexus.remembered")) {
        sessionStorage.setItem("nexus.remembered", "1");
        void rememberThisDevice().catch(() => {});
      }
    } catch {
      /* private mode */
    }
  }, []);

  // Deep link: /settings/<section> while open; the URL the app had comes back on close.
  const origin = useRef<string | null>(null);
  const want = useRef("");
  useEffect(() => {
    const here = window.location.pathname.startsWith("/settings") ? `/${window.location.search}` : window.location.pathname + window.location.search;
    origin.current = here;
    const sync = () => setTimeout(() => window.location.pathname !== want.current && window.history.replaceState(window.history.state, "", want.current), 0);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      const back = origin.current;
      setTimeout(() => back && window.history.replaceState(window.history.state, "", back), 0);
    };
  }, []);
  useEffect(() => {
    const last = path[path.length - 1];
    want.current = !last ? "/settings" : last === "space" ? "/settings/space" : `/settings/${last}`;
    const id = setTimeout(() => window.history.replaceState(window.history.state, "", want.current), 0);
    return () => clearTimeout(id);
  }, [path]);

  const go = (id: SectionId) => {
    setDir("in");
    if (desktop) setPath(SUB[id] ? [SUB[id], id] : [id]);
    else setPath(pathFor(id, false, shared));
  };
  const back = () => {
    setDir("back");
    setPath((p) => p.slice(0, -1));
  };
  const props: PageProps = { go, close, phone: !desktop };

  return (
    <D.Root open onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <div className="nx sx-root" dir={undefined}>
          {desktop ? (
            <Desktop path={path} setPath={(p) => (setDir("in"), setPath(p))} back={back} dir={dir} props={props} />
          ) : (
            <Phone path={path} back={back} dir={dir} props={props} />
          )}
        </div>
      </D.Portal>
    </D.Root>
  );
}

// ---------------- desktop ----------------

function Desktop({ path, setPath, back, dir, props }: { path: string[]; setPath: (p: string[]) => void; back: () => void; dir: "in" | "back"; props: PageProps }) {
  const s = useStore();
  const { t } = useI18n();
  const spaceIds = useSpaceSections();
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const cur = path[path.length - 1] ?? "account";
  const top = path[0] ?? "account";
  const matches = (id: string) => {
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return `${t.sx.sections[id as keyof typeof t.sx.sections]} ${(t.sx.keywords as Record<string, string>)[id] ?? ""}`.toLowerCase().includes(k);
  };
  const you = YOU.filter(matches);
  const space = spaceIds.filter(matches);
  const sp = s.space;
  const isSpace = (SPACE as readonly string[]).includes(top);
  const Page = (YOU_PAGES as Record<string, React.ComponentType<PageProps>>)[cur] ?? (SPACE_PAGES as Record<string, React.ComponentType<PageProps>>)[cur];
  const navBtn = (id: string) => (
    <button key={id} type="button" className={cn("sx-nav", top === id && "on")} aria-current={top === id ? "page" : undefined} onClick={() => setPath([id])} data-sx-nav={id}>
      <I d={P[id as keyof typeof P]} />
      {t.sx.sections[id as keyof typeof t.sx.sections]}
    </button>
  );

  return (
    <>
      <D.Overlay className="sx-scrim overlay-in" data-sheet-scrim />
      <D.Content
        className="sx-dialog sx-in"
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (document.activeElement === search.current && q) {
            e.preventDefault();
            setQ("");
          } else if (path.length > 1) {
            e.preventDefault();
            back();
          }
        }}
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest?.("[data-sonner-toaster]")) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "/" && !(e.target as HTMLElement).closest("input, textarea, select")) {
            e.preventDefault();
            search.current?.focus();
          }
        }}
        data-settings
        data-settings-section={cur}
      >
        <D.Title className="sr-only">{t.sx.title}</D.Title>
        <D.Close className="btn sm icon" style={{ position: "absolute", top: 16, insetInlineEnd: 16, zIndex: 3 }} aria-label={t.sx.close} data-settings-close>
          <I d={P.close} />
        </D.Close>
        <aside className="sx-aside" aria-label={t.sx.title}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 30 }}>
            <b style={{ fontSize: 15, flex: 1 }}>{t.sx.title}</b>
            <span className="kbd">Esc</span>
          </div>
          <label className="input" style={{ height: 34, borderRadius: 8, margin: "6px 0 4px", fontSize: 13, padding: "0 10px" }}>
            <I d={P.search} size="sm" className="faint" />
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                const first = [...you, ...space][0];
                if (e.key === "Enter" && first) {
                  setPath([first]);
                  setQ("");
                }
              }}
              placeholder={t.sx.search}
              aria-label={t.sx.search}
              style={{ fontSize: 13 }}
              data-settings-search
            />
            <span className="kbd">/</span>
          </label>
          {you.length > 0 && (
            <div className="sx-group">
              <Av name={s.me?.name || s.me?.email || "?"} color={avatarColor(s.me?.id ?? "")} size="xs" />
              {t.sx.you}
            </div>
          )}
          {you.map(navBtn)}
          {sp && space.length > 0 && (
            <div className="sx-group" style={{ paddingTop: 18 }}>
              <SpaceLook space={sp} size={22} />
              <span style={{ flex: 1, color: "var(--ink2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sp.name}</span>
              <span className="badge" style={{ height: 18, fontSize: 11 }}>
                {t.spaces.roles[sp.role]}
              </span>
            </div>
          )}
          {sp && space.map(navBtn)}
          {you.length + space.length === 0 && <p className="tiny" style={{ padding: "10px" }}>{t.sx.noMatch}</p>}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid var(--line-in)", paddingTop: 8 }}>
            <button type="button" className="sx-nav" onClick={() => s.openReport()} data-settings-report>
              <I d={P.flag} />
              {t.sx.reportProblem}
            </button>
            <form action="/api/logout" method="post">
              <button type="submit" className="sx-nav">
                <I d={P.signOut} />
                {t.nav.signOut}
              </button>
            </form>
          </div>
        </aside>
        <main className="sx-main" style={isSpace ? { padding: "12px 12px 24px" } : undefined}>
          {isSpace && sp && <SpaceCover onEdit={() => props.go("general")} compact={false} />}
          <div key={cur} className={cn("sx-body", dir === "back" ? "sx-page back" : "sx-page")} style={isSpace ? { minHeight: 0, marginTop: 18, padding: "0 24px" } : undefined}>
            {path.length > 1 && (
              <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start", marginInlineStart: -10, marginBottom: -12 }} onClick={back} data-settings-back>
                <I d={P.back} size="sm" className="flip" />
                {t.sx.sections[path[0] as keyof typeof t.sx.sections]}
              </button>
            )}
            {Page && <Page {...props} />}
          </div>
        </main>
      </D.Content>
    </>
  );
}

// ---------------- phone ----------------

function BackLevel({ onBack }: { onBack: () => void }) {
  useBackClose(true, onBack, PHONE_NAV);
  return null;
}

function Phone({ path, back, dir, props }: { path: string[]; back: () => void; dir: "in" | "back"; props: PageProps }) {
  const { t } = useI18n();
  useBackClose(true, props.close, PHONE_NAV);
  const cur = path[path.length - 1];
  const title = !cur ? t.sx.title : cur === "space" ? t.sx.spaceSettings : t.sx.sections[cur as keyof typeof t.sx.sections];
  const Page = cur ? ((YOU_PAGES as Record<string, React.ComponentType<PageProps>>)[cur] ?? (SPACE_PAGES as Record<string, React.ComponentType<PageProps>>)[cur]) : null;
  // Swipe from the start edge goes back (iOS-style); the system back gesture/button does too (BackLevel).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  return (
    <D.Content
      className="sx-phone"
      aria-describedby={undefined}
      onEscapeKeyDown={(e) => {
        if (path.length > 0) {
          e.preventDefault();
          back();
        }
      }}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).focus();
      }}
      onTouchStart={(e) => {
        const x = e.touches[0].clientX;
        const edge = rtl ? window.innerWidth - x : x;
        touch.current = path.length > 0 && edge < 28 ? { x, y: e.touches[0].clientY } : null;
      }}
      onTouchEnd={(e) => {
        const st = touch.current;
        touch.current = null;
        if (!st) return;
        const dx = (e.changedTouches[0].clientX - st.x) * (rtl ? -1 : 1);
        const dy = Math.abs(e.changedTouches[0].clientY - st.y);
        if (dx > 70 && dy < dx * 0.6) back();
      }}
      data-settings
      data-settings-section={cur ?? "list"}
    >
      {path.map((_, k) => (
        <BackLevel key={`${k}:${path.slice(0, k + 1).join("/")}`} onBack={back} />
      ))}
      <D.Title className="sr-only">{title}</D.Title>
      {cur === "space" ? null : (
        <div className="sx-pbar">
          <button type="button" className="btn icon ghost" onClick={() => (path.length ? back() : props.close())} aria-label={path.length ? t.sx.back : t.sx.close} data-settings-back>
            <I d={P.back} className="flip" />
          </button>
          <b>{title}</b>
        </div>
      )}
      <div className="sx-pscroll" style={cur === "space" ? { padding: 0 } : undefined}>
        <div key={cur ?? "list"} className={cn(dir === "back" ? "sx-page back" : "sx-page")} style={{ minHeight: "100%" }}>
          {!cur ? <PhoneList go={props.go} /> : cur === "space" ? <SpaceHub props={props} back={back} /> : Page ? <div className="sx-body">{Page && <Page {...props} />}</div> : null}
        </div>
      </div>
    </D.Content>
  );
}

function PhoneList({ go }: { go: (id: SectionId) => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const { theme } = useTheme();
  const sp = s.space;
  const row = (id: SectionId, val?: string, tone?: string) => (
    <button key={id} type="button" className="sx-prow" onClick={() => go(id)} data-sx-nav={id}>
      <span className={cn("ic", tone)}>
        <I d={P[id as keyof typeof P]} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{t.sx.sections[id as keyof typeof t.sx.sections]}</span>
      {val && <span className="val">{val}</span>}
      <I d={P.chevron} size="sm" className="flip" />
    </button>
  );
  const themeLabel = theme === "dark" ? t.settings.dark : theme === "light" ? t.settings.light : t.sx.matchDevice;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} data-settings-list>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 4px 0" }}>
        <Av name={s.me?.name || s.me?.email || "?"} color={avatarColor(s.me?.id ?? "")} size="xl" />
        <span style={{ lineHeight: 1.35, minWidth: 0 }}>
          <b style={{ fontSize: 17 }}>{s.me?.name || s.me?.email}</b>
          <br />
          <span className="sub">{s.me?.email}</span>
        </span>
      </div>
      <div>
        <p className="sec" style={{ paddingInlineStart: 4 }}>{t.sx.you}</p>
        <div className="card">
          {row("account")}
          {row("display", themeLabel)}
          {row("notif", t.sx.inApp)}
          {row("ai", s.homePrefs.aiSuggestions ? t.sx.aiRules : t.sx.rulesOnly)}
          {row("calendar")}
          {row("memory")}
          {row("data")}
        </div>
      </div>
      {sp && (
        <div>
          <p className="sec" style={{ display: "flex", alignItems: "center", gap: 8, paddingInlineStart: 4 }}>
            <SpaceLook space={sp} size={20} />
            {sp.name}
          </p>
          <div className="card">
            <button type="button" className="sx-prow" onClick={() => go("space" as SectionId)} data-sx-nav="space">
              <span className="ic">
                <I d={P.general} />
              </span>
              <span style={{ flex: 1 }}>{t.sx.spaceSettings}</span>
              <span className="val">{sp.kind === "shared" ? f(t.sx.peopleN, { n: s.people.length || 1 }) : t.sx.personalPeople}</span>
              <I d={P.chevron} size="sm" className="flip" />
            </button>
          </div>
        </div>
      )}
      <div className="card">
        <button type="button" className="sx-prow" onClick={() => s.openReport()} data-settings-report>
          <span className="ic">
            <I d={P.flag} />
          </span>
          <span style={{ flex: 1 }}>{t.sx.reportProblem}</span>
        </button>
        <form action="/api/logout" method="post" className="sx-prow" style={{ padding: 0 }}>
          <button type="submit" className="sx-prow" style={{ color: "var(--danger)" }}>
            <span className="ic dng">
              <I d={P.signOut} />
            </span>
            <span style={{ flex: 1 }}>{t.nav.signOut}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

/** Phone: the space's own list (SpaceSettings-phone "list"): cover band, people online, sections, Invite people. */
function SpaceHub({ props, back }: { props: PageProps; back: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  const presence = usePresence();
  const ids = useSpaceSections();
  const sp = s.space;
  const summary = useMemo(() => ({ general: t.sx.generalSub } as Record<string, string>), [t]);
  if (!sp) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-space-hub>
      <SpaceCover onEdit={() => props.go("general")} compact onBack={back} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 16px 24px" }}>
        {sp.kind === "shared" && s.people.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Facepile people={s.people} size={26} max={4} online={presence.online} />
            {presence.shopping[0] && <span className="sub">{t.sx.shoppingNow}</span>}
          </div>
        )}
        <div className="card">
          {ids.map((id) => (
            <button key={id} type="button" className="sx-prow" onClick={() => props.go(id)} data-sx-nav={id}>
              <span className={cn("ic", id === "danger" && "dng")}>
                <I d={P[id]} />
              </span>
              <span style={{ flex: 1 }}>{t.sx.sections[id]}</span>
              {summary[id] && <span className="val">{summary[id]}</span>}
              <I d={P.chevron} size="sm" className="flip" />
            </button>
          ))}
        </div>
        {sp.kind === "shared" && sp.role !== "viewer" && (
          <button type="button" className="btn pri block lg" onClick={() => openSpaces({ kind: "invite" })} data-space-invite>
            <I d={P.userPlus} />
            {t.spaces.invite}
          </button>
        )}
      </div>
    </div>
  );
}
