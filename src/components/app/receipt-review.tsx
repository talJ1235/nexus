"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Link2Off, Plus, Search, X } from "lucide-react";
import { findLinePictures, understandReceiptLines } from "@/app/picture-actions";
import type { ReceiptRead } from "@/app/receipt-actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import type { Candidate } from "@/lib/picture-rank";
import type { LineInfo } from "@/lib/product-lines";
import { ProductImage } from "./item-card";
import { PicturePicker } from "./picture-picker";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";

export type Mode = "match" | "new" | "ignore";
export type LineState = {
  name: string;
  qty: number;
  unitPrice: number | null;
  check?: boolean;
  mode: Mode;
  allocations: { itemId: string; qty: number }[];
  ranked: string[];
  /** New items: picture found for the line (undefined = still looking), category, project/list. Round 10 D: what the
   *  line is (D1), the ranked alternatives for the picker, where the picture came from, and "check" (a soft highlight). */
  image?: string | null;
  info?: LineInfo;
  candidates?: Candidate[];
  imageSource?: Candidate["source"] | null;
  imageCheck?: boolean;
  category?: string | null;
  collectionId?: string | null;
};
export type ReviewPhase = { step: "review"; read: ReceiptRead; kind: "receipt" | "order"; lines: LineState[]; picturesApproved?: boolean };

/** Review after reading: summary header, then "Already on your list" and "New" as product cards. */
export function ReceiptReview({ phase, setPhase, onApply, onBack }: { phase: ReviewPhase; setPhase: (p: ReviewPhase) => void; onApply: (opts?: { skipPictures?: boolean }) => void; onBack: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { data } = phase.read;
  const currency = data.currency ?? s.currency;
  const m = (v: number) => formatMoney(v, currency, locale);
  const byId = useMemo(() => new Map(s.items.map((i) => [i.id, i])), [s.items]);
  const setLine = (i: number, patch: Partial<LineState>) => setPhase({ ...phase, lines: phase.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const taken = (itemId: string, line: number) => phase.lines.some((l, j) => j !== line && l.mode === "match" && l.allocations.some((a) => a.itemId === itemId));
  const [leaving, setLeaving] = useState(false);

  // Pictures for the new cards (Round 10 D): one call understands every line, then a few lines at a time are searched
  // and ranked, so each card fills in as soon as its picture is found. Nothing is saved until Confirm.
  const latest = useRef(phase);
  useEffect(() => {
    latest.current = phase;
  });
  const patchLines = (patch: Map<number, Partial<LineState>>) => {
    const cur = latest.current;
    const next = { ...cur, lines: cur.lines.map((l, i) => (patch.has(i) ? { ...l, ...patch.get(i) } : l)) };
    latest.current = next;
    setPhase(next);
  };
  const wanted = phase.lines.map((l, i) => [l, i] as const).filter(([l]) => l.mode === "new" && l.image === undefined);
  const wantKey = wanted.map(([l, i]) => `${i}:${l.name}`).join("|");
  useEffect(() => {
    if (!wanted.length) return;
    let alive = true;
    void (async () => {
      const idx = wanted.map(([, i]) => i);
      const infos = await understandReceiptLines({ names: wanted.map(([l]) => l.name) }).catch(() => null);
      if (!alive) return;
      if (!infos) return patchLines(new Map(idx.map((i) => [i, { image: null }])));
      for (let k = 0; k < infos.length && alive; k += 3) {
        const chunk = infos.slice(k, k + 3);
        const got = await findLinePictures({ infos: chunk }).catch(() => null);
        if (!alive) return;
        patchLines(
          new Map(
            chunk.map((info, j) => {
              const r = got?.[j];
              return [idx[k + j], { info, image: r?.chosen?.url ?? null, candidates: r?.candidates ?? [], imageSource: r?.chosen?.source ?? null, imageCheck: !!r?.check }] as const;
            }),
          ),
        );
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey]);
  const [picker, setPicker] = useState<number | null>(null);
  const pending = phase.lines.some((l) => l.mode === "new" && l.image === undefined);
  const approveAll = () => setPhase({ ...phase, picturesApproved: true, lines: phase.lines.map((l) => (l.mode === "new" ? { ...l, imageCheck: false } : l)) });

  const matched = phase.lines.map((l, i) => [l, i] as const).filter(([l]) => l.mode === "match" && l.allocations.length);
  const fresh = phase.lines.map((l, i) => [l, i] as const).filter(([l]) => l.mode === "new");
  const ignored = phase.lines.map((l, i) => [l, i] as const).filter(([l]) => l.mode === "ignore" || (l.mode === "match" && !l.allocations.length));
  const checks = phase.lines.filter((l) => l.check).length;
  const count = matched.length + fresh.length;
  const dest = phase.kind === "order" ? t.nav.onTheWay : t.nav.history;
  const collections = s.collections.filter((c) => !c.archived);
  const date = data.orderDate ? new Date(data.orderDate).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

  const apply = (skipPictures = false) => {
    // Cards fly toward their destination (staggered), then the receipt is applied.
    setLeaving(true);
    setTimeout(() => onApply({ skipPictures }), 420);
  };

  return (
    <div className="flex flex-col gap-4" data-receipt-review>
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3 rounded-[22px] bg-surface-2 p-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-extrabold bidi">{data.store ?? t.scan.title}</div>
          <div className="tabular text-xs text-muted">{[date, data.orderNumber && f(t.scan.orderNo, { n: data.orderNumber }), f(t.scan.lines, { n: phase.lines.length })].filter(Boolean).join(" · ")}</div>
        </div>
        {data.total != null && <div className="tabular text-[20px] font-black">{m(data.total)}</div>}
        <span
          className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", checks ? "bg-tint text-tint-ink" : "bg-ok-soft text-ok")}
          data-receipt-check={checks ? "check" : "ok"}
        >
          {checks ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" strokeWidth={3} />}
          {checks ? f(t.review.checkLines, { n: checks }) : data.check?.sumOk ? t.review.matches : t.review.read}
        </span>
        <div role="radiogroup" aria-label={t.scan.markAs} className="flex w-full rounded-full bg-surface p-[3px] text-[13px] sm:w-auto">
          {(["receipt", "order"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={phase.kind === k} onClick={() => setPhase({ ...phase, kind: k })} className={cn("min-h-9 flex-1 rounded-full px-3 font-semibold", phase.kind === k ? "bg-ink text-bg" : "text-muted")}>
              {k === "receipt" ? t.scan.received : t.scan.ordered}
            </button>
          ))}
        </div>
      </div>

      {matched.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-muted">{t.review.onList}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {matched.map(([l, i], k) => (
              <MatchedCard key={i} line={l} index={i} dest={dest} currency={currency} byId={byId} taken={taken} onChange={(p) => setLine(i, p)} leaving={leaving} order={k} />
            ))}
          </div>
        </section>
      )}

      {fresh.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-muted">{t.review.new}</h3>
            <select
              value=""
              onChange={(e) => setPhase({ ...phase, lines: phase.lines.map((l) => (l.mode === "new" ? { ...l, collectionId: e.target.value === "none" ? null : e.target.value } : l)) })}
              className="h-9 rounded-full border border-line bg-surface px-3 text-xs font-semibold outline-none"
              aria-label={t.review.addAllTo}
              data-review-all-to
            >
              <option value="" disabled>
                {t.review.addAllTo}
              </option>
              <option value="none">{t.barcode.none}</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {/* One tap approves every picture; "check" cards carry a soft highlight. Skip adds now, pictures keep coming. */}
          <div className="flex flex-wrap items-center gap-2" data-review-pictures>
            {phase.picturesApproved && !pending ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ok-soft px-3 text-xs font-bold text-ok" data-pictures-approved>
                <Check className="size-3.5" strokeWidth={3} /> {t.pictures.approved}
              </span>
            ) : (
              <Button variant="outline" className="h-9 rounded-full px-3.5 text-xs font-bold" disabled={pending} onClick={approveAll} data-pictures-approve>
                <Check /> {t.pictures.approveAll}
              </Button>
            )}
            {pending && (
              <>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <Spinner className="size-3.5" /> {t.pictures.finding}
                </span>
                <button type="button" className="ms-auto h-9 rounded-full px-3 text-xs font-semibold text-muted hover:bg-surface-2" onClick={() => apply(true)} disabled={!count || leaving} data-pictures-skip>
                  {t.pictures.skip}
                </button>
              </>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {fresh.map(([l, i], k) => (
              <NewCard key={i} line={l} dest={dest} currency={currency} onChange={(p) => setLine(i, p)} onPicture={() => setPicker(i)} leaving={leaving} order={matched.length + k} />
            ))}
          </div>
          {picker != null && (
            <PicturePicker
              open
              onOpenChange={(o) => !o && setPicker(null)}
              title={phase.lines[picker].info?.nameHe ?? phase.lines[picker].name}
              current={phase.lines[picker].image ?? null}
              candidates={phase.lines[picker].candidates ?? []}
              loading={phase.lines[picker].image === undefined}
              keyword={phase.lines[picker].info?.iconKeyword ?? "package"}
              onPick={(c) => setLine(picker, { image: c.url, imageSource: c.source === "photo" ? null : c.source, imageCheck: false })}
            />
          )}
        </section>
      )}

      {ignored.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-bold text-muted">{t.review.skipped}</h3>
          {ignored.map(([l, i]) => (
            <div key={i} className="flex items-center gap-2 rounded-[16px] border border-dashed border-line px-3 py-2 text-sm" data-receipt-line="ignore">
              <span className="min-w-0 flex-1 truncate text-muted line-through bidi">{l.name}</span>
              <button type="button" className="inline-flex h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-xs font-semibold" onClick={() => setLine(i, { mode: "new" })}>
                <Plus className="size-3.5" /> {t.scan.asNew}
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-2 bg-surface px-1 pt-2">
        <Button variant="ghost" onClick={onBack}>
          {t.scan.back}
        </Button>
        <Button variant="accent" disabled={!count || leaving} onClick={() => apply()} data-receipt-apply>
          {t.scan.apply} {count > 0 && <span className="tabular">({count})</span>}
        </Button>
      </div>
    </div>
  );
}

const fly = (leaving: boolean, order: number) => (leaving ? { transitionDelay: `${order * 45}ms` } : undefined);
const flyCls = (leaving: boolean) => cn("transition-[transform,opacity] duration-[380ms] ease-[var(--ease-out)]", leaving && "translate-y-6 scale-95 opacity-0");

function MatchedCard({ line, index, dest, currency, byId, taken, onChange, leaving, order }: {
  line: LineState;
  index: number;
  dest: string;
  currency: string;
  byId: Map<string, ItemWithSources>;
  taken: (id: string, line: number) => boolean;
  onChange: (p: Partial<LineState>) => void;
  leaving: boolean;
  order: number;
}) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const a = line.allocations[0];
  const item = a ? byId.get(a.itemId) : null;
  const results = useMemo(() => {
    if (!picking) return [];
    const needle = q.trim().toLowerCase();
    const open = s.items.filter((i) => i.status !== "purchased" && !taken(i.id, index));
    const ranked = line.ranked.map((id) => open.find((i) => i.id === id)).filter(Boolean) as ItemWithSources[];
    return (needle ? open.filter((i) => i.title.toLowerCase().includes(needle)) : ranked.length ? ranked : open).slice(0, 6);
  }, [picking, q, s.items, line.ranked, taken, index]);

  return (
    <div className={cn("flex flex-col gap-2 rounded-[22px] border bg-surface p-2", line.check ? "border-tint-ink/40 bg-tint/40" : "border-line", flyCls(leaving))} style={fly(leaving, order)} data-receipt-line="match">
      <button type="button" onClick={() => setPicking(!picking)} className="flex items-center gap-3 text-start">
        <ProductImage src={item?.imageUrl ?? null} alt="" className="size-14 shrink-0 rounded-[16px]" iconClass="size-5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold bidi">{item?.title ?? line.name}</span>
          <span className="block truncate text-xs text-muted bidi">{line.name}</span>
          <span className="tabular mt-0.5 flex items-center gap-1.5 text-xs">
            <b>
              {line.qty} × {line.unitPrice != null ? formatMoney(line.unitPrice, currency, locale) : "—"}
            </b>
            {item && a.qty < item.quantity && <span className="text-tint-ink">{f(t.scan.partOf, { n: a.qty, total: item.quantity })}</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-2 px-2 py-1 text-[11px] font-bold text-muted">
          <ArrowRight className="size-3 rtl:-scale-x-100" /> {dest}
        </span>
      </button>
      {line.check && <span className="px-1 text-[11.5px] font-semibold text-tint-ink">{t.review.checkLine}</span>}
      {picking && (
        <div className="flex flex-col gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.scan.search} className="h-10 ps-9" />
          </div>
          {results.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                onChange({ mode: "match", allocations: [{ itemId: it.id, qty: Math.min(line.qty, it.quantity) }] });
                setPicking(false);
              }}
              className="flex min-h-10 items-center gap-2 rounded-[12px] px-1.5 text-start text-[13px] hover:bg-surface-2"
            >
              <ProductImage src={it.imageUrl} alt="" className="size-7 shrink-0 rounded-md" iconClass="size-3.5" />
              <span className="min-w-0 flex-1 truncate bidi">{it.title}</span>
            </button>
          ))}
          <button type="button" onClick={() => onChange({ mode: "new", allocations: [] })} className="flex min-h-10 items-center gap-2 rounded-[12px] px-1.5 text-[13px] font-semibold text-muted hover:bg-surface-2" data-receipt-unlink>
            <Link2Off className="size-4" /> {t.review.unlink}
          </button>
        </div>
      )}
    </div>
  );
}

function NewCard({ line, dest, currency, onChange, onPicture, leaving, order }: { line: LineState; dest: string; currency: string; onChange: (p: Partial<LineState>) => void; onPicture: () => void; leaving: boolean; order: number }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const c = line.collectionId ? s.collections.find((x) => x.id === line.collectionId) : null;
  return (
    <div className={cn("flex flex-col gap-2 rounded-[22px] border bg-surface p-2", line.check ? "border-tint-ink/40 bg-tint/40" : "border-line", flyCls(leaving))} style={fly(leaving, order)} data-receipt-line="new">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onPicture}
          className={cn("relative shrink-0 rounded-[16px] transition active:scale-95", line.imageCheck && "ring-2 ring-tint-ink/60 ring-offset-2 ring-offset-surface")}
          aria-label={line.imageCheck ? t.pictures.check : t.pictures.change}
          title={line.imageCheck ? t.pictures.check : t.pictures.change}
          data-receipt-picture={line.image === undefined ? "pending" : line.imageCheck ? "check" : line.image ? "ok" : "none"}
        >
          <ProductImage key={line.image ?? "none"} src={line.image ?? null} alt="" pending={line.image === undefined} className="size-14 animate-pop-in rounded-[16px]" iconClass="size-5" />
        </button>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-bold leading-snug bidi">{line.name}</span>
          <span className="tabular text-xs">
            <b>
              {line.qty} × {line.unitPrice != null ? formatMoney(line.unitPrice, currency, locale) : "—"}
            </b>
            <span className="text-muted"> · → {dest}</span>
          </span>
        </span>
        <button type="button" onClick={() => onChange({ mode: "ignore" })} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label={t.scan.ignore} title={t.scan.ignore} data-receipt-ignore>
          <X className="size-4" />
        </button>
      </div>
      {line.check && <span className="px-1 text-[11.5px] font-semibold text-tint-ink">{t.review.checkLine}</span>}
      <div className="flex gap-1.5">
        <select value={line.category ?? "other"} onChange={(e) => onChange({ category: e.target.value })} className="h-9 min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-2.5 text-xs outline-none" aria-label={t.home.category}>
          {CATEGORIES.map((k) => (
            <option key={k} value={k}>
              {t.categories[k]}
            </option>
          ))}
        </select>
        <span className="relative min-w-0 flex-1">
          {c && <i className="pointer-events-none absolute start-2.5 top-1/2 size-2 -translate-y-1/2 rounded-[3px]" style={{ background: COLLECTION_COLORS[c.color] }} />}
          <select value={line.collectionId ?? ""} onChange={(e) => onChange({ collectionId: e.target.value || null })} className={cn("h-9 w-full rounded-full border border-line bg-surface-2 px-2.5 text-xs outline-none", c && "ps-6")} aria-label={t.barcode.list}>
            <option value="">{t.barcode.none}</option>
            {s.collections.filter((x) => !x.archived).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </span>
      </div>
    </div>
  );
}
