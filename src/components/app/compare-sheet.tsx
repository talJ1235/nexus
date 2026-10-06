"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Scale } from "lucide-react";
import { toast } from "@/lib/toast";
import { addSourceFromUrl } from "@/app/actions";
import { compareStart, compareVerify, type CompareResponse } from "@/app/compare-actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlays";
import { Spinner } from "@/components/ui/spinner";
import { StoreMark } from "@/components/ui/store-mark";
import { unitPrice } from "@/lib/calc";
import type { CompareResult } from "@/lib/compare";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ProductImage } from "./item-card";
import { useStore } from "./store";
import { useExtension } from "./use-extension";

type State = { step: "loading"; label: string } | { step: "setup" } | { step: "no_ai" } | { step: "ok"; results: CompareResult[]; at: number };

/** Compare one item across any store: search key → extension in the owner's browser → how-to. Never auto-adds. */
export function CompareSheet() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const ext = useExtension();
  const id = s.compareItemId;
  const item = id ? s.items.find((i) => i.id === id) : null;
  const [state, setState] = useState<State>({ step: "loading", label: "" });
  const [adding, setAdding] = useState<string | null>(null);

  const run = useCallback(
    async (refresh = false) => {
      if (!id) return;
      setState({ step: "loading", label: t.compare.searching });
      try {
        let r: CompareResponse = await compareStart({ itemId: id, currency: s.currency, refresh });
        if (r.status === "browser") {
          if (!ext.canSearch) return setState({ step: "setup" });
          const hits = await ext.search(r.queries);
          setState({ step: "loading", label: t.compare.reading });
          r = await compareVerify({ itemId: id, currency: s.currency, candidates: hits });
        }
        // Stores that block servers: read up to three of them in the owner's browser.
        if (r.status === "ok" && r.blocked.length && ext.available) {
          setState({ step: "loading", label: t.compare.reading });
          const payloads = (await Promise.all(r.blocked.slice(0, 3).map((u) => ext.resolve(u)))).filter(Boolean);
          if (payloads.length) r = await compareVerify({ itemId: id, currency: s.currency, payloads });
        }
        if (r.status === "ok") setState({ step: "ok", results: r.results, at: r.at });
        else if (r.status === "no_ai") setState({ step: "no_ai" });
        else setState({ step: "setup" });
      } catch {
        toast.error(t.errors.generic);
        setState({ step: "ok", results: [], at: Date.now() });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, s.currency, ext.canSearch, ext.available, t],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the async comparison
    if (id) void run(false);
  }, [id, run]);

  const add = async (r: CompareResult) => {
    if (!item) return;
    setAdding(r.url);
    try {
      const updated = await addSourceFromUrl(item.id, r.url);
      s.upsertItem(updated);
      toast.success(f(t.compare.added, { store: r.store }));
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setAdding(null);
    }
  };

  const now = item ? unitPrice(item, s.rates, s.currency) : null;
  const m = (v: number) => formatMoney(v, s.currency, locale);
  const have = new Set(item?.sources.map((x) => x.storeKey) ?? []);

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && s.setCompareItemId(null)} title={t.compare.title} className="sm:max-w-[480px]">
      {item && (
        <div className="flex h-full flex-col" data-compare>
          <div className="flex items-center gap-3 border-b border-line p-4" data-sheet-grip>
            <ProductImage src={item.imageUrl} alt="" className="size-14 shrink-0 rounded-[16px]" iconClass="size-5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-muted">{t.compare.title}</div>
              <div className="line-clamp-2 text-[15px] font-bold leading-snug bidi">{item.title}</div>
              {now != null && <div className="tabular text-xs text-muted">{f(t.compare.now, { amount: m(now) })}</div>}
            </div>
            <Button variant="ghost" size="icon" onClick={() => void run(true)} aria-label={t.compare.refresh} title={t.compare.refresh} disabled={state.step === "loading"}>
              <RefreshCw className={cn(state.step === "loading" && "animate-spin")} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {state.step === "loading" && (
              <div className="flex flex-col items-center gap-3 py-14 text-sm text-muted" role="status">
                <Spinner />
                <span className="shimmer-text font-semibold">{state.label}</span>
              </div>
            )}
            {state.step === "no_ai" && <p className="text-sm text-muted">{t.ai.noAi}</p>}
            {state.step === "setup" && (
              <div className="rounded-[22px] border border-line bg-surface-2 p-4 text-sm" data-compare-setup>
                <div className="mb-2 flex items-center gap-2 font-bold">
                  <Scale className="size-4" /> {t.compare.setupTitle}
                </div>
                <p className="text-muted">{t.compare.setupKey}</p>
              </div>
            )}
            {state.step === "ok" && (
              <>
                {state.results.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">{t.compare.none}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {state.results.map((r, i) => {
                      const save = now != null ? now - r.total : null;
                      return (
                        <li key={r.url} className="rise-in flex items-center gap-3 rounded-[22px] border border-line bg-surface p-3" style={{ animationDelay: `${i * 40}ms` }} data-compare-row>
                          <StoreMark store={r.store} storeKey={r.storeKey} url={r.url} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-bold">{r.store}</span>
                              {save != null && save > 0.5 && <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-bold text-ok">−{m(save)}</span>}
                            </div>
                            <div className="truncate text-xs text-muted bidi">{r.title}</div>
                            <div className="text-[11.5px] text-muted">{/instock/i.test(r.availability ?? "") ? t.compare.inStock : t.compare.shipUnknown}</div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="tabular text-[17px] font-extrabold">{m(r.total)}</span>
                            <div className="flex gap-1">
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="grid size-9 place-items-center rounded-full bg-surface-2 text-ink" aria-label={t.compare.open} title={t.compare.open}>
                                <ExternalLink className="size-4" />
                              </a>
                              <button
                                type="button"
                                disabled={have.has(r.storeKey) || adding === r.url}
                                onClick={() => void add(r)}
                                className="inline-flex h-9 items-center gap-1 rounded-full bg-brand px-3 text-xs font-bold text-on-brand disabled:opacity-50 max-sm:w-9 max-sm:justify-center max-sm:px-0"
                                aria-label={t.compare.add}
                                title={t.compare.add}
                                data-compare-add
                              >
                                {adding === r.url ? <Spinner /> : <Plus className="size-3.5" />}
                                <span className="max-sm:hidden">{have.has(r.storeKey) ? t.compare.addedShort : t.compare.add}</span>
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-3 text-center text-xs text-muted">{f(t.compare.checked, { time: new Date(state.at).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) })}</p>
              </>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
