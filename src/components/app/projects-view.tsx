"use client";

import { useMemo } from "react";
import { FileSpreadsheet, Flag, Folder, FolderPlus, Gauge, ListPlus, MoreHorizontal, Pencil, Plus, Share2, ShoppingCart, Sparkles, Truck } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Ring } from "@/components/ui/ring";
import { download, exportUrl } from "@/lib/export-url";
import { budgetStats, countable, sumTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlays";
import type { Collection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProjectCover, openProject, projectColor, useProjectStats } from "./project-cover";
import { useReadOnly } from "./offline-banner";
import { useStore } from "./store";

/**
 * Projects (Round 9 E1, Round 10 C1): projects first, then lists, then one "Start something new" card at the very
 * bottom. Creating either is one pattern: the "New" pill in the header (New project / New list) and the bottom card's
 * two halves look like one family — the same plan gradient chips, folder and list marks.
 */
export function ProjectsView() {
  const s = useStore();
  const { t } = useI18n();
  const projects = s.collections.filter((c) => c.kind === "project" && !c.archived);
  const lists = s.collections.filter((c) => c.kind === "list" && !c.archived);

  return (
    <div className="flex flex-col gap-8 pb-4" data-projects-view>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] lg:text-[28px]">{t.projects.title}</h1>
          <NewMenu />
        </div>
        {projects.length > 0 && <Summary projects={projects} />}
      </header>
      <section className="flex flex-col gap-3.5">
        <SectionTitle label={t.projects.title} n={projects.length} />
        {projects.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-projects-section>
            {projects.map((c, i) => (
              <ProjectCard key={c.id} c={c} index={i} />
            ))}
          </div>
        ) : (
          <EmptySection kind="project" text={t.projects.empty} />
        )}
      </section>
      <section className="flex flex-col gap-3.5">
        <SectionTitle label={t.projects.lists} n={lists.length} />
        {lists.length ? (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-lists-section>
            {lists.map((c, i) => (
              <ProjectCard key={c.id} c={c} index={projects.length + i} small />
            ))}
          </div>
        ) : (
          <EmptySection kind="list" text={t.projects.emptyLists} />
        )}
      </section>
      <StartNewCard index={projects.length + lists.length} />
    </div>
  );
}

function SectionTitle({ label, n }: { label: string; n: number }) {
  return (
    <h2 className="flex items-center gap-2 text-[18px] font-extrabold tracking-[-0.01em]">
      {label}
      <span className="tabular grid h-6 min-w-6 place-items-center rounded-full bg-surface-2 px-2 text-[12.5px] font-bold text-muted">{n}</span>
    </h2>
  );
}

/** A section with nothing in it yet: what it's for, and the one button that starts it. */
function EmptySection({ kind, text }: { kind: "project" | "list"; text: string }) {
  const s = useStore();
  const ro = useReadOnly();
  const { t } = useI18n();
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-[26px] bg-surface-2/70 p-5"
      data-projects-section={kind === "project" ? "" : undefined}
      data-lists-section={kind === "list" ? "" : undefined}
      data-empty-section={kind}
    >
      <KindChip kind={kind} />
      <p className="min-w-[16ch] flex-1 text-[14px] text-muted">{text}</p>
      <Button variant="outline" className="h-10 rounded-full px-4" disabled={ro.ro} onClick={() => create(s, kind)}>
        <Plus /> {kind === "project" ? t.nav.newProject : t.nav.newList}
      </Button>
    </div>
  );
}

/** Header summary across projects: how many are active, what's left to buy, and the budget nearest its limit. */
function Summary({ projects }: { projects: Collection[] }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const m = (v: number) => formatMoney(Math.round(v), s.currency, locale);
  const sum = useMemo(() => {
    let left = 0;
    let active = 0;
    let nearest: { name: string; pct: number; over: number } | null = null;
    for (const c of projects) {
      const open = s.items.filter((i) => i.collectionId === c.id && i.status === "to_buy");
      if (open.length) active++;
      left += sumTotals(countable(open, s.altGroups, s.rates), s.rates, s.currency).total;
      const b = budgetStats(c, s.items, s.altGroups, s.rates, s.currency);
      if (b.budget != null && b.pct != null && (!nearest || b.pct > nearest.pct)) nearest = { name: c.name, pct: b.pct, over: b.used - b.budget };
    }
    return { left, active, nearest };
  }, [projects, s.items, s.altGroups, s.rates, s.currency]);
  const chip = "inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-semibold shadow-card ring-1 ring-line";
  const near = sum.nearest;
  return (
    <div className="flex flex-wrap gap-2" data-projects-summary>
      <span className={chip}>
        <Folder className="size-3.5 text-muted" /> {sum.active === 1 ? t.projects.activeOne : f(t.projects.activeN, { n: sum.active })}
      </span>
      <span className={cn(chip, "tabular")}>
        <ShoppingCart className="size-3.5 text-muted" /> {f(t.projects.leftAll, { amount: m(sum.left) })}
      </span>
      <span className={cn(chip, "bidi", near && near.over > 0 && "text-danger")}>
        <Gauge className="size-3.5 text-muted" />
        {near ? (near.over > 0 ? f(t.projects.nearestOver, { name: near.name, amount: m(near.over) }) : f(t.projects.nearest, { name: near.name, pct: Math.round(near.pct) })) : t.projects.noBudgets}
      </span>
    </div>
  );
}

const create = (s: ReturnType<typeof useStore>, kind: "project" | "list") => s.setEditor({ mode: "create", kind });

/** The two kinds' marks, shared by the header menu and the bottom card. */
function KindChip({ kind, size = "md" }: { kind: "project" | "list"; size?: "sm" | "md" }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-[image:var(--act-plan)] text-[var(--act-plan-ink)] transition-transform duration-[450ms] ease-[var(--ease-spring)]", size === "sm" ? "size-8" : "size-12")}>
      {kind === "project" ? <FolderPlus className={size === "sm" ? "size-4" : "size-5"} /> : <ListPlus className={size === "sm" ? "size-4" : "size-5"} />}
    </span>
  );
}

/** Header "New" pill → New project / New list. */
function NewMenu() {
  const s = useStore();
  const ro = useReadOnly();
  const { t } = useI18n();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="outline" className="h-10 gap-1.5 rounded-full border-dashed border-line-strong px-4 font-bold" disabled={ro.ro} data-projects-new>
          <Plus /> {t.projects.newMenu}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-[240px]">
        {(["project", "list"] as const).map((k) => (
          <MenuItem key={k} onSelect={() => create(s, k)} className="gap-3 py-2" data-projects-new-item={k}>
            <KindChip kind={k} size="sm" />
            <span className="flex min-w-0 flex-col">
              <b className="text-[14px] font-bold">{k === "project" ? t.nav.newProject : t.nav.newList}</b>
              <span className="text-xs text-muted">{k === "project" ? t.projects.projectHint : t.projects.listHint}</span>
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** Bottom of the page: one dashed card with two halves, New project · New list. */
function StartNewCard({ index }: { index: number }) {
  const s = useStore();
  const ro = useReadOnly();
  const { t } = useI18n();
  return (
    <section className="rise-in mt-2 rounded-[26px] border-2 border-dashed border-line-strong p-2" style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }} aria-label={t.projects.startNew} data-start-new>
      <h2 className="px-3 pb-1 pt-2 text-[13px] font-bold text-muted">{t.projects.startNew}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["project", "list"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={ro.ro}
            onClick={() => create(s, k)}
            className="group flex min-h-[76px] items-center gap-3.5 rounded-[20px] p-3.5 text-start transition hover:bg-surface-2 active:scale-[0.99] disabled:opacity-50"
            data-start-new-item={k}
          >
            <span className="group-hover:rotate-[-8deg] transition-transform duration-[450ms] ease-[var(--ease-spring)]">
              <KindChip kind={k} />
            </span>
            <span className="flex min-w-0 flex-col">
              <b className="text-[16px] font-extrabold">{k === "project" ? t.nav.newProject : t.nav.newList}</b>
              <span className="text-[13px] text-muted">{k === "project" ? t.projects.projectHint : t.projects.listHint}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ c, index, small }: { c: Collection; index: number; small?: boolean }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const st = useProjectStats(c);
  const color = projectColor(c);
  const m = (v: number) => formatMoney(Math.round(v), s.currency, locale);
  const budget = st.b?.budget != null ? st.b : null;
  const ring = budget ? Math.min(1, (budget.pct ?? 0) / 100) : st.items.length ? st.bought / st.items.length : 0;

  return (
    <div
      className="rise-in group relative flex flex-col overflow-hidden rounded-[26px] border border-line bg-surface shadow-card transition-[transform,box-shadow] duration-[250ms] ease-[var(--ease-out)] hover:-translate-y-[3px] hover:shadow-lift active:scale-[0.99]"
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
      data-project-card={c.id}
      data-opens
    >
      <button type="button" className="absolute inset-0 z-[1] rounded-[26px]" aria-label={c.name} onClick={() => openProject(c.id, s.setView)} />
      <ProjectCover c={c} pics={st.pics} className={small ? "h-[64px] sm:h-[76px]" : "h-[84px] sm:h-[104px]"} />
      <div className="flex flex-1 flex-col gap-2.5 p-4 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className={cn("bidi truncate font-extrabold leading-tight tracking-[-0.01em]", small ? "text-[16px]" : "text-[18px]")}>{c.name}</h3>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              <span className="tabular">{st.toBuy.length ? (st.toBuy.length === 1 ? t.projects.leftOne : f(t.projects.left, { n: st.toBuy.length })) : t.projects.done}</span>
              {st.next && (
                <>
                  {" · "}
                  <span className="bidi">{f(t.projects.next, { item: st.next.title })}</span>
                </>
              )}
            </p>
          </div>
          <Ring value={ring} size={small ? 40 : 48} stroke={small ? 5 : 6} color={budget?.state === "over" ? "var(--danger)" : color}>
            <span className={cn("tabular font-extrabold", small ? "text-[10.5px]" : "text-[11.5px]")}>{Math.round(ring * 100)}%</span>
          </Ring>
          <button
            type="button"
            onClick={() => s.setEditor({ mode: "edit", collection: c })}
            className="relative z-[2] -me-1.5 -mt-1 grid size-9 place-items-center rounded-full text-muted opacity-0 transition hover:bg-surface-2 hover:text-ink group-hover:opacity-100 max-lg:hidden"
            aria-label={t.collection.rename}
            title={t.collection.rename}
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
        <div className="mt-auto">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <i className="grow-x block h-full rounded-full" style={{ width: `${st.items.length ? (st.bought / st.items.length) * 100 : 0}%`, background: color, animationDelay: `${200 + index * 55}ms` }} />
          </div>
          {/* One line, always (Round 10 C2): the flags are compact (icon + count, full text as the label), so every
              card in a section has the same height without stretching the short ones. */}
          <div className="mt-2 flex h-[22px] items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted">
            <span className="tabular truncate">{f(t.projects.bought, { done: st.bought, total: st.items.length })}</span>
            {budget && (
              <span className={cn("tabular shrink-0 font-semibold", budget.state === "over" ? "text-danger" : "text-ink")}>
                · {budget.state === "over" ? f(t.projects.overAmount, { amount: m(budget.used - budget.budget!) }) : f(t.projects.leftAmount, { amount: m(budget.budget! - budget.used) })}
              </span>
            )}
            <span className="flex-1" />
            {st.urgent > 0 && (
              <span className="tabular inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-2 py-0.5 font-semibold text-danger" title={f(t.projects.urgentN, { n: st.urgent })} aria-label={f(t.projects.urgentN, { n: st.urgent })} data-project-urgent>
                <Flag className="size-3" /> {st.urgent}
              </span>
            )}
            {st.onTheWay > 0 && (
              <span className="tabular inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--info)_14%,transparent)] px-2 py-0.5 font-semibold text-info" title={f(t.projects.onTheWayN, { n: st.onTheWay })} aria-label={f(t.projects.onTheWayN, { n: st.onTheWay })}>
                <Truck className="size-3" /> {st.onTheWay}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The project page's header (Round 9 E1), matching its card: the cover (the card's cover morphs into it), name,
 * ring, numbers, and the actions — Plan with Nexus (Plan mode), Shop this project, Share, Edit.
 */
export function ProjectHeader({ c }: { c: Collection }) {
  const s = useStore();
  const ro = useReadOnly();
  const { t, f, locale } = useI18n();
  const st = useProjectStats(c);
  const color = projectColor(c);
  const m = (v: number) => formatMoney(Math.round(v), s.currency, locale);
  const budget = st.b?.budget != null ? st.b : null;
  const ring = budget ? Math.min(1, (budget.pct ?? 0) / 100) : st.items.length ? st.bought / st.items.length : 0;

  return (
    <header className="mb-4 overflow-hidden rounded-[26px] border border-line bg-surface shadow-card" data-project-header={c.id}>
      <ProjectCover c={c} pics={st.pics} size="header" className="h-[120px] sm:h-[160px]" />
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="bidi text-[26px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[30px]">{c.name}</h1>
            {c.description && <p className="mt-1 max-w-[70ch] text-sm text-muted bidi">{c.description}</p>}
            <p className="tabular mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13.5px] text-muted">
              <span>{st.toBuy.length ? (st.toBuy.length === 1 ? t.projects.leftOne : f(t.projects.left, { n: st.toBuy.length })) : t.projects.done}</span>
              {st.left > 0 && <b className="font-semibold text-ink">{f(t.projects.toBuy, { amount: m(st.left) })}</b>}
              {st.b && st.b.spent > 0 && <span>{f(t.projects.spent, { amount: m(st.b.spent) })}</span>}
              {budget && (
                <span className={cn("font-semibold", budget.state === "over" ? "text-danger" : "text-ok")}>
                  {budget.state === "over" ? f(t.projects.overAmount, { amount: m(budget.used - budget.budget!) }) : f(t.projects.leftAmount, { amount: m(budget.budget! - budget.used) })}
                </span>
              )}
              {st.urgent > 0 && <span className="font-semibold text-danger">{f(t.projects.urgentN, { n: st.urgent })}</span>}
              {st.onTheWay > 0 && <span className="font-semibold text-info">{f(t.projects.onTheWayN, { n: st.onTheWay })}</span>}
            </p>
          </div>
          <Ring value={ring} size={64} stroke={8} color={budget?.state === "over" ? "var(--danger)" : color}>
            <span className="tabular text-[13px] font-extrabold">{Math.round(ring * 100)}%</span>
          </Ring>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.kind === "project" && s.aiEnabled && (
            <Button className="h-10 border-transparent bg-[image:var(--act-plan)] px-4 text-[var(--act-plan-ink)] hover:opacity-90" variant="outline" disabled={ro.ro} onClick={() => s.setPanel("planner")} data-plan-project>
              <Sparkles /> {t.projects.plan}
            </Button>
          )}
          <Button variant="primary" className="h-10 px-4" onClick={() => s.setShop({ kind: "collection", id: c.id })} data-shop-open>
            <ShoppingCart /> {t.projects.shop}
          </Button>
          <Button variant="outline" className="h-10 px-4" onClick={() => s.setPanel("share")}>
            <Share2 /> <span className="max-sm:sr-only">{t.share.shareBtn}</span>
          </Button>
          {/* The project/list menu (Round 9 F1): Excel export + edit. */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="outline" className="h-10 w-10 px-0" aria-label={t.projects.more} title={t.projects.more} data-project-menu>
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => download(exportUrl({ collection: c.id }, s.currency, locale))} data-project-export>
                <FileSpreadsheet className="size-4" /> {t.me.exportProject}
              </MenuItem>
              <MenuItem onSelect={() => s.setEditor({ mode: "edit", collection: c })}>
                <Pencil className="size-4" /> {t.collection.rename}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
    </header>
  );
}
