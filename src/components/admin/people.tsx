"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteUserAccount, getPerson, listPeople, resetAiToday, setAiQuota, setBan, signOutDevice, signOutEverywhere } from "@/app/admin-actions";
import { useI18n } from "@/components/providers";
import type { PersonDetail, PersonRow } from "@/lib/db-scoped/admin";
import type { Go } from "./admin-app";
import { Av, DevChip, Failed, PATH, Skeleton, Svg, useLoad, useNow, useScreenLabel, useTimes, useVisiblePoll } from "./ui";

// R17 G2 — People (boards Admin-desktop "People" + drawer, Admin-phone "People" / "Person"). Filters All / Online /
// Quiet 30 days / Deleting, search by name or email. A person: desktop = a 432 px right drawer (--ease-drawer, scrim,
// Esc / ✕, focus trapped and returned); phone = a pushed page. AI today + daily limit (E2), reset, devices (sign out
// one), sign out everywhere, ban, and hold-to-delete (2 s; keyboard: hold Space / Enter; screen readers: a confirm).

const DAY = 86_400_000;
const QUIET = 30 * DAY;
type Filter = "all" | "online" | "quiet" | "deleting";

function useStatus() {
  const { t, f } = useI18n();
  const p = t.adm.people;
  return (r: PersonRow, now: number): [string, string] => {
    if (r.deletionRequestedAt != null) return [f(p.sDeleting, { n: Math.max(0, Math.ceil((r.deletionRequestedAt + 7 * DAY - now) / DAY)) }), "badge dng"];
    if (r.banned) return [p.sBanned, "badge dng"];
    if (r.admin) return [p.sAdmin, "badge"];
    if (r.ai.limit != null && r.ai.used >= r.ai.limit) return [p.sLimit, "badge warn"];
    if (now - r.createdAt < DAY) return [p.sNew, "badge info"];
    if (!r.lastSeen || now - r.lastSeen > QUIET) return [p.sQuiet, "badge"];
    return [p.sActive, "badge ok"];
  };
}

function useAi() {
  const { t, f } = useI18n();
  return (a: PersonRow["ai"]) => ({
    text: a.limit == null ? f(t.adm.people.noLimit, { n: a.used }) : f(t.adm.people.ofLimit, { n: a.used, l: a.limit }),
    pct: Math.min(100, a.limit == null ? (a.used / 40) * 100 : a.limit === 0 ? 100 : (a.used / a.limit) * 100),
    full: a.limit != null && a.used >= a.limit,
  });
}

export function PeopleTab({ phone, go, me, person }: { phone: boolean; go: Go; me: string; person: string | null }) {
  const { t, f } = useI18n();
  const { data, setData, failed, reload } = useLoad(() => listPeople(), []);
  // The list keeps its "Now" column fresh (30 s while visible).
  useVisiblePoll(() => listPeople().then(setData, () => {}), 30_000);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const now = useNow();
  const status = useStatus();
  const ai = useAi();
  const screen = useScreenLabel();
  const { ago } = useTimes();
  const opener = useRef<HTMLElement | null>(null);

  const counts = useMemo(() => {
    const rows = data ?? [];
    return {
      all: rows.length,
      online: rows.filter((r) => r.online).length,
      quiet: rows.filter((r) => r.deletionRequestedAt == null && (!r.lastSeen || now - r.lastSeen > QUIET)).length,
      deleting: rows.filter((r) => r.deletionRequestedAt != null).length,
    };
  }, [data, now]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (filter === "online" && !r.online) return false;
      if (filter === "quiet" && !(r.deletionRequestedAt == null && (!r.lastSeen || now - r.lastSeen > QUIET))) return false;
      if (filter === "deleting" && r.deletionRequestedAt == null) return false;
      return !needle || r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle);
    });
  }, [data, filter, q, now]);

  const seen = (r: PersonRow) => (r.online ? (r.online.screen === "shopping-mode" ? f(t.adm.live.shoppingLeft, { n: r.online.shoppingLeft ?? 0 }) : screen(r.online.screen)) : r.lastSeen ? ago(r.lastSeen, now) : t.adm.people.notSeen);
  const open = (id: string, el: HTMLElement) => {
    opener.current = el;
    go("people", id);
  };
  const close = () => {
    if (window.history.state?.admin?.tab === "people" && window.history.length > 1) window.history.back();
    else go("people", null, { replace: true });
    requestAnimationFrame(() => opener.current?.focus());
  };
  const changed = (p: PersonDetail | null) => {
    if (!p) return void reload();
    setData((d) => d?.map((r) => (r.id === p.id ? { ...r, ...p } : r)) ?? d);
  };

  const filters: [Filter, string][] = [
    ["all", f(t.adm.people.all, { n: counts.all })],
    ["online", f(t.adm.people.online, { n: counts.online })],
    ["quiet", f(t.adm.people.quiet, { n: counts.quiet })],
    ["deleting", f(t.adm.people.deleting, { n: counts.deleting })],
  ];
  const chips = (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", flexShrink: 0 }} role="group">
      {filters.map(([k, label]) => (
        <button key={k} type="button" className={`chipb${filter === k ? " on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)} data-people-filter={k}>
          {k === "online" && <span className="ping" style={{ width: 7, height: 7 }} aria-hidden="true" />}
          {label}
        </button>
      ))}
    </div>
  );

  if (phone && person)
    return <PersonView key={person} id={person} me={me} phone onBack={close} onChanged={changed} />;

  if (phone)
    return (
      <div className="page" data-people>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <h1 className="lt" style={{ flex: 1 }}>
            {t.adm.tabs.people}
          </h1>
          <button type="button" className="btn sm pri" onClick={() => go("invites")}>
            {t.adm.people.invite}
          </button>
        </div>
        <label className="input">
          <Svg d={PATH.search} />
          <input placeholder={t.adm.people.searchShort} aria-label={t.adm.people.search} style={{ fontSize: 16 }} value={q} onChange={(e) => setQ(e.target.value)} data-people-search />
        </label>
        {chips}
        {failed && <Failed onRetry={reload} />}
        {!data ? (
          <Skeleton rows={6} h={60} />
        ) : (
          <div className="card">
            {rows.length === 0 && <div className="empty">{t.adm.people.none}</div>}
            {rows.map((r) => {
              const a = ai(r.ai);
              return (
                <button key={r.id} type="button" className="li tap" onClick={(e) => open(r.id, e.currentTarget)} data-person-row={r.id}>
                  <Av id={r.id} name={r.name} size="lg" ring={r.online ? "on" : null} />
                  <span className="grow">
                    <b className="bidi">{r.name}</b>
                    <span>{seen(r)}</span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span className={`qbar${a.full ? " full" : ""}`} style={{ width: 48 }}>
                      <i style={{ width: `${a.pct}%` }} />
                    </span>
                    <span className="tiny num">{a.text}</span>
                  </span>
                  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d={PATH.chev} />
                  </svg>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );

  return (
    <>
      <div className="ad-top">
        <h1>{t.adm.tabs.people}</h1>
        <span className="sub num">{counts.all}</span>
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label className="input" style={{ height: 38, width: 260 }}>
            <Svg d={PATH.search} />
            <input placeholder={t.adm.people.search} aria-label={t.adm.people.search} style={{ fontSize: 14 }} value={q} onChange={(e) => setQ(e.target.value)} data-people-search />
          </label>
          <button type="button" className="btn pri" style={{ height: 38 }} onClick={() => go("invites")}>
            <Svg d={PATH.plus} />
            {t.adm.people.invite}
          </button>
        </div>
      </div>
      <div className="ad-body" data-people>
        {chips}
        {failed && <Failed onRetry={reload} />}
        <section className="panel" style={{ paddingTop: 12, flexShrink: 0 }}>
          <div className="th-t ppl-cols">
            <span>{t.adm.people.cPerson}</span>
            <span>{t.adm.people.cNow}</span>
            <span>{t.adm.people.cSpaces}</span>
            <span>{t.adm.people.cItems}</span>
            <span>{t.adm.people.cAi}</span>
            <span>{t.adm.people.cStatus}</span>
          </div>
          {!data && <div style={{ padding: "0 18px 14px" }}><Skeleton rows={5} h={48} /></div>}
          {data && rows.length === 0 && <div className="empty">{t.adm.people.none}</div>}
          {rows.map((r) => {
            const a = ai(r.ai);
            const [st, cls] = status(r, now);
            return (
              <button key={r.id} type="button" className={`row-t ppl-cols${person === r.id ? " sel" : ""}`} onClick={(e) => open(r.id, e.currentTarget)} data-person-row={r.id}>
                <span className="who-c">
                  <Av id={r.id} name={r.name} ring={r.online ? "on" : null} />
                  <span className="nm">
                    <b className="bidi" title={r.name}>{r.name}</b>
                    <span className="bidi" title={r.email}>{r.email}</span>
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {r.online && <DevChip device={r.online.device} />}
                  <span className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={seen(r)}>
                    {seen(r)}
                  </span>
                </span>
                <span className="num">{r.spaces}</span>
                <span className="num">{r.items}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span className={`qbar${a.full ? " full" : ""}`}>
                    <i style={{ width: `${a.pct}%` }} />
                  </span>
                  <span className="tiny num" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.text}>
                    {a.text}
                  </span>
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={cls} style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }} title={st} data-person-status>
                    {st}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      </div>
      {person && <PersonView key={person} id={person} me={me} phone={false} onBack={close} onChanged={changed} />}
    </>
  );
}

const QUOTAS: [string, number | "unlimited" | null][] = [
  ["20", 20],
  ["40", null],
  ["80", 80],
  ["unl", "unlimited"],
];

/** One person — the desktop drawer or the phone page. */
function PersonView({ id, me, phone, onBack, onChanged }: { id: string; me: string; phone: boolean; onBack: () => void; onChanged: (p: PersonDetail | null) => void }) {
  const { t, f } = useI18n();
  const P = t.adm.person;
  const { data: p, setData, failed, reload } = useLoad(() => getPerson(id), [id]);
  const ai = useAi();
  const screen = useScreenLabel();
  const { dur, ago } = useTimes();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const box = useRef<HTMLElement>(null);
  const now = useNow();
  const self = id === me;

  // Desktop drawer: Esc closes, focus moves in and stays inside (returned to the row by onBack).
  useEffect(() => {
    if (phone) return;
    const el = box.current;
    el?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirm) {
        e.preventDefault();
        onBack();
      }
      if (e.key === "Tab" && el) {
        const all = [...el.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input,[tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null);
        if (!all.length) return;
        const first = all[0], last = all[all.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [phone, onBack, confirm]);

  const run = async <T,>(fn: () => Promise<T>, ok?: (r: T) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      ok?.(r);
    } catch {
      toast.error(t.adm.retry);
    } finally {
      setBusy(false);
    }
  };
  const update = (next: PersonDetail | null) => {
    if (next) setData(next);
    onChanged(next);
  };
  const doDelete = () =>
    run(
      () => deleteUserAccount(id),
      (r) => {
        setConfirm(false);
        if (r.ok) {
          toast.success(f(P.deleted, { name: p?.name ?? "" }));
          void getPerson(id).then(update);
        } else if (r.reason === "self") toast.error(P.self);
        else toast.error(f(P.owner, { name: p?.name ?? "", spaces: r.spaces.join(", ") }), { duration: 8000 });
      },
    );

  const head = p && (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: phone ? 0 : "18px 18px 14px 20px" }}>
      <Av id={p.id} name={p.name} size="xl" ring={p.online ? "on" : null} />
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
        <b style={{ fontSize: phone ? 20 : 17, letterSpacing: "-.01em", overflowWrap: "anywhere" }} data-person-name>
          {p.name}
        </b>
        <br />
        <span className="sub" style={{ overflowWrap: "anywhere" }}>
          {p.email}
        </span>
      </span>
      {!phone && (
        <button type="button" className="btn icon ghost" onClick={onBack} aria-label={P.close} data-person-close>
          <Svg d={PATH.close} className="i" />
        </button>
      )}
    </div>
  );

  const deviceWord = (d: "phone" | "computer") => (d === "phone" ? P.phone : P.computer).toLowerCase();
  const banner = p && (
    <>
      {p.deletionRequestedAt != null && (
        <div className="alert dng" data-person-deleting>
          {f(P.deletingBanner, { n: Math.max(0, Math.ceil((p.deletionRequestedAt + 7 * DAY - now) / DAY)) })}
        </div>
      )}
      {p.banned && <div className="alert dng">{P.bannedBanner}</div>}
      {p.online ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: phone ? 14 : 12, background: "var(--ok-t)", color: "var(--ok)", fontSize: phone ? 14 : 13.5, fontWeight: 600 }} data-person-now>
          <span className="ping" aria-hidden="true" />
          <span style={{ flex: 1, minWidth: 0 }}>
            {p.online.screen === "shopping-mode"
              ? f(P.shoppingNow, { device: deviceWord(p.online.device), n: p.online.shoppingLeft ?? 0 })
              : f(P.onlineOn, { device: deviceWord(p.online.device), screen: screen(p.online.screen) })}
          </span>
          <span className="num" style={{ fontWeight: 500 }}>
            {dur(now - p.online.since)}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "var(--s)", color: "var(--muted)", fontSize: 13.5, fontWeight: 600 }} data-person-now>
          <span className="dot off" aria-hidden="true" />
          {p.lastSeen ? f(P.lastSeen, { ago: ago(p.lastSeen, now) }) : P.notSeen}
        </div>
      )}
    </>
  );

  const stats = p && (
    <div className="stat3">
      <div>
        <span className="tiny">{P.spaces}</span>
        <b>{p.spaces}</b>
      </div>
      <div>
        <span className="tiny">{P.items}</span>
        <b>{p.items}</b>
      </div>
      <div>
        <span className="tiny">{P.chats}</span>
        <b>{p.chats}</b>
      </div>
    </div>
  );

  const a = p ? ai(p.ai) : null;
  const curQ = p ? (p.ai.limit == null ? "unl" : String(p.ai.limit)) : "40";
  const quota = p && a && (
    <div className={phone ? "card" : undefined} style={phone ? { padding: 14, display: "flex", flexDirection: "column", gap: 10 } : undefined} data-person-ai>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="label" style={{ flex: 1 }}>
          {P.aiToday}
        </span>
        <b className="num" style={{ fontSize: 15 }} data-person-ai-used>
          {a.text}
        </b>
      </div>
      <div className="meter" style={{ marginTop: phone ? 0 : 8, height: 8 }}>
        <i style={{ width: `${a.pct}%` }} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: phone ? 4 : 12 }}>
        <div className="seg" style={{ flex: 1, display: "flex" }} role="group" aria-label={P.limitHint}>
          {QUOTAS.map(([k, v]) => (
            <button
              key={k}
              type="button"
              className={curQ === k ? "on" : ""}
              aria-pressed={curQ === k}
              style={{ flex: 1, justifyContent: "center", height: phone ? 40 : undefined }}
              disabled={busy || p.admin}
              onClick={() => run(() => setAiQuota(id, v), (al) => (update({ ...p, ai: al }), toast.success(P.quotaSaved)))}
              data-quota={k}
            >
              {k === "unl" ? P.noLimit : k}
            </button>
          ))}
        </div>
        {!phone && (
          <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => resetAiToday(id), (al) => (update({ ...p, ai: al }), toast.success(P.resetDone)))} data-person-reset>
            {P.reset}
          </button>
        )}
      </div>
      {phone && (
        <button type="button" className="btn block" disabled={busy} onClick={() => run(() => resetAiToday(id), (al) => (update({ ...p, ai: al }), toast.success(P.resetDone)))} data-person-reset>
          {P.reset}
        </button>
      )}
      <div className="tiny" style={{ marginTop: phone ? 0 : 6 }}>
        {P.limitHint}
      </div>
    </div>
  );

  const devices = p && (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        {P.devices}
      </div>
      <div className="card">
        {p.devices.length === 0 && <div className="empty">{P.noDevices}</div>}
        {p.devices.map((d) => (
          <div key={d.id} className="hl" style={{ padding: "8px 12px", minHeight: phone ? 52 : 40 }} data-person-device={d.id}>
            <DevChip device={d.kind === "phone" ? "phone" : "computer"} />
            {(() => {
              const label = d.installed ? (d.os ? f(P.appOn, { os: d.os }) : P.app) : [d.browser, d.os].filter(Boolean).join(", ") || "—";
              return (
                <span className="grow" title={label}>
                  {label}
                </span>
              );
            })()}
            <span className="r" style={d.online ? { color: "var(--ok)" } : undefined}>
              {d.online ? P.activeNow : ago(d.lastActive, now)}
            </span>
            {!d.online || !self ? (
              <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => signOutDevice(id, d.id), (n) => (update(n), toast.success(P.signedOut)))} data-person-signout-device>
                {P.signOut}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );

  const actions = p && (
    <>
      <button type="button" className="btn sm" disabled={busy || self} onClick={() => run(() => signOutEverywhere(id), (r) => r.ok && (update(r.person), toast.success(P.signedOut)))} data-person-signout-all>
        {phone ? P.signOutAllShort : P.signOutAll}
      </button>
      <button type="button" className="btn sm" disabled={busy || self} onClick={() => run(() => setBan(id, !p.banned), (r) => r.ok && (update(r.person), toast.success(p.banned ? P.unbanned : P.banned)))} data-person-ban={p.banned ? "on" : "off"}>
        {p.banned ? P.unban : P.ban}
      </button>
    </>
  );
  const hold = p && !self && p.deletionRequestedAt == null && (
    <HoldButton label={phone ? P.holdLong : P.hold} aria={P.holdAria} onDone={doDelete} onConfirm={() => setConfirm(true)} disabled={busy} phone={phone} />
  );
  const dialog = confirm && p && (
    <div className="nx" style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div className="scrim" style={{ position: "fixed" }} onClick={() => setConfirm(false)} />
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="del-t" aria-describedby="del-b" style={{ position: "fixed", insetInline: 16, top: "30%", maxWidth: 420, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <b id="del-t" style={{ fontSize: 17 }}>
          {P.confirmTitle}
        </b>
        <p id="del-b" className="sub" style={{ margin: 0 }}>
          {f(P.confirmBody, { name: p.name })}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={() => setConfirm(false)} autoFocus>
            {P.cancel}
          </button>
          <button type="button" className="btn dng" onClick={doDelete} data-person-delete-confirm>
            {P.confirm}
          </button>
        </div>
      </div>
    </div>
  );

  if (phone)
    return (
      <>
        <div className="bar">
          <button type="button" className="btn icon ghost" onClick={onBack} aria-label={P.backAria} data-person-back>
            <Svg d={PATH.back} className="i flip" />
          </button>
          <span className="sub">{P.back}</span>
        </div>
        <div className="page push under-bar" style={{ gap: 16, paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 30px)" }} data-person={id}>
          {failed && <Failed onRetry={reload} />}
          {!p ? (
            <Skeleton rows={5} h={56} />
          ) : (
            <>
              {head}
              {banner}
              {stats}
              {quota}
              <div className="card" style={{ padding: 0 }}>
                {devices}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: "auto" }}>
                {actions}
                {hold && <div style={{ gridColumn: "span 2" }}>{hold}</div>}
              </div>
              {hold && (
                <span className="tiny" style={{ textAlign: "center", marginTop: -8 }}>
                  {P.holdHintShort}
                </span>
              )}
            </>
          )}
        </div>
        {dialog}
      </>
    );

  return (
    <>
      <div className="scrim-s" onClick={onBack} aria-hidden="true" />
      <aside className="drawer" aria-label={P.details} role="dialog" aria-modal="true" tabIndex={-1} ref={box} data-person={id}>
        {failed && (
          <div style={{ padding: 20 }}>
            <Failed onRetry={reload} />
          </div>
        )}
        {!p ? (
          <div style={{ padding: 20 }}>
            <Skeleton rows={6} h={56} />
          </div>
        ) : (
          <>
            {head}
            <div className="body">
              {banner}
              {stats}
              {quota}
              {devices}
            </div>
            <div style={{ display: "flex", gap: 8, padding: "14px 20px", borderTop: "1px solid var(--line-in)", alignItems: "center" }}>
              {actions}
              <span style={{ flex: 1 }} />
              {hold}
            </div>
            {hold && (
              <div className="tiny" style={{ padding: "0 20px 14px", textAlign: "end" }}>
                {P.holdHint}
              </div>
            )}
          </>
        )}
      </aside>
      {dialog}
    </>
  );
}

/** Press and hold 2 s (pointer, or Space / Enter held) → onDone. Release early → nothing (the fill snaps back in
 *  200 ms). A click that no pointer or key started (screen readers activate without a press) → onConfirm. */
function HoldButton({ label, aria, onDone, onConfirm, disabled, phone }: { label: string; aria: string; onDone: () => void; onConfirm: () => void; disabled?: boolean; phone: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const start = () => {
    if (disabled || timer.current) return;
    pressed.current = true;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onDone();
    }, 2000);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    // The click that follows a pointer release is ignored (above); after that, a bare click means assistive tech.
    setTimeout(() => (pressed.current = false), 0);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className={`btn ${phone ? "" : "sm "}dng-o hold${holding ? " holding" : ""}`}
      style={phone ? { height: 46, width: "100%" } : undefined}
      aria-label={aria}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          stop();
        }
      }}
      onBlur={stop}
      onClick={(e) => {
        // A real press was handled above; a click with no press (detail 0, no key) comes from assistive tech.
        if (pressed.current || e.detail > 0) {
          pressed.current = false;
          return;
        }
        onConfirm();
      }}
      data-person-hold
    >
      <span className="fill" aria-hidden="true" />
      {label}
    </button>
  );
}
