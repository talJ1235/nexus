"use client";

import "./sm.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, Check, CircleX, LayoutTemplate, MoreHorizontal, Plus, Receipt, Sparkles, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { useBackClose } from "@/components/ui/sheet-drag";
import { answerRoutine, applySupermarketTemplate, deleteSupermarketTemplate, editSupermarketTemplate, readdToSupermarket, saveListAsTemplate, saveTripAsTemplate, supermarketPastTrips, supermarketTemplatePlan, supermarketTemplates } from "@/app/supermarket-actions";
import { formatMoney } from "@/lib/money";
import type { TemplateItem } from "@/db/schema";
import type { ApplyLine } from "@/lib/grocery/routines";
import { sectionName } from "@/lib/grocery/sections";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile, sectionColor } from "./art";
import { patchSmHome, refreshSmHome, type SmHome } from "./data";
import { asItem, storeLabel } from "./numbers";
import { qtyLabel } from "./qty";

// R18 S2 E1 — templates (board Lists-phone): people's templates and the ones Nexus made from repeating trips ("Made by
// Nexus", kept up to date until someone edits one), the routine Nexus spotted (Keep it / No thanks), a template's page
// and the apply sheet (merge: new / already on it — stays / skipped). E2: editing (the template becomes the user's), past
// trips by month (open → add the picked ones again / save as a template), save the current list.

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
function TemplateList({ list, routine, ro, onOpen, onRoutine, onSaveList }: { list: Template[] | null; routine: SmHome["routine"]; ro: boolean; onOpen: (id: string) => void; onRoutine: () => void; onSaveList: () => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const L = t.sm.lists;
  return (
    <div className="flex flex-col gap-3" data-sm-templates>
      {routine && <RoutineOffer routine={routine} onDone={onRoutine} />}
      {list && !list.length && !routine && (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" data-sm-templates-none>
          <span className="mb-2 grid size-16 place-items-center rounded-[18px] bg-surface-2 text-muted">
            <LayoutTemplate className="size-7" />
          </span>
          <b className="text-[19px] font-extrabold">{L.none}</b>
          <span className="max-w-[300px] text-[14px] text-muted">{L.noneSub}</span>
          {!ro && s.sm.length > 0 && (
            <button type="button" className={cn("mt-2 h-12 rounded-[14px] bg-ink px-5 text-[15px] font-extrabold text-bg", press)} onClick={onSaveList} data-sm-save-list>
              {L.saveCurrent}
            </button>
          )}
        </div>
      )}
      {list?.map((x) => (
        <TemplateCard key={x.id} tpl={x} onOpen={() => onOpen(x.id)} />
      ))}
      {!ro && !!list?.length && s.sm.length > 0 && (
        <button type="button" className={cn("flex min-h-[68px] w-full items-center gap-3 rounded-[18px] border border-dashed border-line-strong px-3.5 text-start", press)} onClick={onSaveList} data-sm-save-list>
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface-2">
            <Plus className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] font-extrabold">{L.saveCurrentRow}</b>
            <span className="block text-[13px] text-muted">{f(L.saveCurrentSub, { n: s.sm.length })}</span>
          </span>
        </button>
      )}
    </div>
  );
}

/** One template: its items, Edit (E2), Add to my list → the apply sheet. */
function TemplatePage({ tpl, ro, onBack, onApplied, onEdit }: { tpl: Template; ro: boolean; onBack: () => void; onApplied: () => void; onEdit: () => void }) {
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
          <button type="button" className={cn("h-12 rounded-[14px] border border-line-strong bg-surface px-4 text-[15px] font-bold", press)} onClick={onEdit} data-sm-template-edit>
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

/** Templates + past trips: a full screen on phones, a dialog on computers; opened from the ⋯ menu. */
export type ListsStart = "templates" | "past" | "save";
export function Lists({ open, onClose, routine, start = "templates" }: { open: boolean; onClose: () => void; routine: SmHome["routine"]; start?: ListsStart }) {
  const { t } = useI18n();
  useBackClose(open, onClose);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 overlay-in phone:hidden" />
        <D.Content className="fixed inset-0 z-50 flex flex-col bg-bg outline-none phone:pt-[env(safe-area-inset-top)] desk:inset-x-0 desk:top-[6vh] desk:mx-auto desk:h-[86vh] desk:max-w-[560px] desk:overflow-hidden desk:rounded-2xl desk:border desk:border-line desk:shadow-pop desk:animate-pop-in" data-sm-lists>
          <D.Title className="sr-only">{t.sm.lists.templates}</D.Title>
          <D.Description className="sr-only">{t.sm.lists.open}</D.Description>
          {open && <ListsBody onClose={onClose} routine={routine} start={start} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ListsBody({ onClose, routine, start }: { onClose: () => void; routine: SmHome["routine"]; start: ListsStart }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const L = t.sm.lists;
  const ro = s.space?.role === "viewer" || s.offlineAt != null;
  const [tab, setTab] = useState<"templates" | "past">(start === "past" ? "past" : "templates");
  const [list, setList] = useState<Template[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ kind: "list" } | { kind: "trip"; trip: PastTrip } | null>(start === "save" ? { kind: "list" } : null);
  const [trips, setTrips] = useState<PastTrip[] | null>(null);
  const load = useCallback(() => {
    void supermarketTemplates().then(setList, () => setList([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (tab === "past" && trips == null) void supermarketPastTrips().then(setTrips, () => setTrips([]));
  }, [tab, trips]);
  const tpl = openId ? list?.find((x) => x.id === openId) ?? null : null;
  const trip = tripId ? trips?.find((x) => x.id === tripId) ?? null : null;
  const saveSheet = (
    <SaveSheet
      what={saving}
      onClose={() => setSaving(null)}
      onSaved={(id) => {
        setSaving(null);
        setTripId(null);
        setTab("templates");
        load();
        setOpenId(id);
      }}
    />
  );
  if (tpl && editing)
    return (
      <EditPage
        tpl={tpl}
        onBack={() => setEditing(false)}
        onSaved={(x) => {
          setList((l) => l?.map((y) => (y.id === x.id ? x : y)) ?? l);
          setEditing(false);
        }}
        onDeleted={() => {
          setEditing(false);
          setOpenId(null);
          load();
        }}
      />
    );
  if (tpl) return <TemplatePage tpl={tpl} ro={ro} onBack={() => setOpenId(null)} onApplied={load} onEdit={() => setEditing(true)} />;
  if (trip)
    return (
      <>
        <TripPage trip={trip} ro={ro} onBack={() => setTripId(null)} onSave={() => setSaving({ kind: "trip", trip })} />
        {saveSheet}
      </>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Head onBack={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
        <h1 className="pb-3 text-[28px] font-extrabold tracking-[-0.02em]">{tab === "past" ? L.past : L.templates}</h1>
        <div className="mb-3 grid grid-cols-2 rounded-[12px] bg-surface-2 p-1" role="tablist" aria-label={L.segLabel} data-sm-lists-seg>
          {(["templates", "past"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={cn("h-9 rounded-[9px] text-[14px] font-bold transition-colors duration-150", tab === k ? "bg-surface text-ink shadow-card" : "text-muted")} onClick={() => setTab(k)} data-sm-lists-tab={k}>
              {k === "past" ? L.past : L.templates}
            </button>
          ))}
        </div>
        {tab === "templates" ? (
          <TemplateList
            list={list}
            routine={ro ? null : routine}
            ro={ro}
            onOpen={setOpenId}
            onSaveList={() => setSaving({ kind: "list" })}
            onRoutine={() => {
              load();
              void refreshSmHome(s.spaceId || "-", locale);
            }}
          />
        ) : (
          <PastTrips trips={trips} onOpen={setTripId} />
        )}
      </div>
      {saveSheet}
    </div>
  );
}

// ---------- E2: edit a template ----------

/** Rename, remove / add items. Saving makes it the user's: a Nexus template stops following trips. */
function EditPage({ tpl, onBack, onSaved, onDeleted }: { tpl: Template; onBack: () => void; onSaved: (t: Template) => void; onDeleted: () => void }) {
  const { t, f, locale } = useI18n();
  const L = t.sm.lists;
  const tx = useTemplateText();
  const [name, setName] = useState(tpl.name || tx.name(tpl));
  const [items, setItems] = useState<TemplateItem[]>(tpl.items);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const add = () => {
    const title = adding.trim();
    if (!title) return;
    // A new line gets its product key on the server (classified there); a temporary key keeps it apart here.
    setItems((xs) => [...xs, { productKey: `new:${title}`, title, qty: 1 }]);
    setAdding("");
  };
  const save = async () => {
    setBusy(true);
    try {
      const out = await editSupermarketTemplate(tpl.id, { name: name.trim() || tx.name(tpl), items: items.map((i) => ({ ...i, productKey: i.productKey.startsWith("new:") ? undefined : i.productKey, amount: i.amount ?? null, unit: i.unit ?? null, section: i.section ?? null, art: i.art ?? null })) });
      toast.success(L.saved);
      onSaved(out as Template);
    } catch {
      toast.error(L.failed);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteSupermarketTemplate(tpl.id);
      toast.success(L.deleted);
      onDeleted();
    } catch {
      toast.error(L.failed);
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-sm-template-editor={tpl.id}>
      <Head onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        <h1 className="bidi text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{tx.name(tpl)}</h1>
        <p className="mt-0.5 text-[14px] text-muted">{tx.sub(tpl)}</p>
        <label className="mt-5 block px-1 pb-1.5 text-[13px] font-bold text-muted" htmlFor="sm-tpl-name">
          {L.name}
        </label>
        <input id="sm-tpl-name" className="h-13 min-h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-[16px] outline-none focus:border-ink" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-sm-tpl-name />
        <form
          className="mt-3 flex h-13 min-h-12 items-center gap-2 rounded-[14px] border border-line-strong bg-surface ps-3.5 pe-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Plus className="size-[18px] shrink-0 text-muted" />
          <input className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none" placeholder={L.addItem} aria-label={L.addItem} value={adding} maxLength={300} onChange={(e) => setAdding(e.target.value)} data-sm-tpl-add />
        </form>
        <div className="mt-5 flex items-baseline justify-between px-1 pb-2 text-[13px]">
          <b className="font-bold text-muted">{L.inThis}</b>
          <span className="tabular text-muted">{items.length === 1 ? L.itemsOne : f(L.items, { n: items.length })}</span>
        </div>
        <div className="gro-box">
          {items.map((i) => (
            <div key={i.productKey} className="gro-row" data-sm-tpl-row={i.productKey}>
              <ProductTile art={i.art} section={i.section} />
              <span className="min-w-0 flex-1">
                <span className="gro-t bidi">{i.title}</span>
                {i.section && <span className="gro-s truncate">{sectionName(i.section, locale)}</span>}
              </span>
              <span className="gro-q">{qtyLabel({ quantity: i.qty, amount: i.amount, unit: i.unit }, locale)}</span>
              <button type="button" className="grid size-10 shrink-0 place-items-center rounded-full text-muted active:scale-90" aria-label={f(L.remove, { title: i.title })} onClick={() => setItems((xs) => xs.filter((x) => x.productKey !== i.productKey))} data-sm-tpl-remove>
                <X className="size-[18px]" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" disabled={busy} className="mt-5 flex h-11 items-center gap-2 px-1 text-[14.5px] font-bold text-danger" onClick={() => void remove()} data-sm-tpl-delete>
          <Trash2 className="size-4" />
          {L.delete}
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <button type="button" disabled={busy || !items.length} className={cn("h-12 w-full rounded-[14px] bg-ink text-[15.5px] font-extrabold text-bg disabled:opacity-50", press)} onClick={() => void save()} data-sm-tpl-save>
          {tx.nexus(tpl) ? L.saveMine : L.save}
        </button>
      </div>
    </div>
  );
}

// ---------- E2: past trips ----------

type PastTrip = Awaited<ReturnType<typeof supermarketPastTrips>>[number];

const tripTotal = (x: PastTrip) => x.total ?? x.items.reduce((a, i) => a + (i.price ?? 0), 0);

/** Trips by month (newest first): the month's total and count, each trip's date, store, size, who, minutes, total. */
function PastTrips({ trips, onOpen }: { trips: PastTrip[] | null; onOpen: (id: string) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const L = t.sm.lists;
  const loc = locale === "he" ? "he-IL" : "en-US";
  const months = useMemo(() => {
    const m = new Map<string, PastTrip[]>();
    for (const x of trips ?? []) {
      const k = new Date(x.startedAt).toISOString().slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return [...m];
  }, [trips]);
  if (trips && !trips.length)
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" data-sm-past-none>
        <b className="text-[17px] font-extrabold">{L.noTrips}</b>
        <span className="text-[14px] text-muted">{L.noTripsSub}</span>
      </div>
    );
  return (
    <div className="flex flex-col gap-4" data-sm-past>
      {months.map(([k, xs]) => {
        const sum = xs.reduce((a, x) => a + tripTotal(x), 0);
        const money = formatMoney(Math.round(sum), xs[0]?.currency ?? s.currency, locale);
        return (
          <section key={k} data-sm-month={k}>
            <div className="flex items-baseline justify-between px-1 pb-2 text-[13px]">
              <b className="font-bold text-muted">{new Intl.DateTimeFormat(loc, { month: "long", year: new Date().getFullYear() === Number(k.slice(0, 4)) ? undefined : "numeric" }).format(Date.parse(`${k}-15`))}</b>
              <span className="tabular text-muted">{xs.length === 1 ? f(L.monthSumOne, { total: money }) : f(L.monthSum, { total: money, n: xs.length })}</span>
            </div>
            <div className="gro-box">
              {xs.map((x) => {
                const d = new Date(x.startedAt);
                const min = Math.round((x.finishedAt - x.startedAt) / 60_000);
                const n = x.items.filter((i) => i.state === "bought").length;
                return (
                  <button key={x.id} type="button" className="gro-row text-start" onClick={() => onOpen(x.id)} data-sm-trip={x.id}>
                    <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-surface-2 leading-none">
                      <b className="tabular text-[16px] font-extrabold">{d.getDate()}</b>
                      <small className="text-[10.5px] text-muted">{new Intl.DateTimeFormat(loc, { month: "short" }).format(d)}</small>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="gro-t bidi">{storeLabel(x.chain ?? "", x.branch ?? "", locale) ?? x.chain ?? ""}</span>
                      <span className="gro-s truncate">{min > 0 && min < 600 ? f(L.tripMeta, { n, who: x.who, min }) : f(L.tripMetaNoMin, { n, who: x.who })}</span>
                    </span>
                    {x.receipt && <Receipt className="size-4 shrink-0 text-muted" aria-label={L.receipt} />}
                    <span className="gro-q">{formatMoney(Math.round(tripTotal(x)), x.currency, locale)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A past trip: total / items / not found, the receipt, the products picked to add again (not found and listed ones off). */
function TripPage({ trip, ro, onBack, onSave }: { trip: PastTrip; ro: boolean; onBack: () => void; onSave: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const L = t.sm.lists;
  const loc = locale === "he" ? "he-IL" : "en-US";
  const [picked, setPicked] = useState<Set<string>>(() => {
    const onList = new Set(s.sm.map((i) => i.productKey));
    return new Set(trip.items.filter((i) => i.state === "bought" && !onList.has(i.productKey)).map((i) => i.productKey));
  });
  const [busy, setBusy] = useState(false);
  const bought = trip.items.filter((i) => i.state === "bought").length;
  const missed = trip.items.length - bought;
  const toggle = (k: string) => setPicked((p) => (p.has(k) ? new Set([...p].filter((x) => x !== k)) : new Set([...p, k])));
  const readd = async () => {
    setBusy(true);
    try {
      const rows = await readdToSupermarket(trip.items.filter((i) => picked.has(i.productKey)).map((i) => ({ productKey: i.productKey, title: i.title, qty: i.qty, amount: i.amount, unit: i.unit, section: i.section, art: i.art })));
      s.upsertSm(rows.map(asItem));
      toast.success(f(L.added, { n: rows.length }));
      setPicked(new Set());
    } catch {
      toast.error(L.failed);
    } finally {
      setBusy(false);
    }
  };
  const when = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(trip.startedAt);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-sm-trip-page={trip.id}>
      <Head onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        <h1 className="bidi text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{storeLabel(trip.chain ?? "", trip.branch ?? "", locale) ?? trip.chain}</h1>
        <p className="mt-0.5 text-[14px] text-muted">{[when, trip.who].filter(Boolean).join(" · ")}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            [formatMoney(Math.round(tripTotal(trip)), trip.currency, locale), L.total],
            [String(bought), L.itemsWord],
            [String(missed), L.notFound],
          ].map(([v, label]) => (
            <div key={label} className="rounded-[14px] border border-line-strong bg-surface px-3 py-2.5">
              <b className="tabular block text-[20px] font-extrabold">{v}</b>
              <span className="block truncate text-[12.5px] text-muted">{label}</span>
            </div>
          ))}
        </div>
        {trip.receipt && (
          <span className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-semibold text-muted">
            <Receipt className="size-4" />
            {L.receipt}
          </span>
        )}
        <div className="mt-5 flex items-baseline justify-between px-1 pb-2 text-[13px]">
          <b className="font-bold text-muted">{L.addAgain}</b>
          <span className="tabular text-muted">{picked.size}</span>
        </div>
        <div className="gro-box">
          {trip.items.map((i) => {
            const on = picked.has(i.productKey);
            return (
              <button key={i.productKey} type="button" role="checkbox" aria-checked={on} aria-label={f(L.select, { title: i.title })} disabled={ro} className="gro-row text-start" onClick={() => toggle(i.productKey)} data-sm-trip-item={i.state}>
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-[7px] border-[1.5px]", on ? "border-ink bg-ink text-bg" : "border-line-strong")}>{on && <Check className="size-4" strokeWidth={3} />}</span>
                <ProductTile art={i.art} section={i.section} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="gro-t bidi">
                    {i.title} {i.qty > 1 && !i.amount ? `×${i.qty}` : ""}
                  </span>
                  <span className="gro-s truncate">{i.state === "not_found" ? L.notFound : i.amount && i.unit ? qtyLabel({ quantity: i.qty, amount: i.amount, unit: i.unit }, locale) : ""}</span>
                </span>
                <span className="gro-q">{i.state === "not_found" ? <CircleX className="size-4 text-muted" /> : i.price != null ? formatMoney(i.price, trip.currency, locale) : "–"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {!ro && (
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-line bg-bg/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <button type="button" className={cn("h-12 rounded-[14px] border border-line-strong bg-surface px-4 text-[15px] font-bold", press)} onClick={onSave} data-sm-trip-save>
            {L.saveAs}
          </button>
          <button type="button" disabled={busy || !picked.size} className={cn("h-12 flex-1 rounded-[14px] bg-ink text-[15.5px] font-extrabold text-bg disabled:opacity-50", press)} onClick={() => void readd()} data-sm-trip-readd>
            {f(L.addAgainN, { n: picked.size })}
          </button>
        </div>
      )}
    </div>
  );
}

function Switch({ on, onChange, label, disabled, ...rest }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean } & Record<`data-${string}`, string>) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-60", on ? "bg-ink" : "bg-line-strong")} onClick={() => onChange(!on)} {...rest}>
      <span className={cn("absolute top-0.5 size-6 rounded-full bg-surface shadow-card transition-[inset-inline-start] duration-150 ease-[var(--ease-out)]", on ? "start-[22px]" : "start-0.5")} />
    </button>
  );
}

/** Save the list / a trip as a template: a name, (a trip:) what was bought, also what wasn't found, keep the quantities. */
function SaveSheet({ what, onClose, onSaved }: { what: { kind: "list" } | { kind: "trip"; trip: PastTrip } | null; onClose: () => void; onSaved: (id: string) => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const L = t.sm.lists;
  const [name, setName] = useState("");
  const [missed, setMissed] = useState(false);
  const [keepQty, setKeepQty] = useState(true);
  const [busy, setBusy] = useState(false);
  const trip = what?.kind === "trip" ? what.trip : null;
  const bought = trip ? trip.items.filter((i) => i.state === "bought").length : s.sm.length;
  const miss = trip ? trip.items.length - bought : 0;
  const save = async () => {
    const n = name.trim() || L.namePh;
    setBusy(true);
    try {
      const out = trip ? await saveTripAsTemplate(trip.id, n, { missed, keepQty }) : await saveListAsTemplate(n);
      toast.success(L.tplSaved);
      setName("");
      if (out) onSaved(out.id);
    } catch {
      toast.error(L.failed);
    } finally {
      setBusy(false);
    }
  };
  const row = "flex min-h-[58px] items-center gap-3 px-3.5 py-2";
  const ic = "grid size-8 shrink-0 place-items-center rounded-full bg-surface-2";
  return (
    <Sheet open={what != null} onOpenChange={(o) => !o && onClose()} title={L.saveAsTitle} className="desk:max-w-[460px]">
      <div className="flex flex-col gap-3 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-1" data-sm-save-sheet>
        <h2 className="text-[20px] font-extrabold">{L.saveAsTitle}</h2>
        <label className="px-1 text-[13px] font-bold text-muted" htmlFor="sm-save-name">
          {L.name}
        </label>
        <input id="sm-save-name" className="h-13 min-h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-surface px-3.5 text-[16px] outline-none" placeholder={L.namePh} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-sm-save-name />
        {trip && (
          <div className="divide-y divide-line rounded-[16px] border border-line-strong bg-surface">
            <div className={row}>
              <span className={ic}>
                <Check className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-bold">{L.whatBought}</b>
                <span className="block text-[13px] text-muted">{f(L.items, { n: bought })}</span>
              </span>
              <Switch on disabled label={L.whatBought} onChange={() => {}} data-sm-save-bought="" />
            </div>
            <div className={row}>
              <span className={ic}>
                <CircleX className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-bold">{L.alsoMissed}</b>
                <span className="block text-[13px] text-muted">{f(L.items, { n: miss })}</span>
              </span>
              <Switch on={missed} disabled={!miss} label={L.alsoMissed} onChange={setMissed} data-sm-save-missed="" />
            </div>
            <div className={row}>
              <span className={ic}>
                <Plus className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-bold">{L.keepQty}</b>
                <span className="block text-[13px] text-muted">{L.keepQtySub}</span>
              </span>
              <Switch on={keepQty} label={L.keepQty} onChange={setKeepQty} data-sm-save-qty="" />
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" className={cn("h-12 rounded-[14px] border border-line-strong bg-surface px-4 text-[15px] font-bold", press)} onClick={onClose}>
            {L.cancel}
          </button>
          <button type="button" disabled={busy || !bought} className={cn("h-12 flex-1 rounded-[14px] bg-ink text-[15.5px] font-extrabold text-bg disabled:opacity-50", press)} onClick={() => void save()} data-sm-save-go>
            {L.saveTpl}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
