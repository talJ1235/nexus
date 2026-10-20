"use client";

import { openChoose } from "./choose-product";
import "./sm.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, Camera, Check, ClipboardPaste, Mic, Plus, ScanBarcode, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useBackClose } from "@/components/ui/sheet-drag";
import { Spinner } from "@/components/ui/spinner";
import { SuggestionActions } from "./item-sheet";
import { acceptSuggestions, addParts, addToSupermarket, undoSupermarketAdd } from "@/app/supermarket-actions";
import { classifyLocal } from "@/lib/grocery/classify";
import { parseLine, splitList, type SplitPart } from "@/lib/grocery/parse";
import type { Hit } from "@/lib/grocery/search";
import { sectionName } from "@/lib/grocery/sections";
import { listen, voiceSupported, type VoiceSession } from "@/lib/grocery/voice";
import { recError, recorderSupported, startRecording, toWav, type Recording } from "@/lib/grocery/recorder";
import { unitKgFor } from "@/lib/grocery/weights";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile, SectionIcon } from "./art";
import { useSmHome, type SmHome } from "./data";
import { asItem } from "./numbers";
import { qtyLabel } from "./qty";
import { QtySteppers, type Measure } from "./qty-steppers";
import { announceAdded, useAddedLine, type Added } from "./added";

// R18 S2 B2 — the Add screen (board Add-phone): type-ahead (the household's products first, the typed letters bold),
// "Did you mean" for spelling mistakes with "Add as new" still offered, a quantity read from the line ("2 milk 3%",
// "קילו עגבניות, בערך 6") with the count + weight steppers, a duplicate merged into its row ("Milk is already on the list —
// now ×3", Undo), voice and pasted lists split into a checked preview. Full screen on a phone, a dialog on a computer.

export type AddMode = "type" | "voice" | "paste";

const never = () => () => {};
/** S4 C1: voice = a recorder (MediaRecorder + a mic) — a browser fact: false on the server and while hydrating, then the real answer. */
export const useVoiceSupported = () => useSyncExternalStore(never, recorderSupported, () => false);

// R18 S3 C2: `seed` = the lines a photo of a list read — the Paste review opens with them, and closes the screen when added.
export function AddScreen({ open, onClose, mode: startMode = "type", onCapture, hint = null, seed = null }: { open: boolean; onClose: () => void; mode?: AddMode; onCapture?: (k: "scan" | "photo") => void; hint?: "camera" | null; seed?: string | null }) {
  const { t } = useI18n();
  useBackClose(open, onClose);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 overlay-in phone:hidden" />
        <D.Content
          className="sm-rise fixed inset-0 z-50 flex flex-col bg-bg outline-none phone:pt-[env(safe-area-inset-top)] desk:inset-x-0 desk:top-[8vh] desk:mx-auto desk:h-[78vh] desk:max-w-[560px] desk:overflow-hidden desk:rounded-2xl desk:border desk:border-line desk:shadow-pop desk:animate-pop-in"
          onInteractOutside={(e) => {
            if ((e.target as Element | null)?.closest?.("[data-sonner-toaster]")) e.preventDefault();
          }}
          data-add-screen
        >
          <D.Title className="sr-only">{t.sm.add.title}</D.Title>
          <D.Description className="sr-only">{t.sm.add.title}</D.Description>
          {open && <AddBody onClose={onClose} startMode={startMode} onCapture={onCapture} hint={hint} seed={seed} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

type Hits = { hits: Hit[]; didYouMean: Hit[] };

function AddBody({ onClose, startMode, onCapture, hint, seed }: { onClose: () => void; startMode: AddMode; onCapture?: (k: "scan" | "photo") => void; hint: "camera" | null; seed: string | null }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const [mode, setMode] = useState<AddMode>(startMode);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Hits>({ hits: [], didYouMean: [] });
  const input = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseLine(q), [q]);
  const name = parsed.name || q.trim();
  // The quantity the person typed (or set with the steppers), until the line changes.
  const [edited, setEdited] = useState<{ q: string; m: Measure } | null>(null);
  const typed: Measure = { quantity: parsed.qty, count: parsed.count, amount: parsed.amount, unit: parsed.unit && parsed.unit !== "u" ? parsed.unit : null };
  const measure = edited && edited.q === q ? edited.m : typed;
  const hasMeasure = parsed.qty > 1 || parsed.amount != null || parsed.count != null || (edited?.q === q);
  const [steppers, setSteppers] = useState(false);
  const voice = useVoiceSupported();
  const line = useAddedLine();
  const [last, setLast] = useState<{ key: number; text: string; undo: () => void } | null>(null);

  useEffect(() => {
    if (mode === "type") requestAnimationFrame(() => input.current?.focus());
  }, [mode]);

  // Type-ahead: the line's name (quantity words out), 120 ms after the last key.
  useEffect(() => {
    if (!name) return;
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/grocery/search?q=${encodeURIComponent(name.slice(0, 80))}&locale=${locale}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((r: Hits | null) => r && setRes(r))
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [name, locale]);
  const hits = name ? res.hits : [];
  const dym = name && !hits.length ? res.didYouMean : [];
  const onListByKey = useMemo(() => new Map(s.sm.filter((i) => i.productKey).map((i) => [i.productKey!, i])), [s.sm]);
  const guess = classifyLocal(name);
  const top = hits[0] ?? null;
  const target = top && top.productKey === guess.productKey ? top : null;
  const listed = onListByKey.get(target?.productKey ?? guess.productKey) ?? null;
  const unitKg = unitKgFor(target?.productKey ?? guess.productKey, home?.unitKg);

  const add = async (hit: Hit | null) => {
    const title = hit ? hit.title : name;
    if (!title) return;
    const m = measure;
    setQ("");
    setEdited(null);
    setSteppers(false);
    input.current?.focus();
    try {
      const r = await addToSupermarket({ title, qty: m.quantity, amount: m.amount, unit: (m.unit as "kg" | "g" | "l" | null) ?? null, count: m.count, ...(hit ? { productKey: hit.productKey } : {}) });
      s.upsertSm([asItem(r.item)]);
      // S4 A2: one inline line under the field (replaced by the next add) — no toast while the Add screen is open.
      const x: Added = { id: r.item.id, title: r.item.title, qty: qtyLabel(r.item, locale, unitKgFor(r.item.productKey, home?.unitKg)), merged: r.merged };
      announceAdded([x]);
      // R19 C1: matched by the home's choice / usual brand → a quiet "As always · ₪6.80 · Change"; unsure → "Which one?".
      if (r.match?.state === "ask") openChoose(r.item.id);
      else if (r.match?.state === "auto" && (r.match.why === "brand" || r.match.why === "choice") && r.match.price != null)
        toast(r.match.name ?? r.item.title, { description: f(t.sm.match.asAlways, { price: `₪${r.match.price.toFixed(2)}` }), action: { label: t.sm.match.change, onClick: () => openChoose(r.item.id) } });
      setLast({ key: Date.now(), text: line([x]), undo: () => void undoSupermarketAdd(r.item.id, r.before).then((u) => (u.item ? s.upsertSm([asItem(u.item)]) : s.removeSm(r.item.id))) });
    } catch {
      setQ(q);
      toast.error(t.sm.add.failed);
    }
  };

  const chip = (on: boolean) => cn("flex h-[58px] min-w-0 flex-col items-center justify-center gap-1 rounded-[14px] border px-1 text-[12.5px] font-bold leading-none transition-transform duration-150 ease-[var(--ease-out)] active:scale-95 [&_svg]:size-5", on ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full text-ink active:scale-95" aria-label={t.sm.add.back} data-add-back>
          <ArrowLeft className="size-5 rtl:-scale-x-100" />
        </button>
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-ink bg-surface pe-1 ps-3.5">
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (mode !== "type") setMode("type");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name) {
                e.preventDefault();
                void add(target ?? (top?.source === "household" && top.match ? top : null));
              }
            }}
            placeholder={t.sm.main.addPh}
            aria-label={t.sm.main.addPh}
            enterKeyHint="done"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
            data-add-input
          />
          {q && (
            <button type="button" className="grid size-9 place-items-center rounded-full text-muted" onClick={() => setQ("")} aria-label={t.sm.add.clear}>
              <X className="size-[18px]" />
            </button>
          )}
        </label>
      </div>
      {last && (
        <div key={last.key} className="sm-added-line mx-3 mt-2 flex min-h-11 items-center gap-2 rounded-[12px] bg-surface-2 ps-3 pe-1 text-[14px] font-bold text-ink" role="status" aria-live="polite" data-add-done>
          <Check className="size-4 shrink-0 text-ok" aria-hidden />
          <span className="bidi min-w-0 flex-1 truncate">{last.text}</span>
          <button
            type="button"
            className="h-9 shrink-0 rounded-[10px] px-3 text-[13.5px] font-extrabold text-ink underline-offset-2 hover:underline"
            onClick={() => {
              last.undo();
              setLast(null);
            }}
            data-add-done-undo
          >
            {t.sm.add.undo}
          </button>
        </div>
      )}
      {hint === "camera" && (
        <p className="mx-3 mt-2 rounded-[12px] bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn" data-add-hint="camera">
          {t.sm.add.cameraOff}
        </p>
      )}
      {/* R18 S3 B6: every way to add in one row at 360 px (he + en) — equal columns, the icon over a short label; no
          sideways scroll. Scan / Photo only where the camera opens from here, Voice only where the browser hears. */}
      <div className="grid gap-2 px-3 py-3" style={{ gridTemplateColumns: `repeat(${(onCapture ? 2 : 0) + (voice ? 1 : 0) + 1}, minmax(0, 1fr))` }} data-add-chips>
        {onCapture && (
          <>
            <button type="button" className={chip(false)} onClick={() => onCapture("scan")} data-add-chip="scan">
              <ScanBarcode />
              <span className="max-w-full truncate">{t.sm.add.scan}</span>
            </button>
            <button type="button" className={chip(false)} onClick={() => onCapture("photo")} data-add-chip="photo">
              <Camera />
              <span className="max-w-full truncate">{t.sm.add.photo}</span>
            </button>
          </>
        )}
        {voice && (
          <button type="button" className={chip(mode === "voice")} onClick={() => setMode(mode === "voice" ? "type" : "voice")} data-add-chip="voice">
            <Mic />
            <span className="max-w-full truncate">{t.sm.add.voice}</span>
          </button>
        )}
        <button type="button" className={chip(mode === "paste")} onClick={() => setMode(mode === "paste" ? "type" : "paste")} aria-label={t.sm.add.paste} data-add-chip="paste">
          <ClipboardPaste />
          <span className="max-w-full truncate">{t.sm.add.pasteShort}</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
        {mode === "voice" ? (
          <Voice onDone={() => setMode("type")} />
        ) : mode === "paste" ? (
          <Paste initial={seed ?? ""} onDone={seed ? onClose : () => setMode("type")} />
        ) : !name ? (
          <Usual />
        ) : (
          <div className="flex flex-col gap-3">
            {hasMeasure && (
              <div className="rounded-[16px] border border-line bg-surface-2 p-2.5" data-add-parse>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSteppers(!steppers)} className="h-9 shrink-0 rounded-[10px] border border-line-strong bg-surface px-2.5 text-[14px] font-extrabold" aria-label={f(t.sm.add.setQty, { title: name })} aria-expanded={steppers} data-add-measure>
                    {qtyLabel(measure, locale, unitKg)}
                  </button>
                  <span className="bidi h-9 min-w-0 flex-1 truncate rounded-[10px] border border-line-strong bg-surface px-2.5 text-[14px] font-bold leading-9">{target?.title ?? name}</span>
                  <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface pe-2.5 ps-1 text-[13px] font-bold">
                    <SectionIcon section={target?.section ?? guess.section} size={24} />
                    <span className="max-w-[110px] truncate">{(target?.section ?? guess.section) === "other" ? t.sm.main.other : sectionName(target?.section ?? guess.section, locale)}</span>
                  </span>
                </div>
                {listed && (
                  <p className="mt-2 flex items-center gap-2 text-[13px] text-muted">
                    <span className="rounded-[6px] bg-info-soft px-1.5 py-0.5 text-[12px] font-bold text-info">{t.sm.add.onListPlain}</span>
                    {f(t.sm.add.nowAfter, { now: qtyLabel(listed, locale, unitKg), after: qtyLabel(afterMerge(listed, measure), locale, unitKg) })}
                  </p>
                )}
                {steppers && (
                  <div className="mt-3">
                    <QtySteppers value={measure} unitKg={unitKg} title={target?.title ?? name} learned={!!(target && home?.unitKg[target.productKey])} onChange={(m) => setEdited({ q, m })} />
                  </div>
                )}
              </div>
            )}
            {dym.length > 0 && (
              <p className="flex items-center gap-1.5 px-1 text-[13px] font-semibold text-muted">
                <Sparkles className="size-3.5 text-spark" />
                {t.sm.add.didYouMean}
              </p>
            )}
            <div className="overflow-hidden rounded-[18px] border border-line-strong bg-surface" data-add-results>
              {[...hits, ...dym].map((h) => (
                <HitRow key={`${h.source}:${h.productKey}`} hit={h} listed={onListByKey.get(h.productKey) ?? null} unitKg={unitKgFor(h.productKey, home?.unitKg)} onAdd={() => void add(h)} />
              ))}
              <button type="button" className="gro-hit flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-start active:bg-surface-2" onClick={() => void add(null)} data-add-new>
                <span className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-dashed border-line-strong text-muted">
                  <Plus className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="bidi block truncate text-[15.5px] font-extrabold">{f(t.sm.add.addNew, { q: name })}</b>
                  <span className="block text-[12.5px] text-muted">{guess.section === "other" ? t.sm.add.addNewSub : sectionName(guess.section, locale)}</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The row after adding `m` to it (same merge as the server: counts add, same-unit weights add, packs add). */
function afterMerge(cur: Measure, m: Measure): Measure {
  const out = { ...cur };
  if (m.count != null) out.count = (cur.count ?? 0) + m.count;
  if (m.unit && m.unit === cur.unit && m.amount != null) out.amount = Math.round(((cur.amount ?? 0) + m.amount) * 1000) / 1000;
  else if (m.count == null && !m.unit && !cur.unit) out.quantity = cur.quantity + m.quantity;
  return out;
}

function HitRow({ hit, listed, unitKg, onAdd }: { hit: Hit; listed: Measure | null; unitKg: number | null; onAdd: () => void }) {
  const { t, f, locale } = useI18n();
  const title = hit.title;
  const [a, b] = hit.match ?? [0, 0];
  return (
    <div className="gro-hit flex min-h-[64px] items-center gap-3 px-3 py-2" data-add-hit={hit.productKey} data-add-hit-source={hit.source}>
      <ProductTile art={hit.art} section={hit.section} size={44} />
      <span className="min-w-0 flex-1">
        <span className="bidi block truncate text-[15.5px] font-medium">
          {hit.match ? (
            <>
              {title.slice(0, a)}
              <b className="font-extrabold">{title.slice(a, b)}</b>
              {title.slice(b)}
            </>
          ) : (
            title
          )}
        </span>
        <span className="block truncate text-[12.5px] text-muted">
          {hit.section === "other" ? t.sm.main.other : sectionName(hit.section, locale)}
          {hit.count ? ` · ${f(t.sm.add.bought, { n: hit.count })}` : ""}
        </span>
      </span>
      {listed && <span className="shrink-0 rounded-[7px] bg-info-soft px-1.5 py-0.5 text-[12px] font-bold text-info">{f(t.sm.add.onList, { qty: qtyLabel(listed, locale, unitKg) })}</span>}
      <button type="button" className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-90" aria-label={`${t.sm.quick.add}: ${title}`} onClick={onAdd} data-add-hit-plus>
        <Plus className="size-5" />
      </button>
    </div>
  );
}

/** Nothing typed: what this home usually buys (Nexus's suggestions) — a tap opens its page (R18 S3 B4: quantity from
 *  history, Add or Update quantity), never a silent add behind this screen. */
function Usual() {
  const { t, f } = useI18n();
  const { home } = useSmHome();
  const [open, setOpen] = useState<SmHome["suggestions"][number] | null>(null);
  const list = (home?.suggestions ?? []).slice(0, 8);
  if (!list.length) return null;
  const reason = (x: SmHome["suggestions"][number]) => {
    const a = x.reasonArgs as Record<string, string | number>;
    return x.reasonKey === "due" ? f(t.sm.sug.due, { days: a.days }) : "";
  };
  return (
    <div data-add-usual>
      <SuggestionActions sug={open} reason={open ? reason(open) : ""} onClose={() => setOpen(null)} />
      <p className="px-1 pb-2 text-[13px] font-semibold text-muted">{t.sm.add.usual}</p>
      <div className="flex flex-wrap gap-2">
        {list.map((x) => (
          <button
            key={x.productKey}
            type="button"
            className="flex h-11 items-center gap-1.5 rounded-[12px] border border-line-strong bg-surface px-3 text-[14px] font-bold transition-transform duration-150 ease-[var(--ease-out)] active:scale-95"
            onClick={() => setOpen(x)}
            aria-label={f(t.sm.sugAct.open, { title: x.title })}
            data-add-usual-item={x.productKey}
          >
            <Plus className="size-4 text-muted" />
            <span className="bidi">{x.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The checked preview of a split list (paste or voice): products checked, notes unchecked; "Add N". */
function SplitPreview({ parts, onDone }: { parts: SplitPart[]; onDone: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const [off, setOff] = useState<Set<number>>(() => new Set());
  const [on, setOn] = useState<Set<number>>(() => new Set());
  const checked = (k: number) => (parts[k].checked ? !off.has(k) : on.has(k));
  const toggle = (k: number) => (parts[k].checked ? setOff : setOn)((x) => (x.has(k) ? new Set([...x].filter((y) => y !== k)) : new Set([...x, k])));
  const onListByKey = new Map(s.sm.filter((i) => i.productKey).map((i) => [i.productKey!, i]));
  const n = parts.filter((_, k) => checked(k)).length;
  const addedLine = useAddedLine();
  const go = async () => {
    const picked = parts.filter((_, k) => checked(k));
    try {
      const rows = await addParts(picked.map((p) => ({ title: (p.product ? p.name || p.text : p.text).slice(0, 300), qty: p.qty, amount: p.amount != null && p.unit && p.unit !== "u" ? p.amount : null, unit: p.unit && p.unit !== "u" ? p.unit : null, count: p.count, ...(p.product ? {} : { note: true }) })));
      s.upsertSm(rows.map((r) => asItem(r.item)));
      const xs: Added[] = rows.map((r) => ({ id: r.item.id, title: r.item.title, qty: qtyLabel(r.item, locale, unitKgFor(r.item.productKey, home?.unitKg)), merged: r.merged }));
      announceAdded(xs, { line: addedLine(xs) });
      onDone();
    } catch {
      toast.error(t.sm.add.failed);
    }
  };
  if (!parts.length) return null;
  return (
    <div className="flex flex-col gap-2.5" data-add-split>
      <p className="px-1 text-[13px] font-semibold text-muted">{parts.length === 1 ? t.sm.add.splitOne : f(t.sm.add.split, { n: parts.length })}</p>
      <div className="overflow-hidden rounded-[18px] border border-line-strong bg-surface">
        {parts.map((p, k) => {
          const listed = p.product ? onListByKey.get(p.cls.productKey) ?? null : null;
          const unitKg = unitKgFor(p.cls.productKey, home?.unitKg);
          const m: Measure = { quantity: p.qty, count: p.count, amount: p.amount, unit: p.unit && p.unit !== "u" ? p.unit : null };
          return (
            <label key={k} className="gro-hit flex min-h-[60px] cursor-pointer items-center gap-3 px-3 py-2" data-add-part={k}>
              <input type="checkbox" className="peer sr-only" checked={checked(k)} onChange={() => toggle(k)} />
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-[7px] border-2 transition-colors duration-150", checked(k) ? "border-ink bg-ink text-bg" : "border-line-strong text-transparent")} aria-hidden>
                <Check className="size-4" strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="bidi block truncate text-[15.5px] font-bold">{p.product ? p.name || p.text : p.text}</b>
                <span className="block truncate text-[12.5px] text-muted">{p.product ? (p.cls.section === "other" ? t.sm.main.other : sectionName(p.cls.section, locale)) : t.sm.add.note}</span>
              </span>
              {listed && <span className="shrink-0 rounded-[7px] bg-info-soft px-1.5 py-0.5 text-[12px] font-bold text-info">{f(t.sm.add.onList, { qty: `→ ${qtyLabel(afterMerge(listed, m), locale, unitKg)}` })}</span>}
              {p.product && <span className="gro-q">{qtyLabel(m, locale, unitKg)}</span>}
            </label>
          );
        })}
      </div>
      <button type="button" disabled={!n} onClick={() => void go()} className="mt-1 h-[52px] rounded-[16px] bg-ink text-[16px] font-extrabold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-40" data-add-parts>
        {n === 1 ? t.sm.add.addOne : f(t.sm.add.addN, { n })}
      </button>
    </div>
  );
}

function Paste({ onDone, initial = "" }: { onDone: () => void; initial?: string }) {
  const s = useStore();
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const keys = useMemo(() => s.sm.map((i) => i.productKey).filter((k): k is string => !!k), [s.sm]);
  const parts = useMemo(() => (text.trim() ? splitList(text, keys) : []), [text, keys]);
  return (
    <div className="flex flex-col gap-3">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.sm.add.pastePh}
        rows={5}
        className="w-full resize-none rounded-[16px] border border-line-strong bg-[color-mix(in_srgb,#3f9d5a_10%,var(--surface))] p-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted focus:border-ink"
        data-add-paste
      />
      <SplitPreview key={text} parts={parts} onDone={onDone} />
    </div>
  );
}

/**
 * R18 S4 C1 — voice add (Tal's choice 2026-10-15: record + AI). Recording starts at once: the mic turns into a live
 * level meter with the elapsed time and "Tap to finish" (60 s at most); the browser's own recognition, where it works,
 * shows the words live (never needed — an error hides it). Stop → "Understanding…" (the AI reads the audio, one call
 * from the daily quota) → the items as chips over the Paste review → merged into the list (A1). Errors say what to do:
 * the mic is blocked (how to allow it), no mic, nothing heard, the daily limit.
 */
const VOICE_SEEN = "nexus:voice-seen";
type VoiceErr = "blocked" | "nomic" | "empty" | "limit" | "failed";
function Voice({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<"starting" | "listening" | "understanding" | "error">("starting");
  const [error, setError] = useState<VoiceErr | null>(null);
  const [live, setLive] = useState("");
  const [lines, setLines] = useState<string[] | null>(null);
  const [round, setRound] = useState(0);
  const [secs, setSecs] = useState(0);
  // First use: one line of example (once per device).
  const [first] = useState(() => {
    try {
      const seen = localStorage.getItem(VOICE_SEEN);
      localStorage.setItem(VOICE_SEEN, "1");
      return !seen;
    } catch {
      return false;
    }
  });
  const rec = useRef<Recording | null>(null);
  const words = useRef<VoiceSession | null>(null);
  const bars = useRef<HTMLSpanElement>(null);
  const finishRef = useRef<() => void>(() => {});

  const fail = (e: VoiceErr) => {
    setError(e);
    setPhase("error");
  };
  const finish = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    if (words.current?.supported) words.current.abort();
    setPhase("understanding");
    try {
      const { blob } = await r.stop();
      const body = (await toWav(blob)) ?? blob;
      const res = await fetch(`/api/grocery/voice?locale=${locale}`, { method: "POST", headers: { "content-type": body.type.split(";")[0] || "audio/webm" }, body });
      const out = (await res.json().catch(() => null)) as { state: string; lines?: string[] } | null;
      if (out?.state === "read" && out.lines?.length) return setLines(out.lines);
      fail(out?.state === "limit" ? "limit" : out?.state === "empty" ? "empty" : "failed");
    } catch {
      fail("failed");
    }
  };
  useEffect(() => {
    finishRef.current = () => void finish();
  });

  useEffect(() => {
    let gone = false;
    void startRecording(() => finishRef.current())
      .then((r) => {
        if (gone) return r.cancel();
        rec.current = r;
        setPhase("listening");
        // Live words where the browser's recognition works next to the recording; an error just hides them.
        if (voiceSupported())
          words.current = listen(
            locale,
            (txt) => !gone && setLive(txt),
            (_txt, err) => void (err && !gone && setLive("")),
          );
      })
      .catch((e) => {
        if (gone) return;
        const k = recError(e);
        fail(k === "blocked" ? "blocked" : k === "nomic" ? "nomic" : "failed");
      });
    return () => {
      gone = true;
      rec.current?.cancel();
      rec.current = null;
      if (words.current?.supported) words.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new round restarts the recording
  }, [locale, round]);

  // The meter (from the recording's own audio; the bars are styled directly, no render per frame) and the clock.
  useEffect(() => {
    if (phase !== "listening") return;
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hist: number[] = new Array(9).fill(0);
    const tick = () => {
      const r = rec.current;
      if (r) {
        hist.shift();
        hist.push(r.level());
        const peak = Math.max(...hist);
        bars.current?.querySelectorAll("i").forEach((b, i) => {
          b.style.transform = `scaleY(${0.15 + (reduce ? peak : hist[i]) * 0.85})`;
        });
        setSecs(Math.floor((performance.now() - r.startedAt) / 1000));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const keys = useMemo(() => s.sm.map((i) => i.productKey).filter((k): k is string => !!k), [s.sm]);
  const parts = useMemo(() => (lines ? splitList(lines.join("\n"), keys) : null), [lines, keys]);
  if (parts)
    return (
      <div className="flex flex-col gap-3 pt-2" data-add-voice="done">
        <div className="flex flex-wrap gap-1.5" data-add-voice-chips>
          {parts
            .filter((p) => p.product)
            .map((p, i) => (
              <span key={i} className="sm-chip-in bidi inline-flex h-8 items-center rounded-full bg-surface-2 px-3 text-[14px] font-bold" style={{ animationDelay: `${i * 40}ms` }}>
                {p.qty > 1 ? `${p.qty} · ` : ""}
                {p.name || p.text}
              </span>
            ))}
        </div>
        <SplitPreview parts={parts} onDone={onDone} />
      </div>
    );
  const msg = error ? t.sm.voice[error] : null;
  const listening = phase === "listening";
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className="flex flex-col items-center gap-4 pt-10 text-center" data-add-voice={phase} data-add-voice-error={error ?? undefined}>
      {first && listening && (
        <p className="rounded-[12px] bg-surface-2 px-3 py-2 text-[13.5px] font-semibold text-ink" data-add-voice-example>
          {t.sm.voice.example}
        </p>
      )}
      <b className="bidi min-h-7 px-4 text-[19px] font-extrabold" aria-live="polite" data-add-voice-text>
        {phase === "understanding" ? t.sm.voice.understanding : listening ? live : ""}
      </b>
      <button
        type="button"
        className={cn("grid size-24 place-items-center rounded-full text-bg transition-[transform,background-color] duration-200 ease-[var(--ease-out)] active:scale-95 disabled:opacity-60", listening ? "bg-danger" : "bg-ink")}
        disabled={phase === "starting" || phase === "understanding"}
        onClick={() => {
          if (phase !== "error") return void finish();
          setError(null);
          setLive("");
          setSecs(0);
          setPhase("starting");
          setRound((n) => n + 1);
        }}
        aria-label={phase === "error" ? t.sm.add.voiceAgain : t.sm.voice.finish}
        data-add-voice-stop
      >
        {listening ? (
          <span ref={bars} className="flex h-10 items-center gap-[3px]" aria-hidden data-add-voice-meter>
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} className="block h-full w-[4px] origin-center rounded-full bg-bg transition-transform duration-75" style={{ transform: "scaleY(0.15)" }} />
            ))}
          </span>
        ) : phase === "error" ? (
          <Mic className="size-8" />
        ) : (
          <Spinner className="size-8" />
        )}
      </button>
      {listening && (
        <span className="tabular text-[15px] font-bold" data-add-voice-time>
          {clock}
        </span>
      )}
      <p className={cn("max-w-[300px] text-[13.5px]", error ? "font-semibold text-ink" : "text-muted")} data-add-voice-msg>
        {msg ?? (listening ? t.sm.voice.tapFinish : phase === "understanding" ? t.sm.voice.understandingSub : t.sm.voice.starting)}
      </p>
      {phase === "error" && <span className="text-[12.5px] text-muted">{t.sm.add.voiceAgain}</span>}
    </div>
  );
}
