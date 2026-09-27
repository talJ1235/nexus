"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Minus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { addSourceFromUrl, deleteItem, deleteSource, refetchSource, restoreItem, updateItem, updateSource } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button, Input, Label, Textarea } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { cheapestSource, activeSource, lineTotal, sourceTotal } from "@/lib/calc";
import { convert, formatMoney } from "@/lib/money";
import type { ItemWithSources, Source } from "@/lib/types";
import { cn, isHttpUrl } from "@/lib/utils";
import { PriceTag, ProductImage } from "./item-card";
import { AltLink, PriceHistory, ReceiptsSection, ShippingSection, StatusControl } from "./item-sheet-parts";
import { useStore } from "./store";
import { useExtension } from "./use-extension";
import { COLLECTION_COLORS } from "./view-items";

const SOURCE_CURRENCIES = ["ILS", "USD", "EUR", "GBP", "CNY"];

function NumberField({ value, onCommit, placeholder, className, ariaLabel }: { value: number | null; onCommit: (v: number | null) => void; placeholder?: string; className?: string; ariaLabel: string }) {
  return (
    <input
      key={value ?? "empty"}
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const next = raw === "" ? null : Math.max(0, Number(raw));
        if (next !== value && !Number.isNaN(next)) onCommit(next);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn("tabular h-8 w-24 rounded-md border border-line bg-bg px-2 text-sm outline-none focus:border-accent", className)}
    />
  );
}

function SourceRow({ item, source }: { item: ItemWithSources; source: Source }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const ext = useExtension();
  const cheapest = cheapestSource(item, s.rates);
  const active = activeSource(item, s.rates);
  const isCheapest = cheapest?.id === source.id && item.sources.length > 1;
  const isChosen = item.chosenSourceId === source.id;
  const total = sourceTotal(source);

  const patch = async (p: Parameters<typeof updateSource>[1]) => {
    s.upsertItem({ ...item, sources: item.sources.map((x) => (x.id === source.id ? { ...x, ...p } : x)) });
    try {
      s.upsertItem(await updateSource(source.id, p));
    } catch {
      toast.error(t.errors.generic);
    }
  };

  return (
    <li className={cn("rounded-xl border p-3 transition", active?.id === source.id ? "border-accent/60 bg-accent-soft/40" : "border-line bg-bg/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{source.store}</span>
            {isCheapest && <span className="rounded bg-accent px-1.5 py-px text-[11px] font-semibold text-accent-fg">{t.item.cheapest}</span>}
            {isChosen && <span className="rounded bg-fg px-1.5 py-px text-[11px] font-semibold text-bg">{t.item.chosen}</span>}
            {source.availability && /OutOfStock|Discontinued|SoldOut/i.test(source.availability) && <span className="rounded bg-danger-soft px-1.5 py-px text-[11px] text-danger">{source.availability}</span>}
          </div>
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-xs text-faint hover:text-accent-ink" dir="ltr">
            {source.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)}
          </a>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" title={t.item.openStore} aria-label={t.item.openStore}>
            <ExternalLink className="size-4" />
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const payload = ext.available ? await ext.resolve(source.url) : null;
                s.upsertItem(await refetchSource(source.id, payload));
              } catch {
                toast.error(t.errors.generic);
              } finally {
                setBusy(false);
              }
            }}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg disabled:opacity-50"
            title={t.item.refetch}
            aria-label={t.item.refetch}
          >
            <RefreshCw className={cn("size-4", busy && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={async () => {
              s.upsertItem({ ...item, sources: item.sources.filter((x) => x.id !== source.id) });
              s.upsertItem(await deleteSource(source.id));
            }}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
            title={t.item.removeSource}
            aria-label={t.item.removeSource}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <div className="mb-1 text-[11px] text-faint">{t.item.price}</div>
          <div className="flex">
            <NumberField value={source.price} onCommit={(v) => patch({ price: v })} ariaLabel={t.item.price} className="rounded-e-none" />
            <select
              value={source.currency}
              onChange={(e) => patch({ currency: e.target.value })}
              aria-label={t.item.currency}
              className="h-8 rounded-e-md border border-s-0 border-line bg-sunken px-1.5 text-xs outline-none focus:border-accent"
            >
              {Array.from(new Set([source.currency, ...SOURCE_CURRENCIES])).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-faint">{t.item.shipping}</div>
          <NumberField value={source.shipping} onCommit={(v) => patch({ shipping: v })} placeholder="?" ariaLabel={t.item.shipping} className="w-20" />
        </div>
        <div className="ms-auto text-end">
          <div className="mb-1 text-[11px] text-faint">{t.item.total}</div>
          <div className="tabular text-sm font-semibold">
            {total == null ? "—" : formatMoney(convert(total, source.currency, s.currency, s.rates), s.currency, locale)}
          </div>
        </div>
      </div>
      {!isChosen && item.sources.length > 1 && (
        <button
          type="button"
          onClick={async () => {
            s.upsertItem({ ...item, chosenSourceId: source.id });
            s.upsertItem(await updateItem(item.id, { chosenSourceId: source.id }));
          }}
          className="mt-2.5 text-xs font-medium text-accent-ink hover:underline"
        >
          {t.item.choose}
        </button>
      )}
    </li>
  );
}

function TagEditor({ item, onChange }: { item: ItemWithSources; onChange: (tags: string[]) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const tags = item.tags ?? [];
  const add = () => {
    const v = draft.trim().toLowerCase();
    setDraft("");
    if (v && !tags.includes(v)) onChange([...tags, v]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-sunken py-1 pe-1 ps-2 text-xs">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== tag))} className="rounded p-0.5 text-faint hover:text-fg" aria-label={`Remove ${tag}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={t.item.addTag}
        className="h-7 w-28 rounded-md border border-dashed border-line-strong bg-transparent px-2 text-xs outline-none focus:border-accent"
      />
    </div>
  );
}

export function ItemSheet() {
  const s = useStore();
  const { t, locale } = useI18n();
  const item = s.openItemId ? s.items.find((i) => i.id === s.openItemId) ?? null : null;
  const [newLink, setNewLink] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the add-link box when switching items
    setNewLink("");
  }, [s.openItemId]);

  const save = async (patch: Parameters<typeof updateItem>[1]) => {
    if (!item) return;
    s.upsertItem({ ...item, ...patch } as ItemWithSources);
    try {
      s.upsertItem(await updateItem(item.id, patch));
    } catch {
      s.upsertItem(item);
      toast.error(t.errors.generic);
    }
  };

  const remove = async () => {
    if (!item) return;
    s.openItem(null);
    s.removeItem(item.id);
    const snap = await deleteItem(item.id);
    toast(t.item.deleted, {
      description: item.title,
      action: snap ? { label: t.item.undo, onClick: async () => s.upsertItem(await restoreItem(snap)) } : undefined,
    });
  };

  const ext = useExtension();
  const [repairing, setRepairing] = useState(false);
  const total = item ? lineTotal(item, s.rates, s.currency) : null;
  const firstSource = item?.sources[0];
  const missing = !!item && !!firstSource && (!item.imageUrl || !firstSource.rawTitle || item.sources.every((x) => x.price == null));
  const repair = async () => {
    if (!item || !firstSource) return;
    setRepairing(true);
    try {
      const payload = ext.available ? await ext.resolve(firstSource.url) : null;
      const next = await refetchSource(firstSource.id, payload);
      s.upsertItem(next);
      toast.success(t.item.saved);
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setRepairing(false);
    }
  };

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && s.openItem(null)} title={item?.title ?? ""}>
      {item && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <StatusControl item={item} />
            <SheetClose className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </SheetClose>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="flex gap-4 p-4">
              <ProductImage src={item.imageUrl} alt={item.title} className="size-28 shrink-0 rounded-xl sm:size-32" />
              <div className="min-w-0 flex-1">
                <textarea
                  key={item.id + item.title}
                  defaultValue={item.title}
                  rows={1}
                  dir="auto"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== item.title) void save({ title: v });
                  }}
                  aria-label={t.item.title}
                  className="-mx-1.5 w-[calc(100%+12px)] field-sizing-content min-h-[2.5em] resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[17px] font-semibold leading-snug outline-none hover:border-line focus:border-accent"
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <PriceTag item={item} size="lg" />
                  {total != null && item.quantity > 1 && (
                    <span className="tabular text-sm text-muted">
                      {t.item.total} <b className="text-fg">{formatMoney(total, s.currency, locale)}</b>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {missing && (
              <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/60 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 text-accent-ink">{ext.available ? t.item.missingExt : t.item.missing}</span>
                <Button size="sm" variant="accent" onClick={repair} disabled={repairing}>
                  <RefreshCw className={cn(repairing && "animate-spin")} />
                  {t.item.refetch}
                </Button>
              </div>
            )}

            <AltLink item={item} />
            {item.status !== "to_buy" && <ShippingSection item={item} />}

            <div className="mt-4 grid grid-cols-2 gap-3 px-4">
              <div>
                <Label>{t.item.quantity}</Label>
                <div className="flex h-10 items-center rounded-lg border border-line-strong bg-bg">
                  <button type="button" onClick={() => item.quantity > 1 && save({ quantity: item.quantity - 1 })} className="grid h-full w-10 place-items-center text-muted hover:text-fg" aria-label="−">
                    <Minus className="size-4" />
                  </button>
                  <input
                    key={item.quantity}
                    type="number"
                    min={1}
                    defaultValue={item.quantity}
                    onBlur={(e) => {
                      const q = Math.max(1, Math.floor(Number(e.target.value) || 1));
                      if (q !== item.quantity) void save({ quantity: q });
                    }}
                    className="tabular h-full min-w-0 flex-1 bg-transparent text-center text-sm outline-none"
                    aria-label={t.item.quantity}
                  />
                  <button type="button" onClick={() => save({ quantity: item.quantity + 1 })} className="grid h-full w-10 place-items-center text-muted hover:text-fg" aria-label="+">
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>
              <div>
                <Label>{t.item.priority}</Label>
                <div className="grid h-10 grid-cols-3 rounded-lg border border-line-strong bg-bg p-0.5 text-[13px]">
                  {(["urgent", "normal", "someday"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => save({ priority: p })}
                      className={cn("rounded-md transition", item.priority === p ? (p === "urgent" ? "bg-danger text-white" : "bg-fg text-bg") : "text-muted hover:text-fg")}
                    >
                      {t.item[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <Label>{t.item.collection}</Label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => save({ collectionId: null })}
                    className={cn("h-8 rounded-lg border px-2.5 text-[13px] transition", !item.collectionId ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg")}
                  >
                    {t.item.none}
                  </button>
                  {s.collections
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => save({ collectionId: c.id })}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition",
                          item.collectionId === c.id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg",
                        )}
                      >
                        <span className={cn("size-2", c.kind === "project" ? "rounded-[2px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
                        {c.name}
                      </button>
                    ))}
                </div>
              </div>
            </div>

            <section className="mt-6 px-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">{t.item.sources}</h3>
                <span className="text-xs text-faint">{item.sources.length > 1 ? `${t.item.price} + ${t.item.shipping}` : ""}</span>
              </div>
              <ul className="space-y-2">
                {item.sources.map((src) => (
                  <SourceRow key={src.id} item={item} source={src} />
                ))}
              </ul>
              <form
                className="mt-2 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!isHttpUrl(newLink.trim())) return toast.error(t.add.invalidUrl);
                  setAdding(true);
                  try {
                    s.upsertItem(await addSourceFromUrl(item.id, newLink.trim()));
                    setNewLink("");
                  } catch {
                    toast.error(t.errors.generic);
                  } finally {
                    setAdding(false);
                  }
                }}
              >
                <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder={t.item.addSource} dir="ltr" className="h-9" />
                <Button type="submit" size="sm" variant="subtle" className="h-9" disabled={adding || !newLink.trim()}>
                  {adding ? <Loader2 className="animate-spin" /> : <Plus />}
                </Button>
              </form>
            </section>

            <PriceHistory item={item} />

            <section className="mt-6 space-y-4 px-4">
              <div>
                <Label>{t.item.tags}</Label>
                <TagEditor item={item} onChange={(tags) => save({ tags })} />
              </div>
              <div>
                <Label htmlFor="notes">{t.item.notes}</Label>
                <Textarea
                  id="notes"
                  key={item.id}
                  rows={4}
                  dir="auto"
                  defaultValue={item.notes ?? ""}
                  placeholder={t.item.notesPlaceholder}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (item.notes ?? null)) void save({ notes: v });
                  }}
                />
              </div>
            </section>

            <ReceiptsSection item={item} />

            <section className="mt-6 space-y-4 px-4">
              <details className="group rounded-lg border border-line px-3 py-2 text-sm">
                <summary className="cursor-pointer select-none text-muted">{t.item.edit}</summary>
                <div className="mt-3 grid gap-3 pb-1">
                  <div>
                    <Label>{t.item.brand}</Label>
                    <Input key={item.id + "b"} defaultValue={item.brand ?? ""} onBlur={(e) => (e.target.value.trim() || null) !== item.brand && save({ brand: e.target.value.trim() || null })} />
                  </div>
                  <div>
                    <Label>{t.item.image}</Label>
                    <Input key={item.id + "i"} dir="ltr" defaultValue={item.imageUrl ?? ""} onBlur={(e) => (e.target.value.trim() || null) !== item.imageUrl && save({ imageUrl: e.target.value.trim() || null })} />
                  </div>
                  <div className="text-xs text-faint">
                    {t.item.category}: {item.category ?? "—"}
                  </div>
                </div>
              </details>
            </section>

            <div className="mt-6 border-t border-line px-4 py-4">
              <Button variant="ghost" size="sm" onClick={remove} className="text-danger hover:bg-danger-soft hover:text-danger">
                <Trash2 />
                {t.item.delete}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
