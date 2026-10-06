"use client";

import { useEffect, useState } from "react";
import { Copy, FolderInput, Link2, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { createCollection, deleteCollection, setSharing, updateCollection } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button, Input, Label, Textarea } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { CURRENCIES } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { openSpaces } from "./spaces/space-ui";
import { COLLECTION_COLORS, COLOR_KEYS } from "./view-items";

export function CollectionDialog() {
  const s = useStore();
  const { t, f } = useI18n();
  const ed = s.editor;
  const existing = ed?.mode === "edit" ? ed.collection : null;
  const [kind, setKind] = useState<"project" | "list">("project");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("amber");
  const [budget, setBudget] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState("ILS");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ed) return;
    /* eslint-disable react-hooks/set-state-in-effect -- load form state when the dialog opens */
    if (ed.mode === "create") {
      setKind(ed.kind);
      setName("");
      setDescription("");
      setColor(COLOR_KEYS[s.collections.length % COLOR_KEYS.length]);
      setBudget("");
      setBudgetCurrency(s.currency);
    } else {
      const c = ed.collection;
      setKind(c.kind);
      setName(c.name);
      setDescription(c.description ?? "");
      setColor(c.color);
      setBudget(c.budget != null ? String(c.budget) : "");
      setBudgetCurrency(c.budgetCurrency);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ed, s.collections.length, s.currency]);

  const live = existing ? s.collections.find((c) => c.id === existing.id) ?? existing : null;
  const shareUrl = live?.shareToken && typeof window !== "undefined" ? `${window.location.origin}/s/${live.shareToken}` : null;
  const kindLabel = kind === "project" ? t.collection.project : t.collection.list;

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const payload = {
      kind,
      name: name.trim(),
      description: description.trim() || null,
      color,
      budget: kind === "project" && budget.trim() ? Math.max(0, Number(budget)) : null,
      budgetCurrency,
    };
    try {
      if (existing) {
        s.upsertCollection(await updateCollection(existing.id, payload));
      } else {
        const c = await createCollection(payload);
        s.upsertCollection(c);
        s.setView({ type: "collection", id: c.id });
      }
      s.setEditor(null);
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!ed}
      onOpenChange={(o) => !o && s.setEditor(null)}
      title={existing ? `${t.collection.rename} · ${existing.name}` : kind === "project" ? t.nav.newProject : t.nav.newList}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        {!existing && (
          <div className="grid grid-cols-2 rounded-lg border border-line-strong bg-bg p-0.5 text-sm">
            {(["project", "list"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={cn("h-8 rounded-md transition", kind === k ? "bg-fg text-bg" : "text-muted hover:text-fg")}>
                {k === "project" ? t.collection.project : t.collection.list}
              </button>
            ))}
          </div>
        )}
        <div>
          <Label htmlFor="c-name">{t.collection.name}</Label>
          <div className="flex gap-2">
            <Input id="c-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className="bidi" maxLength={80} />
          </div>
          <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Color">
            {COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={color === k}
                aria-label={k}
                onClick={() => setColor(k)}
                className={cn("size-6 rounded-full border-2 transition", color === k ? "border-fg scale-110" : "border-transparent")}
                style={{ background: COLLECTION_COLORS[k] }}
              />
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="c-desc">{t.collection.description}</Label>
          <Textarea id="c-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="bidi" maxLength={500} />
        </div>
        {kind === "project" && (
          <div>
            <Label htmlFor="c-budget">{t.collection.budget}</Label>
            <div className="flex">
              <Input id="c-budget" type="number" min={0} step="any" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t.collection.noBudget} className="tabular rounded-e-none" />
              <select value={budgetCurrency} onChange={(e) => setBudgetCurrency(e.target.value)} className="h-10 rounded-e-lg border border-s-0 border-line-strong bg-sunken px-2 text-sm outline-none" aria-label={t.item.currency}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {live && (
          <div className="rounded-xl border border-line bg-bg/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Link2 className="size-4 text-muted" />
                {t.collection.share}
              </div>
              <Button
                size="sm"
                variant={live.shareToken ? "ghost" : "subtle"}
                onClick={async () => s.upsertCollection(await setSharing(live.id, !live.shareToken))}
              >
                {live.shareToken ? t.collection.disableShare : t.collection.enableShare}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted">{f(live.shareToken ? t.collection.shareOn : t.collection.shareOff, { kind: kindLabel })}</p>
            {shareUrl && (
              <div className="mt-2 flex gap-2">
                <Input readOnly value={shareUrl} dir="ltr" className="h-9 text-xs" onFocus={(e) => e.target.select()} />
                <Button
                  size="sm"
                  className="h-9"
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareUrl);
                    toast.success(t.collection.copied);
                  }}
                >
                  <Copy />
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {live ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger-soft hover:text-danger"
              onClick={async () => {
                if (!window.confirm(f(t.collection.deleteConfirm, { name: live.name }))) return;
                await deleteCollection(live.id);
                s.removeCollection(live.id);
                s.setEditor(null);
                s.setView({ type: "to_buy" });
              }}
            >
              <Trash2 />
              {t.collection.delete}
            </Button>
          ) : (
            <span />
          )}
          {live && s.spaces.some((sp) => sp.id !== s.space?.id && sp.role !== "viewer") ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                s.setEditor(null);
                setTimeout(() => openSpaces({ kind: "move", collectionId: live.id }), 120);
              }}
              data-collection-move
            >
              <FolderInput />
              {t.spaces.moveTo}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => s.setEditor(null)}>
              {t.item.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              {existing ? t.item.save : t.collection.create}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
