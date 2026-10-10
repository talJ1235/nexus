"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { budgetRecipientsState, saveBudgetRecipients, saveImportLimit, saveBudgetWarn } from "@/app/money-actions";
import { loadAppData } from "@/app/data-actions";
import {
  changeMemberRole,
  createInviteLink,
  deleteCurrentSpace,
  getSpacePeople,
  leaveCurrentSpace,
  removeSpaceMember,
  restoreDeletedSpace,
  revokeInviteLink,
  transferSpaceOwnership,
  updateCurrentSpace,
  type SpacePeople,
} from "@/app/space-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger, Modal } from "@/components/ui/overlays";
import { capFor, monthKeyIn, monthStartIn, monthForecast, nextMonthKey } from "@/lib/budget";
import { lineTotal, spendDate } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { BudgetEditor } from "../budget-card";
import { useStore } from "../store";
import { InviteQr } from "../spaces/qr";
import { deepOf, gradientOf, isSpacePhoto } from "../spaces/look";
import { avatarColor, Facepile, openSpaces, reloadInto, SpaceLook, usePresence } from "../spaces/space-ui";
import type { PageProps } from "./shell";
import { Av, I, Li, P, SectionHead, Sel, Toggle } from "./ui";

// Settings → the current space (R16 D2, boards SpaceSettings-desktop/-phone): a cover band in the space's look, then
// General (name, currency, numbers, look), People & invites (roles, remove, transfer, links + QR), Budget, Danger
// zone (transfer, leave, delete with the typed name, restore). Owners edit; others see the same screens read-only.

type Person = SpacePeople["people"][number];
type Confirm = { kind: "remove"; p: Person } | { kind: "transfer"; p: Person } | { kind: "leave" } | { kind: "delete"; typed: string } | { kind: "stepUp" } | null;

/** The space's people + links, loaded once per page. */
function usePeople() {
  const { t } = useI18n();
  const [data, setData] = useState<SpacePeople | null>(null);
  const [now, setNow] = useState(0);
  const load = useCallback(() => {
    getSpacePeople()
      .then((d) => {
        setNow(Date.now());
        setData(d);
      })
      .catch(() => toast.error(t.spaces.failed));
  }, [t]);
  useEffect(() => load(), [load]);
  return { data, now, load };
}

/** After a change to the space itself (name, look, currency): fresh space records for switcher + sidebar. */
export function useRefreshSpace() {
  const s = useStore();
  return useCallback(() => loadAppData().then((d) => s.replaceData(d, { keepView: true })).catch(() => {}), [s]);
}

export function SpaceCover({ onEdit, compact, onBack }: { onEdit: () => void; compact: boolean; onBack?: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const presence = usePresence();
  const sp = s.space;
  if (!sp) return null;
  const owner = sp.role === "owner";
  const n = sp.kind === "shared" ? Math.max(1, s.people.length) : 1;
  const since = sp.createdAt ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "short", day: "numeric" }).format(sp.createdAt) : null;
  const sub = compact
    ? [f(t.sx.peopleN, { n }), t.spaces.roles[sp.role]].join(" · ")
    : [f(t.sx.peopleN, { n }), sp.currency === "ILS" ? "₪ ILS" : sp.currency === "USD" ? "$ USD" : "€ EUR", since && f(t.sx.since, { date: since })].filter(Boolean).join(" · ");
  const photo = isSpacePhoto(sp.photo) ? sp.photo : null;
  const edit = () => (owner ? openSpaces({ kind: "identity" }) : onEdit());
  return (
    <div
      className="cover"
      style={{
        background: photo ? `linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.45)), url(${JSON.stringify(photo)}) center/cover` : gradientOf(sp.color),
        borderRadius: compact ? "0 0 22px 22px" : 14,
        padding: compact ? "max(10px, env(safe-area-inset-top)) 16px 20px" : "14px 70px 14px 22px",
        minHeight: compact ? 212 : undefined,
        display: "flex",
        flexDirection: compact ? "column" : "row",
        alignItems: compact ? "stretch" : "center",
        gap: compact ? 0 : 16,
        boxShadow: `0 10px 30px -18px ${deepOf(sp.color)}`,
      }}
      data-space-cover
    >
      {compact && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button type="button" className="btn icon ghost" style={{ color: "#fff" }} onClick={onBack} aria-label={t.sx.back} data-settings-back>
            <I d={P.back} className="flip" />
          </button>
          {owner && (
            <button type="button" className="btn sm" onClick={edit} data-edit-look>
              <I d={P.pencil} size="sm" />
              {t.sx.editLook}
            </button>
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: compact ? "auto" : 0, flex: compact ? undefined : 1, minWidth: 0 }}>
        <SpaceLook space={sp} size={compact ? 76 : 76} style={{ boxShadow: "0 0 0 3px rgba(255,255,255,.85)", borderRadius: 18 }} />
        <span style={{ minWidth: 0, lineHeight: 1.25 }}>
          <b style={{ fontSize: compact ? 21 : 22, letterSpacing: "-.01em", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,.15)" }} data-cover-name>
            {sp.name}
          </b>
          <span style={{ fontSize: 13, opacity: 0.92 }}>{sub}</span>
        </span>
      </div>
      {!compact && (
        <>
          {sp.kind === "shared" && s.people.length > 0 && (
            <span style={{ alignSelf: "flex-end", marginBottom: 2 }}>
              <Facepile people={s.people} size={28} max={4} online={presence.online} />
            </span>
          )}
          {owner && (
            <button type="button" className="btn sm" style={{ alignSelf: "flex-end" }} onClick={edit} data-edit-look>
              <I d={P.pencil} size="sm" />
              {t.sx.editLook}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- General ----------------

function GeneralPage() {
  const s = useStore();
  const { t, locale } = useI18n();
  const refresh = useRefreshSpace();
  const sp = s.space!;
  const owner = sp.role === "owner";
  const [name, setName] = useState(sp.name);
  const save = (v: { name?: string; currency?: string }) =>
    updateCurrentSpace(v)
      .then(refresh)
      .catch(() => toast.error(t.spaces.failed));
  const month = useMemo(() => {
    const key = monthKeyIn(s.clock.now, s.clock.tz);
    const fc = monthForecast({ items: s.items, altGroups: s.altGroups, rates: s.rates, currency: s.currency, from: monthStartIn(key, s.clock.tz), to: monthStartIn(nextMonthKey(key), s.clock.tz), cap: capFor(key, s.budget), includeNormal: false });
    return fc.spent + fc.committed;
  }, [s.items, s.altGroups, s.rates, s.currency, s.budget, s.clock]);
  const stat = (label: string, value: string, data: string) => (
    <div className="stat" data-space-stat={data}>
      <span className="sub">{label}</span>
      <b className="num">{value}</b>
    </div>
  );
  return (
    <>
      <SectionHead title={t.sx.sections.general} />
      <div className="grid2 stack" data-space-general>
        <div>
          <p className="sec">{t.sx.colName}</p>
          <label className="input">
            <input
              id="space-name-edit"
              value={name}
              maxLength={40}
              readOnly={!owner}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              onBlur={() => name.trim() && name.trim() !== sp.name && void save({ name: name.trim() })}
              aria-label={t.spaces.name}
            />
          </label>
        </div>
        <div>
          <p className="sec">{t.spaces.currency}</p>
          <label className="input">
            <select
              value={sp.currency}
              disabled={!owner}
              aria-label={t.spaces.currency}
              onChange={(e) => void save({ currency: e.target.value })}
              data-space-currency
            >
              <option value="ILS">₪ Israeli shekel (ILS)</option>
              <option value="USD">$ US dollar (USD)</option>
              <option value="EUR">€ Euro (EUR)</option>
            </select>
          </label>
        </div>
      </div>
      <div className="grid4">
        {stat(t.sx.stItems, String(s.items.length), "items")}
        {stat(t.sx.stLists, String(s.collections.length), "lists")}
        {stat(t.sx.stPeople, String(sp.kind === "shared" ? Math.max(1, s.people.length) : 1), "people")}
        {stat(t.sx.stMonth, formatMoney(Math.round(month), s.currency, locale), "month")}
      </div>
      <div className="card">
        <Li icon={<SpaceLook space={sp} size={40} />} title={t.sx.look} sub={t.sx.lookSub}>
          {owner && (
            <button type="button" className="btn sm" onClick={() => openSpaces({ kind: "identity" })} data-space-look-change>
              {t.sx.change}
            </button>
          )}
        </Li>
      </div>
    </>
  );
}

// ---------------- People & invites ----------------

function PeoplePage({ phone }: PageProps) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const presence = usePresence();
  const { data, now, load } = usePeople();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const sp = s.space!;
  const owner = sp.role === "owner";
  const canInvite = sp.role !== "viewer";
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short" });
  const ago = (ms: number | null) => (ms == null ? "—" : now - ms < 10 * 60_000 ? t.spaces.activeNow : date(ms));
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      const r = (await fn()) as { stepUp?: true } | undefined;
      if (r && typeof r === "object" && "stepUp" in r && r.stepUp) return setConfirm({ kind: "stepUp" });
      if (done) toast.success(done);
      load();
      return r;
    } catch {
      toast.error(t.spaces.failed);
    }
  };
  const pending = (data?.invites ?? []).filter((i) => !i.revokedAt && i.expiresAt > now && i.uses < i.maxUses);
  const activity = (p: Person) => (presence.shopping.some((x) => x.id === p.id) ? <span style={{ color: "var(--ok)" }}>{t.sx.shoppingNow}</span> : ago(p.lastActive));
  const roleCtl = (p: Person) =>
    owner && p.id !== data?.me && p.role !== "owner" ? (
      <Sel<"member" | "viewer">
        label={t.sx.colRole}
        value={p.role as "member" | "viewer"}
        onChange={(r) => r !== p.role && void act(() => changeMemberRole(p.id, r))}
        options={[
          { value: "member", label: t.spaces.roles.member },
          { value: "viewer", label: t.spaces.roles.viewer },
        ]}
        data-role-menu={p.id}
      />
    ) : (
      <span className="sub">{t.spaces.roles[p.role]}</span>
    );
  const more = (p: Person) =>
    owner && p.id !== data?.me && p.role !== "owner" ? (
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="btn sm icon ghost" aria-label={f(t.spaces.removeTitle, { name: p.name || p.email })} data-person-more={p.id}>
            <I d={P.more} />
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setConfirm({ kind: "transfer", p })}>{t.spaces.transfer}</MenuItem>
          <MenuItem danger onSelect={() => setConfirm({ kind: "remove", p })} data-remove-person>
            {t.spaces.remove}
          </MenuItem>
        </MenuContent>
      </Menu>
    ) : null;
  const linkRow = (i: (typeof pending)[number]) => (
    <>
      {owner || i.createdBy === data?.me ? (
        <button type="button" className="btn sm ghost" onClick={() => void act(() => revokeInviteLink(i.id))} data-invite-revoke={i.id}>
          {t.spaces.revoke}
        </button>
      ) : null}
    </>
  );

  return (
    <>
      <SectionHead
        title={
          <>
            {t.sx.stPeople}{" "}
            <span className="badge" style={{ verticalAlign: 4 }}>
              {data?.people.length ?? s.people.length}
            </span>
          </>
        }
      />
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexDirection: phone ? "column" : "row" }} data-space-people>
        <div style={{ flex: 1, minWidth: 0, width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
          {phone ? (
            <>
              <div className="card">
                {(data?.people ?? []).map((p) => (
                  <div key={p.id} className="li" data-person={p.id}>
                    <Av name={p.name || p.email} color={avatarColor(p.id)} online={presence.online.has(p.id)} />
                    <span className="grow">
                      <b>{p.name || p.email}</b> {p.id === data?.me && <span className="tiny">{t.spaces.you}</span>}
                      <br />
                      <span className="tiny">{p.id === data?.me ? `${t.spaces.roles[p.role]} · ${t.spaces.activeNow}` : activity(p)}</span>
                    </span>
                    {p.id !== data?.me && roleCtl(p)}
                    {more(p)}
                  </div>
                ))}
                {!data && <div className="li" aria-busy="true" />}
              </div>
              {pending.length > 0 && (
                <div>
                  <p className="sec">{t.sx.pending}</p>
                  <div className="card">
                    {pending.map((i) => (
                      <Li key={i.id} icon={P.mail} title={t.sx.linkInvite} sub={[t.spaces.roles[i.role], f(t.spaces.expiresOn, { date: date(i.expiresAt) })].join(" · ")} data-invite-row={i.id}>
                        {linkRow(i)}
                      </Li>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              <table className="ptable">
                <thead>
                  <tr>
                    <th>{t.sx.colName}</th>
                    <th style={{ width: 130 }}>{t.sx.colRole}</th>
                    <th style={{ width: 130 }}>{t.sx.colActive}</th>
                    <th style={{ width: 70 }} aria-label="" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.people ?? []).map((p) => (
                    <tr key={p.id} data-person={p.id}>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <Av name={p.name || p.email} color={avatarColor(p.id)} online={presence.online.has(p.id)} />
                          <span style={{ lineHeight: 1.3, minWidth: 0 }}>
                            <b style={{ fontWeight: 600 }}>{p.name || p.email}</b> {p.id === data?.me && <span className="tiny">{t.spaces.you}</span>}
                            <br />
                            <span className="tiny">{p.email}</span>
                          </span>
                        </span>
                      </td>
                      <td>{roleCtl(p)}</td>
                      <td className="sub">{p.id === data?.me ? t.spaces.activeNow : activity(p)}</td>
                      <td style={{ textAlign: "end" }}>{more(p)}</td>
                    </tr>
                  ))}
                  {pending.map((i) => (
                    <tr key={i.id} data-invite-row={i.id}>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="ic round" style={{ width: 32, height: 32 }}>
                            <I d={P.mail} size="sm" />
                          </span>
                          <span style={{ lineHeight: 1.3 }}>
                            <b style={{ fontWeight: 600 }}>{t.sx.linkInvite}</b>
                            <br />
                            <span className="tiny">{[i.byName, date(i.createdAt)].filter(Boolean).join(" · ")}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="badge warn">{t.sx.pending}</span>
                      </td>
                      <td className="sub">{t.spaces.roles[i.role]}</td>
                      <td style={{ textAlign: "end" }}>{linkRow(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data && <div className="li" aria-busy="true" />}
            </div>
          )}
          <p className="tiny" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>
              <b style={{ color: "var(--ink2)" }}>{t.spaces.roles.owner}</b> {t.sx.legendOwner}
            </span>
            <span>
              <b style={{ color: "var(--ink2)" }}>{t.spaces.roles.member}</b> {t.sx.legendMember}
            </span>
            <span>
              <b style={{ color: "var(--ink2)" }}>{t.spaces.roles.viewer}</b> {t.sx.legendViewer}
            </span>
          </p>
        </div>
        {canInvite && !phone && <InviteBox onMade={load} />}
      </div>
      {canInvite && phone && (
        <button type="button" className="btn pri block lg" style={{ marginTop: "auto" }} onClick={() => openSpaces({ kind: "invite" })} data-space-invite>
          <I d={P.userPlus} />
          {t.spaces.invite}
        </button>
      )}
      <SpaceConfirms confirm={confirm} setConfirm={setConfirm} count={data?.people.length ?? 1} adminReauth={!!data?.adminReauth} onDone={load} />
    </>
  );
}

/** The desktop invite panel: the QR appears once a link exists (one is made on the first copy — never just by opening). */
function InviteBox({ onMade }: { onMade: () => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const sp = s.space!;
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async (r: "member" | "viewer", replace?: string) => {
    setBusy(true);
    try {
      if (replace) await revokeInviteLink(replace).catch(() => {});
      const { id, token } = await createInviteLink(r);
      const next = { id, url: `${window.location.origin}/join/${token}` };
      setLink(next);
      onMade();
      return next;
    } catch {
      toast.error(t.spaces.failed);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const l = link ?? (await make(role));
    if (!l) return;
    await navigator.clipboard?.writeText(l.url).catch(() => {});
    toast.success(t.spaces.copied);
  };
  return (
    <div className="card" style={{ width: 236, flexShrink: 0, padding: 16, background: "var(--s)", display: "flex", flexDirection: "column", gap: 12 }} data-invite-panel>
      <b>{t.sx.invite}</b>
      <div style={{ alignSelf: "center" }}>
        {link ? (
          <InviteQr value={link.url} name={sp.name} color={sp.color} size={112} />
        ) : (
          <div className="card" style={{ width: 138, height: 138, display: "grid", placeItems: "center" }}>
            <SpaceLook space={sp} size={32} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="sub" style={{ flex: 1 }}>
          {t.spaces.joinAs}
        </span>
        <Sel<"member" | "viewer">
          label={t.spaces.joinAs}
          value={role}
          onChange={(r) => {
            setRole(r);
            if (link) void make(r, link.id);
          }}
          options={[
            { value: "member", label: t.spaces.roles.member },
            { value: "viewer", label: t.spaces.roles.viewer },
          ]}
        />
      </div>
      <button type="button" className="btn pri block" disabled={busy} onClick={() => void copy()} data-invite-copy>
        <I d={P.copy} size="sm" />
        {t.sx.copyInvite}
      </button>
      {link && <input readOnly value={link.url} aria-label={t.spaces.inviteLink} className="tiny mono" style={{ border: 0, background: "transparent", textAlign: "center" }} onFocus={(e) => e.currentTarget.select()} data-invite-url />}
      <span className="tiny" style={{ textAlign: "center" }}>
        {f(t.spaces.joinsAs, { role: t.spaces.roles[role].toLowerCase(), days: 7 })}
      </span>
    </div>
  );
}

// ---------------- Budget ----------------

function BudgetPage() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const ro = s.readOnly;
  const m = (v: number) => formatMoney(Math.round(v), s.currency, locale);
  const key = monthKeyIn(s.clock.now, s.clock.tz);
  const from = monthStartIn(key, s.clock.tz);
  const to = monthStartIn(nextMonthKey(key), s.clock.tz);
  const fc = useMemo(
    () => monthForecast({ items: s.items, altGroups: s.altGroups, rates: s.rates, currency: s.currency, from, to, cap: capFor(key, s.budget), includeNormal: false }),
    [s.items, s.altGroups, s.rates, s.currency, s.budget, key, from, to],
  );
  const spent = fc.spent + fc.committed;
  const cats = useMemo(() => {
    const by = new Map<string, number>();
    for (const i of s.items) {
      if (i.status === "to_buy") continue;
      const at = spendDate(i) ?? i.updatedAt;
      if (at < from || at >= to) continue;
      const v = lineTotal(i, s.rates, s.currency) ?? 0;
      if (v > 0) by.set(i.category ?? "other", (by.get(i.category ?? "other") ?? 0) + v);
    }
    return [...by].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [s.items, s.rates, s.currency, from, to]);
  const max = Math.max(1, ...cats.map((c) => c[1]));
  // Pace: the share of the month gone vs the share of the budget spent.
  const dayShare = (s.clock.now - from) / Math.max(1, to - from);
  const over = fc.cap != null && spent / fc.cap > dayShare + 0.05;
  const month = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long" }).format(from + 86_400_000);
  return (
    <>
      <SectionHead title={t.sx.sections.budget}>
        <span className="sub">{month}</span>
      </SectionHead>
      <div className="card" style={{ padding: 20, background: "var(--s)", display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }} data-space-budget>
        <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="sub">{fc.cap != null ? f(t.sx.spentOf, { cap: m(fc.cap) }) : t.sx.spentNoCap}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="big num">{m(spent)}</span>
            {fc.cap != null && <span className={cn("badge", over ? "warn" : "ok")}>{over ? t.sx.overPace : t.sx.onPace}</span>}
          </span>
          {fc.cap != null && (
            <div className="bar-row">
              <i className={cn(spent > fc.cap ? "bad" : spent >= fc.cap * 0.8 && "warn")} style={{ width: `${Math.min(100, (spent / fc.cap) * 100)}%` }} />
            </div>
          )}
        </div>
        {!ro && (
          <div style={{ width: 260, maxWidth: "100%" }}>
            <p className="label" style={{ margin: "0 0 6px" }}>
              {t.sx.monthly}
            </p>
            <BudgetEditor />
          </div>
        )}
      </div>
      <div>
        <p className="sec">{t.sx.byCategory}</p>
        <div className="card">
          {cats.length === 0 && <div className="li sub">{t.sx.noCategories}</div>}
          {cats.map(([c, v]) => (
            <div key={c} className="li" data-budget-cat={c}>
              <span style={{ width: 150, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.categories[c as keyof typeof t.categories] ?? c}</span>
              <div className="bar-row" style={{ flex: 1 }}>
                <i style={{ width: `${(v / max) * 100}%` }} />
              </div>
              <span className="num sub" style={{ width: 80, textAlign: "end" }}>
                {m(v)}
              </span>
            </div>
          ))}
        </div>
      </div>
      {s.space?.kind === "shared" && <BudgetRecipients />}
      <div className="card">
        <Li icon={P.bell} tone="warn" title={t.sx.warn80}>
          <Toggle
            on={s.budgetWarn}
            disabled={ro}
            label={t.sx.warn80}
            onChange={(v) => {
              s.setBudgetWarn(v);
              saveBudgetWarn(v).catch(() => {
                s.setBudgetWarn(!v);
                toast.error(t.errors.generic);
              });
            }}
            data-budget-warn
          />
        </Li>
        <Li icon={P.coin} title={t.importVat.title} sub={t.importVat.hint}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, width: 110 }}>
            <span className="sub">$</span>
            <input
              key={s.importLimitUsd}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              defaultValue={s.importLimitUsd}
              disabled={ro}
              aria-label={t.importVat.title}
              data-import-limit
              className="nsel"
              style={{ background: "var(--raised)", padding: "0 10px", width: "100%" }}
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
            />
          </span>
        </Li>
      </div>
    </>
  );
}

// ---------------- Danger zone ----------------

function DangerPage() {
  const s = useStore();
  const { t, f } = useI18n();
  const { data, load } = usePeople();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [to, setTo] = useState("");
  const [typed, setTyped] = useState("");
  const sp = s.space!;
  const owner = sp.role === "owner";
  const others = (data?.people ?? []).filter((p) => p.id !== data?.me);
  const owners = (data?.people ?? []).filter((p) => p.role === "owner").length;
  const lastOwner = owner && owners <= 1;
  return (
    <>
      <SectionHead title={t.sx.sections.danger} />
      {owner && (
        <div className="card">
          <Li icon={P.swap} title={t.spaces.transfer} sub={t.sx.transferSub}>
            <Sel label={t.sx.choosePerson} value={to} onChange={setTo} disabled={!others.length} options={[{ value: "", label: others.length ? t.sx.choosePerson : t.sx.noOne }, ...others.map((p) => ({ value: p.id, label: p.name || p.email }))]} data-transfer-to />
            <button
              type="button"
              className="btn sm"
              disabled={!to}
              onClick={() => {
                const p = others.find((x) => x.id === to);
                if (p) setConfirm({ kind: "transfer", p });
              }}
              data-transfer-go
            >
              {t.spaces.transfer}
            </button>
          </Li>
        </div>
      )}
      <div className="card">
        <Li icon={P.signOut} title={t.spaces.leave} sub={lastOwner ? t.spaces.lastOwner : t.spaces.leaveBody}>
          <button type="button" className="btn sm" disabled={lastOwner} onClick={() => setConfirm({ kind: "leave" })} data-space-leave>
            {t.spaces.leaveBtn}
          </button>
        </Li>
      </div>
      {owner && (
        <div className="card dng">
          <Li icon={P.trash} tone="dng" title={f(t.sx.deleteName, { space: sp.name })} sub={f(t.sx.deleteStats, { items: s.items.length, lists: s.collections.length, people: Math.max(1, data?.people.length ?? 1) })}>
            <label className="input" style={{ height: 38, width: 220, fontSize: 14 }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={f(t.sx.typeToConfirm, { name: sp.name })} aria-label={f(t.spaces.typeName, { name: sp.name })} autoComplete="off" data-delete-typed />
            </label>
            <button type="button" className="btn sm dng" disabled={typed.trim() !== sp.name.trim()} onClick={() => setConfirm({ kind: "delete", typed })} data-space-delete>
              {t.spaces.delete}
            </button>
          </Li>
        </div>
      )}
      {(data?.deleted.length ?? 0) > 0 && (
        <div>
          <p className="sec">{t.sx.deletedSpaces}</p>
          <div className="card">
            {data!.deleted.map((d) => (
              <Li key={d.id} icon={<SpaceLook space={{ name: d.name, color: d.color }} size={32} style={{ opacity: 0.6 }} />} title={d.name}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void restoreDeletedSpace(d.id)
                      .then(() => reloadInto(f(t.spaces.restored, { space: d.name })))
                      .catch(() => toast.error(t.spaces.failed))
                  }
                  data-restore-space={d.id}
                >
                  {f(t.spaces.restore, { space: "" }).trim()}
                </button>
              </Li>
            ))}
          </div>
        </div>
      )}
      <SpaceConfirms confirm={confirm} setConfirm={setConfirm} count={data?.people.length ?? 1} adminReauth={!!data?.adminReauth} onDone={load} />
    </>
  );
}

/** Confirmations (Dialogs-desktop): remove, transfer, leave, delete; step-up when the session is too old. */
function SpaceConfirms({ confirm, setConfirm, count, adminReauth, onDone }: { confirm: Confirm; setConfirm: (c: Confirm) => void; count: number; adminReauth: boolean; onDone: () => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [busy, setBusy] = useState(false);
  const sp = s.space!;
  if (!confirm) return null;
  const reauthHref = `/login?reauth=1&next=${encodeURIComponent(window.location.pathname)}`;
  const close = () => setConfirm(null);
  const name = confirm.kind === "remove" || confirm.kind === "transfer" ? confirm.p.name || confirm.p.email : "";
  const title =
    confirm.kind === "stepUp"
      ? t.spaces.stepUpTitle
      : confirm.kind === "remove"
        ? f(t.spaces.removeTitle, { name })
        : confirm.kind === "transfer"
          ? f(t.spaces.transferTitle, { name })
          : confirm.kind === "leave"
            ? f(t.spaces.leaveTitle, { space: sp.name })
            : f(t.spaces.deleteTitle, { space: sp.name });
  const run = async () => {
    setBusy(true);
    const c = confirm;
    try {
      if (c.kind === "remove") {
        const r = await removeSpaceMember(c.p.id);
        if ("stepUp" in r) return setConfirm({ kind: "stepUp" });
        toast.success(f(t.spaces.removed, { name }));
        close();
        onDone();
      } else if (c.kind === "transfer") {
        const r = await transferSpaceOwnership(c.p.id);
        if ("stepUp" in r) return setConfirm({ kind: "stepUp" });
        reloadInto(f(t.spaces.transferred, { name }));
      } else if (c.kind === "leave") {
        const r = await leaveCurrentSpace();
        if (!r.ok) {
          close();
          return void toast.error(r.reason === "last_owner" ? t.spaces.lastOwner : t.spaces.failed);
        }
        reloadInto(f(t.spaces.left, { space: sp.name }));
      } else if (c.kind === "delete") {
        const r = await deleteCurrentSpace(c.typed);
        if ("stepUp" in r) return setConfirm({ kind: "stepUp" });
        if (!r.ok) {
          close();
          return void toast.error(t.spaces.failed);
        }
        reloadInto(f(t.spaces.deleted, { space: sp.name }));
      }
    } catch {
      close();
      toast.error(t.spaces.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && close()} title={title} className="max-w-[440px]">
      <div className="space-y-4" data-space-confirm={confirm.kind}>
        {confirm.kind === "stepUp" && <p className="text-sm text-muted">{t.spaces.stepUpBody}</p>}
        {confirm.kind === "remove" && <p className="text-sm text-muted">{f(t.spaces.removeBody, { space: sp.name })}</p>}
        {confirm.kind === "transfer" && <p className="text-sm text-muted">{f(t.spaces.transferBody, { space: sp.name })}</p>}
        {confirm.kind === "leave" && <p className="text-sm text-muted">{t.spaces.leaveBody}</p>}
        {confirm.kind === "delete" && <p className="text-sm text-muted">{f(t.spaces.deleteBody, { n: count })}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t.spaces.cancel}
          </Button>
          {confirm.kind === "stepUp" ? (
            <a href={reauthHref} className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-sm font-medium text-on-brand" data-step-up-go>
              {t.spaces.stepUpGo}
            </a>
          ) : (
            <Button variant={confirm.kind === "transfer" ? "primary" : "danger"} disabled={busy} onClick={() => void run()} data-confirm-go>
              {confirm.kind === "remove" ? t.spaces.remove : confirm.kind === "transfer" ? t.spaces.transfer : confirm.kind === "leave" ? t.spaces.leaveBtn : t.spaces.delete}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export const SPACE_PAGES = { general: GeneralPage, people: PeoplePage, budget: BudgetPage, danger: DangerPage };

/**
 * R17 S3 N2 (board Settings-notify-phone, "space budget"): who gets this space's budget alerts at 80 % / 100 %. The owner
 * always (locked row), plus the members the owner picks; viewers can't be picked. Others see it read-only.
 */
function BudgetRecipients() {
  const s = useStore();
  const { t, f } = useI18n();
  const st = t.nt.set;
  const [state, setState] = useState<Awaited<ReturnType<typeof budgetRecipientsState>> | null>(null);
  const spaceId = s.space?.id;
  useEffect(() => {
    let alive = true;
    budgetRecipientsState().then((r) => alive && setState(r), () => {});
    return () => {
      alive = false;
    };
  }, [spaceId]);
  if (!state) return null;
  const toggle = (id: string, on: boolean) => {
    const before = state.picked;
    const next = on ? [...before, id] : before.filter((x) => x !== id);
    setState({ ...state, picked: next });
    saveBudgetRecipients(next).then(
      (picked) => setState((cur) => (cur ? { ...cur, picked } : cur)),
      () => {
        setState((cur) => (cur ? { ...cur, picked: before } : cur));
        toast.error(t.errors.generic);
      },
    );
  };
  return (
    <div data-budget-recipients>
      <p className="sec">{st.whoGets}</p>
      <div className="card">
        {state.people.map((p) => {
          const owner = p.role === "owner";
          const viewer = p.role === "viewer";
          const on = owner || state.picked.includes(p.id);
          const name = p.id === s.me?.id ? f(st.you, { name: p.name }) : p.name;
          return (
            <Li key={p.id} icon={<Av name={p.name} color={avatarColor(p.id)} size="sm" />} title={name} sub={owner ? st.owner : viewer ? st.viewer : st.member} data-budget-to={p.id}>
              <Toggle on={on} disabled={owner || viewer || !state.canEdit} label={name} onChange={(v) => toggle(p.id, v)} data-budget-to-toggle={p.id} />
            </Li>
          );
        })}
      </div>
      <p className="tiny" style={{ padding: "10px 4px 0", margin: 0, lineHeight: 1.5 }}>
        {st.budgetNote}
      </p>
    </div>
  );
}
