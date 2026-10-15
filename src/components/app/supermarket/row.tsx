"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useSwipe } from "@/components/ui/swipe";
import { removeSmItem, restoreSmItem, updateSmItem } from "@/app/supermarket-actions";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile } from "./art";
import { asItem } from "./numbers";
import { qtyLabel } from "./qty";
import { countOf, withCountOf } from "./qty-steppers";

// One row of the supermarket list (not store mode — there a tap checks). R18 S3 C5: the inbox's swipe (`useSwipe`) —
// toward the inline-end deletes (red, the bin; a full swipe or the revealed button, then 5 s to Undo — no modal), toward
// the start opens a quick − count + (closes on a tap outside); the name renames inline, the picture opens the item sheet.
// Vertical scrolls never swipe (axis lock); RTL mirrors; reduced motion: no slide, the side opens in place.

/** Rows open the item sheet (C2): an event, so the memoised rows don't take a callback. */
export const OPEN_ITEM = "nexus:sm-item";
export function openSmItem(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_ITEM, { detail: id }));
}

/** Who added a row (shared spaces): a dot in the person's colour. */
const WHO = ["#7c5ad9", "#21938f", "#3b7fc4", "#d17a22", "#c94673", "#3f9d5a"];
function useWhoColor(item: ItemWithSources) {
  const s = useStore();
  if (s.space?.kind !== "shared" || !item.addedByUserId) return null;
  const k = s.people.findIndex((p) => p.id === item.addedByUserId);
  return k < 0 ? null : WHO[k % WHO.length];
}

/** R18 S4 D2: rows put back by Undo open in place (height, then slide in) — the ids waiting to mount. */
const entering = new Set<string>();
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce";
const after = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** G1: a row the AI just placed in its section (it was `other`) flashes once in the section's tint. */
export const useSettled = (id: string) => useStore().fresh.get(id) === "bump" || undefined;

export function Row({ item, unitKg }: { item: ItemWithSources; unitKg: number | null }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const who = useWhoColor(item);
  const ro = s.space?.role === "viewer" || s.offlineAt != null;
  const [renaming, setRenaming] = useState(false);
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
      const dir = document.documentElement.dir === "rtl" ? -1 : 1;
      const width = w.offsetWidth;
      const now = new DOMMatrixReadOnly(getComputedStyle(r).transform === "none" ? undefined : getComputedStyle(r).transform).m41;
      const left = Math.max(0, width - Math.abs(now));
      // The exit keeps the release's speed (px/ms), between a quick 120 ms and a calm 260 ms.
      const ms = Math.round(Math.min(260, Math.max(120, velocity > 0.05 ? left / velocity : 240)));
      r.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
      r.style.transform = `translateX(${dir * (width + 24)}px)`;
      await after(ms);
      w.style.height = `${w.offsetHeight}px`;
      void w.offsetHeight;
      w.classList.add("gro-closing");
      w.style.height = "0px";
      await after(200);
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
    const dir = document.documentElement.dir === "rtl" ? -1 : 1;
    w.style.height = "0px";
    r.style.transition = "none";
    r.style.transform = `translateX(${dir * (w.offsetWidth + 24)}px)`;
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
  const sw = useSwipe({ disabled: ro || renaming, end: { width: 92, full: (v) => void remove(v) }, start: { width: 168 } });
  // The quick quantity closes on a tap anywhere else.
  const qtyOpen = sw.x < 0;
  const { setX } = sw;
  useEffect(() => {
    if (!qtyOpen) return;
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setX(0);
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [qtyOpen, setX]);
  const save = async (patch: Parameters<typeof updateSmItem>[1], optimistic: Partial<ItemWithSources>) => {
    s.upsertSm([{ ...item, ...optimistic }]);
    try {
      const r = await updateSmItem(item.id, patch);
      if (r) s.upsertSm([asItem(r)]);
    } catch {
      s.upsertSm([item]);
      toast.error(t.sm.sheet.failed);
    }
  };
  const m = { quantity: item.quantity, count: item.count ?? null, amount: item.amount, unit: item.unit };
  const n = countOf(m, unitKg).shown;
  const step = (d: number) => {
    const next = withCountOf(m, unitKg, (n ?? 0) + d);
    void save({ quantity: next.quantity, count: next.count, amount: next.amount, unit: (next.unit as "kg" | "g" | "l" | null) ?? null }, { quantity: next.quantity, count: next.count, amount: next.amount, unit: next.unit as ItemWithSources["unit"] });
  };
  const dir = typeof document !== "undefined" && document.documentElement.dir === "rtl" ? "rtl" : "ltr";
  const btn = "grid size-11 shrink-0 place-items-center rounded-[12px] bg-surface text-ink shadow-card transition-transform duration-150 ease-[var(--ease-out)] active:scale-90 disabled:opacity-40";
  return (
    <div ref={wrap} className="gro-sw" data-sm-sw={item.id}>
      {!ro && (
        <>
          <div className={cn("gro-sw-del", sw.x > 0 && "on")} aria-hidden={sw.x <= 0}>
            <button type="button" onClick={() => void remove()} tabIndex={sw.x > 0 ? 0 : -1} data-sm-swipe-delete>
              <Trash2 className="size-5" />
              {t.sm.row.delete}
            </button>
          </div>
          <div className={cn("gro-sw-qty", qtyOpen && "on")} aria-hidden={!qtyOpen} data-sm-quick={item.id}>
            <button type="button" className={btn} onClick={() => step(-1)} disabled={(n ?? 1) <= 1} tabIndex={qtyOpen ? 0 : -1} aria-label={`${item.title}: ${t.sm.qty.less}`} data-sm-quick-less>
              <Minus className="size-5" />
            </button>
            <b className="tabular min-w-8 text-center text-[17px] font-extrabold" data-sm-quick-n>
              {n ?? "—"}
            </b>
            <button type="button" className={btn} onClick={() => step(1)} tabIndex={qtyOpen ? 0 : -1} aria-label={`${item.title}: ${t.sm.qty.more}`} data-sm-quick-more>
              <Plus className="size-5" />
            </button>
          </div>
        </>
      )}
      <div ref={rowEl} className={cn("gro-row", !sw.drag && "gro-settle")} style={sw.x ? { transform: `translateX(${sw.offset(dir)}px)` } : undefined} {...sw.bind} data-sm-row={item.id} data-settled={useSettled(item.id)}>
        <button type="button" className="shrink-0 rounded-[12px]" onClick={() => openSmItem(item.id)} aria-label={f(t.sm.row.open, { title: item.title })} data-sm-row-tile>
          <ProductTile art={item.artKey} section={item.section} photo={item.imageUrl} size={40} />
        </button>
        {renaming ? (
          <input
            autoFocus
            defaultValue={item.title}
            maxLength={300}
            aria-label={t.sm.sheet.rename}
            className="bidi gro-t min-w-0 flex-1 rounded-[8px] bg-surface-2 px-2 py-1 outline-none ring-2 ring-ink/20"
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
              if (v && v !== item.title) void save({ title: v }, { title: v });
            }}
            data-sm-rename
          />
        ) : (
          // S4 D1: only the name's own letters rename (its inline box); the row's empty part does nothing.
          <div className="min-w-0 flex-1 select-none text-start" data-sm-row-name-area>
            <button type="button" className="gro-t bidi -my-1.5 max-w-full py-1.5 text-start" onClick={() => (ro ? openSmItem(item.id) : setRenaming(true))} data-sm-row-name>
              {item.title}
            </button>
            {item.notes && <span className="gro-s bidi truncate">{item.notes}</span>}
          </div>
        )}
        {who && <i className="gro-who" style={{ background: who }} aria-hidden />}
        <button type="button" className="gro-q" onClick={() => openSmItem(item.id)} aria-label={f(t.sm.row.open, { title: item.title })} data-sm-row-qty>
          {qtyLabel(item, locale, unitKg)}
        </button>
      </div>
    </div>
  );
}
