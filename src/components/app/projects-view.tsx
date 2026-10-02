"use client";

import { FileSpreadsheet, Flag, FolderPlus, ListPlus, MoreHorizontal, Pencil, Plus, Share2, ShoppingCart, Sparkles, Truck } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Ring } from "@/components/ui/ring";
import { download, exportUrl } from "@/lib/export-url";
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
    <div className="flex flex-col gap-5" data-projects-view>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{t.projects.title}</h1>
        <NewMenu />
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3" data-projects-section>
        {projects.map((c, i) => (
          <ProjectCard key={c.id} c={c} index={i} />
        ))}
      </div>
      {lists.length > 0 && (
        <>
          <h2 className="mt-2 text-[18px] font-extrabold">{t.projects.lists}</h2>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3" data-lists-section>
            {lists.map((c, i) => (
              <ProjectCard key={c.id} c={c} index={projects.length + i} />
            ))}
          </div>
        </>
      )}
      <StartNewCard index={projects.length + lists.length} />
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

function ProjectCard({ c, index }: { c: Collection; index: number }) {
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
    >
      <button type="button" className="absolute inset-0 z-[1] rounded-[26px]" aria-label={c.name} onClick={() => openProject(c.id, s.setView)} />
      <ProjectCover c={c} pics={st.pics} className="h-[84px] sm:h-[104px]" />
      <div className="flex flex-1 flex-col gap-2.5 p-4 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="bidi truncate text-[18px] font-extrabold leading-tight tracking-[-0.01em]">{c.name}</h3>
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
          <Ring value={ring} size={48} stroke={6} color={budget?.state === "over" ? "var(--danger)" : color}>
            <span className="tabular text-[11.5px] font-extrabold">{Math.round(ring * 100)}%</span>
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
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="tabular">{f(t.projects.bought, { done: st.bought, total: st.items.length })}</span>
            {budget && (
              <span className={cn("tabular font-semibold", budget.state === "over" ? "text-danger" : "text-ink")}>
                · {budget.state === "over" ? f(t.projects.overAmount, { amount: m(budget.used - budget.budget!) }) : f(t.projects.leftAmount, { amount: m(budget.budget! - budget.used) })}
              </span>
            )}
            <span className="flex-1" />
            {st.urgent > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-2 py-0.5 font-semibold text-danger" data-project-urgent>
                <Flag className="size-3" /> {f(t.projects.urgentN, { n: st.urgent })}
              </span>
            )}
            {st.onTheWay > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--info)_14%,transparent)] px-2 py-0.5 font-semibold text-info">
                <Truck className="size-3" /> {f(t.projects.onTheWayN, { n: st.onTheWay })}
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
