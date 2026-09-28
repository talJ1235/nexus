"use client";

import { useEffect, useState } from "react";
import { Copy, Globe, Link2, UserMinus, Users } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { setSharing } from "@/app/actions";
import { createInvite, getSharing, removeMember, revokeInvite, setMemberRole, type SharingState } from "@/app/share-actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { Segmented } from "./settings-dialog";
import { useStore } from "./store";

function ago(ts: number, locale: string) {
  const rtf = new Intl.RelativeTimeFormat(locale === "he" ? "he" : "en", { numeric: "auto" });
  const h = Math.round((ts - Date.now()) / 3600_000);
  return Math.abs(h) < 24 ? rtf.format(h, "hour") : rtf.format(Math.round(h / 24), "day");
}

function CopyRow({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} dir="ltr" className="h-9 text-xs" onFocus={(e) => e.target.select()} />
      <Button
        size="sm"
        className="h-9"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          toast.success(t.collection.copied);
        }}
      >
        <Copy />
        {t.collection.copy}
      </Button>
    </div>
  );
}

export function ShareDialog() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const collection = s.view.type === "collection" ? s.collections.find((c) => c.id === (s.view as { id: string }).id) ?? null : null;
  const open = s.panel === "share" && !!collection;
  const [st, setSt] = useState<SharingState | null>(null);
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !collection) return;
    let alive = true;
    getSharing(collection.id).then((x) => alive && setSt(x));
    return () => {
      alive = false;
    };
  }, [open, collection]);

  if (!collection) return null;
  const kind = collection.kind === "project" ? t.collection.project : t.collection.list;
  const publicUrl = collection.shareToken && typeof window !== "undefined" ? `${window.location.origin}/s/${collection.shareToken}` : null;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          s.setPanel(null);
          setFresh(null);
        }
      }}
      title={`${t.share.title} · ${collection.name}`}
      className="max-w-lg"
    >
      <div className="space-y-6">
        <section>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="size-4 text-muted" />
            {t.share.invite}
          </h3>
          <p className="mt-1 text-xs text-muted">{f(t.share.inviteHint, { kind: kind.toLowerCase() })}</p>
          <div className="mt-3 flex items-center gap-2">
            <Segmented
              size="sm"
              label={t.share.invite}
              value={role}
              onChange={setRole}
              options={[
                { value: "editor", label: t.share.editor },
                { value: "viewer", label: t.share.viewer },
              ]}
            />
            <Button
              size="sm"
              variant="accent"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await createInvite(collection.id, role, window.location.origin);
                  setFresh(r.url);
                  setSt(r.state);
                } catch {
                  toast.error(t.errors.generic);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : <Link2 />}
              {t.share.createLink}
            </Button>
          </div>
          {fresh && (
            <div className="mt-3 animate-pop-in rounded-xl border border-accent/50 bg-accent-soft/40 p-3">
              <p className="mb-2 text-xs font-medium text-accent-ink">{t.share.linkReady}</p>
              <CopyRow url={fresh} />
            </div>
          )}
          {!!st?.invites.length && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs text-faint">{t.share.activeLinks}</p>
              <ul className="space-y-1">
                {st.invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg/60 px-3 py-1.5 text-sm">
                    <span className="text-muted">
                      {i.role === "editor" ? t.share.editor : t.share.viewer} · {new Date(i.createdAt).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short" })}
                    </span>
                    <button type="button" className="text-xs font-medium text-danger hover:underline" onClick={async () => setSt(await revokeInvite(i.id, collection.id))}>
                      {t.share.revoke}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="border-t border-line pt-5">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4 text-muted" />
            {t.share.people}
          </h3>
          {!st ? (
            <div className="skeleton-pulse mt-3 space-y-2">
              <div className="skeleton h-10 rounded-lg" />
            </div>
          ) : st.members.length ? (
            <ul className="mt-3 space-y-1.5">
              {st.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-sm font-semibold">{m.name.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium bidi">
                      {m.name}
                    </div>
                    <div className="text-xs text-faint">{m.lastSeenAt ? f(t.share.lastSeen, { time: ago(m.lastSeenAt, locale) }) : t.share.never}</div>
                  </div>
                  <Segmented
                    size="sm"
                    label={m.name}
                    value={m.role}
                    onChange={async (r) => setSt(await setMemberRole(m.id, collection.id, r))}
                    options={[
                      { value: "editor", label: t.share.editor },
                      { value: "viewer", label: t.share.viewer },
                    ]}
                  />
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
                    title={t.share.remove}
                    aria-label={t.share.remove}
                    onClick={async () => setSt(await removeMember(m.id, collection.id))}
                  >
                    <UserMinus className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">{t.share.noPeople}</p>
          )}
        </section>

        <section className="border-t border-line pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Globe className="size-4 text-muted" />
                {t.share.publicLink}
              </h3>
              <p className="mt-1 text-xs text-muted">{t.share.publicHint}</p>
            </div>
            <Button size="sm" variant={collection.shareToken ? "ghost" : "subtle"} onClick={async () => s.upsertCollection(await setSharing(collection.id, !collection.shareToken))}>
              {collection.shareToken ? t.collection.disableShare : t.collection.enableShare}
            </Button>
          </div>
          {publicUrl && (
            <div className={cn("mt-2")}>
              <CopyRow url={publicUrl} />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
