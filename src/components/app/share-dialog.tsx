"use client";

import { Copy, Globe, UserPlus } from "lucide-react";
import { toast } from "@/lib/toast";
import { setSharing } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { useStore } from "./store";
import { openSpaces } from "./spaces/space-ui";

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

/** A list's Share (R15 D1): the per-list guest invites are retired — people join the whole space (Invite people);
 *  the public read-only link to this one list stays here. */
export function ShareDialog() {
  const s = useStore();
  const { t, f } = useI18n();
  const collection = s.view.type === "collection" ? s.collections.find((c) => c.id === (s.view as { id: string }).id) ?? null : null;
  const open = s.panel === "share" && !!collection;
  if (!collection) return null;
  const publicUrl = collection.shareToken && typeof window !== "undefined" ? `${window.location.origin}/s/${collection.shareToken}` : null;
  const canInvite = s.space?.kind === "shared" && s.space.role !== "viewer";
  const close = () => s.setPanel(null);

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title={`${t.share.title} · ${collection.name}`} className="max-w-lg">
      <div className="space-y-6">
        {s.space && !s.readOnly && (
          <section className="flex items-center gap-3" data-share-space>
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <UserPlus className="size-4 text-muted" />
                {canInvite ? f(t.spaces.inviteTo, { space: s.space.name }) : t.spaces.create}
              </h3>
              <p className="mt-1 text-xs text-muted">{t.share.spaceHint}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                close();
                setTimeout(() => openSpaces({ kind: canInvite ? "invite" : "create" }), 120);
              }}
            >
              {canInvite ? t.spaces.invite : t.spaces.create}
            </Button>
          </section>
        )}

        <section className={s.space && !s.readOnly ? "border-t border-line pt-5" : undefined}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Globe className="size-4 text-muted" />
                {t.share.publicLink}
              </h3>
              <p className="mt-1 text-xs text-muted">{t.share.publicHint}</p>
            </div>
            {!s.readOnly && (
              <Button size="sm" variant={collection.shareToken ? "ghost" : "subtle"} onClick={async () => s.upsertCollection(await setSharing(collection.id, !collection.shareToken))}>
                {collection.shareToken ? t.collection.disableShare : t.collection.enableShare}
              </Button>
            )}
          </div>
          {publicUrl && (
            <div className="mt-2">
              <CopyRow url={publicUrl} />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
