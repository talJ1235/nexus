"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, MessageCircle, QrCode, RotateCcw, Share2 } from "lucide-react";
import { createInviteLink, moveCollectionBack, moveCollectionToSpace, revokeInviteLink } from "@/app/space-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { APP_NAME } from "@/lib/brand";
import { toast } from "@/lib/toast";
import { Segmented } from "../settings-dialog";
import { useStore } from "../store";
import { InviteQr } from "./qr";
import { SpaceLook } from "./space-ui";

/** Invite-desktop / -phone body: role, one link (Copy · QR · WhatsApp · Share), reset. Used by Invite and Create. */
export function InvitePanel({ name, color }: { name: string; color: string }) {
  const { t, f } = useI18n();
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const made = useRef<string | null>(null);

  const make = async (r: "member" | "viewer", replace?: string) => {
    try {
      if (replace) await revokeInviteLink(replace).catch(() => {});
      const { id, token } = await createInviteLink(r);
      setLink({ id, url: `${window.location.origin}/join/${token}` });
      made.current = id;
    } catch {
      toast.error(t.spaces.failed);
    }
  };
  useEffect(() => {
    if (made.current) return;
    made.current = "pending";
    void make("member");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard?.writeText(link.url).catch(() => {});
    setCopied(true);
    toast.success(t.spaces.copied);
    setTimeout(() => setCopied(false), 1600);
  };
  const msg = link ? f(t.spaces.inviteMsg, { space: name, app: APP_NAME, url: link.url }) : "";
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className="space-y-4" data-invite-panel>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm font-medium">{t.spaces.joinAs}</span>
        <div className="w-[220px]">
          <Segmented
            label={t.spaces.joinAs}
            value={role}
            onChange={(r) => {
              setRole(r);
              if (link) void make(r, link.id);
            }}
            options={[
              { value: "member", label: t.spaces.roles.member, title: t.spaces.roleHints.member },
              { value: "viewer", label: t.spaces.roles.viewer, title: t.spaces.roleHints.viewer },
            ]}
          />
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
        <div className="mb-2 text-[12.5px] text-muted">{f(t.spaces.joinsAs, { role: t.spaces.roles[role].toLowerCase(), days: 7 })}</div>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link?.url ?? "…"}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t.spaces.inviteLink}
            className="h-9 min-w-0 flex-1 rounded-full border border-line bg-surface px-3 text-[13px] text-muted outline-none"
            data-invite-url
          />
          <Button size="sm" onClick={() => void copy()} disabled={!link} data-invite-copy>
            {copied ? <Check /> : <Copy />}
            {t.spaces.copy}
          </Button>
          <Button size="icon" className="size-9" onClick={() => setQr((q) => !q)} disabled={!link} aria-label={t.spaces.qr} aria-pressed={qr} data-invite-qr-toggle>
            <QrCode />
          </Button>
        </div>
        {qr && link && (
          <div className="mt-3 flex justify-center">
            <InviteQr value={link.url} name={name} color={color} size={184} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!link}
          onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener")}
          data-invite-whatsapp
        >
          <MessageCircle />
          {t.spaces.whatsapp}
        </Button>
        {canShare && (
          <Button size="sm" variant="outline" disabled={!link} onClick={() => void navigator.share({ title: name, text: msg, url: link!.url }).catch(() => {})}>
            <Share2 />
            {t.spaces.shareLink}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={!link} onClick={() => link && void make(role, link.id)} className="ms-auto" data-invite-reset>
          <RotateCcw />
          {t.spaces.reset}
        </Button>
      </div>
    </div>
  );
}

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  if (!s.space) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={f(t.spaces.inviteTo, { space: s.space.name })} className="max-w-[560px]">
      {open && <InvitePanel name={s.space.name} color={s.space.color} />}
    </Modal>
  );
}

/** C4: "Move to space…" for a list/project — spaces where you can edit; one transaction; undo toast. */
export function MoveDialog({ collectionId, onOpenChange }: { collectionId: string | null; onOpenChange: (o: boolean) => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const col = s.collections.find((c) => c.id === collectionId);
  const targets = s.spaces.filter((sp) => sp.id !== s.space?.id && sp.role !== "viewer");
  const move = async (to: string, toName: string) => {
    if (!collectionId || !s.space) return;
    setBusy(to);
    try {
      const r = await moveCollectionToSpace(collectionId, to);
      s.removeCollection(collectionId);
      onOpenChange(false);
      if (s.view.type === "collection" && s.view.id === collectionId) s.setView({ type: "home" });
      toast.success(f(t.spaces.moved, { space: toName }), {
        action: {
          label: t.spaces.undo,
          onClick: () =>
            void moveCollectionBack(collectionId, r.from, to)
              .then(() => window.location.reload())
              .catch(() => toast.error(t.spaces.failed)),
        },
      });
    } catch {
      toast.error(t.spaces.failed);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open={!!collectionId} onOpenChange={onOpenChange} title={t.spaces.moveTitle} description={col ? `${col.name} · ${t.spaces.moveHint}` : t.spaces.moveHint}>
      <div className="space-y-1" data-move-dialog>
        {targets.map((sp) => (
          <button
            key={sp.id}
            type="button"
            disabled={!!busy}
            onClick={() => void move(sp.id, sp.name)}
            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-start transition hover:bg-surface-2 disabled:opacity-60"
            data-move-target={sp.id}
          >
            <SpaceLook space={sp} size={28} />
            <span className="min-w-0 flex-1 truncate font-medium">{sp.name}</span>
            <span className="text-[12px] text-muted">{sp.kind === "personal" ? t.spaces.personal : t.spaces.roles[sp.role]}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
