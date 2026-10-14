"use client";

import "./sm.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, MoreHorizontal, Sparkles } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { useBackClose } from "@/components/ui/sheet-drag";
import { answerRoutine, applySupermarketTemplate, supermarketTemplatePlan, supermarketTemplates } from "@/app/supermarket-actions";
import type { TemplateItem } from "@/db/schema";
import type { ApplyLine } from "@/lib/grocery/routines";
import { sectionName } from "@/lib/grocery/sections";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile, sectionColor } from "./art";
import { patchSmHome, refreshSmHome, type SmHome } from "./data";
import { asItem } from "./numbers";
import { qtyLabel } from "./qty";

// R18 S2 E1 — templates (board Lists-phone): people's templates and the ones Nexus made from repeating trips ("Made by
// Nexus", kept up to date until someone edits one), the routine Nexus spotted (Keep it / No thanks), a template's page
// and the apply sheet (merge: new / already on it — stays / skipped). E2 adds editing and past trips.

export type Template = Awaited<ReturnType<typeof supermarketTemplates>>[number];

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
/** "Thursday" / "חמישי" — and the English plural for "your last 6 Thursdays". */
export function dayName(d: number, locale: string, plural = false) {
  if (locale === "he") return HE_DAYS[d] ?? "";
  const n = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2026, 9, 4 + d));
  return plural ? `${n}s` : n;
}

/** A Nexus template nobody named reads "Thursday shop"; anyone else's keeps its name. */
export function useTemplateText() {
  const { t, f, locale } = useI18n();
  const L = t.sm.lists;
  const nexus = (x: Template) => x.madeBy === "nexus" && x.editedAt == null;
  return {
    nexus,
    name: (x: Template) => x.name || (x.routineDay != null ? f(L.nexusName, { day: dayName(x.routineDay, locale) }) : L.templates),
    sub: (x: Template) => {
      if (nexus(x) && x.routineDay != null) return f(L.nexusFrom, { n: x.routineTrips ?? 0, days: dayName(x.routineDay, locale, true) });
      if (x.usedAt) return f(L.yoursUsed, { month: new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { month: "long" }).format(x.usedAt) });
      return L.yoursNever;
    },
  };
}

/** One bar per section in the template, as wide as its count (the list's aisle rail). */
function Bar({ items }: { items: TemplateItem[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.section ?? "other", (m.get(i.section ?? "other") ?? 0) + 1);
    return [...m];
  }, [items]);
  return (
    <div className="gro-rail" aria-hidden>
      {counts.map(([k, n]) => (
        <i key={k} style={{ "--k": sectionColor(k), "--n": n } as React.CSSProperties} />
      ))}
    </div>
  );
}

const card = "rounded-[18px] border border-line-strong bg-surface shadow-card";
const press = "transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]";

/** "Nexus spotted a new routine" — on the Supermarket tab and at the top of Templates. */
export function RoutineOffer({ routine, onDone }: { routine: NonNullable<SmHome["routine"]>; onDone?: (kept: boolean) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const L = t.sm.lists;
  const [busy, setBusy] = useState(false);
  const answer = async (keep: boolean) => {
    setBusy(true);
    patchSmHome(s.spaceId || "-", (h) => ({ ...h, routine: null }));
    try {
      await answerRoutine(routine.id, keep);
      toast.success(keep ? L.kept : L.dismissed);
      onDone?.(keep);
    } catch {
      toast.error(L.failed);
      void refreshSmHome(s.spaceId || "-", locale);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-[18px] border border-[color-mix(in_srgb,var(--spark)_34%,var(--line-strong))] bg-[color-mix(in_srgb,var(--spark)_7%,var(--surface))] p-3.5" data-sm-routine={routine.id}>
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-spark text-white">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15.5px] font-extrabold">{L.spotted}</b>
          <span className="block text-[13px] leading-snug text-muted">{f(L.spottedSub, { days: dayName(routine.day, locale, true), n: routine.items })}</span>
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className={cn("h-11 rounded-[12px] bg-ink text-[15px] font-bold text-bg", press)} onClick={() => void answer(true)} data-sm-routine-keep>
          {L.keep}
        </button>
        <button type="button" disabled={busy} className={cn("h-11 rounded-[12px] border border-line-strong bg-surface text-[15px] font-bold", press)} onClick={() => void answer(false)} data-sm-routine-no>
          {L.noThanks}
        </button>
      </div>
    </section>
  );
}

function MadeBy() {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] bg-[color-mix(in_srgb,var(--spark)_14%,var(--surface))] px-1.5 text-[12px] font-bold text-[color-mix(in_srgb,var(--spark)_70%,var(--ink))]" data-sm-madeby>
      <Sparkles className="size-3" />
      {t.sm.lists.madeBy}
    </span>
  );
}

function TemplateCard({ tpl, onOpen }: { tpl: Template; onOpen: () => void }) {
  const tx = useTemplateText();
  const { t, f } = useI18n();
  const shown = tpl.items.slice(0, 5);
  const more = tpl.items.length - shown.length;
  return (
    <button type="button" className={cn(card, press, "flex w-full flex-col gap-2.5 p-3.5 text-start")} onClick={onOpen} data-sm-template={tpl.id}>
      <span className="flex w-full items-start gap-3">
        <span className="min-w-0 flex-1">
          <b className="bidi block truncate text-[16.5px] font-extrabold">{tx.name(tpl)}</b>
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-muted">
            {tx.nexus(tpl) && <MadeBy />}
            <span className="truncate">{tx.sub(tpl)}</span>
          </span>
        </span>
        <span className="tabular grid h-9 min-w-10 place-items-center rounded-[10px] bg-surface-2 px-2 text-[15px] font-extrabold" aria-label={tpl.items.length === 1 ? t.sm.lists.itemsOne : f(t.sm.lists.items, { n: tpl.items.length })}>
          {tpl.items.length}
        </span>
      </span>
      <Bar items={tpl.items} />
      <span className="flex items-center gap-1.5" aria-hidden>
        {shown.map((i) => (
          <ProductTile key={i.productKey} art={i.art} section={i.section} size={36} />
        ))}
        {more > 0 && <span className="tabular grid size-9 place-items-center rounded-[10px] bg-surface-2 text-[13px] font-bold text-muted">{f(t.sm.lists.more, { n: more })}</span>}
      </span>
    </button>
  );
}

/** The templates (+ the routine offer). `onOpen` opens one. */
function TemplateList({ list, routine, onOpen, onRoutine }: { list: Template[] | null; routine: SmHome["routine"]; onOpen: (id: string) => void; onRoutine: () => void }) {
  const { t } = useI18n();
  const L = t.sm.lists;
  return (
    <div className="flex flex-col gap-3" data-sm-templates>
      {routine && <RoutineOffer routine={routine} onDone={onRoutine} />}
      {list && !list.length && !routine && (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" data-sm-templates-none>
          <b className="text-[17px] font-extrabold">{L.none}</b>
          <span className="text-[14px] text-muted">{L.noneSub}</span>
        </div>
      )}
      {list?.map((x) => (
        <TemplateCard key={x.id} tpl={x} onOpen={() => onOpen(x.id)} />
      ))}
    </div>
  );
}

/** One template: its items, Edit (E2), Add to my list → the apply sheet. */
function TemplatePage({ tpl, ro, onBack, onApplied }: { tpl: Template; ro: boolean; onBack: () => void; onApplied: () => void }) {
  const { t, f, locale } = useI18n();
  const L = t.sm.lists;
  const tx = useTemplateText();
  const [applying, setApplying] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-sm-template-page={tpl.id}>
      <Head onBack={onBack} more />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        <h1 className="bidi text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{tx.name(tpl)}</h1>
        <p className="mt-0.5 text-[14px] text-muted">{tx.sub(tpl)}</p>
        {tx.nexus(tpl) && (
          <div className="mt-3 flex gap-2.5 rounded-[14px] bg-[color-mix(in_srgb,var(--spark)_9%,var(--surface))] p-3 text-[14px] leading-snug" data-sm-nexus-note>
            <Sparkles className="mt-0.5 size-4 shrink-0 text-spark" />
            <span>{L.nexusNote}</span>
          </div>
        )}
        <div className="mt-5 flex items-baseline justify-between px-1 pb-2 text-[13px]">
          <b className="font-bold text-muted">{L.inThis}</b>
          <span className="tabular text-muted">{tpl.items.length === 1 ? L.itemsOne : f(L.items, { n: tpl.items.length })}</span>
        </div>
        <div className="gro-box">
          {tpl.items.map((i) => (
            <div key={i.productKey} className="gro-row" data-sm-template-item={i.productKey}>
              <ProductTile art={i.art} section={i.section} />
              <span className="min-w-0 flex-1">
                <span className="gro-t bidi">{i.title}</span>
                <span className="gro-s truncate">{sectionName(i.section ?? "other", locale)}</span>
              </span>
              <span className="gro-q">{qtyLabel({ quantity: i.qty, amount: i.amount, unit: i.unit }, locale)}</span>
            </div>
          ))}
        </div>
      </div>
      {!ro && (
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-line bg-bg/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <button type="button" className={cn("h-12 rounded-[14px] border border-line-strong bg-surface px-4 text-[15px] font-bold", press)} data-sm-template-edit disabled>
            {L.edit}
          </button>
          <button type="button" className={cn("h-12 flex-1 rounded-[14px] bg-ink text-[15.5px] font-extrabold text-bg", press)} onClick={() => setApplying(true)} data-sm-template-apply>
            {L.addToList}
          </button>
        </div>
      )}
      <ApplySheet tpl={applying ? tpl : null} name={tx.name(tpl)} onClose={() => setApplying(false)} onApplied={onApplied} />
    </div>
  );
}

/** Add a template to the list: what's new, what's already there (keeps its quantity), what's skipped (hidden). */
function ApplySheet({ tpl, name, onClose, onApplied }: { tpl: Template | null; name: string; onClose: () => void; onApplied: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const L = t.sm.lists;
  // The plan of the template on screen (a stale one from another template is never shown).
  const [plan, setPlan] = useState<{ id: string; lines: ApplyLine[] } | null>(null);
  const lines = tpl && plan?.id === tpl.id ? plan.lines : null;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (tpl) void supermarketTemplatePlan(tpl.id).then((l) => setPlan({ id: tpl.id, lines: l }), () => toast.error(L.failed));
  }, [tpl, L.failed]);
  const n = { new: 0, on: 0, hidden: 0 };
  for (const l of lines ?? []) n[l.state]++;
  const byKey = new Map(tpl?.items.map((i) => [i.productKey, i]) ?? []);
  const order = { on: 0, hidden: 1, new: 2 } as const;
  const apply = async () => {
    if (!tpl) return;
    setBusy(true);
    try {
      const r = await applySupermarketTemplate(tpl.id);
      s.upsertSm(r.rows.map(asItem));
      toast.success(f(L.added, { n: r.added }));
      onClose();
      onApplied();
    } catch {
      toast.error(L.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={tpl != null} onOpenChange={(o) => !o && onClose()} title={f(L.applyTitle, { name })} className="desk:max-w-[460px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-1" data-sm-apply>
        <div>
          <h2 className="bidi text-[20px] font-extrabold leading-tight">{f(L.applyTitle, { name })}</h2>
          <p className="mt-1 text-[14px] text-muted">{L.applySub}</p>
        </div>
        <div className="grid grid-cols-3 gap-2" data-sm-apply-counts>
          {([["new", L.newN], ["on", L.onN], ["hidden", L.skippedN]] as const).map(([k, label]) => (
            <div key={k} className="rounded-[14px] border border-line-strong bg-surface px-3 py-2.5" data-sm-apply-count={k}>
              <b className="tabular block text-[20px] font-extrabold">{lines ? n[k] : "–"}</b>
              <span className="block truncate text-[12.5px] text-muted">{label}</span>
            </div>
          ))}
        </div>
        {lines && (
          <div className="gro-box">
            {[...lines].sort((a, b) => order[a.state] - order[b.state]).map((l) => {
              const i = byKey.get(l.productKey);
              return (
                <div key={l.productKey} className={cn("gro-row", l.state !== "new" && "opacity-60")} data-sm-apply-line={l.state}>
                  <ProductTile art={i?.art} section={i?.section} />
                  <span className="min-w-0 flex-1">
                    <span className="gro-t bidi">{l.title}</span>
                    <span className="gro-s truncate">{l.state === "new" ? L.lineNew : l.state === "on" ? f(L.lineOn, { q: `×${l.onQty ?? 1}` }) : L.lineHidden}</span>
                  </span>
                  <span className="gro-q">{l.state === "on" ? `×${l.onQty ?? 1}` : i ? qtyLabel({ quantity: i.qty, amount: i.amount, unit: i.unit }, locale) : `×${l.qty}`}</span>
                </div>
              );
            })}
          </div>
        )}
        <button type="button" disabled={!lines || busy || n.new === 0} className={cn("h-13 min-h-12 rounded-[14px] bg-ink text-[16px] font-extrabold text-bg disabled:opacity-50", press)} onClick={() => void apply()} data-sm-apply-go>
          {lines && n.new === 0 ? L.nothingNew : n.new === 1 ? L.addOne : f(L.addN, { n: n.new })}
        </button>
      </div>
    </Sheet>
  );
}

function Head({ onBack, more }: { onBack: () => void; more?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex h-14 shrink-0 items-center justify-between px-2">
      <button type="button" className="grid size-11 place-items-center rounded-full active:scale-95" onClick={onBack} aria-label={t.sm.lists.back} data-sm-lists-back>
        <ArrowLeft className="size-5 rtl:-scale-x-100" />
      </button>
      {more && (
        <span className="grid size-11 place-items-center text-muted" aria-hidden>
          <MoreHorizontal className="size-5" />
        </span>
      )}
    </div>
  );
}

/** Templates (+ past trips in E2): a full screen on phones, a dialog on computers; opened from the ⋯ menu. */
export function Lists({ open, onClose, routine }: { open: boolean; onClose: () => void; routine: SmHome["routine"] }) {
  const { t } = useI18n();
  useBackClose(open, onClose);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 overlay-in phone:hidden" />
        <D.Content className="fixed inset-0 z-50 flex flex-col bg-bg outline-none phone:pt-[env(safe-area-inset-top)] desk:inset-x-0 desk:top-[6vh] desk:mx-auto desk:h-[86vh] desk:max-w-[560px] desk:overflow-hidden desk:rounded-2xl desk:border desk:border-line desk:shadow-pop desk:animate-pop-in" data-sm-lists>
          <D.Title className="sr-only">{t.sm.lists.templates}</D.Title>
          <D.Description className="sr-only">{t.sm.lists.open}</D.Description>
          {open && <ListsBody onClose={onClose} routine={routine} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ListsBody({ onClose, routine }: { onClose: () => void; routine: SmHome["routine"] }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const L = t.sm.lists;
  const ro = s.space?.role === "viewer" || s.offlineAt != null;
  const [list, setList] = useState<Template[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    void supermarketTemplates().then(setList, () => setList([]));
  }, []);
  useEffect(load, [load]);
  const tpl = openId ? list?.find((x) => x.id === openId) ?? null : null;
  if (tpl) return <TemplatePage tpl={tpl} ro={ro} onBack={() => setOpenId(null)} onApplied={load} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Head onBack={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
        <h1 className="pb-3 text-[28px] font-extrabold tracking-[-0.02em]">{L.templates}</h1>
        <TemplateList
          list={list}
          routine={ro ? null : routine}
          onOpen={setOpenId}
          onRoutine={() => {
            load();
            void refreshSmHome(s.spaceId || "-", locale);
          }}
        />
      </div>
    </div>
  );
}
