"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus, Tag, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useSwipe } from "@/components/ui/swipe";
import { useDevice } from "@/components/ui/use-device";
import { removeSmItem, restoreSmItem, updateSmItem } from "@/app/supermarket-actions";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile } from "./art";
import { asItem } from "./numbers";
import { rowChip } from "./qty";
import { countOf, withCountOf } from "./qty-steppers";
import { openChoose } from "./choose-product";
import { useSmHome } from "./data";
import { Money } from "./money";
import { rowPrice, type RowPrice } from "./shelf";

// One row of the supermarket list (not store mode — there a tap checks). R18 S5 A1–A3 (board List-phone): a 60 px row —
// picture tile 44 (→ the item sheet), the name (its letters rename inline), a second line only for the usual brand and /
// or a note, the quantity chip ("6 · ~1 kg", "×2"), a dot in the colour of who added it. A2: drag toward the start edge →
// Delete at the end (past 56 px it stays open, past ~170 px or a fling it deletes, Undo 5 s); toward the end edge → the
// − count + stepper at the start (past 56 px it stays open). R19 A4 (board Fixes-phone): calm and deliberate — the row
// opens to a grey Delete at 96 px; the delete point is ~55 % of the row (≈ 210 px): only past it the underlay turns red,
// the icon grows, "Release to delete", one haptic tick; released there the row slides out while it folds its height
// (360 ms ease-out, opacity first — no red flash). A fling deletes only when it also crosses the point. 8 px slop + axis lock (a vertical move scrolls), rubber band
// past the limits, one row open at a time, a tap elsewhere closes it, snap = 380 ms drawer ease; RTL mirrors.

/** Rows open the item sheet (C2): an event, so the memoised rows don't take a callback. */
export const OPEN_ITEM = "nexus:sm-item";
export function openSmItem(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_ITEM, { detail: id }));
}
/** A5 A2: one row open at a time — a row that opens tells the others. */
const ROW_OPEN = "nexus:sm-row-open";

/** Who added a row (shared spaces): a dot in the person's colour, named for screen readers + a tooltip. */
const WHO = ["#7c5ad9", "#21938f", "#3b7fc4", "#d17a22", "#c94673", "#3f9d5a"];
function useWho(item: ItemWithSources) {
  const s = useStore();
  if (s.space?.kind !== "shared" || !item.addedByUserId) return null;
  const k = s.people.findIndex((p) => p.id === item.addedByUserId);
  return k < 0 ? null : { color: WHO[k % WHO.length], name: s.people[k].name.split(" ")[0] };
}

/** R18 S4 D2: rows put back by Undo open in place (height, then slide in) — the ids waiting to mount. */
const entering = new Set<string>();
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce";
const after = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The physical sign of "toward the start edge" (left in LTR, right in RTL). */
const startSign = () => (document.documentElement.dir === "rtl" ? 1 : -1);

/** G1: a row the AI just placed in its section (it was `other`) flashes once in the section's tint. */
export const useSettled = (id: string) => useStore().fresh.get(id) === "bump" || undefined;

export function Row({ item, unitKg, peek = false }: { item: ItemWithSources; unitKg: number | null; peek?: boolean }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const who = useWho(item);
  const ro = s.space?.role === "viewer" || s.offlineAt != null;
  // A4: a computer has no swipes — the row's actions show on hover / keyboard focus; Delete on a focused row deletes.
  const desk = useDevice() === "computer";
  const [renaming, setRenaming] = useState(false);
  const [pulse, setPulse] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const rowEl = useRef<HTMLDivElement>(null);
  // S4 D2: leaving = the row slides out at the finger's speed, then its height closes, then the list has no gap to jump.
  // A ref, not state: a re-render mid-exit would hand the row's transform back to React.
  const leaving = useRef(false);
  // Gone (no modal) — the server keeps a copy, so Undo (5 s) puts the very same row back, opening in place.
  const remove = async (velocity = 0) => {
    if (leaving.current) return;
    leaving.current = true;
    const w = wrap.current;
    const r = rowEl.current;
    if (w && r && !reduced()) {
      const width = w.offsetWidth;
      const now = new DOMMatrixReadOnly(getComputedStyle(r).transform === "none" ? undefined : getComputedStyle(r).transform).m41;
      const left = Math.max(0, width - Math.abs(now));
      // The slide keeps the release's speed (px/ms), between 160 and 260 ms — toward the start edge — while the whole
      // row (with what's under it) fades first and then folds its height: one soft 360 ms ease-out, no gap to jump.
      const ms = Math.round(Math.min(260, Math.max(160, velocity > 0.05 ? left / velocity : 240)));
      r.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
      r.style.transform = `translateX(${startSign() * (width + 24)}px)`;
      const h = w.offsetHeight;
      w.setAttribute("data-sm-folding", "");
      await w.animate([{ height: `${h}px`, opacity: 1 }, { height: `${Math.round(h * 0.78)}px`, opacity: 0, offset: 0.4 }, { height: "0px", opacity: 0 }], { duration: 360, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)", fill: "forwards" }).finished.catch(() => {});
    }
    s.removeSm(item.id);
    try {
      await removeSmItem(item.id);
    } catch {
      leaving.current = false;
      s.upsertSm([item]);
      return toast.error(t.sm.sheet.failed);
    }
    toast(f(t.sm.sheet.removed, { title: item.title }), {
      duration: 5000,
      ...(desk ? { position: "bottom-center" as const } : {}),
      action: {
        label: t.sm.add.undo,
        onClick: () =>
          void restoreSmItem(item.id).then(
            (r) => {
              if (!r) return;
              entering.add(item.id);
              s.upsertSm([asItem(r)]);
            },
            () => toast.error(t.sm.sheet.failed),
          ),
      },
    });
  };
  // Undo's row: from closed and out to its place — the height opens, then it slides back in (the delete reversed).
  useLayoutEffect(() => {
    if (!entering.has(item.id)) return;
    entering.delete(item.id);
    const w = wrap.current;
    const r = rowEl.current;
    if (!w || !r || reduced()) return;
    const h = w.offsetHeight;
    w.style.height = "0px";
    r.style.transition = "none";
    r.style.transform = `translateX(${startSign() * (w.offsetWidth + 24)}px)`;
    void w.offsetHeight;
    w.classList.add("gro-closing");
    w.style.height = `${h}px`;
    const a = setTimeout(() => {
      r.style.transition = "transform 280ms var(--ease-drawer)";
      r.style.transform = "translateX(0px)";
    }, 200);
    const b = setTimeout(() => {
      w.classList.remove("gro-closing");
      w.style.height = "";
      r.style.transition = "";
      r.style.transform = "";
    }, 500);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [item.id]);
  // x < 0 = pulled toward the start edge (Delete shows at the end); x > 0 = toward the end edge (the stepper at the start).
  // A4: the delete point = 55 % of the row's width (≈ 210 px on a 390 phone); a fling never commits short of it.
  const [rowW, setRowW] = useState(382);
  useLayoutEffect(() => {
    const w = wrap.current;
    if (!w || desk) return;
    const read = () => w.offsetWidth && setRowW(w.offsetWidth);
    read();
    const ro2 = new ResizeObserver(read);
    ro2.observe(w);
    return () => ro2.disconnect();
  }, [desk]);
  const arm = Math.round(Math.min(260, Math.max(170, rowW * 0.55)));
  const sw = useSwipe({
    disabled: ro || renaming || desk,
    start: { width: 96, openAt: 58, fullAt: arm, flick: Infinity, stop: arm + 80, full: (v) => void remove(v) },
    end: { width: 168, openAt: 56, stop: 200 },
  });
  const armed = sw.drag && -sw.x >= arm;
  useEffect(() => {
    if (!armed) return;
    try {
      navigator.vibrate?.(8);
    } catch {}
  }, [armed]);
  const delOpen = sw.x < 0;
  const qtyOpen = sw.x > 0;
  const { setX } = sw;
  const open = sw.x !== 0 && !sw.drag;
  // One row open at a time; a tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent(ROW_OPEN, { detail: item.id }));
    const other = (e: Event) => (e as CustomEvent<string>).detail !== item.id && setX(0);
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setX(0);
    window.addEventListener(ROW_OPEN, other);
    document.addEventListener("pointerdown", down, true);
    return () => {
      window.removeEventListener(ROW_OPEN, other);
      document.removeEventListener("pointerdown", down, true);
    };
  }, [open, setX, item.id]);
  const save = async (patch: Parameters<typeof updateSmItem>[1], optimistic: Partial<ItemWithSources>) => {
    s.upsertSm([{ ...item, ...optimistic }]);
    try {
      const r = await updateSmItem(item.id, patch);
      if (r) s.upsertSm([asItem(r)]);
      return true;
    } catch {
      s.upsertSm([item]);
      toast.error(t.sm.sheet.failed);
      return false;
    }
  };
  const m = { quantity: item.quantity, count: item.count ?? null, amount: item.amount, unit: item.unit };
  const n = countOf(m, unitKg).shown;
  const step = (d: number) => {
    const next = withCountOf(m, unitKg, (n ?? 0) + d);
    void save({ quantity: next.quantity, count: next.count, amount: next.amount, unit: (next.unit as "kg" | "g" | "l" | null) ?? null }, { quantity: next.quantity, count: next.count, amount: next.amount, unit: next.unit as ItemWithSources["unit"] });
  };
  const rename = async (v: string) => {
    if (!(await save({ title: v }, { title: v }))) return;
    setPulse(true);
    setTimeout(() => setPulse(false), 900);
  };
  const dir = typeof document !== "undefined" && document.documentElement.dir === "rtl" ? "rtl" : "ltr";
  const chip = rowChip(item, locale, unitKg);
  // R19 D1: the price for the count at the store, the deal that fits, or "Choose a product".
  const { home } = useSmHome();
  const shelf = home?.shelf ?? null;
  const rp = rowPrice(item, shelf?.items[item.id], unitKg);
  const choose = !!shelf?.chain && !shelf.items[item.id] && (item.matchState === "ask" || item.matchState === "none");
  const sub = [item.preferBrand, item.notes].filter(Boolean);
  const stepBtn = "grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-card transition-transform duration-150 ease-[var(--ease-out)] active:scale-90 disabled:opacity-40";
  const mini = "gro-mini grid size-8 shrink-0 place-items-center rounded-[9px] text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.92] disabled:opacity-40";
  return (
    <div
      ref={wrap}
      className={cn("gro-sw", desk && "gro-desk", rp?.deal && "gro-tall")}
      role="listitem"
      tabIndex={desk && !ro && !renaming ? 0 : undefined}
      aria-label={desk ? `${item.title}, ${chip.n}${chip.w ? ` ${chip.w}` : ""}` : undefined}
      onKeyDown={
        desk && !ro && !renaming
          ? (e) => {
              if ((e.key === "Delete" || e.key === "Backspace") && e.target === e.currentTarget) {
                e.preventDefault();
                const next = (wrap.current?.nextElementSibling ?? wrap.current?.previousElementSibling) as HTMLElement | null;
                void remove();
                next?.focus();
              }
            }
          : undefined
      }
      data-sm-sw={item.id}
    >
      {!ro && !desk && (
        <>
          <div className={cn("gro-sw-qty", qtyOpen && "on")} aria-hidden={!qtyOpen} data-sm-quick={item.id}>
            <button type="button" className={stepBtn} onClick={() => step(-1)} disabled={(n ?? 1) <= 1} tabIndex={qtyOpen ? 0 : -1} aria-label={`${item.title}: ${t.sm.qty.less}`} data-sm-quick-less>
              <Minus className="size-[18px]" />
            </button>
            <b className="tabular min-w-[34px] text-center text-[16px] font-extrabold" data-sm-quick-n>
              {n ?? "—"}
            </b>
            <button type="button" className={stepBtn} onClick={() => step(1)} tabIndex={qtyOpen ? 0 : -1} aria-label={`${item.title}: ${t.sm.qty.more}`} data-sm-quick-more>
              <Plus className="size-[18px]" />
            </button>
          </div>
          <div className={cn("gro-sw-del", delOpen && "on", armed && "arm")} aria-hidden={!delOpen} data-sm-del-state={armed ? "arm" : delOpen ? "calm" : undefined}>
            <button type="button" onClick={() => void remove()} tabIndex={delOpen ? 0 : -1} data-sm-swipe-delete>
              <Trash2 className="size-[18px]" />
              <span className="truncate">{armed ? t.sm.row.releaseDelete : sw.drag && -sw.x > 104 ? t.sm.row.keepGoing : t.sm.row.delete}</span>
            </button>
          </div>
        </>
      )}
      <div
        ref={rowEl}
        className={cn("gro-row", !sw.drag && "gro-settle", peek && !ro && "gro-peek", pulse && "gro-pulse")}
        style={sw.x ? { transform: `translateX(${sw.offset(dir)}px)` } : undefined}
        {...sw.bind}
        data-sm-row={item.id}
        data-settled={useSettled(item.id)}
        data-open={delOpen ? "delete" : qtyOpen ? "qty" : undefined}
      >
        {/* R19 A5 (board Main): the whole row opens the product — a hit layer under the content (z −1 in the row's
            stacking context); only the name's letters (rename) and the chip / price sit above it as their own buttons. */}
        {!renaming && <button type="button" className="gro-hit" onClick={() => openSmItem(item.id)} tabIndex={-1} aria-hidden data-sm-row-hit />}
        <button type="button" className="gro-tile-btn shrink-0 rounded-[13px]" onClick={() => openSmItem(item.id)} aria-label={f(t.sm.row.open, { title: item.title })} data-sm-row-tile>
          <ProductTile art={item.artKey} section={item.section} photo={item.imageUrl} size={44} />
        </button>
        {renaming ? (
          <input
            autoFocus
            defaultValue={item.title}
            maxLength={300}
            aria-label={t.sm.sheet.rename}
            enterKeyHint="done"
            className="bidi gro-ren"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = item.title;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              setRenaming(false);
              if (v && v !== item.title) void rename(v);
            }}
            data-sm-rename
          />
        ) : (
          // S4 D1: only the name's own letters rename (its inline box); R19 A5: the rest of this area (the brand / note
          // line, the space after the name) lets the tap through to the row's hit layer → the product.
          <div className="gro-na min-w-0 flex-1 select-none text-start" data-sm-row-name-area>
            <button type="button" className="gro-t bidi" onClick={() => (ro ? openSmItem(item.id) : setRenaming(true))} aria-label={ro ? undefined : f(t.sm.row.rename, { title: item.title })} data-sm-row-name>
              {item.title}
            </button>
            {sub.length > 0 && (
              <span className="gro-s bidi" data-sm-row-sub>
                {item.preferBrand && <span className="gro-br">{item.preferBrand}</span>}
                {item.preferBrand && item.notes ? " · " : ""}
                {item.notes}
              </span>
            )}
            {rp?.deal && <DealLine rp={rp} onTake={ro ? undefined : (n) => step(n)} />}
          </div>
        )}
        {!renaming && desk && !ro && (
          <button type="button" className={cn(mini, "gro-act")} onClick={() => step(-1)} disabled={(n ?? 1) <= 1} aria-label={`${item.title}: ${t.sm.qty.less}`} data-sm-desk-less>
            <Minus className="size-4" />
          </button>
        )}
        {!renaming && (
          <button type="button" className="gro-q" onClick={() => openSmItem(item.id)} aria-label={f(t.sm.row.open, { title: item.title })} data-sm-row-qty>
            <span>{chip.n}</span>
            {chip.w && <i>· {chip.w}</i>}
          </button>
        )}
        {!renaming && desk && !ro && (
          <>
            <button type="button" className={cn(mini, "gro-act")} onClick={() => step(1)} aria-label={`${item.title}: ${t.sm.qty.more}`} data-sm-desk-more>
              <Plus className="size-4" />
            </button>
            <button type="button" className={cn(mini, "gro-act gro-mini-del")} onClick={() => void remove()} aria-label={`${item.title}: ${t.sm.row.delete}`} data-sm-desk-delete>
              <Trash2 className="size-4" />
            </button>
          </>
        )}
        {!renaming && rp && (
          <span className="gro-pr" data-sm-row-price={rp.total.toFixed(2)}>
            <Money v={rp.total} className="gro-pr-t" />
            {rp.total < rp.regular - 0.004 ? <Money v={rp.regular} strike className="gro-pr-s" /> : rp.per && <small className="gro-pr-s">{perLabel(rp.per, locale)}</small>}
          </span>
        )}
        {!renaming && !rp && choose && !ro && (
          <button type="button" className="gro-choose" onClick={() => openChoose(item.id)} data-sm-choose={item.id}>
            {t.sm.match.choose}
          </button>
        )}
        {who && !renaming && <i className="gro-who" style={{ background: who.color }} title={f(t.sm.row.addedBy, { name: who.name })} role="img" aria-label={f(t.sm.row.addedBy, { name: who.name })} data-sm-who />}
      </div>
    </div>
  );
}

const PER: Record<string, [string, string]> = { kg: ["לק״ג", "/kg"], l: ["לליטר", "/L"], "100g": ["ל־100 גרם", "/100 g"], "100ml": ["ל־100 מ״ל", "/100 ml"] };
function perLabel(per: NonNullable<RowPrice["per"]>, locale: string) {
  return `₪${per.v.toFixed(2)} ${PER[per.unit][locale === "he" ? 0 : 1]}`;
}

/** R19 D1: the deal under the name, in the list's terms — "3 for ₪15 · you have 3 ✓", "4 for ₪12 · worth taking 4". */
function DealLine({ rp, onTake }: { rp: RowPrice; onTake?: (n: number) => void }) {
  const { t, f } = useI18n();
  const d = rp.deal!;
  const what =
    d.kind === "n_for" && d.price != null
      ? f(t.sm.shelf.nFor, { n: d.n, price: `₪${d.price.toFixed(2).replace(/\.00$/, "")}` })
      : d.kind === "price" && d.price != null
        ? f(t.sm.shelf.dealPrice, { price: `₪${d.price.toFixed(2)}` })
        : d.kind === "pct" && d.rate
          ? f(t.sm.shelf.pct, { rate: Math.round(d.rate) })
          : d.kind === "second"
            ? d.price === 0
              ? t.sm.shelf.oneOne
              : d.rate
                ? f(t.sm.shelf.secondPct, { rate: Math.round(d.rate) })
                : f(t.sm.shelf.second, { price: `₪${(d.price ?? 0).toFixed(2)}` })
            : d.description;
  const hint = d.hint === "have" && d.kind !== "price" && d.kind !== "pct" ? f(t.sm.shelf.have, { n: d.n }) : d.hint === "take" ? f(t.sm.shelf.take, { n: Math.round(rp.units + d.take) }) : null;
  const cls = cn("gro-deal bidi", d.club && "club", d.hint === "take" && onTake && "tap");
  const body = (
    <>
      <Tag className="size-3 shrink-0" />
      <span className="truncate">
        {what}
        {d.club ? ` · ${t.sm.shelf.club}` : ""}
        {hint ? ` · ${hint}` : ""}
      </span>
    </>
  );
  return d.hint === "take" && onTake ? (
    <button type="button" className={cls} onClick={() => onTake(d.take)} data-sm-deal="take">
      {body}
    </button>
  ) : (
    <span className={cls} data-sm-deal={d.hint}>
      {body}
    </span>
  );
}
