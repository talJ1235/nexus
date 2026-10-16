"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, BarChart3, CalendarClock, CalendarDays, Folder, Maximize2, Minimize2, Minus, PiggyBank, Plus, ShoppingBasket, ShoppingCart, Sparkles, Star, TrendingDown, TrendingUp, Truck, Users, Wallet } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Modal, Sheet } from "@/components/ui/overlays";
import { useDevice } from "@/components/ui/use-device";
import { addTop, canResize, moveTo, NEW_WIDGETS, pack, PRESETS, presetItems, remove, setSize, sizeOf, swap, unused, type HomeLayout, type WidgetId } from "@/lib/home-layout";
import { cn } from "@/lib/utils";

/**
 * R18 S5 D1 + D2 (boards Home-widgets-phone / -desktop, Widgets-catalog) — Home's cards. Every widget sits in one card
 * shell (radius 26, a 28 px round icon chip, one accent per widget for its visual only); small = 1 cell, wide = 2.
 * Grid: phone 2 columns of square cells, computer 4 (~259 × 196), dense packing (`pack` in lib/home-layout.ts places
 * every card, so the tested order is the drawn one). Edit in place: long-press a card 450 ms without moving (10 px slop
 * — moving earlier is a scroll) → edit mode starts with that card lifted under the finger; it follows the pointer and,
 * when its centre rests over another card (220 ms), the two swap; the rest glide to their new slots (300 ms drawer
 * ease). In edit mode: an outline on every card, "−" removes (scale out 200 ms, then repack), a size chip (small ↔
 * wide where allowed), "Add widget" (phone: bottom sheet; computer: dialog; added at the top with a short highlight),
 * "Done". The pencil on Home enters it too: arrow keys move the focused card, Delete removes it. No wiggle.
 */

export type RenderWidget = (id: WidgetId, h: 1 | 2, editing: boolean, size: "small" | "wide") => React.ReactNode | null;

export const WIDGET_ICON: Record<WidgetId, React.ReactNode> = {
  nextshop: <ShoppingBasket />,
  left: <ShoppingCart />,
  budget: <Wallet />,
  way: <Truck />,
  saved: <PiggyBank />,
  suggest: <Sparkles />,
  week: <CalendarDays />,
  needs: <AlertTriangle />,
  ontheway: <Truck />,
  pace: <TrendingUp />,
  projects: <Folder />,
  noticed: <Sparkles />,
  drops: <TrendingDown />,
  vslast: <TrendingDown />,
  nextdel: <Truck />,
  bycat: <BarChart3 />,
  most: <Star />,
  activity: <Users />,
  due: <CalendarClock />,
};

/** One accent per widget (nx-s5.css `.w-*`), for its visual only — text stays ink. */
export const WIDGET_ACCENT: Record<WidgetId, string> = {
  nextshop: "#2f9a58",
  budget: "#2f6fd1",
  way: "#e07a1f",
  ontheway: "#e07a1f",
  nextdel: "#e07a1f",
  saved: "#1a9a8f",
  drops: "#d2456f",
  suggest: "#e8920a",
  noticed: "#e8920a",
  week: "#7c5ad9",
  bycat: "#7c5ad9",
  most: "#c98a12",
  due: "#d0573f",
  needs: "#d0573f",
  projects: "#3a8fc4",
  pace: "#2f6fd1",
  vslast: "#2f6fd1",
  activity: "#1a9a8f",
  left: "#5a5955",
};

const reduced = () => typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce");
const DRAWER = "cubic-bezier(.32,.72,0,1)";
const LONG_MS = 450;
const SLOP = 10;
const SWAP_MS = 220;
type Pt = { x: number; y: number };
const clock = () => performance.now();
/** A dropped card glides from where it was dragged to its slot. */
function settle(el: HTMLElement) {
  const from = el.style.transform;
  el.style.transform = "";
  if (!reduced() && from && from !== "none") el.animate([{ transform: from }, { transform: "none" }], { duration: 300, easing: DRAWER });
}

export function HomeCards({ layout, render, onSave, stagger, shared, editRequest }: { layout: HomeLayout; render: RenderWidget; onSave: (l: HomeLayout) => void; stagger: boolean; shared: boolean; editRequest: number }) {
  const { t, f } = useI18n();
  const desk = useDevice() === "computer";
  const cols = desk ? 4 : 2;
  const [draft, setDraft] = useState<HomeLayout | null>(null);
  const editing = draft != null;
  const cur = draft ?? layout;
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<WidgetId, HTMLDivElement>());
  const latest = useRef(cur);
  useEffect(() => {
    latest.current = cur;
  });
  const [lifted, setLifted] = useState<WidgetId | null>(null);
  const [fresh, setFresh] = useState<WidgetId | null>(null);
  const [leaving, setLeaving] = useState<WidgetId | null>(null);
  const [adding, setAdding] = useState(false);
  const [say, setSay] = useState("");
  const [rowH, setRowH] = useState<number | null>(null);
  const before = useRef<Map<WidgetId, DOMRect> | null>(null);
  // `swappedAt`: where the last swap happened — the reflow after a swap puts another card under a still finger, so no
  // new swap until the pointer moves 24 px on (no cascade).
  const drag = useRef<{ id: WidgetId; grab: Pt; at: Pt; over: { id: WidgetId; since: number } | null; pid: number; swappedAt: Pt | null } | null>(null);

  // Square cells on a phone (row = column width); 196 px rows on a computer.
  // Before hydration the style's fallback is the same square: (100vw − 2 × 16 px padding − 10 px gap) / 2.
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    const read = () => {
      const gap = desk ? 14 : 10;
      setRowH(desk ? 196 : Math.round((g.clientWidth - gap * (cols - 1)) / cols));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(g);
    return () => ro.disconnect();
  }, [desk, cols]);

  // Edit mode on <html> (the floating Ask hides; the page knows).
  useEffect(() => {
    if (!editing) return;
    document.documentElement.setAttribute("data-home-edit", "");
    return () => document.documentElement.removeAttribute("data-home-edit");
  }, [editing]);

  // The pencil (Home header) asks for edit mode: keyboard and screen readers get the same as a long-press.
  const lastReq = useRef(editRequest);
  useEffect(() => {
    if (editRequest === lastReq.current) return;
    lastReq.current = editRequest;
    setDraft(layout);
    setSay(t.hc.keysHint);
  }, [editRequest, layout, t.hc.keysHint]);

  // ---- FLIP: remember every card's box, change the layout, then glide from there (the lifted card excluded).
  const flip = useCallback((fn: (l: HomeLayout) => HomeLayout) => {
    const m = new Map<WidgetId, DOMRect>();
    cells.current.forEach((el, id) => m.set(id, el.getBoundingClientRect()));
    before.current = m;
    setDraft((d) => fn(d ?? latest.current));
  }, []);
  const follow = useCallback(() => {
    const d = drag.current;
    const el = d && cells.current.get(d.id);
    if (!d || !el) return;
    el.style.transform = "none";
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${d.at.x - d.grab.x - r.left}px, ${d.at.y - d.grab.y - r.top}px) scale(1.04)`;
  }, []);
  useLayoutEffect(() => {
    const b = before.current;
    before.current = null;
    if (b && !reduced())
      cells.current.forEach((el, id) => {
        if (id === drag.current?.id) return;
        const p = b.get(id);
        if (!p) return;
        const r = el.getBoundingClientRect();
        const dx = p.left - r.left;
        const dy = p.top - r.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing: DRAWER });
      });
    if (drag.current) follow();
  }, [cur, follow]);

  // ---- drag (edit mode): the card follows the pointer; its centre over another card for 220 ms → they swap.
  // `grab` = where the finger holds the card (from the press: entering edit mode can reflow the grid, and the card must
  // stay under the finger even if its slot moved).
  const startDrag = (id: WidgetId, at: Pt, pid: number, target: HTMLElement, grab?: Pt) => {
    const el = cells.current.get(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { id, grab: grab ?? { x: at.x - r.left, y: at.y - r.top }, at, over: null, pid, swappedAt: null };
    setLifted(id);
    try {
      target.setPointerCapture(pid);
    } catch {}
    try {
      navigator.vibrate?.(12);
    } catch {}
    setSay(f(t.hc.lifted, { name: t.hc.names[id] }));
    follow();
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pid) return;
    e.preventDefault();
    d.at = { x: e.clientX, y: e.clientY };
    follow();
    const el = cells.current.get(d.id)!;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let hit: WidgetId | null = null;
    cells.current.forEach((c, id) => {
      if (id === d.id || hit) return;
      const b = c.getBoundingClientRect();
      if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) hit = id;
    });
    if (d.swappedAt && Math.hypot(d.at.x - d.swappedAt.x, d.at.y - d.swappedAt.y) < 24) return void (d.over = null);
    d.swappedAt = null;
    if (!hit) return void (d.over = null);
    if (d.over?.id !== hit) return void (d.over = { id: hit, since: clock() });
    if (clock() - d.over.since < SWAP_MS) return;
    const other: WidgetId = hit;
    d.over = null;
    d.swappedAt = d.at;
    flip((l) => swap(l, d.id, other));
    setSay(f(t.hc.swapped, { name: t.hc.names[d.id], other: t.hc.names[other] }));
  };
  // A swap fires while the pointer rests too (no move event): check on a timer while lifted.
  useEffect(() => {
    if (!lifted) return;
    const id = setInterval(() => {
      const d = drag.current;
      if (d?.over && !d.swappedAt && clock() - d.over.since >= SWAP_MS) {
        const other = d.over.id;
        d.over = null;
        d.swappedAt = d.at;
        flip((l) => swap(l, d.id, other));
      }
    }, 60);
    return () => clearInterval(id);
  }, [lifted, flip]);
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    setLifted(null);
    const el = d && cells.current.get(d.id);
    if (el) settle(el);
  };

  // ---- long-press (view mode) → edit mode with that card lifted; moving first is a scroll. In edit mode a press that
  // moves picks the card up at once.
  const press = useRef<{ id: WidgetId; at: Pt; pid: number; timer: ReturnType<typeof setTimeout> | null; target: HTMLElement; grab: Pt } | null>(null);
  const onDown = (id: WidgetId, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as Element).closest("[data-card-ctl]")) return;
    const at = { x: e.clientX, y: e.clientY };
    const target = e.currentTarget;
    const box = target.getBoundingClientRect();
    const grab = { x: at.x - box.left, y: at.y - box.top };
    if (editing) {
      press.current = { id, at, pid: e.pointerId, timer: null, target, grab };
      return;
    }
    // Watched on the window (capture): a card that handles its own swipes (Nexus suggests) may capture the pointer or
    // stop its events. Slop is measured from where the press started — a slow drift adds up.
    const pid = e.pointerId;
    const off = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
    };
    const stop = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      off();
      if (press.current?.timer) clearTimeout(press.current.timer);
      if (press.current?.timer) press.current = null;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid || !press.current?.timer) return;
      if (Math.hypot(ev.clientX - at.x, ev.clientY - at.y) > SLOP) stop(ev);
      else press.current.at = { x: ev.clientX, y: ev.clientY };
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    const timer = setTimeout(() => {
      off();
      const p = press.current;
      press.current = null;
      if (!p) return;
      setDraft(latest.current);
      // The edit-mode render puts every card in place first; then the pressed one lifts under the finger.
      requestAnimationFrame(() => startDrag(p.id, p.at, p.pid, p.target, p.grab));
    }, LONG_MS);
    press.current = { id, at, pid, timer, target, grab };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) return moveDrag(e);
    const p = press.current;
    if (!p || e.pointerId !== p.pid) return;
    // View mode: the window listeners above decide; edit mode: a press that moves past the slop picks the card up.
    if (p.timer) return;
    if (Math.hypot(e.clientX - p.at.x, e.clientY - p.at.y) <= SLOP) return;
    press.current = null;
    startDrag(p.id, { x: e.clientX, y: e.clientY }, p.pid, p.target, p.grab);
  };
  const onUp = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
    if (drag.current) endDrag();
  };
  // The long-press must not open the browser's menu / select text.
  const noMenu = (e: React.MouseEvent) => editing && e.preventDefault();

  const removeCard = (id: WidgetId) => {
    if (reduced()) {
      flip((l) => remove(l, id));
    } else {
      setLeaving(id);
      setTimeout(() => {
        setLeaving(null);
        flip((l) => remove(l, id));
      }, 200);
    }
    setSay(f(t.hc.removed, { name: t.hc.names[id] }));
  };
  const keys = (id: WidgetId, e: React.KeyboardEvent) => {
    if (!editing) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return removeCard(id);
    }
    const rtl = document.documentElement.dir === "rtl";
    const d = e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft") ? -1 : e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    const k = latest.current.items.findIndex((x) => x.id === id);
    const to = Math.max(0, Math.min(latest.current.items.length - 1, k + d));
    if (to === k) return;
    flip((l) => moveTo(l, id, to));
    setSay(f(t.hc.moved, { name: t.hc.names[id], n: to + 1 }));
    requestAnimationFrame(() => cells.current.get(id)?.focus());
  };
  const addOne = (id: WidgetId) => {
    flip((l) => addTop(l, id));
    setAdding(false);
    setFresh(id);
    setTimeout(() => setFresh(null), 1100);
    setSay(f(t.hc.moved, { name: t.hc.names[id], n: 1 }));
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" }));
  };
  const done = () => {
    if (drag.current) endDrag();
    if (draft) onSave(draft);
    setDraft(null);
    setAdding(false);
  };

  // Cards with something to show (view) or every card (edit), packed.
  const shown = cur.items.map((x) => ({ x, node: render(x.id, x.h, editing, sizeOf(x)) })).filter((c) => c.node != null);
  const placed = pack(
    shown.map((c) => c.x),
    cols,
  );
  const at = new Map(placed.map((c) => [c.id, c]));
  const tray = unused(cur);
  const trayList = (
    <div className="grid grid-cols-2 gap-2.5 desk:grid-cols-3" data-home-tray>
      {tray.length === 0 && <p className="col-span-full text-[13px] text-muted">{t.hc.allOn}</p>}
      {tray.map((id) => (
        <button key={id} type="button" onClick={() => addOne(id)} className="wv2-tray" style={{ "--k": WIDGET_ACCENT[id] } as React.CSSProperties} aria-label={f(t.hc.add, { name: t.hc.names[id] })} data-tray-add={id}>
          <span className="wv2-chip">{WIDGET_ICON[id]}</span>
          <span className="min-w-0 flex-1 truncate text-start text-[13.5px] font-bold">{t.hc.names[id]}</span>
          {NEW_WIDGETS.includes(id) && <span className="wv2-new">{t.hc.new}</span>}
        </button>
      ))}
    </div>
  );
  const presets = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.hc.startFrom}>
      <span className="text-[12.5px] font-semibold text-muted">{t.hc.startFrom}</span>
      {PRESETS.map((p) => (
        <button key={p} type="button" onClick={() => (flip(() => ({ v: 2, preset: p, items: presetItems(p, shared) })), setAdding(false))} className={cn("h-9 rounded-full border px-3 text-[13px] font-semibold transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]", cur.preset === p ? "border-ink bg-ink text-bg" : "border-line bg-surface")} data-home-preset={p}>
          {t.hc.presets[p]}
        </button>
      ))}
    </div>
  );
  const addBody = (
    <div className="flex flex-col gap-3.5 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-1">
      <div>
        {!desk && <h2 className="text-[20px] font-extrabold tracking-[-0.01em]">{t.hc.addWidget}</h2>}
        <p className="mt-0.5 text-[13.5px] text-muted">{t.hc.addSub}</p>
      </div>
      {trayList}
      {presets}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 desk:col-span-12" data-home-cards={editing ? "edit" : "view"}>
      {editing && (
        <div className="wv2-bar sticky top-[calc(var(--app-header-h,0px)+6px)] z-20 flex items-center gap-2" data-home-editbar>
          <button type="button" onClick={() => setAdding(true)} className="flex h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-bold shadow-card transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]" data-home-add-widget>
            <Plus className="size-4" />
            {t.hc.addWidget}
          </button>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{t.hc.editHint}</span>
          <button type="button" onClick={done} className="h-11 rounded-full bg-ink px-5 text-[14px] font-bold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]" data-home-done>
            {t.hc.done}
          </button>
        </div>
      )}
      <div
        ref={grid}
        className={cn("wv2-grid", editing && "wv2-editing")}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: rowH ? `${rowH}px` : desk ? "196px" : "calc((100vw - 42px) / 2)" } as React.CSSProperties}
        onContextMenu={noMenu}
        data-home-grid
        data-cols={cols}
      >
        {shown.map(({ x, node }, k) => {
          const c = at.get(x.id)!;
          const size = sizeOf(x);
          return (
            <div
              key={x.id}
              ref={(el) => {
                if (el) cells.current.set(x.id, el);
                else cells.current.delete(x.id);
              }}
              className={cn("wv2", stagger && !editing && "r13-rise", lifted === x.id && "wv2-lifted", fresh === x.id && "wv2-fresh", leaving === x.id && "wv2-leaving")}
              style={{ gridColumn: `${c.col + 1} / span ${c.cols}`, gridRow: `${c.row + 1} / span ${c.rows}`, "--k": WIDGET_ACCENT[x.id], ...(stagger && !editing ? { "--d": `${(k + 1) * 50}ms` } : {}) } as React.CSSProperties}
              onPointerDown={(e) => onDown(x.id, e)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={(e) => keys(x.id, e)}
              tabIndex={editing ? 0 : undefined}
              role={editing ? "group" : undefined}
              aria-label={editing ? t.hc.names[x.id] : undefined}
              data-widget={x.id}
              data-size={size}
              data-h={x.h}
              data-col={c.col}
              data-row={c.row}
            >
              <div className={cn("wv2-body", editing && "pointer-events-none select-none")} inert={editing || undefined}>
                {node}
              </div>
              {editing && (
                <>
                  <button type="button" className="wv2-remove" onClick={() => removeCard(x.id)} aria-label={f(t.hc.removeW, { name: t.hc.names[x.id] })} data-card-ctl data-widget-hide={x.id}>
                    <Minus className="size-4" strokeWidth={3} />
                  </button>
                  {canResize(x.id) && (
                    <button
                      type="button"
                      className="wv2-size"
                      onClick={() => flip((l) => setSize(l, x.id, size === "wide" ? "small" : "wide"))}
                      aria-label={f(t.hc.sizeTo, { name: t.hc.names[x.id], size: size === "wide" ? t.hc.small : t.hc.wide })}
                      data-card-ctl
                      data-widget-size={x.id}
                    >
                      {size === "wide" ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                      {size === "wide" ? t.hc.wide : t.hc.small}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {desk ? (
        <Modal open={adding} onOpenChange={setAdding} title={t.hc.addWidget}>
          {addBody}
        </Modal>
      ) : (
        <Sheet open={adding} onOpenChange={setAdding} title={t.hc.addWidget} fit>
          {addBody}
        </Sheet>
      )}
      <span className="sr-only" aria-live="polite">
        {say}
      </span>
    </div>
  );
}
