"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, LogOut, MoreHorizontal, RotateCcw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import {
  changeMemberRole,
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
import { Button, Input, Label } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Modal } from "@/components/ui/overlays";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Segmented } from "../settings-dialog";
import { useStore } from "../store";
import { Avatar, openSpaces, reloadInto, SpaceTile, TILE, tileColor } from "./space-ui";

type Person = SpacePeople["people"][number];
type Confirm =
  | { kind: "remove"; p: Person }
  | { kind: "transfer"; p: Person }
  | { kind: "leave" }
  | { kind: "delete" }
  | { kind: "stepUp" }
  | null;

/** SpaceSettings-desktop (phone: the same sections, full-height): identity, people + roles, invite links, leave /
 *  transfer / delete (Dialogs-desktop: step-up, typed delete, leave). */
export function SpaceSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [data, setData] = useState<SpacePeople | null>(null);
  // "Now" for ages and expiry, taken when the data arrives (render stays pure).
  const [now, setNow] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const sp = s.space;
  const load = useCallback(() => {
    getSpacePeople()
      .then((d) => {
        setNow(Date.now());
        setData(d);
      })
      .catch(() => toast.error(t.spaces.failed));
  }, [t]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  if (!sp) return null;
  const owner = sp.role === "owner";
  const shared = sp.kind === "shared";
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short" });
  const ago = (ms: number | null) => {
    if (ms == null) return "—";
    if (now - ms < 10 * 60_000) return t.spaces.activeNow;
    return date(ms);
  };
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
  const reauthHref = `/login?reauth=1${data?.adminReauth ? "&admin=1" : ""}&next=${encodeURIComponent("/?panel=space")}`;

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title={t.spaces.settings} className="max-w-[640px]">
        <div className="space-y-6" data-space-settings-body>
          {/* Cover band in the space colour */}
          <div className="-mx-5 -mt-2 flex items-center gap-3 px-5 py-4" style={{ background: `linear-gradient(135deg, ${tileColor(sp.color)}26, transparent 70%)` }}>
            <SpaceTile name={sp.name} color={sp.color} size={44} />
            <div className="min-w-0 leading-tight">
              <b className="block truncate text-[17px]">{sp.name}</b>
              <span className="text-[12.5px] text-muted">{shared ? t.spaces.roles[sp.role] : t.spaces.personalNote}</span>
            </div>
          </div>

          {owner && <General />}

          {shared && (
            <section className="space-y-2" data-space-people>
              <div className="flex items-center gap-2">
                <h3 className="flex-1 text-xs font-medium text-faint">{t.spaces.members}</h3>
                {sp.role !== "viewer" && (
                  <Button size="sm" variant="primary" onClick={() => openSpaces({ kind: "invite" })}>
                    <UserPlus />
                    {t.spaces.invite}
                  </Button>
                )}
              </div>
              <div className="divide-y divide-line rounded-2xl border border-line">
                {(data?.people ?? []).map((p) => (
                  <div key={p.id} className="flex min-h-14 items-center gap-3 px-3 py-2" data-person={p.id}>
                    <Avatar person={{ id: p.id, name: p.name || p.email }} size={32} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <b className="block truncate text-sm">
                        {p.name || p.email} {p.id === data?.me && <span className="text-xs font-normal text-faint">{t.spaces.you}</span>}
                      </b>
                      <span className="block truncate text-xs text-faint">{p.email}</span>
                    </div>
                    <span className="hidden text-xs text-muted sm:block" title={t.spaces.lastActive}>
                      {ago(p.lastActive)}
                    </span>
                    {owner && p.id !== data?.me && p.role !== "owner" ? (
                      <Menu>
                        <MenuTrigger asChild>
                          <button type="button" className="flex h-9 items-center gap-1 rounded-full border border-line px-3 text-[13px]" data-role-menu={p.id}>
                            {t.spaces.roles[p.role]}
                            <MoreHorizontal className="size-3.5 text-muted" />
                          </button>
                        </MenuTrigger>
                        <MenuContent>
                          {(["member", "viewer"] as const).map((r) => (
                            <MenuItem key={r} onSelect={() => p.role !== r && void act(() => changeMemberRole(p.id, r))} data-set-role={r}>
                              <span className={cn("size-1.5 rounded-full", p.role === r ? "bg-accent" : "bg-transparent")} />
                              <span className="flex-1">
                                {t.spaces.roles[r]}
                                <span className="block text-[11.5px] text-muted">{t.spaces.roleHints[r]}</span>
                              </span>
                            </MenuItem>
                          ))}
                          <MenuSeparator />
                          <MenuItem onSelect={() => setConfirm({ kind: "transfer", p })}>
                            <ShieldCheck />
                            {t.spaces.transfer}
                          </MenuItem>
                          <MenuItem danger onSelect={() => setConfirm({ kind: "remove", p })} data-remove-person>
                            <Trash2 />
                            {t.spaces.remove}
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    ) : (
                      <span className="text-[13px] text-muted">{t.spaces.roles[p.role]}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">{t.spaces.rolesNote}</p>
            </section>
          )}

          {shared && sp.role !== "viewer" && (
            <section className="space-y-2" data-space-links>
              <h3 className="text-xs font-medium text-faint">{t.spaces.links}</h3>
              {(data?.invites ?? []).filter((i) => !i.revokedAt && i.expiresAt > now && i.uses < i.maxUses).length === 0 && <p className="text-sm text-muted">{t.spaces.noLinks}</p>}
              {(data?.invites ?? []).map((i) => {
                const dead = i.revokedAt ? t.spaces.revoked : i.expiresAt <= now ? t.spaces.expired : i.uses >= i.maxUses ? t.spaces.usedUp : null;
                if (dead && now - i.createdAt > 14 * 86_400_000) return null;
                return (
                  <div key={i.id} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-1", dead && "opacity-60")} data-invite-row={i.id}>
                    <Link2 className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t.spaces.roles[i.role]} · {f(t.spaces.uses, { used: i.uses, max: i.maxUses })} · {dead ?? f(t.spaces.expiresOn, { date: date(i.expiresAt) })}
                      {i.byName && <span className="text-muted"> · {i.byName}</span>}
                    </span>
                    {!dead && (owner || i.createdBy === data?.me) && (
                      <Button size="sm" variant="ghost" onClick={() => void act(() => revokeInviteLink(i.id))} data-invite-revoke={i.id}>
                        {t.spaces.revoke}
                      </Button>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted">{t.spaces.linkNote}</p>
            </section>
          )}

          {(data?.deleted.length ?? 0) > 0 && (
            <section className="space-y-1">
              {data!.deleted.map((d) => (
                <div key={d.id} className="flex min-h-11 items-center gap-3">
                  <SpaceTile name={d.name} color={d.color} size={24} className="opacity-60" />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{d.name}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void restoreDeletedSpace(d.id)
                        .then(() => reloadInto(f(t.spaces.restored, { space: d.name })))
                        .catch(() => toast.error(t.spaces.failed))
                    }
                    data-restore-space={d.id}
                  >
                    <RotateCcw />
                    {f(t.spaces.restore, { space: "" }).trim()}
                  </Button>
                </div>
              ))}
            </section>
          )}

          {shared && (
            <section className="divide-y divide-line rounded-2xl border border-line" data-space-danger>
              <div className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1 leading-tight">
                  <b className="text-sm">{t.spaces.leave}</b>
                  {owner && <span className="block text-xs text-muted">{t.spaces.lastOwner}</span>}
                </div>
                <Button size="sm" onClick={() => setConfirm({ kind: "leave" })} data-space-leave>
                  <LogOut />
                  {t.spaces.leaveBtn}
                </Button>
              </div>
              {owner && (
                <div className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1 leading-tight">
                    <b className="text-sm">{t.spaces.delete}</b>
                    <span className="block text-xs text-muted">{t.spaces.deleteSub}</span>
                  </div>
                  <Button size="sm" variant="outline" className="border-danger/50 text-danger hover:bg-danger-soft" onClick={() => setConfirm({ kind: "delete" })} data-space-delete>
                    <Trash2 />
                    {t.spaces.delete}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </Modal>

      <ConfirmDialogs
        confirm={confirm}
        setConfirm={setConfirm}
        reauthHref={reauthHref}
        count={data?.people.length ?? 1}
        onRemove={(p) => act(() => removeSpaceMember(p.id), f(t.spaces.removed, { name: p.name || p.email }))}
        onTransfer={(p) => act(() => transferSpaceOwnership(p.id)).then((r) => r && "ok" in (r as object) && (r as { ok: boolean }).ok && reloadInto(f(t.spaces.transferred, { name: p.name || p.email })))}
        onLeave={async () => {
          const r = await leaveCurrentSpace().catch(() => null);
          if (!r) return void toast.error(t.spaces.failed);
          if (!r.ok) return void toast.error(r.reason === "last_owner" ? t.spaces.lastOwner : t.spaces.failed);
          reloadInto(f(t.spaces.left, { space: sp.name }));
        }}
        onDelete={async (typed) => {
          const r = await deleteCurrentSpace(typed).catch(() => null);
          if (!r) return void toast.error(t.spaces.failed);
          if ("stepUp" in r) return setConfirm({ kind: "stepUp" });
          if (!r.ok) return void toast.error(t.spaces.failed);
          reloadInto(f(t.spaces.deleted, { space: sp.name }));
        }}
      />
    </>
  );
}

function General() {
  const s = useStore();
  const { t } = useI18n();
  const sp = s.space!;
  const [name, setName] = useState(sp.name);
  const [color, setColor] = useState(sp.color in TILE ? sp.color : "violet");
  const [currency, setCurrency] = useState(sp.currency);
  const save = (v: { name?: string; color?: string; currency?: string }) =>
    updateCurrentSpace(v).catch(() => toast.error(t.spaces.failed));
  return (
    <section className="space-y-4" data-space-general>
      <h3 className="text-xs font-medium text-faint">{t.spaces.general}</h3>
      <div className="space-y-1.5">
        <Label htmlFor="space-name-edit">{t.spaces.name}</Label>
        <Input
          id="space-name-edit"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== sp.name && void save({ name: name.trim() })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-sm font-medium">{t.spaces.color}</span>
        <div role="radiogroup" aria-label={t.spaces.color} className="flex gap-2.5">
          {Object.keys(TILE).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={t.spaces.colors[c as keyof typeof t.spaces.colors]}
              onClick={() => {
                setColor(c);
                void save({ color: c });
              }}
              className={cn("size-7 rounded-full", color === c && "ring-2 ring-fg ring-offset-2 ring-offset-surface")}
              style={{ background: TILE[c] }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-sm font-medium">{t.spaces.currency}</span>
        <div className="w-[240px]">
          <Segmented
            label={t.spaces.currency}
            value={currency}
            onChange={(c) => {
              setCurrency(c);
              void save({ currency: c });
            }}
            options={[
              { value: "ILS", label: "₪ ILS" },
              { value: "USD", label: "$ USD" },
              { value: "EUR", label: "€ EUR" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function ConfirmDialogs({
  confirm,
  setConfirm,
  reauthHref,
  count,
  onRemove,
  onTransfer,
  onLeave,
  onDelete,
}: {
  confirm: Confirm;
  setConfirm: (c: Confirm) => void;
  reauthHref: string;
  count: number;
  onRemove: (p: Person) => Promise<unknown>;
  onTransfer: (p: Person) => Promise<unknown>;
  onLeave: () => Promise<void>;
  onDelete: (typed: string) => Promise<void>;
}) {
  const s = useStore();
  const { t, f } = useI18n();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const sp = s.space!;
  const close = () => {
    setConfirm(null);
    setTyped("");
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  if (!confirm) return null;
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
  return (
    <Modal open onOpenChange={(o) => !o && close()} title={title} className="max-w-[440px]">
      <div className="space-y-4" data-space-confirm={confirm.kind}>
        {confirm.kind === "stepUp" && <p className="text-sm text-muted">{t.spaces.stepUpBody}</p>}
        {confirm.kind === "remove" && <p className="text-sm text-muted">{f(t.spaces.removeBody, { space: sp.name })}</p>}
        {confirm.kind === "transfer" && <p className="text-sm text-muted">{f(t.spaces.transferBody, { space: sp.name })}</p>}
        {confirm.kind === "leave" && <p className="text-sm text-muted">{t.spaces.leaveBody}</p>}
        {confirm.kind === "delete" && (
          <>
            <p className="text-sm text-muted">{f(t.spaces.deleteBody, { n: count })}</p>
            <div className="space-y-1.5">
              <Label htmlFor="space-delete-name">{f(t.spaces.typeName, { name: sp.name })}</Label>
              <Input id="space-delete-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-delete-typed />
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t.spaces.cancel}
          </Button>
          {confirm.kind === "stepUp" ? (
            <a href={reauthHref} className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-sm font-medium text-on-brand" data-step-up-go>
              {t.spaces.stepUpGo}
            </a>
          ) : (
            <Button
              variant={confirm.kind === "transfer" ? "primary" : "danger"}
              disabled={busy || (confirm.kind === "delete" && typed.trim() !== sp.name.trim())}
              onClick={() =>
                void run(async () => {
                  const c = confirm;
                  close();
                  if (c.kind === "remove") await onRemove(c.p);
                  else if (c.kind === "transfer") await onTransfer(c.p);
                  else if (c.kind === "leave") await onLeave();
                  else if (c.kind === "delete") await onDelete(typed);
                })
              }
              data-confirm-go
            >
              {confirm.kind === "remove" ? t.spaces.remove : confirm.kind === "transfer" ? t.spaces.transfer : confirm.kind === "leave" ? t.spaces.leaveBtn : t.spaces.delete}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
