"use client";

import { FolderPlus, ListPlus, Pencil } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Ring } from "@/components/ui/ring";
import { budgetStats, countable, sumTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import type { Collection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";

/** Projects (and lists) as cards: items left, amount left, budget ring, bought vs total. Tap → the project page. */
export function ProjectsView() {
  const s = useStore();
  const { t } = useI18n();
  const projects = s.collections.filter((c) => c.kind === "project" && !c.archived);
  const lists = s.collections.filter((c) => c.kind === "list" && !c.archived);

  return (
    <div className="flex flex-col gap-5" data-projects-view>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{t.projects.title}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-10 px-4" onClick={() => s.setEditor({ mode: "create", kind: "list" })}>
            <ListPlus /> {t.nav.newList}
          </Button>
          <Button variant="primary" size="sm" className="h-10 px-4" onClick={() => s.setEditor({ mode: "create", kind: "project" })} data-new-project>
            <FolderPlus /> {t.nav.newProject}
          </Button>
        </div>
      </div>
      {projects.length === 0 && <p className="rounded-[26px] border border-dashed border-line-strong px-6 py-10 text-center text-[15px] text-muted">{t.projects.empty}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((c, i) => (
          <ProjectCard key={c.id} c={c} index={i} />
        ))}
      </div>
      {lists.length > 0 && (
        <>
          <h2 className="mt-2 text-[17px] font-extrabold">{t.projects.lists}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {lists.map((c, i) => (
              <ProjectCard key={c.id} c={c} index={projects.length + i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectCard({ c, index }: { c: Collection; index: number }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const items = s.items.filter((i) => i.collectionId === c.id);
  const toBuy = countable(items.filter((i) => i.status === "to_buy"), s.altGroups, s.rates);
  const left = sumTotals(toBuy, s.rates, s.currency).total;
  const bought = items.filter((i) => i.status !== "to_buy").length;
  const b = c.kind === "project" ? budgetStats(c, s.items, s.altGroups, s.rates, s.currency) : null;
  const color = COLLECTION_COLORS[c.color] ?? COLLECTION_COLORS.slate;
  const ringValue = b?.budget != null ? (b.pct ?? 0) / 100 : items.length ? bought / items.length : 0;
  const m = (v: number) => formatMoney(v, s.currency, locale);

  return (
    <div
      className="rise-in group relative flex flex-col gap-3 rounded-[26px] border border-line bg-surface p-4 transition-[transform,box-shadow] duration-[250ms] ease-[var(--ease-out)] hover:-translate-y-[3px] hover:shadow-[0_14px_30px_color-mix(in_srgb,var(--ink)_10%,transparent)] active:scale-[0.99]"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      data-project-card={c.id}
    >
      <button type="button" className="absolute inset-0 z-[1] rounded-[26px]" aria-label={c.name} onClick={() => s.setView({ type: "collection", id: c.id })} />
      <div className="flex items-start gap-3">
        <i className={cn("mt-1.5 size-3 shrink-0", c.kind === "project" ? "rounded-[4px]" : "rounded-full")} style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <h3 className="bidi truncate text-[16px] font-extrabold">{c.name}</h3>
          <p className="tabular mt-0.5 text-[13px] text-muted">
            {toBuy.length ? (toBuy.length === 1 ? t.projects.leftOne : f(t.projects.left, { n: toBuy.length })) : t.projects.done}
            {left > 0 && <> · {f(t.projects.toBuy, { amount: m(left) })}</>}
          </p>
        </div>
        <Ring value={ringValue} size={44} stroke={6} color={b?.state === "over" ? "var(--danger)" : color}>
          <span className="tabular text-[11px] font-extrabold">{Math.round(ringValue * 100)}%</span>
        </Ring>
        <button
          type="button"
          onClick={() => s.setEditor({ mode: "edit", collection: c })}
          className="relative z-[2] -me-1.5 -mt-1 grid size-9 place-items-center rounded-full text-muted opacity-0 transition hover:bg-surface-2 hover:text-ink group-hover:opacity-100 max-lg:opacity-100"
          aria-label={t.collection.rename}
          title={t.collection.rename}
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <i className="grow-x block h-full rounded-full" style={{ width: `${items.length ? (bought / items.length) * 100 : 0}%`, background: color }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-muted">
          <span className="tabular">{f(t.projects.bought, { done: bought, total: items.length })}</span>
          {b?.budget != null && <span className="tabular">{t.home.budget} {m(b.budget)}</span>}
        </div>
      </div>
    </div>
  );
}
