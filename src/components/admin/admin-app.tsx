"use client";

import "../auth/nx.css";
import "../app/settings/nx16.css";
import "./nx17.css";
import "./admin.css";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getAdminNav } from "@/app/admin-actions";
import { CrashBoundary } from "@/components/crash";
import { useI18n } from "@/components/providers";
import { useMedia } from "@/components/ui/use-media";
import { AiTab } from "./ai";
import { ErrorsTab } from "./errors";
import { InvitesTab } from "./invites";
import { LiveTab } from "./live";
import { PeopleTab } from "./people";
import { ReportsTab } from "./reports";
import { SystemTab } from "./system";
import { parseRoute, pathOf, type Route, type Tab } from "./route";
import { beatHere, PATH, Svg, useVisiblePoll } from "./ui";

// R17 G0 — the admin panel (boards Admin-desktop / Admin-phone). /admin and /admin/<tab>[/<id>] deep links; the server
// page already refused everyone but the admin (404). Desktop (≥ 1024 px): sidebar (Live · Manage · Health) + the tab.
// Phone: large titles + a translucent bottom tab bar (Live · People · Reports · More); a person / a report is a pushed
// page (Back, Android Back and the edge swipe = history back).

export type Nav = { online: number; people: number; reports: number; errors: number; waiting: number };
export type Go = (tab: Tab, sub?: string | null, opts?: { replace?: boolean }) => void;
export type { Tab, Route };

const noop = () => () => {};

export function AdminApp({ initial, me }: { initial: Route; me: string }) {
  const { t, f } = useI18n();
  const [route, setRoute] = useState<Route>(initial);
  const [nav, setNav] = useState<Nav | null>(null);
  const phone = useMedia("(max-width: 1023px)");
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const go: Go = useCallback((tab, sub = null, opts) => {
    const r = { tab, sub };
    if (opts?.replace) window.history.replaceState({ admin: r }, "", pathOf(r));
    else window.history.pushState({ admin: r }, "", pathOf(r));
    setRoute(r);
  }, []);
  useEffect(() => {
    const pop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  // Live carries the nav counts in its own 5 s poll; every other tab refreshes them every 30 s (one request each).
  useVisiblePoll(
    async () => {
      if (route.tab === "live") return;
      await getAdminNav(beatHere("admin")).then(setNav, () => {});
    },
    30_000,
    [route.tab === "live"],
  );

  const items: { id: Tab; group?: string; count?: number; hot?: boolean }[] = [
    { id: "live" },
    { id: "people", group: t.adm.manage, count: nav?.people || undefined },
    { id: "invites", count: nav?.waiting || undefined },
    { id: "ai" },
    { id: "reports", group: t.adm.health, count: nav?.reports || undefined, hot: !!nav?.reports },
    { id: "errors", count: nav?.errors || undefined },
    { id: "system" },
  ];
  const label = (id: Tab) => t.adm.tabs[id];
  const cur: Tab = route.tab;
  const phoneTab: Tab = ["live", "people", "reports"].includes(cur) ? cur : "more";

  const body = !hydrated ? null : (
    <CrashBoundary key={`${route.tab}/${route.sub ?? ""}`} where="admin">
      <TabBody route={route} phone={phone} go={go} me={me} nav={nav} setNav={setNav} />
    </CrashBoundary>
  );

  return (
    <div className="nx adm" data-admin={route.tab}>
      <aside className="ad-side" aria-label={t.adm.nav}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 10px 14px" }}>
          <span className="logo">
            <Svg d={PATH.logo} className="i lg" />
            Nexus
          </span>
          <span className="badge" style={{ marginInlineStart: "auto" }}>
            {t.adm.title}
          </span>
        </div>
        {items.map((it) => (
          <div key={it.id} style={{ display: "contents" }}>
            {it.group && <div className="navlabel">{it.group}</div>}
            <button type="button" className={`navb${cur === it.id ? " on" : ""}`} aria-current={cur === it.id ? "page" : undefined} onClick={() => go(it.id)} data-admin-nav={it.id}>
              <Svg d={PATH[it.id as keyof typeof PATH]} />
              {label(it.id)}
              {it.id === "live" && nav != null && (
                <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--ok)" }} data-admin-online={nav.online}>
                  <span className="ping" aria-hidden="true" />
                  {nav.online}
                </span>
              )}
              {it.count != null && <span className={`cnt${it.hot ? " hot" : ""}`}>{it.count}</span>}
            </button>
          </div>
        ))}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="lock" style={{ alignSelf: "flex-start", marginInlineStart: 6 }}>
            <Svg d={PATH.lock} className="i" />
            {t.adm.countsOnly}
          </span>
          <Link className="nav navb" href="/" data-admin-back>
            <Svg d={PATH.back} className="i sm flip" />
            {t.adm.back}
          </Link>
        </div>
      </aside>

      <main className="ad-main" id="admin-main">
        {body}
      </main>

      {!(phone && route.sub && (route.tab === "people" || route.tab === "reports")) && (
        <nav className="tabbar" aria-label={t.adm.nav}>
          {(["live", "people", "reports", "more"] as const).map((id) => (
            <button key={id} type="button" className={`tab-b${phoneTab === id ? " on" : ""}`} aria-current={phoneTab === id ? "page" : undefined} onClick={() => go(id)} data-admin-tab={id}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={PATH[id]} />
              </svg>
              {label(id)}
              {id === "reports" && !!nav?.reports && (
                <span className="bd" aria-label={f(t.adm.rep.open, { n: nav.reports })}>
                  {nav.reports}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function TabBody({ route, phone, go, me, nav, setNav }: { route: Route; phone: boolean; go: Go; me: string; nav: Nav | null; setNav: (n: Nav) => void }) {
  switch (route.tab) {
    case "live":
      return <LiveTab phone={phone} go={go} onNav={setNav} />;
    case "people":
      return <PeopleTab phone={phone} go={go} me={me} person={route.sub} />;
    case "invites":
      return <InvitesTab phone={phone} go={go} />;
    case "ai":
      return <AiTab phone={phone} go={go} />;
    case "reports":
      return <ReportsTab phone={phone} go={go} report={route.sub} />;
    case "errors":
      return <ErrorsTab phone={phone} go={go} />;
    case "system":
      return <SystemTab phone={phone} go={go} />;
    default:
      return <MorePage go={go} nav={nav} />;
  }
}

/** Phone "More": Invites, AI usage, Errors, System. */
function MorePage({ go, nav }: { go: Go; nav: Nav | null }) {
  const { t, f } = useI18n();
  const rows: [Tab, string, string | null][] = [
    ["invites", PATH.invites, nav?.waiting ? `${t.adm.inv.waiting} · ${nav.waiting}` : null],
    ["ai", PATH.ai, null],
    ["errors", PATH.errors, nav ? f(t.adm.err.open, { n: nav.errors }) : null],
    ["system", PATH.system, null],
  ];
  return (
    <div className="page">
      <h1 className="lt">{t.adm.tabs.more}</h1>
      <div className="card">
        {rows.map(([id, d, sub]) => (
          <button key={id} type="button" className="li" onClick={() => go(id)} data-admin-more={id}>
            <span className={`ic${id === "system" ? " ok" : ""}`} style={{ width: 34, height: 34 }}>
              <Svg d={d} />
            </span>
            <span className="grow">
              <b>{t.adm.tabs[id]}</b>
              {sub && <span>{sub}</span>}
            </span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
              <path d={PATH.chev} />
            </svg>
          </button>
        ))}
      </div>
      <Link className="li card" href="/" style={{ minHeight: 52 }}>
        <span className="grow">
          <b>{t.adm.back}</b>
        </span>
        <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d={PATH.chev} />
        </svg>
      </Link>
      <span className="lock" style={{ alignSelf: "center" }}>
        <Svg d={PATH.lock} className="i" />
        {t.adm.countsOnly}
      </span>
    </div>
  );
}
