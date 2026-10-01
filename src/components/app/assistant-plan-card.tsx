"use client";

import { useMemo, useState } from "react";
import { Check, FolderPlus, Lightbulb, Plus, Store } from "lucide-react";
import { addPlannedParts } from "@/app/ai-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Plan } from "@/lib/assistant";
import { budgetStats } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "./store";

const range = (min: number | null, max: number | null, cur: string, locale: string) =>
  [min, max].filter((v, i, a) => v != null && (i === 0 || v !== a[0])).map((v) => formatMoney(v, cur, locale)).join("–");

/**
 * A drafted parts list inside the chat (Round 9 C1): lines with qty, estimate and (with memory) the usual store,
 * a per-line Add, the budget fit for the chosen project, and "Add all to…". A new project is created by the first add.
 */
export function PlanCard({ plan, defaultTarget }: { plan: Plan; defaultTarget: string | null }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [target, setTarget] = useState<string>(defaultTarget ?? "new");
  // The project made by the first add when the target was "new".
  const [created, setCreated] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const dest = created ?? (target === "new" ? null : target);
  const open = plan.parts.map((p, i) => i).filter((i) => !added.has(i) && !plan.parts[i].have);

  const est = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const i of open) {
      const p = plan.parts[i];
      min += (p.estMin ?? p.estMax ?? 0) * p.qty;
      max += (p.estMax ?? p.estMin ?? 0) * p.qty;
    }
    return { min, max };
  }, [open, plan.parts]);

  const fit = useMemo(() => {
    const c = dest ? s.collections.find((x) => x.id === dest) : null;
    if (!c || c.kind !== "project") return null;
    const b = budgetStats(c, s.items, s.altGroups, s.rates, s.currency);
    if (b.budget == null) return null;
    const left = b.budget - b.used;
    return { left, over: est.max - left };
  }, [dest, s.collections, s.items, s.altGroups, s.rates, s.currency, est.max]);

  const add = async (idx: number[], key: number | "all") => {
    if (!idx.length) return;
    setBusy(key);
    try {
      const r = await addPlannedParts({
        parts: idx.map((i) => {
          const { have, store, ...p } = plan.parts[i];
          void have;
          void store;
          return p;
        }),
        collectionId: dest,
        newProject: dest ? null : { name: plan.projectName || t.ai.untitled, description: plan.summary, budget: null },
        currency: s.currency,
        estimateLabel: t.ai.estimate,
      });
      if (r.collection) {
        s.upsertCollection(r.collection);
        setCreated(r.collection.id);
      }
      s.upsertItems(r.items);
      setAdded((a) => new Set([...a, ...idx]));
      const id = r.collection?.id ?? dest;
      const name = s.collections.find((c) => c.id === id)?.name ?? r.collection?.name ?? plan.projectName;
      toast.success(f(t.ai.planDone, { name }), id ? { action: { label: t.report.view, onClick: () => (s.setPanel(null), s.setView({ type: "collection", id })) } } : undefined);
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rise-in overflow-hidden rounded-[22px] border border-line bg-surface" data-ai-plan>
      <div className="space-y-1 border-b border-line bg-[image:var(--act-plan)] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[12.5px] font-bold" style={{ color: "var(--act-plan-ink)" }}>
          <FolderPlus className="size-4" /> {t.ai.planTab}
        </div>
        <h3 className="text-[16px] font-extrabold leading-snug bidi">{plan.projectName}</h3>
        {plan.summary && <p className="text-[13px] text-muted bidi">{plan.summary}</p>}
      </div>
      <ul className="divide-y divide-line">
        {plan.parts.map((p, i) => {
          const done = added.has(i);
          return (
            <li key={i} className={cn("flex items-start gap-3 px-4 py-2.5", (p.have || done) && "opacity-60")} data-ai-plan-line>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold leading-snug bidi">
                  {p.name}
                  {p.qty > 1 && <span className="tabular ms-1.5 font-medium text-muted">×{p.qty}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                  {(p.estMin != null || p.estMax != null) && <span className="tabular">~{range(p.estMin, p.estMax, plan.currency, locale)}</span>}
                  {p.store && (
                    <span className="inline-flex items-center gap-1">
                      <Store className="size-3" />
                      {p.store}
                    </span>
                  )}
                  {!p.essential && <span className="rounded bg-surface-2 px-1.5">{t.ai.optional}</span>}
                  {p.have && <span className="rounded bg-ok-soft px-1.5 text-ok">{t.ai.have}</span>}
                </div>
                {p.spec && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted bidi">{p.spec}</p>}
              </div>
              {!p.have && (
                <button
                  type="button"
                  disabled={done || busy != null}
                  onClick={() => void add([i], i)}
                  className={cn("mt-0.5 inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12.5px] font-bold transition", done ? "text-ok" : "bg-surface-2 text-ink hover:bg-line")}
                  data-ai-plan-add={i}
                >
                  {busy === i ? <Spinner /> : done ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                  {done ? t.ai.addedLine : t.ai.addLine}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {plan.tips.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
            <Lightbulb className="size-3.5" /> {t.ai.tips}
          </div>
          <ul className="list-disc space-y-0.5 ps-5 text-[12.5px] text-muted bidi">
            {plan.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-2.5 border-t border-line bg-surface-2/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="tabular font-semibold">
            ~{formatMoney(est.min, plan.currency, locale)}
            {est.max > est.min ? `–${formatMoney(est.max, plan.currency, locale)}` : ""}
          </span>
          {fit && (
            <span className={cn("text-end text-[12.5px] font-semibold", fit.over > 0 ? "text-danger" : "text-ok")} data-ai-plan-fit>
              {fit.over > 0 ? f(t.ai.overBudget, { amount: formatMoney(fit.over, s.currency, locale) }) : f(t.ai.fits, { left: formatMoney(fit.left, s.currency, locale) })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!created && (
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={t.ai.planFor}
              className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-3 text-[13px] outline-none"
              data-ai-plan-target
            >
              <option value="new">+ {t.nav.newProject}</option>
              {s.collections
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          )}
          <Button variant="accent" className="h-10 flex-1" disabled={!open.length || busy != null} onClick={() => void add(open, "all")} data-ai-plan-all>
            {busy === "all" ? <Spinner /> : <Check />}
            {f(t.ai.addAll, { n: open.length })}
          </Button>
        </div>
      </div>
    </div>
  );
}
