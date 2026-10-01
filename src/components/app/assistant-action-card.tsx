"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, FolderPlus, Undo2, X } from "lucide-react";
import { applyAssistant, undoAssistant, type AssistantUndo } from "@/app/ai-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { changedKeys, isNewRef, newCollections, newRef, planChanges, type ItemChange, type ItemFields, type Proposal } from "@/lib/assistant-actions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "./store";

const SHOWN = 8;

/** Confirmation card under an assistant answer: what would change (before → after), Apply / Cancel, then Undo. */
export function ActionCard({ proposal, onItem }: { proposal: Proposal; onItem: (id: string) => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "applied" | "cancelled" | "undone">("idle");
  const [frozen, setFrozen] = useState<ItemChange[] | null>(null);
  const [undo, setUndo] = useState<AssistantUndo | null>(null);
  const [all, setAll] = useState(false);
  const live = useMemo(() => planChanges(proposal, s.items), [proposal, s.items]);
  const changes = frozen ?? live;
  const created = newCollections(proposal);

  const statusLabel = { to_buy: t.flow.toBuy, ordered: t.flow.ordered, purchased: t.flow.received };
  const collectionName = (id: string | null) =>
    id == null ? t.nav.unsorted : isNewRef(id) ? (created.find((c) => c.ref === newRef(id))?.name ?? "?") : (s.collections.find((c) => c.id === id)?.name ?? "?");
  const show = (k: keyof ItemFields, v: ItemFields) =>
    k === "status" ? statusLabel[v.status] : k === "priority" ? t.item[v.priority] : k === "quantity" ? `${t.item.quantity} ${v.quantity}` : collectionName(v.collectionId);

  const doUndo = async (u: AssistantUndo) => {
    try {
      const r = await undoAssistant(u);
      s.upsertItems(r.items);
      r.removedCollectionIds.forEach(s.removeCollection);
      setState("undone");
      toast(t.ai.act.undone);
    } catch {
      toast.error(t.errors.generic);
    }
  };

  const apply = async () => {
    setFrozen(live);
    setState("busy");
    try {
      const r = await applyAssistant({ proposal, currency: s.currency });
      if ("error" in r) {
        setFrozen(null);
        setState("idle");
        return void toast.error(t.ai.act.invalid);
      }
      r.collections.forEach(s.upsertCollection);
      s.upsertItems(r.items);
      setUndo(r.undo);
      setState("applied");
      toast.success(f(t.ai.act.toast, { summary: proposal.summary }), { action: { label: t.item.undo, onClick: () => void doUndo(r.undo) } });
    } catch {
      setFrozen(null);
      setState("idle");
      toast.error(t.errors.generic);
    }
  };

  const done = state === "applied" || state === "cancelled" || state === "undone";
  return (
    <section aria-label={t.ai.act.label} data-testid="ai-action-card" data-state={state} className={cn("rise-in rounded-[22px] border border-line bg-surface-2/60 p-4", done && state !== "applied" && "opacity-70")}>
      <p className="text-sm font-bold text-ink" dir="auto">
        {proposal.summary}
      </p>
      <ul className="mt-2 space-y-1.5">
        {created.map((c) => (
          <li key={c.ref} className="flex items-center gap-1.5 text-[13px] text-muted">
            <FolderPlus className="size-3.5 shrink-0 text-accent-ink" />
            <span className="bidi">{f(t.ai.act.newCollection, { kind: t.collection[c.kind].toLowerCase(), name: c.name })}</span>
          </li>
        ))}
        {(all ? changes : changes.slice(0, SHOWN)).map((c) => (
          <li key={c.id} data-item-id={c.id} className="text-[13px]">
            <button type="button" onClick={() => onItem(c.id)} className="block max-w-full truncate text-start font-medium text-fg hover:text-accent-ink bidi">
              {c.title}
            </button>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
              {changedKeys(c).map((k) =>
                k === "tags" ? (
                  <span key={k} className="bidi">
                    {[...c.after.tags.filter((x) => !c.before.tags.includes(x)).map((x) => `+${x}`), ...c.before.tags.filter((x) => !c.after.tags.includes(x)).map((x) => `−${x}`)].join(" ")}
                  </span>
                ) : (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span className="bidi">{show(k, c.before)}</span>
                    <ArrowRight className="size-3 shrink-0 rtl:-scale-x-100" aria-hidden />
                    <span className="bidi font-medium text-fg">{show(k, c.after)}</span>
                  </span>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
      {!all && changes.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 h-10 text-[13px] font-medium text-accent-ink md:h-auto">
          {f(t.ai.act.more, { n: changes.length - SHOWN })}
        </button>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === "idle" || state === "busy" ? (
          <>
            <Button variant="accent" className="h-10 md:h-8" size="sm" onClick={apply} disabled={state === "busy"}>
              {state === "busy" ? <Spinner /> : <Check />}
              {t.ai.act.apply}
            </Button>
            <Button variant="ghost" className="h-10 md:h-8" size="sm" onClick={() => setState("cancelled")} disabled={state === "busy"}>
              <X />
              {t.ai.act.cancel}
            </Button>
            <span className="text-xs text-faint">{t.ai.act.hint}</span>
          </>
        ) : (
          <>
            <span className={cn("inline-flex items-center gap-1 text-[13px]", state === "applied" ? "text-ok" : "text-muted")} role="status">
              {state === "applied" && <Check className="size-3.5" />}
              {state === "applied" ? t.ai.act.applied : state === "undone" ? t.ai.act.undone : t.ai.act.cancelled}
            </span>
            {state === "applied" && undo && (
              <Button variant="ghost" className="h-10 md:h-8" size="sm" onClick={() => void doUndo(undo)}>
                <Undo2 />
                {t.item.undo}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
