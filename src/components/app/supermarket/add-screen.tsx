"use client";

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
import { unitKgFor } from "@/lib/grocery/weights";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile, SectionIcon } from "./art";
import { useSmHome, type SmHome } from "./data";
import { asItem } from "./numbers";
import { qtyLabel } from "./qty";
import { QtySteppers, type Measure } from "./qty-steppers";

// R18 S2 B2 — the Add screen (board Add-phone): type-ahead (the household's products first, the typed letters bold),
// "Did you mean" for spelling mistakes with "Add as new" still offered, a quantity read from the line ("2 milk 3%",
// "קילו עגבניות, בערך 6") with the count + weight steppers, a duplicate merged into its row ("Milk is already on the list —
// now ×3", Undo), voice and pasted lists split into a checked preview. Full screen on a phone, a dialog on a computer.

export type AddMode = "type" | "voice" | "paste";

const never = () => () => {};
/** Web Speech is a browser fact: false on the server and while hydrating (no mismatch), then the real answer. */
export const useVoiceSupported = () => useSyncExternalStore(never, voiceSupported, () => false);

export function AddScreen({ open, onClose, mode: startMode = "type", onCapture }: { open: boolean; onClose: () => void; mode?: AddMode; onCapture?: (k: "scan" | "photo") => void }) {
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
          {open && <AddBody onClose={onClose} startMode={startMode} onCapture={onCapture} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

type Hits = { hits: Hit[]; didYouMean: Hit[] };

function AddBody({ onClose, startMode, onCapture }: { onClose: () => void; startMode: AddMode; onCapture?: (k: "scan" | "photo") => void }) {
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
      const undo = { label: t.sm.add.undo, onClick: () => void undoSupermarketAdd(r.item.id, r.before).then((u) => (u.item ? s.upsertSm([asItem(u.item)]) : s.removeSm(r.item.id))) };
      if (r.merged) toast(r.item.title, { description: f(t.sm.add.merged, { qty: qtyLabel(r.item, locale, unitKgFor(r.item.productKey, home?.unitKg)) }), action: undo, id: `sm-add-${r.item.id}` });
      else toast(f(t.sm.add.added, { title: r.item.title }), { action: undo, id: `sm-add-${r.item.id}` });
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
          <Paste onDone={() => setMode("type")} />
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
  const go = async () => {
    const picked = parts.filter((_, k) => checked(k));
    try {
      const rows = await addParts(picked.map((p) => ({ title: (p.product ? p.name || p.text : p.text).slice(0, 300), qty: p.qty, amount: p.amount != null && p.unit && p.unit !== "u" ? p.amount : null, unit: p.unit && p.unit !== "u" ? p.unit : null, count: p.count, ...(p.product ? {} : { note: true }) })));
      s.upsertSm(rows.map((r) => asItem(r.item)));
      toast.success(f(t.sm.add.added_n, { n: rows.length }));
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

function Paste({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  const [text, setText] = useState("");
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

function Voice({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [final, setFinal] = useState<string | null>(null);
  // listening → (Stop) finishing → the preview, or "Didn't catch that" with Try again.
  const [phase, setPhase] = useState<"listening" | "finishing" | "missed">("listening");
  const [error, setError] = useState<string | null>(() => (voiceSupported() ? null : t.sm.add.noVoice));
  const [round, setRound] = useState(0);
  const session = useRef<VoiceSession | null>(null);
  useEffect(() => {
    const v = listen(
      locale,
      (txt) => setText(txt),
      (txt, err) => {
        if (txt.trim()) return setFinal(txt);
        setPhase("missed");
        if (err) setError(err === "not-allowed" || err === "service-not-allowed" ? t.sm.add.noVoice : t.sm.add.voiceError);
        else setError(t.sm.add.voiceError);
      },
    );
    session.current = v;
    return () => {
      if (v.supported) v.abort();
    };
  }, [locale, t, round]);
  // Stop: the last words often land after it — wait for the recognizer's end (or 2.5 s, then take what's on screen).
  useEffect(() => {
    if (phase !== "finishing") return;
    const id = window.setTimeout(() => (text.trim() ? setFinal(text) : setPhase("missed")), 2500);
    return () => window.clearTimeout(id);
  }, [phase, text]);
  const keys = useMemo(() => s.sm.map((i) => i.productKey).filter((k): k is string => !!k), [s.sm]);
  if (final) return <SplitPreview parts={splitList(final, keys)} onDone={onDone} />;
  const missed = phase === "missed";
  return (
    <div className="flex flex-col items-center gap-5 pt-16 text-center" data-add-voice={phase}>
      <span className="flex h-8 items-end gap-1" aria-hidden>
        {[10, 22, 6, 14, 26, 12, 20].map((h, i) => (
          <i key={i} className={cn("block w-1 rounded-full bg-ink", !missed && "gro-wave")} style={{ height: missed ? 6 : h, animationDelay: `${i * 90}ms` }} />
        ))}
      </span>
      <b className="bidi min-h-7 px-4 text-[20px] font-extrabold" data-add-voice-text>{text}</b>
      <p className="text-[13.5px] text-muted">{error ?? t.sm.add.listening}</p>
      <button
        type="button"
        className="grid size-20 place-items-center rounded-full bg-ink text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-95 disabled:opacity-60"
        disabled={phase === "finishing" || (missed && !voiceSupported())}
        onClick={() => {
          if (missed) {
            setText("");
            setError(null);
            setPhase("listening");
            setRound((n) => n + 1);
            return;
          }
          const v = session.current;
          if (!v?.supported) return onDone();
          setPhase("finishing");
          v.stop();
        }}
        aria-label={missed ? t.sm.add.voiceAgain : t.sm.add.tapStop}
        data-add-voice-stop
      >
        {phase === "finishing" ? <Spinner className="size-7" /> : <Mic className="size-7" />}
      </button>
      <span className="text-[12.5px] text-muted">{missed ? t.sm.add.voiceAgain : t.sm.add.tapStop}</span>
    </div>
  );
}
