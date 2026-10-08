"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, ChevronDown, ClipboardList, ExternalLink, Inbox, LineChart, Minus, NotebookPen, Plus, RefreshCw, Store, Trash2, X, Scale, Ellipsis, FolderInput, Link2, CheckSquare } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { addSourceFromUrl, deleteItem, deleteSource, refetchSource, restoreItem, splitItem, unsplitItem, updateItem, updateSource } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button, Input, Label, Textarea } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Sheet, SheetClose } from "@/components/ui/overlays";
import { openItemActions, StatusIcon, statusActs, useActionLabels, useItemActions } from "./quick-actions";
import { cheapestSource, activeSource, lineTotal, sourceTotal } from "@/lib/calc";
import { convert, formatMoney } from "@/lib/money";
import type { ItemWithSources, Source } from "@/lib/types";
import { cn, isHttpUrl } from "@/lib/utils";
import { PriceTag, morphClose } from "./item-card";
import { useSaveItem, useSaveSource } from "./conflicts";
import { AltLink, FindIt, Group, LowestBadge, PriceHistory, PriceWatch, ReceiptsSection, Row, ShippingSection, StatusControl } from "./item-sheet-parts";
import { StoreMark } from "@/components/ui/store-mark";
import { SheetPicture } from "./sheet-picture";
import { useStore, useOpenItemId } from "./store";
import { useReadOnly } from "./offline-banner";
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

  const saveSource = useSaveSource();
  const patch = (p: Parameters<typeof updateSource>[1]) => saveSource(item, source, p);

  return (
    <li className={cn("rounded-xl border p-3 transition", active?.id === source.id ? "border-accent/60 bg-accent-soft/40" : "border-line bg-bg/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {source.url && <StoreMark store={source.store} storeKey={source.storeKey} url={source.url} size={20} />}
            <span className="font-medium">{source.store}</span>
            {isCheapest && <span className="rounded bg-accent px-1.5 py-px text-[11px] font-semibold text-accent-fg">{t.item.cheapest}</span>}
            {isChosen && <span className="rounded bg-fg px-1.5 py-px text-[11px] font-semibold text-bg">{t.item.chosen}</span>}
            {source.availability && /OutOfStock|Discontinued|SoldOut/i.test(source.availability) && <span className="rounded bg-danger-soft px-1.5 py-px text-[11px] text-danger">{source.availability}</span>}
          </div>
          {source.url ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-xs text-faint hover:text-accent-ink" dir="ltr">
              {source.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)}
            </a>
          ) : (
            <span className="mt-0.5 block text-xs text-faint">{t.item.manualPrice}</span>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
          {source.url && (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" title={t.item.openStore} aria-label={t.item.openStore}>
            <ExternalLink className="size-4" />
          </a>
          )}
          {source.url && (
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
            {busy ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
          </button>
          )}
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

/** Project/list picker. With more than one unit, the user chooses how many move (the rest stay). */
function CollectionPicker({ item, save }: { item: ItemWithSources; save: (p: Parameters<typeof updateItem>[1]) => Promise<void> }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [draft, setDraft] = useState<{ target: string | null; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = item.collectionId ? s.collections.find((c) => c.id === item.collectionId) : null;
  const options = s.collections.filter((c) => !c.archived);
  const nameOf = (id: string | null) => (id ? (s.collections.find((c) => c.id === id)?.name ?? "—") : t.nav.unsorted);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a pending split belongs to the item it was started on
    setDraft(null);
  }, [item.id]);

  const pick = (target: string | null) => {
    if (target === item.collectionId) return setDraft(null);
    if (item.quantity > 1) setDraft({ target, n: item.quantity });
    else void save({ collectionId: target });
  };

  const commit = async () => {
    if (!draft) return;
    if (draft.n >= item.quantity) {
      setDraft(null);
      return void save({ collectionId: draft.target });
    }
    setBusy(true);
    try {
      const { original, moved } = await splitItem(item.id, draft.n, draft.target);
      s.upsertItems([moved, original]);
      s.markFresh(moved.id);
      setDraft(null);
      toast.success(f(t.item.splitDone, { n: draft.n, name: nameOf(draft.target) }), {
        action: {
          label: t.item.undo,
          onClick: async () => {
            s.removeItem(moved.id);
            s.upsertItem(await unsplitItem(original.id, moved.id));
          },
        },
      });
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row label={t.item.collection}>
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 min-w-0 max-w-[60%] items-center gap-2 rounded-lg border border-line-strong bg-bg px-3 text-[13.5px] transition hover:border-faint data-[state=open]:border-accent"
            >
              {current ? (
                <span className={cn("size-2.5 shrink-0", current.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[current.color] }} />
              ) : (
                <Inbox className="size-3.5 shrink-0 text-faint" />
              )}
              <span className={cn("bidi min-w-0 truncate", !current && "text-muted")}>{current?.name ?? t.item.none}</span>
              <ChevronDown className="size-3.5 shrink-0 text-faint" />
            </button>
          </MenuTrigger>
          <MenuContent align="end" className="max-h-80 min-w-56 overflow-y-auto">
            <MenuRadioGroup value={item.collectionId ?? ""} onValueChange={(v) => pick(v || null)}>
              <MenuRadioItem value="">{t.item.none}</MenuRadioItem>
              {options.map((c) => (
                <MenuRadioItem key={c.id} value={c.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("size-2.5 shrink-0", c.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
                    <span className="bidi truncate">{c.name}</span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </Row>
      {draft && (
        <div className="animate-pop-in border-t border-line/70 bg-accent-soft/40 px-4 py-3">
          <p className="text-[13px] text-fg">{f(t.item.moveHowMany, { name: nameOf(draft.target) })}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Stepper value={draft.n} min={1} max={item.quantity} onChange={(n) => setDraft({ ...draft, n })} label={t.item.quantity} />
            <span className="text-[13px] text-muted">{f(t.item.ofUnits, { n: item.quantity })}</span>
            {draft.n < item.quantity && (
              <button type="button" onClick={() => setDraft({ ...draft, n: item.quantity })} className="text-xs font-medium text-accent-ink hover:underline">
                {t.item.moveAll}
              </button>
            )}
            <div className="ms-auto flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                {t.item.cancel}
              </Button>
              <Button size="sm" variant="accent" onClick={() => void commit()} disabled={busy}>
                {busy ? <Spinner /> : <ArrowRightLeft />}
                {draft.n < item.quantity ? f(t.item.moveN, { n: draft.n }) : t.item.moveAll}
              </Button>
            </div>
          </div>
          {draft.n < item.quantity && <p className="mt-2 text-xs text-muted">{f(t.item.splitHint, { n: item.quantity - draft.n })}</p>}
        </div>
      )}
    </>
  );
}

/** Compact − n + stepper. */
function Stepper({ value, onChange, min = 1, max = 100000, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="flex h-9 items-center rounded-lg border border-line-strong bg-bg">
      <button type="button" onClick={() => value > min && onChange(value - 1)} disabled={value <= min} className="grid h-full w-9 place-items-center text-muted transition hover:text-fg disabled:opacity-35" aria-label="−">
        <Minus className="size-3.5" />
      </button>
      <input
        key={value}
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        onBlur={(e) => {
          const q = Math.min(max, Math.max(min, Math.floor(Number(e.target.value) || min)));
          if (q !== value) onChange(q);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="tabular h-full w-10 bg-transparent text-center text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={label}
      />
      <button type="button" onClick={() => value < max && onChange(value + 1)} disabled={value >= max} className="grid h-full w-9 place-items-center text-muted transition hover:text-fg disabled:opacity-35" aria-label="+">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export function ItemSheet() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const openItemId = useOpenItemId();
  const item = openItemId ? s.items.find((i) => i.id === openItemId) ?? null : null;
  const [newLink, setNewLink] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the add-link box when switching items
    setNewLink("");
  }, [openItemId]);

  // R16 B3: saves carry the base they started from (conflict → roll back + "Noa changed this…").
  const saveItem = useSaveItem();
  const save = async (patch: Parameters<typeof updateItem>[1]) => {
    if (item) await saveItem(item, patch);
  };

  const remove = async () => {
    if (!item) return;
    s.openItem(null);
    s.removeItem(item.id);
    const req = deleteItem(item.id);
    const id = toast(t.item.deleted, {
      description: item.title,
      action: {
        label: t.item.undo,
        onClick: async () => {
          const snap = await req.catch(() => null);
          if (snap) s.upsertItem(await restoreItem(snap));
        },
      },
    });
    try {
      await req;
    } catch {
      s.upsertItem(item);
      toast.error(t.errors.generic, { id });
    }
  };

  const ext = useExtension();
  const [repairing, setRepairing] = useState(false);
  const total = item ? lineTotal(item, s.rates, s.currency) : null;
  const firstSource = item?.sources[0];
  const active = item ? activeSource(item, s.rates) : null;
  const missing = !!item && !!firstSource?.url && (!item.imageUrl || !firstSource.rawTitle || item.sources.every((x) => x.price == null));
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
  const hasLink = !!item?.sources.some((x) => x.url);
  const ro = useReadOnly();
  // The hero paints with the opening animation; the longer sections follow a frame later (a smooth open on phones).
  const [deepFor, setDeepFor] = useState<string | null>(null);
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!itemId) return;
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setDeepFor(itemId))));
    return () => cancelAnimationFrame(raf);
  }, [itemId]);
  const deep = deepFor === itemId;

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && morphClose(openItemId, () => s.openItem(null))} title={item?.title ?? ""} className="bg-bg">
      {item && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2.5" data-sheet-grip>
            <fieldset disabled={ro.ro} title={ro.title} className="m-0 min-w-0 border-0 p-0">
              <StatusControl item={item} />
            </fieldset>
            <div className="flex items-center gap-1">
              <SheetMoreMenu item={item} onDelete={() => void remove()} />
              <SheetClose className="hit grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" aria-label="Close" data-sheet-close>
                <X className="size-4" />
              </SheetClose>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Offline: every field reads, nothing edits (links still open). */}
            <fieldset disabled={ro.ro} title={ro.title} data-sheet-fields className="m-0 min-w-0 border-0 p-0">
            {/* Hero: what it is and what it costs. */}
            <div className="border-b border-line bg-surface px-5 pb-5 pt-4">
              <div className="flex gap-4">
                <SheetPicture item={item} />
                <div className="min-w-0 flex-1">
                  <textarea
                    key={item.id + item.title}
                    defaultValue={item.title}
                    rows={1}
                    data-big
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== item.title) void save({ title: v });
                    }}
                    aria-label={t.item.title}
                    className="bidi -mx-1.5 w-[calc(100%+12px)] field-sizing-content min-h-[2.4em] resize-none rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[17px] font-semibold leading-snug outline-none hover:border-line focus:border-accent"
                  />
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
                    {active?.store && <span>{active.store}</span>}
                    {item.brand && (
                      <>
                        <span className="text-faint">·</span>
                        <span className="bidi">{item.brand}</span>
                      </>
                    )}
                    {item.addedByName && (
                      <>
                        <span className="text-faint">·</span>
                        <span>{f(t.share.addedBy, { name: item.addedByName })}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <PriceTag item={item} size="lg" />
                    {total != null && item.quantity > 1 && (
                      <span className="tabular text-sm text-muted">
                        ×{item.quantity} = <b className="font-semibold text-fg">{formatMoney(total, s.currency, locale)}</b>
                      </span>
                    )}
                    {item.status === "to_buy" && s.offlineAt == null && (
                      <button
                        type="button"
                        onClick={() => s.setCompareItemId(item.id)}
                        className="ask-hairline ms-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"
                        data-compare-open
                      >
                        <Scale className="size-3.5" />
                        {t.compare.button}
                      </button>
                    )}
                    {active?.url && (
                      <a
                        href={active.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] font-medium text-fg transition hover:bg-sunken", item.status !== "to_buy" && "ms-auto")}
                      >
                        <ExternalLink className="size-3.5" />
                        {t.item.openStore}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {missing && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/60 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 text-accent-ink">{ext.available ? t.item.missingExt : t.item.missing}</span>
                  <Button size="sm" variant="accent" onClick={repair} disabled={repairing}>
                    {repairing ? <Spinner /> : <RefreshCw />}
                    {t.item.refetch}
                  </Button>
                </div>
              )}
              <AltLink item={item} />
            </div>

            {!deep ? (
              <div className="space-y-3 p-4" aria-hidden>
                <div className="skeleton h-28 rounded-[22px]" />
                <div className="skeleton h-40 rounded-[22px]" />
              </div>
            ) : (
            <div className="space-y-3 p-4">
              {item.status !== "to_buy" && <ShippingSection item={item} />}

              <Group title={t.item.plan} icon={ClipboardList}>
                <Row label={t.item.quantity}>
                  <Stepper value={item.quantity} onChange={(q) => void save({ quantity: q })} label={t.item.quantity} />
                </Row>
                <Row label={t.item.priority}>
                  <div role="radiogroup" aria-label={t.item.priority} className="grid h-9 grid-cols-3 rounded-lg border border-line-strong bg-bg p-0.5 text-[13px]">
                    {(["urgent", "normal", "someday"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={item.priority === p}
                        onClick={() => save({ priority: p })}
                        className={cn("hit rounded-md px-2.5 transition", item.priority === p ? (p === "urgent" ? "bg-danger text-white" : "bg-fg text-bg") : "text-muted hover:text-fg")}
                      >
                        {t.item[p]}
                      </button>
                    ))}
                  </div>
                </Row>
                <CollectionPicker item={item} save={save} />
              </Group>

              {!hasLink && item.status === "to_buy" && <FindIt query={item.searchQuery || item.title} />}

              <Group title={t.item.sources} icon={Store} aside={item.sources.length > 1 ? <span className="text-xs text-faint">{`${t.item.price} + ${t.item.shipping}`}</span> : null}>
                <div className="px-3 pb-3">
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
                    <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder={t.item.addSource} dir="ltr" className="h-9 border-dashed" />
                    <Button type="submit" size="sm" variant="subtle" className="h-9" disabled={adding || !newLink.trim()} aria-label={t.item.addSource}>
                      {adding ? <Spinner /> : <Plus />}
                    </Button>
                  </form>
                </div>
              </Group>

              <Group title={t.history.title} icon={LineChart} aside={<LowestBadge item={item} />}>
                <PriceHistory item={item} />
                {item.status === "to_buy" && hasLink && <PriceWatch item={item} save={save} />}
              </Group>

              <Group title={t.item.details} icon={NotebookPen}>
                <div className="space-y-3 px-4 pb-4">
                  <TagEditor item={item} onChange={(tags) => save({ tags })} />
                  <Textarea
                    id="notes"
                    key={item.id}
                    rows={3}
                    defaultValue={item.notes ?? ""}
                    placeholder={t.item.notesPlaceholder}
                    aria-label={t.item.notes}
                    className="bidi field-sizing-content min-h-20 resize-none bg-sunken/50"
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== (item.notes ?? null)) void save({ notes: v });
                    }}
                  />
                </div>
              </Group>

              <ReceiptsSection item={item} />

              <details className="group rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
                <summary className="flex cursor-pointer select-none items-center justify-between text-muted">
                  {t.item.edit}
                  <ChevronDown className="size-4 transition group-open:rotate-180" />
                </summary>
                <div className="mt-3 grid gap-3 pb-1">
                  <div>
                    <Label>{t.item.brand}</Label>
                    <Input key={item.id + "b"} className="bidi" defaultValue={item.brand ?? ""} onBlur={(e) => (e.target.value.trim() || null) !== item.brand && save({ brand: e.target.value.trim() || null })} />
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

              <div className="flex justify-center pb-4 pt-2">
                <Button variant="ghost" size="sm" onClick={remove} className="text-danger hover:bg-danger-soft hover:text-danger">
                  <Trash2 />
                  {t.item.delete}
                </Button>
              </div>
            </div>
            )}
            </fieldset>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The sheet's "…" menu (Round 11 C1): the same quick actions as the long-press sheet / right-click menu. */
function SheetMoreMenu({ item, onDelete }: { item: ItemWithSources; onDelete: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  const ro = useReadOnly();
  const acts = useItemActions();
  const labels = useActionLabels();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="hit grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" aria-label={t.quick.more} title={t.quick.more} data-sheet-more>
          <Ellipsis className="size-4" />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        {statusActs(item.status).map((x) => (
          <MenuItem key={x} disabled={ro.ro} onSelect={() => void acts.setStatus([item], x)}>
            <StatusIcon status={x} /> {labels.status(x)}
          </MenuItem>
        ))}
        <MenuItem disabled={ro.ro} onSelect={() => openItemActions([item.id], "move")} data-sheet-move>
          <FolderInput /> {t.quick.move}
        </MenuItem>
        <MenuItem onSelect={() => void acts.copyLink(item)}>
          <Link2 /> {t.quick.copyLink}
        </MenuItem>
        {!s.selected.has(item.id) && (
          <MenuItem
            onSelect={() => {
              s.openItem(null);
              acts.select(item);
            }}
          >
            <CheckSquare /> {t.select.select}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem danger disabled={ro.ro} onSelect={onDelete} data-sheet-delete>
          <Trash2 /> {t.quick.delete}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
