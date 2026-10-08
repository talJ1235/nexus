"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createInviteCode, getInviteAdmin, inviteFromWaitlist, revokeInviteCode, type InviteAdminState } from "@/app/invite-admin-actions";
import { useI18n } from "@/components/providers";
import { initialOf } from "@/lib/initial";

// Settings → Invite codes (R15 A3, admin only) — mockup InvitesAdmin-desktop: tabs Codes / Waitlist, a codes table
// with usage meters, copy / revoke, and a one-tap Invite from the waitlist.

export function InvitesAdmin() {
  const { t, locale } = useI18n();
  const v = t.invites;
  const [st, setSt] = useState<InviteAdminState | null>(null);
  const [tab, setTab] = useState<"codes" | "waitlist">("codes");
  const [form, setForm] = useState<{ note: string; maxUses: number; days: number } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const load = useCallback(() => getInviteAdmin().then(setSt, () => setSt(null)), []);
  useEffect(() => {
    void load();
  }, [load]);
  const day = (ms: number) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric" }).format(ms);
  const copy = (c: string | null) => c && navigator.clipboard?.writeText(c).then(() => toast.success(v.copied));

  const create = async () => {
    if (!form) return;
    const r = await createInviteCode({ note: form.note.trim() || undefined, maxUses: form.maxUses, days: form.days });
    setFresh(r.code);
    setForm(null);
    await load();
  };
  if (!st) return <div className="sub" aria-busy="true" style={{ padding: 24 }} />;
  const waiting = st.waitlist.filter((w) => !w.invitedAt);
  const status = { active: <span className="badge ok">{v.activeBadge}</span>, used_up: <span className="badge">{v.usedUp}</span>, expired: <span className="badge warn">{v.expired}</span>, revoked: <span className="badge dng">{v.revoked}</span> };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} data-invites-admin>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="tabs" role="tablist" style={{ flex: 1 }}>
          <button type="button" role="tab" aria-selected={tab === "codes"} className={tab === "codes" ? "on" : ""} onClick={() => setTab("codes")}>
            {v.title} <span className="badge">{st.codes.filter((c) => c.status === "active").length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "waitlist"} className={tab === "waitlist" ? "on" : ""} onClick={() => setTab("waitlist")}>
            {v.waitlist} <span className="badge">{waiting.length}</span>
          </button>
        </div>
        <button type="button" className="btn pri" onClick={() => setForm({ note: "", maxUses: 1, days: 14 })} data-new-code>
          <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {v.create}
        </button>
      </div>

      {fresh && (
        <div className="alert info" data-fresh-code>
          <span style={{ flex: 1 }}>
            {v.newCode} <b className="mono" style={{ fontSize: 16 }}>{fresh}</b>
          </span>
          <button type="button" className="btn sm" onClick={() => copy(fresh)}>
            {v.copy}
          </button>
        </div>
      )}

      {form && (
        <div className="card" style={{ padding: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", alignItems: "end" }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="label" htmlFor="inv-note">
              {v.note}
            </label>
            <div className="input">
              <input id="inv-note" value={form.note} maxLength={80} onChange={(e) => setForm({ ...form, note: e.target.value })} autoFocus />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="inv-uses">
              {v.uses}
            </label>
            <div className="input">
              <input id="inv-uses" type="number" min={1} max={50} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="inv-days">
              {v.days}
            </label>
            <div className="input">
              <input id="inv-days" type="number" min={1} max={90} value={form.days} onChange={(e) => setForm({ ...form, days: Math.min(90, Math.max(1, Number(e.target.value) || 14)) })} />
            </div>
          </div>
          <button type="button" className="btn pri" onClick={create} data-create-code>
            {v.make}
          </button>
        </div>
      )}

      {tab === "codes" ? (
        <div className="card" style={{ overflowX: "auto" }}>
          {st.codes.length === 0 ? (
            <div className="row sub">{v.noCodes}</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{v.code}</th>
                  <th>{v.note.split(" (")[0]}</th>
                  <th>{v.usage}</th>
                  <th>{v.expiresCol}</th>
                  <th>{v.status}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {st.codes.map((c) => (
                  <tr key={c.id} data-code-row={c.status}>
                    <td className="mono" style={c.status === "revoked" ? { color: "var(--faint)" } : undefined}>
                      <b>{c.code ?? `•••-${c.hint}`}</b>
                    </td>
                    <td className={c.note ? "" : "sub"} title={c.usedBy.map((u) => u.email).join(", ")}>
                      {c.note ?? "—"}
                      {c.usedBy.length > 0 && <div className="tiny">{c.usedBy.map((u) => u.name).join(", ")}</div>}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="meter" style={{ width: 72 }}>
                          <i style={{ width: `${Math.round((c.uses / c.maxUses) * 100)}%` }} />
                        </div>
                        <span className="sub num">
                          {c.uses} / {c.maxUses}
                        </span>
                      </div>
                    </td>
                    <td className="sub">{c.status === "revoked" ? "—" : day(c.expiresAt)}</td>
                    <td>{status[c.status]}</td>
                    <td style={{ textAlign: "end", whiteSpace: "nowrap" }}>
                      {c.status === "active" && (
                        <>
                          {c.code && (
                            <button type="button" className="btn sm ghost" onClick={() => copy(c.code)}>
                              {v.copy}
                            </button>
                          )}
                          <button type="button" className="btn sm ghost" onClick={() => revokeInviteCode(c.id).then(load)} data-revoke>
                            {v.revoke}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          {st.waitlist.length === 0 && <div className="row sub">{v.noWaitlist}</div>}
          {st.waitlist.map((w) => (
            <div className="row" key={w.email}>
              <span className="av sm c3">{initialOf(w.email, "")}</span>
              <span className="grow">
                {w.email}
                <br />
                <span className="tiny">{day(w.createdAt)}</span>
              </span>
              {w.invitedAt ? (
                <span className="badge ok">{v.invite}</span>
              ) : (
                <button
                  type="button"
                  className="btn sm"
                  onClick={async () => {
                    const r = await inviteFromWaitlist(w.email);
                    setFresh(r.code);
                    await load();
                  }}
                >
                  {v.invite}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
