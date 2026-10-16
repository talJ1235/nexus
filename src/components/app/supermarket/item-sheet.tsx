"use client";

import "./sm.css";
import { useEffect, useRef, useState } from "react";
import { Ban, Camera, CalendarDays, Clock, Link2, MapPin, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlays";
import { Spinner } from "@/components/ui/spinner";
import { acceptSuggestions, dismissSuggestion, hideProduct, removeSmItem, restoreSmItem, smItemDetail, unhideProduct, updateSmItem } from "@/app/supermarket-actions";
import { setItemPicture } from "@/app/picture-actions";
import { SECTION_KEYS, sectionName } from "@/lib/grocery/sections";
import type { Knowledge } from "@/lib/grocery/staples";
import { unitKgFor } from "@/lib/grocery/weights";
import { announceAdded, useAddedLine, type Added } from "./added";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { photoToDataUrl } from "../use-camera";
import { ProductTile, SectionIcon } from "./art";
import { patchSmHome, useSmHome, type SmHome } from "./data";
import { asItem, storeLabel } from "./numbers";
import { QtySteppers, type Measure } from "./qty-steppers";
import { qtyLabel } from "./qty";

// R18 S2 C2 — the supermarket item sheet (board ItemSheet-phone): count + weight, note, a photo of the exact product,
// section, "What Nexus learned" (new / learning 2 of 3 / regular with its timeline and next date / occasional with its
// context / hidden + "Suggest it again"), "Don't suggest this again", preferred brand + substitutes, one store only,
// history (date, store, price, cheapest). Viewers read only. Edits save as they happen (no Save button).

type Detail = Awaited<ReturnType<typeof smItemDetail>>;

export function SmItemSheet({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  const item = itemId ? s.sm.find((i) => i.id === itemId) ?? null : null;
  // The row can leave the list under the sheet (bought, removed by someone): the sheet closes.
  useEffect(() => {
    if (itemId && !item) onClose();
  }, [itemId, item, onClose]);
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()} title={item?.title ?? t.sm.sheet.title} className="desk:max-w-[440px]">
      {item && <Body key={item.id} item={item} onClose={onClose} />}
    </Sheet>
  );
}

function Body({ item, onClose }: { item: ItemWithSources; onClose: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const ro = s.space?.role === "viewer" || s.offlineAt != null;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [hiddenNow, setHiddenNow] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void smItemDetail(item.id).then((d) => live && setDetail(d), () => {});
    return () => {
      live = false;
    };
  }, [item.id]);
  const save = async (patch: Parameters<typeof updateSmItem>[1], optimistic?: Partial<ItemWithSources>) => {
    if (optimistic) s.upsertSm([{ ...item, ...optimistic }]);
    try {
      const r = await updateSmItem(item.id, patch);
      if (r) s.upsertSm([asItem(r)]);
    } catch {
      s.upsertSm([item]);
      toast.error(t.sm.sheet.failed);
    }
  };
  const unitKg = unitKgFor(item.productKey, home?.unitKg);
  const m: Measure = { quantity: item.quantity, count: item.count ?? null, amount: item.amount, unit: item.unit };
  const knowledge: Knowledge | null = detail ? (hiddenNow == null ? detail.knowledge : hiddenNow ? { state: "hidden" } : detail.knowledge.state === "hidden" ? { state: "new", count: 0 } : detail.knowledge) : null;
  const hidden = knowledge?.state === "hidden";
  const key = item.productKey;
  const setHidden = async (h: boolean) => {
    if (!key) return;
    setHiddenNow(h);
    try {
      await (h ? hideProduct(key) : unhideProduct(key));
      if (h && home) patchSmHome(s.spaceId || "-", (x) => ({ ...x, suggestions: x.suggestions.filter((y) => y.productKey !== key) }));
      toast(f(h ? t.sm.sheet.hidden : t.sm.sheet.unhidden, { title: item.title }), { action: { label: t.sm.sheet.undo, onClick: () => void setHidden(!h) } });
    } catch {
      setHiddenNow(!h);
      toast.error(t.sm.sheet.failed);
    }
  };
  const label = "mb-1.5 flex items-baseline justify-between gap-2 text-[13.5px] font-bold";
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-sm-sheet={item.id}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        <div className="flex items-center gap-3.5">
          <ProductTile art={item.artKey} section={item.section} photo={item.imageUrl} size={64} />
          <div className="min-w-0 flex-1">
            {ro ? (
              <h2 className="bidi text-[21px] font-extrabold leading-tight">{item.title}</h2>
            ) : (
              <input
                defaultValue={item.title}
                aria-label={t.sm.sheet.rename}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== item.title) void save({ title: v }, { title: v });
                }}
                className="bidi w-full rounded-[8px] bg-transparent text-[21px] font-extrabold leading-tight outline-none focus:bg-surface-2"
                data-sheet-title
              />
            )}
            {/* R18 S5 A3: the section chip and the brand to buy (the usual one from history, S4 F3) side by side. */}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <SectionPicker value={item.section ?? "other"} disabled={ro} onPick={(k) => void save({ section: k }, { section: k })} />
              {(item.preferBrand || detail?.brand) && (
                <span className="mt-1.5 inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--spark)_12%,var(--surface))] px-3 text-[13px] font-semibold" data-sheet-brand-chip>
                  <span className="text-muted">{t.sm.sheet.usualShort}</span>
                  <b className="bidi truncate font-bold">{item.preferBrand ?? detail?.brand?.brand}</b>
                </span>
              )}
            </div>
          </div>
        </div>
        {ro && <p className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] text-muted" data-sheet-viewer>{t.sm.sheet.viewOnly}</p>}

        <div className="mt-5">
          {ro ? null : (
            <QtySteppers
              value={m}
              unitKg={unitKg}
              title={item.title}
              learned={!!(key && home?.unitKg[key])}
              onChange={(n) => void save({ quantity: n.quantity, count: n.count, amount: n.amount, unit: (n.unit as "kg" | "g" | "l" | null) ?? null }, { quantity: n.quantity, count: n.count, amount: n.amount, unit: n.unit as ItemWithSources["unit"] })}
            />
          )}
        </div>

        <label className="mt-5 block">
          <span className={label}>{t.sm.sheet.note}</span>
          <textarea
            defaultValue={item.notes ?? ""}
            readOnly={ro}
            rows={2}
            placeholder={ro ? "" : t.sm.sheet.notePh}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (item.notes ?? null)) void save({ notes: v }, { notes: v });
            }}
            className="bidi w-full resize-none rounded-[14px] border border-line-strong bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-ink"
            data-sheet-note
          />
        </label>

        <PhotoRow item={item} ro={ro} />

        <div className="mt-5">
          <span className={label}>{t.sm.sheet.learned}</span>
          {knowledge ? <Learned k={knowledge} onAgain={ro ? undefined : () => void setHidden(false)} /> : <div className="grid h-20 place-items-center rounded-[16px] border border-line"><Spinner className="size-4" /></div>}
          {!ro && key && !hidden && (
            <button type="button" className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-strong text-[14.5px] font-bold text-muted transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]" onClick={() => void setHidden(true)} data-sheet-hide>
              <Ban className="size-[18px]" />
              {t.sm.sheet.dontSuggest}
            </button>
          )}
        </div>

        <Brands item={item} ro={ro} usual={detail?.brand ?? null} onSave={(p, o) => void save(p, o)} />

        <div className="mt-5">
          <span className={label}>{t.sm.sheet.store}</span>
          <label className="flex min-h-14 items-center gap-3 rounded-[16px] border border-line-strong bg-surface px-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted">
              <MapPin className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[15px] font-bold">{t.sm.sheet.onlyOne}</b>
              <span className="bidi block truncate text-[12.5px] text-muted">{item.pinnedStore ?? t.sm.sheet.anyStore}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              disabled={ro}
              checked={!!item.pinnedStore}
              onChange={(e) => {
                const v = e.target.checked ? storeLabel(home?.store?.chain, home?.store?.branch, locale)?.replace(/[⁨⁩]/g, "") ?? null : null;
                void save({ pinnedStore: v }, { pinnedStore: v });
              }}
              className="gro-switch"
              data-sheet-pin
            />
          </label>
        </div>

        <History detail={detail} />
      </div>
      {!ro && (
        // R18 S5 A3 (board List-phone sheet): Done wide, Delete a round button beside it (5 s to Undo, like a swipe).
        <div className="flex items-center gap-2.5 border-t border-line px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
          <button type="button" className="h-12 flex-1 rounded-full bg-ink text-[15px] font-bold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]" onClick={onClose} data-sheet-done>
            {t.sm.sheet.done}
          </button>
          <button
            type="button"
            className="grid size-12 shrink-0 place-items-center rounded-full border border-line-strong text-danger transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.94]"
            aria-label={t.sm.sheet.remove}
            title={t.sm.sheet.remove}
            onClick={async () => {
              onClose();
              s.removeSm(item.id);
              try {
                await removeSmItem(item.id);
                toast(f(t.sm.sheet.removed, { title: item.title }), {
                  duration: 5000,
                  action: { label: t.sm.add.undo, onClick: () => void restoreSmItem(item.id).then((r) => r && s.upsertSm([asItem(r)]), () => toast.error(t.sm.sheet.failed)) },
                });
              } catch {
                s.upsertSm([item]);
                toast.error(t.sm.sheet.failed);
              }
            }}
            data-sheet-remove
          >
            <Trash2 className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function SectionPicker({ value, disabled, onPick }: { value: string; disabled: boolean; onPick: (k: string) => void }) {
  const { t, locale } = useI18n();
  const name = value === "other" ? t.sm.main.other : sectionName(value, locale);
  const chip = (
    <span className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong pe-3 ps-1 text-[13.5px] font-bold">
      <SectionIcon section={value} size={26} />
      {name}
    </span>
  );
  if (disabled) return chip;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label={`${t.sm.sheet.section}: ${name}`} data-sheet-section>
          {chip}
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="max-h-[50vh] overflow-y-auto">
        {SECTION_KEYS.map((k) => (
          <MenuItem key={k} onSelect={() => onPick(k)} data-sheet-section-pick={k}>
            <SectionIcon section={k} size={22} />
            {sectionName(k, locale)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function PhotoRow({ item, ro }: { item: ItemWithSources; ro: boolean }) {
  const s = useStore();
  const { t } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const set = async (url: string | null) => {
    setBusy(true);
    try {
      const r = await setItemPicture({ itemId: item.id, url, source: "photo" });
      if (r) s.upsertSm([{ ...item, imageUrl: r.imageUrl }]);
    } catch {
      toast.error(t.sm.sheet.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5">
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[13.5px] font-bold">
        {t.sm.sheet.photo}
        <small className="text-[12.5px] font-medium text-muted">{t.sm.sheet.optional}</small>
      </span>
      <div className="flex items-center gap-3">
        <ProductTile art={item.artKey} section={item.section} photo={item.imageUrl} size={72} />
        <span className="min-w-0 flex-1">
          <b className="block text-[14.5px] font-bold">{item.imageUrl ? t.sm.sheet.photoYours : t.sm.sheet.photoNone}</b>
          <span className="block text-[13px] text-muted">{t.sm.sheet.photoSub}</span>
        </span>
        {!ro &&
          (busy ? (
            <Spinner className="size-5" />
          ) : (
            <>
              {item.imageUrl && (
                <button type="button" className="grid size-10 place-items-center rounded-full text-muted" aria-label={t.sm.sheet.photoRemove} onClick={() => void set(null)}>
                  <X className="size-[18px]" />
                </button>
              )}
              <button type="button" className="grid size-10 place-items-center rounded-full text-ink" aria-label={t.sm.sheet.photoTake} onClick={() => file.current?.click()} data-sheet-photo>
                <Camera className="size-5" />
              </button>
            </>
          ))}
        <input
          ref={file}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void set(await photoToDataUrl(f, 480, 0.8));
          }}
        />
      </div>
    </div>
  );
}

/** "What Nexus learned": never a staple state, only what it saw (board ItemSheet-phone, the five tweaks). */
function Learned({ k, onAgain }: { k: Knowledge; onAgain?: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const box = "rounded-[16px] border border-line bg-surface-2 p-3.5";
  const fmtDay = (d: string) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  if (k.state === "hidden")
    return (
      <div className={box} data-learned="hidden">
        <b className="block text-[15px] font-extrabold">{t.sm.sheet.hiddenTitle}</b>
        <span className="block text-[13px] text-muted">{t.sm.sheet.hiddenSub}</span>
        {onAgain && (
          <button type="button" className="mt-2.5 h-10 rounded-[12px] bg-ink px-3.5 text-[14px] font-bold text-bg" onClick={onAgain} data-sheet-unhide>
            {t.sm.sheet.suggestAgain}
          </button>
        )}
      </div>
    );
  if (k.state === "new")
    return (
      <div className={box} data-learned="new">
        <b className="block text-[15px] font-extrabold">{t.sm.sheet.newTitle}</b>
        <span className="block text-[13px] text-muted">{t.sm.sheet.newSub}</span>
      </div>
    );
  if (k.state === "learning")
    return (
      <div className={box} data-learned="learning">
        <b className="block text-[15px] font-extrabold">{t.sm.sheet.learningTitle}</b>
        <span className="block text-[13px] text-muted">{f(t.sm.sheet.learningSub, { n: k.count, of: k.of })}</span>
        <Dots days={k.count} of={k.of} />
      </div>
    );
  if (k.state === "regular") {
    const month = k.since ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${k.since}T12:00:00Z`)) : "";
    const next = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", day: "numeric", month: "numeric", timeZone: s.clock.tz }).format(new Date(k.next));
    return (
      <div className={box} data-learned="regular">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <b className="text-[16px] font-extrabold">{k.intervalDays >= 14 ? f(t.sm.sheet.everyWeeks, { n: Math.round(k.intervalDays / 7) }) : f(t.sm.sheet.everyDays, { n: k.intervalDays })}</b>
          <span className="text-[13px] text-muted">{f(t.sm.sheet.purchasesSince, { n: k.count, month })}</span>
        </p>
        <div className="mt-3 flex items-center" aria-hidden>
          {k.days.slice(-6).map((d, i) => (
            <span key={d} className={cn("flex items-center", i > 0 && "flex-1")} title={fmtDay(d)}>
              {i > 0 && <i className="h-px flex-1 bg-line-strong" />}
              <i className="size-3 shrink-0 rounded-full bg-ink" />
            </span>
          ))}
          <i className="h-px w-6 bg-line-strong" />
          <i className="h-4 w-px bg-ink" />
          <i className="h-px w-4 bg-line-strong" />
          <i className="size-3.5 shrink-0 rounded-full border-2 border-dashed border-spark" />
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-muted">
          <Clock className="size-3.5 text-spark" />
          {k.next <= s.clock.now ? t.sm.sheet.dueNow : f(t.sm.sheet.nextOn, { date: next })}
        </p>
      </div>
    );
  }
  return (
    <div className={box} data-learned="occasional">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-[16px] font-extrabold">{t.sm.sheet.notRegular}</b>
        <span className="text-[13px] text-muted">{f(t.sm.sheet.boughtTimes, { n: k.count })}</span>
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {k.contexts.includes("shabbat") && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-[13px] font-semibold">
            <CalendarDays className="size-4 text-muted" />
            {t.sm.sheet.ctxShabbat}
          </span>
        )}
        {k.contexts.includes("with") && k.withTitle && (
          <span className="bidi inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-[13px] font-semibold">
            <Link2 className="size-4 text-muted" />
            {f(t.sm.sheet.ctxWith, { title: k.withTitle })}
          </span>
        )}
        {!k.contexts.length && <span className="text-[13px] text-muted">{t.sm.sheet.ctxNone}</span>}
      </div>
    </div>
  );
}

function Dots({ days, of }: { days: number; of: number }) {
  return (
    <div className="mt-3 flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={cn("size-3 rounded-full", i < days ? "bg-ink" : "border-2 border-dashed border-line-strong")} />
      ))}
    </div>
  );
}

function Brands({ item, ro, usual, onSave }: { item: ItemWithSources; ro: boolean; usual: Detail["brand"]; onSave: (p: Parameters<typeof updateSmItem>[1], o: Partial<ItemWithSources>) => void }) {
  const { t, f } = useI18n();
  const [adding, setAdding] = useState(false);
  const subs = item.substitutes ?? [];
  const label = "mb-1.5 flex items-baseline justify-between gap-2 text-[13.5px] font-bold";
  return (
    <>
      <div className="mt-5">
        <span className={label}>{t.sm.sheet.brand}</span>
        <input
          defaultValue={item.preferBrand ?? ""}
          readOnly={ro}
          placeholder={ro ? "—" : t.sm.sheet.brandPh}
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== (item.preferBrand ?? null)) onSave({ preferBrand: v }, { preferBrand: v });
          }}
          className="bidi h-11 w-full rounded-full border border-line-strong bg-surface px-4 text-[14.5px] font-semibold outline-none focus:border-ink"
          data-sheet-brand
        />
        {/* R18 S3 C6: what the home buys of this type (≥ 3 buys, one brand ≥ 60 %). S4 F3: a chip — a tap makes it the
            brand to buy (so whoever shops picks the right one). */}
        {usual && (
          <button
            type="button"
            disabled={ro || item.preferBrand === usual.brand}
            onClick={() => onSave({ preferBrand: usual.brand }, { preferBrand: usual.brand })}
            className="mt-2 inline-flex h-9 max-w-full items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--spark)_12%,var(--surface))] px-3 text-[13px] font-semibold text-ink disabled:opacity-100"
            data-sheet-usual
          >
            <Sparkles className="size-3.5 shrink-0 text-spark" />
            <span className="bidi truncate">{f(t.sm.sheet.usually, { brand: usual.brand, n: usual.n, of: usual.of })}</span>
          </button>
        )}
      </div>
      <div className="mt-4">
        <span className={label}>
          {t.sm.sheet.subs}
          <small className="text-[12.5px] font-medium text-muted">{t.sm.sheet.subsHint}</small>
        </span>
        <div className="flex flex-wrap gap-2">
          {subs.map((x) => (
            <span key={x} className="bidi inline-flex h-10 items-center gap-1 rounded-full border border-line-strong ps-3.5 pe-1.5 text-[14px] font-semibold">
              {x}
              {!ro && (
                <button type="button" className="grid size-7 place-items-center rounded-full text-muted" aria-label={`${t.sm.sheet.remove}: ${x}`} onClick={() => onSave({ substitutes: subs.filter((y) => y !== x) }, { substitutes: subs.filter((y) => y !== x) })}>
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ))}
          {!ro &&
            (adding ? (
              <input
                autoFocus
                placeholder={t.sm.sheet.subPh}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  setAdding(false);
                  if (v && !subs.includes(v)) onSave({ substitutes: [...subs, v].slice(0, 8) }, { substitutes: [...subs, v].slice(0, 8) });
                }}
                className="h-10 w-36 rounded-full border border-ink bg-surface px-3.5 text-[14px] outline-none"
                data-sheet-sub-input
              />
            ) : (
              <button type="button" className="inline-flex h-10 items-center gap-1 rounded-full border border-dashed border-line-strong px-3.5 text-[14px] font-semibold text-muted" onClick={() => setAdding(true)} data-sheet-sub-add>
                <Plus className="size-4" />
                {t.sm.sheet.addSub}
              </button>
            ))}
        </div>
      </div>
    </>
  );
}

function History({ detail }: { detail: Detail | null }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  if (!detail) return null;
  const h = detail.history;
  const money = (n: number) => formatMoney(n, s.currency, locale);
  const where = (c: string | null, b: string | null) => storeLabel(c, b, locale) ?? "—";
  return (
    <div className="mt-5" data-sheet-history>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[13.5px] font-bold">
        {t.sm.sheet.history}
        {h.cheapest && <small className="bidi text-[12.5px] font-medium text-muted">{f(t.sm.sheet.cheapest, { store: where(h.cheapest.chain, null), price: money(h.cheapest.price) })}</small>}
      </span>
      {h.rows.length ? (
        <ul className="flex flex-col">
          {h.rows.map((r, i) => (
            <li key={i} className="flex min-h-9 items-center gap-3 text-[14px]">
              <span className="tabular w-12 shrink-0 text-muted">{new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "numeric", timeZone: s.clock.tz }).format(new Date(r.at))}</span>
              <span className="bidi min-w-0 flex-1 truncate">{where(r.chain, r.branch)}</span>
              {r.price != null && <b className="tabular shrink-0 font-extrabold">{money(r.price)}</b>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{t.sm.sheet.noHistory}</p>
      )}
    </div>
  );
}

// ---------- the suggestion's action sheet: Add · Not this time · Never suggest this ----------

type Sug = SmHome["suggestions"][number];

/**
 * R18 S3 B4: a suggested product's page (Nexus suggests' + or row, the Add screen's "You usually buy"): the product,
 * why it's suggested, the quantity from history on the steppers (count drives weight for produce) and **Add** — or
 * **Update quantity** when it's already on the list (the steppers then start from the row). Then Not this time /
 * Never suggest this. A toast confirms (the list can be hidden under the Add screen).
 */
export function SuggestionActions({ sug, onClose, reason }: { sug: Sug | null; onClose: () => void; reason: string }) {
  const { t } = useI18n();
  return (
    <Sheet open={!!sug} onOpenChange={(o) => !o && onClose()} title={sug?.title ?? t.sm.sheet.title} fit className="desk:max-w-[440px]">
      {sug && <SugBody key={sug.productKey} sug={sug} reason={reason} onClose={onClose} />}
    </Sheet>
  );
}

function SugBody({ sug, reason, onClose }: { sug: Sug; reason: string; onClose: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const listed = s.sm.find((i) => i.productKey === sug.productKey) ?? null;
  const unitKg = unitKgFor(sug.productKey, home?.unitKg);
  const addedLine = useAddedLine();
  const [m, setM] = useState<Measure>(() =>
    listed ? { quantity: listed.quantity, count: listed.count ?? null, amount: listed.amount, unit: listed.unit } : { quantity: sug.qty, count: null, amount: sug.amount, unit: sug.unit },
  );
  const [busy, setBusy] = useState(false);
  const key = s.spaceId || "-";
  const usual = qtyLabel({ quantity: sug.qty, amount: sug.amount, unit: sug.unit }, locale, unitKg);
  const done = async () => {
    setBusy(true);
    try {
      if (listed) {
        const r = await updateSmItem(listed.id, { quantity: m.quantity, count: m.count, amount: m.amount, unit: (m.unit as "kg" | "g" | "l" | null) ?? null });
        if (r) {
          s.upsertSm([asItem(r)]);
          toast.success(f(t.sm.sugAct.updated, { title: r.title, qty: qtyLabel(r, locale, unitKg) }));
        }
      } else {
        const rows = await acceptSuggestions([{ productKey: sug.productKey, title: sug.title, qty: m.quantity, amount: m.amount, unit: m.unit, section: sug.section, art: sug.art }]);
        let row = rows[0];
        if (row && m.count != null && row.count !== m.count) row = (await updateSmItem(row.id, { count: m.count })) ?? row;
        s.upsertSm(rows.map((r) => asItem(r.id === row?.id ? row : r)));
        if (row) {
          const xs: Added[] = [{ id: row.id, title: row.title, qty: qtyLabel(row, locale, unitKg), merged: false }];
          announceAdded(xs, { line: addedLine(xs) });
        }
      }
      patchSmHome(key, (h) => ({ ...h, suggestions: h.suggestions.filter((x) => x.productKey !== sug.productKey) }));
      onClose();
    } catch {
      toast.error(t.sm.sheet.failed);
    } finally {
      setBusy(false);
    }
  };
  const act = async (k: "skip" | "never") => {
    onClose();
    patchSmHome(key, (h) => ({ ...h, suggestions: h.suggestions.filter((x) => x.productKey !== sug.productKey) }));
    try {
      if (k === "skip") {
        if (sug.reasonKey !== "basket") await dismissSuggestion(sug.productKey, Math.min(sug.quietUntil, Date.now() + 119 * 86_400_000));
      } else {
        await hideProduct(sug.productKey);
        toast(f(t.sm.sheet.hidden, { title: sug.title }), { action: { label: t.sm.sheet.undo, onClick: () => void unhideProduct(sug.productKey).then(() => patchSmHome(key, (h) => ({ ...h, suggestions: [sug, ...h.suggestions] }))) } });
      }
    } catch {
      toast.error(t.sm.sheet.failed);
    }
  };
  const row = "flex min-h-[56px] w-full items-center gap-3.5 px-4 py-2 text-start transition-colors duration-150 active:bg-surface-2";
  return (
    <div className="flex flex-col pb-[max(12px,env(safe-area-inset-bottom))]" data-sug-actions={sug.productKey} data-sug-sheet={listed ? "update" : "add"}>
      <div className="flex items-center gap-3.5 px-4 pb-3 pt-1">
        <ProductTile art={sug.art} section={sug.section} size={56} />
        <span className="min-w-0 flex-1">
          <b className="bidi block truncate text-[19px] font-extrabold leading-tight">{sug.title}</b>
          <span className="block truncate text-[13px] text-muted">{[reason, f(t.sm.sugAct.usual, { qty: usual })].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      {listed && (
        <p className="mx-4 mb-2 rounded-[12px] bg-surface-2 px-3 py-2 text-[13.5px] font-semibold" data-sug-listed>
          {f(t.sm.sugAct.onList, { qty: qtyLabel(listed, locale, unitKg) })}
        </p>
      )}
      <div className="px-4 pb-3">
        <QtySteppers value={m} onChange={setM} unitKg={unitKg} title={sug.title} learned />
      </div>
      <div className="px-4 pb-2">
        <button type="button" disabled={busy} className="h-12 w-full rounded-[14px] bg-ink text-[15.5px] font-extrabold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-60" onClick={() => void done()} data-sug-act={listed ? "update" : "add"}>
          {listed ? t.sm.sugAct.update : t.sm.sugAct.add}
        </button>
      </div>
      {sug.reasonKey !== "basket" && (
        <div className="border-t border-line">
          <button type="button" className={row} onClick={() => void act("skip")} data-sug-act="skip">
            <X className="size-5" />
            <span>
              <b className="block text-[15px] font-bold">{t.sm.sugAct.notNow}</b>
              <span className="block text-[12.5px] text-muted">{t.sm.sugAct.notNowSub}</span>
            </span>
          </button>
          <button type="button" className={row} onClick={() => void act("never")} data-sug-act="never">
            <Ban className="size-5 text-danger" />
            <span>
              <b className="block text-[15px] font-bold text-danger">{t.sm.sugAct.never}</b>
              <span className="block text-[12.5px] text-muted">{t.sm.sugAct.neverSub}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

