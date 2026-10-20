"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Search, Sparkles, Tag } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { chooseSmProduct, smProductCandidates } from "@/app/supermarket-actions";
import { classifyLocal } from "@/lib/grocery/classify";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile } from "./art";
import { Money } from "./money";
import { asItem } from "./numbers";

// R19 C2 (board Match-phone) — "Which one?": the catalog's candidates for a row (photo, size, price at the store, deal,
// why — "your usual brand", "you have it on the list"), a catalog search, "Doesn't matter which" (the cheapest of the
// type at the store), "Remember" (on: next time the same name doesn't ask). Opens after an ambiguous add and from a row
// without a product ("Choose a product"); `openChoose(itemId)` from anywhere.

const EVENT = "nexus:sm-choose";
export function openChoose(itemId: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: itemId }));
}

type Data = Awaited<ReturnType<typeof smProductCandidates>>;
type Hit = Data["hits"][number];

const sizeLabel = (h: Pick<Hit, "qty" | "unit" | "weighted">, he: boolean) => {
  if (h.weighted) return he ? "לק״ג" : "per kg";
  if (h.qty == null || !h.unit) return "";
  const u: Record<string, [string, string]> = { g: ["גרם", "g"], kg: ["ק״ג", "kg"], ml: ["מ״ל", "ml"], l: ["ליטר", "L"], u: ["יח׳", "pcs"] };
  return `${h.qty} ${u[h.unit]?.[he ? 0 : 1] ?? h.unit}`;
};

const noSub = () => () => {};

export function ChooseProduct() {
  const [id, setId] = useState<string | null>(null);
  const hydrated = useSyncExternalStore(noSub, () => true, () => false);
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const { t } = useI18n();
  if (!hydrated) return null;
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && setId(null)} title={t.sm.match.titleShort} fit>
      {id && <ChooseBody itemId={id} onDone={() => setId(null)} />}
    </Sheet>
  );
}

function ChooseBody({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const he = locale === "he";
  const item = s.sm.find((x) => x.id === itemId);
  const [q, setQ] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => void smProductCandidates(itemId, q || undefined).then((d) => live && (setData(d), setPicked((p) => p ?? d.current ?? null)), () => live && setData({ hits: [], usual: null, chain: null, current: null })), first.current ? 0 : 200);
    first.current = false;
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [itemId, q]);
  const title = item?.title ?? "";
  const type = useMemo(() => classifyLocal(title).type, [title]);
  const prices = (data?.hits ?? []).map((h) => h.price).filter((p): p is number => p != null);
  const range = prices.length ? [Math.min(...prices), Math.max(...prices)] : null;
  const choose = async (pick: { gtin: string | null; anyType: string | null }) => {
    if (!item || busy) return;
    setBusy(true);
    try {
      const r = await chooseSmProduct(item.id, pick, remember);
      if (r) s.upsertSm([asItem({ ...item, ...r })]);
      onDone();
    } catch {
      toast.error(t.sm.sheet.failed);
    } finally {
      setBusy(false);
    }
  };
  const chosen = data?.hits.find((h) => h.gtin === picked);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-choose={itemId}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-1">
        <div className="flex items-baseline gap-2">
          <h2 className="bidi text-[19px] font-extrabold">{f(t.sm.match.title, { name: title })}</h2>
          <span className="text-[12.5px] text-muted">{t.sm.match.why}</span>
        </div>
        <label className="mb-2 mt-2.5 flex h-12 items-center gap-2.5 rounded-[14px] bg-surface-2 px-3.5">
          <Search className="size-[18px] shrink-0 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.sm.match.search} aria-label={t.sm.match.search} className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" data-choose-search />
        </label>
        <div className="flex flex-col gap-0.5" role="radiogroup" aria-label={t.sm.match.titleShort}>
          {!data && [0, 1, 2].map((k) => <div key={k} className="skeleton-in h-[64px] rounded-[14px] bg-surface-2" />)}
          {data && data.hits.length === 0 && <p className="rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] text-muted" data-choose-none>{t.sm.match.none}</p>}
          {data?.hits.map((h) => {
            const on = picked === h.gtin;
            const why = h.mine ? t.sm.match.whyMine : data.usual && `${h.brand ?? ""} ${h.name}`.includes(data.usual) ? t.sm.match.whyUsual : null;
            return (
              <button key={h.gtin} type="button" role="radio" aria-checked={on} onClick={() => setPicked(h.gtin)} className={cn("flex min-h-[64px] w-full items-center gap-3 rounded-[14px] px-2 py-1.5 text-start transition-colors duration-150", on ? "bg-surface-2 shadow-[inset_0_0_0_2px_var(--ink)]" : "active:bg-surface-2")} data-choose-option={h.gtin}>
                <ProductTile photo={h.imageUrl} section={h.section} size={44} />
                <span className="min-w-0 flex-1">
                  <b className="bidi block truncate text-[14.5px] font-bold">{h.short ?? h.name}</b>
                  <span className="bidi block truncate text-[12.5px] text-muted">{[h.brand, sizeLabel(h, he)].filter(Boolean).join(" · ")}</span>
                  {why && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11.5px] font-bold text-info">
                      <Sparkles className="size-3" />
                      {why}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end leading-tight">
                  {h.price != null ? <Money v={h.price} className="text-[15px] font-extrabold" /> : <span className="text-[12px] font-semibold text-muted">{t.sm.match.notThere}</span>}
                  {h.deals > 0 && (
                    <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-bold text-[var(--deal)]">
                      <Tag className="size-3" />
                      {t.sm.match.deal}
                    </span>
                  )}
                </span>
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-ink bg-ink text-bg" : "border-line-strong")} aria-hidden>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
        {type && (
          <button type="button" onClick={() => void choose({ gtin: null, anyType: type })} disabled={busy} className="mt-1 flex min-h-[56px] w-full items-center gap-3 rounded-[14px] px-2 text-start active:bg-surface-2" data-choose-any>
            <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-surface-2 text-muted">
              <Sparkles className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[14.5px] font-bold">{t.sm.match.any}</b>
              <span className="bidi block truncate text-[12.5px] text-muted">
                {range ? f(t.sm.match.anySubRange, { lo: `₪${range[0].toFixed(2)}`, hi: `₪${range[1].toFixed(2)}` }) : t.sm.match.anySub}
              </span>
            </span>
          </button>
        )}
        <label className="mx-1 mb-2 mt-3 flex items-center gap-2.5 text-[13.5px] text-ink/80">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-5 accent-[var(--ink)]" data-choose-remember />
          <span className="bidi">{f(t.sm.match.remember, { name: title })}</span>
        </label>
      </div>
      <div className="px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-1">
        <button type="button" disabled={!picked || busy} onClick={() => picked && void choose({ gtin: picked, anyType: null })} className="h-[52px] w-full rounded-[16px] bg-ink text-[15px] font-extrabold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-40" data-choose-go>
          <span className="bidi">{chosen ? f(t.sm.match.add, { name: chosen.short ?? chosen.name }) : t.sm.match.pick}</span>
        </button>
      </div>
    </div>
  );
}
