"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createInviteCode, getInviteAdmin, inviteFromWaitlist, revokeInviteCode, type InviteAdminState } from "@/app/invite-admin-actions";
import { useI18n } from "@/components/providers";
import { initialOf } from "@/lib/initial";
import type { Go } from "./admin-app";
import { Failed, PATH, Skeleton, Svg, useLoad, useNow, useTimes } from "./ui";

// R17 G3 — Invites (board Admin-desktop "Invites"): sign-up codes with a usage meter, who they're for, expiry, copy /
// revoke, who used each; the waitlist with one-tap Invite (R15 A3's actions, moved here from Settings).

type Code = InviteAdminState["codes"][number];
type Seg = "active" | "used" | "revoked";
const DAY = 86_400_000;

export function InvitesTab({ phone, go }: { phone: boolean; go: Go }) {
  const { t, f } = useI18n();
  const v = t.invites;
  const I = t.adm.inv;
  const { data, failed, reload } = useLoad(() => getInviteAdmin(), []);
  const [seg, setSeg] = useState<Seg>("active");
  const [form, setForm] = useState<{ note: string; maxUses: number; days: number } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const { ago } = useTimes();
  const now = useNow();

  const copy = (c: string | null) => c && navigator.clipboard?.writeText(c).then(() => toast.success(v.copied), () => {});
  const create = async () => {
    if (!form) return;
    try {
      const r = await createInviteCode({ note: form.note.trim() || undefined, maxUses: form.maxUses, days: form.days });
      setFresh(r.code);
      setForm(null);
      await reload();
    } catch {
      toast.error(t.adm.retry);
    }
  };
  const revoke = async (c: Code) => {
    if (!window.confirm(I.revokeConfirm)) return;
    await revokeInviteCode(c.id).catch(() => toast.error(t.adm.retry));
    await reload();
  };
  const invite = async (email: string) => {
    try {
      const r = await inviteFromWaitlist(email);
      setFresh(r.code);
      await reload();
    } catch {
      toast.error(t.adm.retry);
    }
  };

  const groupOf = (c: Code): Seg => (c.status === "revoked" ? "revoked" : c.status === "active" ? "active" : "used");
  const codes = (data?.codes ?? []).filter((c) => groupOf(c) === seg);
  const n = (s: Seg) => (data?.codes ?? []).filter((c) => groupOf(c) === s).length;
  const waiting = (data?.waitlist ?? []).filter((w) => !w.invitedAt);
  const exp = (c: Code) => (c.expiresAt <= now ? I.expired : c.expiresAt - now < DAY ? I.today : f(I.inDays, { n: Math.ceil((c.expiresAt - now) / DAY) }));
  const masked = (c: Code) => `NX-••••-${c.hint}`;

  const newBtn = (
    <button type="button" className="btn pri" style={{ height: 38, marginInlineStart: phone ? undefined : "auto" }} onClick={() => setForm({ note: "", maxUses: 1, days: 14 })} data-new-code>
      <Svg d={PATH.plus} />
      {I.newCode}
    </button>
  );

  const formCard = form && (
    <section className="panel rise" style={{ padding: 16, gap: 12 }} data-code-form>
      <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <label className="field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label">{v.note}</span>
          <span className="input">
            <input id="inv-note" value={form.note} maxLength={80} onChange={(e) => setForm({ ...form, note: e.target.value })} autoFocus style={{ fontSize: phone ? 16 : undefined }} />
          </span>
        </label>
        <label className="field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label">{v.uses}</span>
          <span className="input">
            <input id="inv-uses" type="number" min={1} max={50} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} style={{ fontSize: phone ? 16 : undefined }} />
          </span>
        </label>
        <label className="field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label">{v.days}</span>
          <span className="input">
            <input id="inv-days" type="number" min={1} max={90} value={form.days} onChange={(e) => setForm({ ...form, days: Math.min(90, Math.max(1, Number(e.target.value) || 14)) })} style={{ fontSize: phone ? 16 : undefined }} />
          </span>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={() => setForm(null)}>
          {t.adm.person.cancel}
        </button>
        <button type="button" className="btn pri" onClick={() => void create()} data-create-code>
          {v.make}
        </button>
      </div>
    </section>
  );

  const freshCard = fresh && (
    <div className="ok-line rise" style={{ justifyContent: "space-between", flexWrap: "wrap" }} data-fresh-code>
      <b className="mono code" dir="ltr">
        {fresh}
      </b>
      <button type="button" className="btn sm" onClick={() => copy(fresh)}>
        {v.copy}
      </button>
    </div>
  );

  const segs = (
    <span className="seg" role="group">
      {(
        [
          ["active", f(I.active, { n: n("active") })],
          ["used", f(I.usedUp, { n: n("used") })],
          ["revoked", f(I.revoked, { n: n("revoked") })],
        ] as [Seg, string][]
      ).map(([k, label]) => (
        <button key={k} type="button" className={seg === k ? "on" : ""} aria-pressed={seg === k} onClick={() => setSeg(k)} data-codes-seg={k}>
          {label}
        </button>
      ))}
    </span>
  );

  const usedBy = (c: Code) =>
    c.usedBy.length > 0 && (
      <span className="pile" title={c.usedBy.map((u) => u.name).join(", ")} aria-label={`${I.usedBy}: ${c.usedBy.map((u) => u.name).join(", ")}`}>
        {c.usedBy.slice(0, 4).map((u, k) => (
          <span key={k} className={`av xs c${(k % 6) + 1}`}>
            {initialOf(u.name)}
          </span>
        ))}
      </span>
    );

  const codesPanel = (
    <section className="panel" data-codes>
      <div className="ph">
        <h2>{I.codes}</h2>
        {segs}
      </div>
      {!phone && (
        <div className="th-t code-cols">
          <span>{I.cCode}</span>
          <span>{I.cFor}</span>
          <span>{I.cUsed}</span>
          <span>{I.cExpires}</span>
          <span />
        </div>
      )}
      {!data && <div style={{ padding: "0 18px 14px" }}><Skeleton rows={3} h={44} /></div>}
      {data && codes.length === 0 && <div className="empty">{I.none}</div>}
      {codes.map((c) =>
        phone ? (
          <div key={c.id} className="hl" style={{ padding: "10px 14px", alignItems: "flex-start", flexDirection: "column", gap: 6 }} data-code={c.id}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
              <span className="code" dir="ltr">
                {masked(c)}
              </span>
              <span className="tiny" style={{ marginInlineStart: "auto" }}>
                {exp(c)}
              </span>
            </div>
            {c.note && <span style={{ overflowWrap: "anywhere" }}>{c.note}</span>}
            <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
              <span className="qbar" style={{ width: 48 }}>
                <i style={{ width: `${(c.uses / Math.max(1, c.maxUses)) * 100}%` }} />
              </span>
              <span className="tiny num">{f(I.ofUses, { u: c.uses, m: c.maxUses })}</span>
              {usedBy(c)}
              <span style={{ marginInlineStart: "auto", display: "flex", gap: 4 }}>
                <button type="button" className="btn sm ghost" onClick={() => copy(c.code)}>
                  {v.copy}
                </button>
                {c.status !== "revoked" && (
                  <button type="button" className="btn sm ghost dng-o" onClick={() => void revoke(c)}>
                    {v.revoke}
                  </button>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div key={c.id} className="row-t code-cols" style={{ cursor: "default" }} data-code={c.id}>
            <span className="code" dir="ltr">
              {masked(c)}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.note ?? "—"}</span>
              {usedBy(c)}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="qbar" style={{ width: 48 }}>
                <i style={{ width: `${(c.uses / Math.max(1, c.maxUses)) * 100}%` }} />
              </span>
              <span className="tiny num">{f(I.ofUses, { u: c.uses, m: c.maxUses })}</span>
            </span>
            <span className="sub">{exp(c)}</span>
            <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
              <button type="button" className="btn sm ghost" onClick={() => copy(c.code)} data-code-copy>
                {v.copy}
              </button>
              {c.status !== "revoked" && (
                <button type="button" className="btn sm ghost dng-o" onClick={() => void revoke(c)} data-code-revoke>
                  {v.revoke}
                </button>
              )}
            </span>
          </div>
        ),
      )}
    </section>
  );

  const waitPanel = (
    <section className="panel" data-waitlist>
      <div className="ph">
        <h2>{I.waiting}</h2>
        <span className="cnt">{waiting.length}</span>
      </div>
      <div className="pb">
        {data && waiting.length === 0 && <div className="tiny">{I.noWaiting}</div>}
        {waiting.map((w) => (
          <div key={w.email} className="hl">
            <span className={`av sm c${(w.email.length % 6) + 1}`} aria-hidden="true">
              {initialOf(w.email)}
            </span>
            <span className="grow" style={{ lineHeight: 1.3 }}>
              <span dir="ltr" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                {w.email}
              </span>
              <span className="tiny">{ago(w.createdAt, now)}</span>
            </span>
            <button type="button" className="btn sm" onClick={() => void invite(w.email)} data-waitlist-invite>
              {v.invite ?? t.adm.people.invite}
            </button>
          </div>
        ))}
      </div>
    </section>
  );

  if (phone)
    return (
      <div className="page" data-invites>
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", marginInlineStart: -8 }} onClick={() => go("more")}>
          <Svg d={PATH.back} className="i sm flip" />
          {t.adm.tabs.more}
        </button>
        <h1 className="lt">{t.adm.tabs.invites}</h1>
        <span className="sub" style={{ marginTop: -8 }}>
          {I.sub}
        </span>
        {newBtn}
        {failed && <Failed onRetry={reload} />}
        {formCard}
        {freshCard}
        {codesPanel}
        {waitPanel}
      </div>
    );

  return (
    <>
      <div className="ad-top">
        <h1>{t.adm.tabs.invites}</h1>
        <span className="sub">{I.sub}</span>
        {newBtn}
      </div>
      <div className="ad-body" data-invites>
        {failed && <Failed onRetry={reload} />}
        {formCard}
        {freshCard}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          {codesPanel}
          {waitPanel}
        </div>
      </div>
    </>
  );
}
