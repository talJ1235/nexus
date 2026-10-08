"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BarChart3, CalendarDays, EyeOff, Folder, GripVertical, Home, Minus, PiggyBank, Plus, RotateCcw, ShoppingCart, Sparkles, Star, Tag, TrendingDown, TrendingUp, Truck, Users, Wallet, Wrench, AlertTriangle, ChevronDown } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Pop, PopContent, PopTrigger, Sheet } from "@/components/ui/overlays";
import { add, moveTo, NEW_WIDGETS, patch, phoneWidth, PRESETS, presetItems, remove, sizeFromDrag, SPAN, unused, type HomeLayout, type LayoutItem, type PresetId, type WidgetId, type Width } from "@/lib/home-layout";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/lib/motion";

/**
 * R16 E1 — Home's widget grid (board HomeCustomize). View: 12 columns on desktop (S/M/L = 3/6/12), 2 on phones
 * (half/full), rows 1× or 2× tall, dense flow so gaps fill. Customise: presets, drag to reorder (FLIP: the others
 * glide to their new places, transform-only), the corner handle or the size menu to resize, hide, and the tray
 * (desktop side panel / phone sheet) to add — drag a widget in or tap +. Keyboard: the grip moves with the arrows.
 */

export type RenderWidget = (id: WidgetId, h: 1 | 2, editing: boolean) => React.ReactNode | null;

export const WIDGET_ICON: Record<WidgetId, React.ReactNode> = {
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
};
const PRESET_ICON: Record<PresetId, React.ReactNode> = { household: <Home />, maker: <Wrench />, deals: <Tag />, minimal: <Minus /> };

const cellStyle = (x: LayoutItem, k: number | null) =>
  ({ "--span": SPAN[x.w], "--pspan": phoneWidth(x) === "half" ? 1 : 2, "--rows": x.h, ...(k != null ? { "--d": `${(k + 1) * 50}ms` } : {}) }) as React.CSSProperties;

export function WidgetGrid({ layout, render, stagger }: { layout: HomeLayout; render: RenderWidget; stagger: boolean }) {
  return (
    <div className="hgrid lg:col-span-12" data-home-grid>
      {layout.items.map((x, k) => {
        const node = render(x.id, x.h, false);
        if (!node) return null;
        return (
          <div key={x.id} className={cn("hw", stagger && "r13-rise")} style={cellStyle(x, stagger ? k : null)} data-widget={x.id} data-w={x.w} data-h={x.h}>
            {node}
          </div>
        );
      })}
    </div>
  );
}

const reduced = () => typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce");
const EASE = EASE_OUT;
type Pt = { x: number; y: number };

export function Customise({
  draft,
  setDraft,
  render,
  shared,
  desktop,
  onDone,
  onReset,
}: {
  draft: HomeLayout;
  setDraft: React.Dispatch<React.SetStateAction<HomeLayout>>;
  render: RenderWidget;
  shared: boolean;
  desktop: boolean;
  onDone: () => void;
  onReset: () => void;
}) {
  const { t, f, locale } = useI18n();
  const rtl = locale === "he";
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<WidgetId, HTMLDivElement>());
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  });
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const [say, setSay] = useState("");
  const [trayOpen, setTrayOpen] = useState(false);
  const drag = useRef<{ id: WidgetId; grab: Pt; at: Pt; last: { target: WidgetId; t: number } | null } | null>(null);
  const before = useRef<Map<WidgetId, Pt> | null>(null);
  const pendingDrag = useRef<{ id: WidgetId; at: Pt } | null>(null);
  const startRef = useRef<((id: WidgetId, at: Pt, grab?: Pt) => void) | null>(null);

  // ---- FLIP: remember where everyone was, change the layout, then glide from there.
  const flip = useCallback(
    (fn: (l: HomeLayout) => HomeLayout) => {
      const m = new Map<WidgetId, Pt>();
      cells.current.forEach((el, id) => m.set(id, { x: el.offsetLeft, y: el.offsetTop }));
      before.current = m;
      setDraft(fn);
    },
    [setDraft],
  );
  const place = useCallback((at: Pt) => {
    const d = drag.current;
    const el = d && cells.current.get(d.id);
    const g = grid.current?.getBoundingClientRect();
    if (!d || !el || !g) return;
    el.style.transform = `translate(${at.x - g.left - d.grab.x - el.offsetLeft}px, ${at.y - g.top - d.grab.y - el.offsetTop}px) rotate(-1deg) scale(1.02)`;
  }, []);
  useLayoutEffect(() => {
    const b = before.current;
    before.current = null;
    if (b && !reduced())
      cells.current.forEach((el, id) => {
        if (id === drag.current?.id) return;
        const p = b.get(id);
        if (!p) return;
        const dx = p.x - el.offsetLeft;
        const dy = p.y - el.offsetTop;
        if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 220, easing: EASE });
      });
    if (drag.current) place(drag.current.at);
    const pd = pendingDrag.current;
    if (pd && cells.current.get(pd.id)) {
      pendingDrag.current = null;
      const el = cells.current.get(pd.id)!;
      startRef.current?.(pd.id, pd.at, { x: Math.min(el.offsetWidth / 2, 120), y: 22 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // ---- drag a widget (pointer); the window listens so a drag that starts in the tray keeps going.
  const start = (id: WidgetId, at: Pt, grab?: Pt) => {
    const el = cells.current.get(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { id, grab: grab ?? { x: at.x - r.left, y: at.y - r.top }, at, last: null };
    setDragId(id);
    place(at);
    let raf = 0;
    const move = (e: PointerEvent) => {
      e.preventDefault();
      const d = drag.current;
      if (!d) return;
      d.at = { x: e.clientX, y: e.clientY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place(d.at);
        const g = grid.current!.getBoundingClientRect();
        const px = d.at.x - g.left;
        const py = d.at.y - g.top;
        const items = latest.current.items;
        for (const x of items) {
          if (x.id === d.id) continue;
          const c = cells.current.get(x.id);
          if (!c || px < c.offsetLeft || px > c.offsetLeft + c.offsetWidth || py < c.offsetTop || py > c.offsetTop + c.offsetHeight) continue;
          // Hysteresis: the cell that just moved away can't pull it straight back.
          if (d.last && d.last.target === x.id && performance.now() - d.last.t < 260) break;
          d.last = { target: x.id, t: performance.now() };
          flip((l) => moveTo(l, d.id, l.items.findIndex((y) => y.id === x.id)));
          break;
        }
      });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", esc);
      cancelAnimationFrame(raf);
      const d = drag.current;
      drag.current = null;
      setDragId(null);
      const el2 = d && cells.current.get(d.id);
      if (!el2) return;
      const from = el2.style.transform;
      el2.style.transform = "";
      if (!reduced() && from) el2.animate([{ transform: from }, { transform: "none" }], { duration: 180, easing: EASE });
      const k = latest.current.items.findIndex((y) => y.id === d!.id);
      setSay(f(t.hc.moved, { name: t.hc.names[d!.id], n: k + 1 }));
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && end();
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", esc);
  };

  useEffect(() => {
    startRef.current = start;
  });

  // ---- resize from the corner: columns → S/M/L, rows → 1×/2×.
  const resize = (x: LayoutItem, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const g = grid.current!.getBoundingClientRect();
    const colW = g.width / 12;
    const rowH = 146;
    const s0 = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      const dCols = ((ev.clientX - s0.x) / colW) * (rtl ? -1 : 1);
      const next = sizeFromDrag(x, dCols, (ev.clientY - s0.y) / rowH);
      const cur = latest.current.items.find((y) => y.id === x.id);
      if (cur && (cur.w !== next.w || cur.h !== next.h)) flip((l) => patch(l, x.id, next));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // ---- the tray: tap + to add at the end, or drag the row into the grid.
  const trayDown = (id: WidgetId, e: React.PointerEvent) => {
    if ((e.target as Element).closest("button")) return;
    const s0 = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - s0.x, ev.clientY - s0.y) < 6) return;
      const g = grid.current?.getBoundingClientRect();
      if (!g || ev.clientX < g.left || ev.clientX > g.right || ev.clientY < g.top || ev.clientY > g.bottom) return;
      up();
      // Insert before the cell under the pointer (else at the end), then carry it.
      const px = ev.clientX - g.left;
      const py = ev.clientY - g.top;
      let at = latest.current.items.length;
      latest.current.items.forEach((x, k) => {
        const c = cells.current.get(x.id);
        if (c && at === latest.current.items.length && py < c.offsetTop + c.offsetHeight && (py < c.offsetTop || px < c.offsetLeft + c.offsetWidth)) at = k;
      });
      pendingDrag.current = { id, at: { x: ev.clientX, y: ev.clientY } };
      flip((l) => add(l, id, at));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const keys = (x: LayoutItem, e: React.KeyboardEvent) => {
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const d = e.key === "ArrowUp" || e.key === back ? -1 : e.key === "ArrowDown" || e.key === fwd ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    const k = latest.current.items.findIndex((y) => y.id === x.id);
    const to = Math.max(0, Math.min(latest.current.items.length - 1, k + d));
    if (to === k) return;
    flip((l) => moveTo(l, x.id, to));
    setSay(f(t.hc.moved, { name: t.hc.names[x.id], n: to + 1 }));
  };

  const tray = unused(draft);
  const trayList = (
    <div className="flex flex-col gap-2" data-home-tray>
      {tray.length === 0 && <p className="text-[12.5px] text-muted">{t.hc.allOn}</p>}
      {tray.map((id) => (
        <div
          key={id}
          onPointerDown={(e) => desktop && trayDown(id, e)}
          className={cn("flex min-h-12 items-center gap-2.5 rounded-[10px] border border-line bg-surface p-2 text-[13px] font-medium", desktop && "cursor-grab touch-none")}
          data-tray-item={id}
        >
          <span className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-surface-2 text-ink [&_svg]:size-4">{WIDGET_ICON[id]}</span>
          <span className="min-w-0 flex-1 leading-tight">
            {t.hc.names[id]}
            {NEW_WIDGETS.includes(id) && <span className="ms-1.5 rounded bg-ok-soft px-1.5 py-px text-[10px] font-bold text-ok">{t.hc.new}</span>}
          </span>
          <button
            type="button"
            onClick={() => {
              flip((l) => add(l, id));
              setTrayOpen(false);
              setSay(f(t.hc.moved, { name: t.hc.names[id], n: latest.current.items.length + 1 }));
            }}
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink hover:bg-sunken"
            aria-label={f(t.hc.add, { name: t.hc.names[id] })}
            data-tray-add={id}
          >
            <Plus className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 lg:col-span-12 lg:flex-row lg:gap-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-card-line lg:bg-surface" data-home-customizing>
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 lg:p-6">
        <div className="flex items-center gap-2 px-1 pt-1 lg:px-0 lg:pt-0">
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-extrabold tracking-[-0.02em] lg:text-[22px]">{t.hc.title}</h1>
          <button type="button" onClick={onReset} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted hover:text-ink" data-home-reset>
            <RotateCcw className="size-3.5 max-lg:hidden" />
            {t.dash.reset}
          </button>
          <button type="button" onClick={onDone} className="h-9 rounded-full bg-brand px-4 text-[13px] font-semibold text-on-brand" data-home-done>
            {t.dash.done}
          </button>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="radiogroup" aria-label={t.hc.title}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={draft.preset === p}
              onClick={() => flip(() => ({ v: 2, preset: p, items: presetItems(p, shared) }))}
              className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition [&_svg]:size-[15px]", draft.preset === p ? "border-brand bg-brand font-semibold text-on-brand" : "border-line bg-surface text-ink hover:border-line-strong")}
              data-home-preset={p}
            >
              {desktop && PRESET_ICON[p]}
              {t.hc.presets[p]}
            </button>
          ))}
          {draft.preset == null && <span className="flex h-9 shrink-0 items-center rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold" data-home-preset="custom">{t.hc.custom}</span>}
        </div>
        <p className="px-1 text-[12.5px] text-muted lg:px-0">{desktop ? t.hc.hint : t.hc.hintPhone}</p>
        <div ref={grid} className="hgrid relative" data-home-grid data-editing>
          {draft.items.map((x) => (
            <div
              key={x.id}
              ref={(el) => {
                if (el) cells.current.set(x.id, el);
                else cells.current.delete(x.id);
              }}
              className={cn(
                "hw relative overflow-hidden rounded-[var(--card-r,12px)] border-[1.5px] border-dashed border-line-strong bg-surface",
                // Its own compositor layer while it moves: the drag is transform-only, no repaint per frame.
                dragId === x.id && "z-20 border-solid border-ink shadow-[0_18px_40px_-12px_rgba(16,16,14,.35)] [will-change:transform]",
              )}
              style={cellStyle(x, null)}
              data-widget={x.id}
              data-w={x.w}
              data-h={x.h}
            >
              <div className="flex shrink-0 items-center gap-1 py-1 pe-1 ps-1">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).focus();
                    start(x.id, { x: e.clientX, y: e.clientY });
                  }}
                  onKeyDown={(e) => keys(x, e)}
                  className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-faint hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
                  aria-label={f(t.hc.drag, { name: t.hc.names[x.id] })}
                  data-widget-handle={x.id}
                >
                  <GripVertical className="size-4" />
                </button>
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-[0.04em] text-muted">{t.hc.names[x.id]}</span>
                {desktop ? (
                  <SizeMenu x={x} onChange={(p) => flip((l) => patch(l, x.id, p))} />
                ) : null}
                <button type="button" onClick={() => flip((l) => remove(l, x.id))} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label={f(t.hc.hide, { name: t.hc.names[x.id] })} data-widget-hide={x.id}>
                  <EyeOff className="size-4" />
                </button>
              </div>
              <div className="hw-body pointer-events-none min-h-0 flex-1 select-none overflow-hidden [&>*]:h-full" inert>
                {render(x.id, x.h, true)}
              </div>
              {!desktop && (
                <div className="flex shrink-0 items-center gap-1.5 p-1.5">
                  <span className="flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label={t.hc.width}>
                    {(["half", "full"] as const).map((p) => (
                      <button key={p} type="button" role="radio" aria-checked={phoneWidth(x) === p} onClick={() => flip((l) => patch(l, x.id, { p }))} className={cn("h-8 rounded-md px-2.5 text-[12px] font-semibold", phoneWidth(x) === p ? "bg-surface text-ink shadow-card" : "text-muted")} data-widget-p={p}>
                        {p === "half" ? t.hc.half : t.hc.full}
                      </button>
                    ))}
                  </span>
                  <button type="button" aria-pressed={x.h === 2} onClick={() => flip((l) => patch(l, x.id, { h: x.h === 2 ? 1 : 2 }))} className={cn("h-9 rounded-lg px-2.5 text-[12px] font-semibold", x.h === 2 ? "bg-ink text-bg" : "bg-surface-2 text-muted")} data-widget-h2={x.id}>
                    2×
                  </button>
                </div>
              )}
              {desktop && (
                <button
                  type="button"
                  onPointerDown={(e) => resize(x, e)}
                  className="absolute bottom-1 end-1 grid size-6 cursor-nwse-resize touch-none place-items-center rounded text-faint hover:text-ink rtl:cursor-nesw-resize"
                  aria-label={f(t.hc.resize, { name: t.hc.names[x.id] })}
                  tabIndex={-1}
                  data-widget-resize={x.id}
                >
                  <svg viewBox="0 0 14 14" className="size-3.5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                    <path d="M12 5 5 12 M12 9l-3 3" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        {!desktop && (
          <button type="button" onClick={() => setTrayOpen(true)} className="sticky bottom-[calc(env(safe-area-inset-bottom)+84px)] z-10 flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[14.5px] font-semibold shadow-card" data-home-add-widget>
            <Plus className="size-4" />
            {t.hc.addWidget}
            <span className="tabular rounded-md bg-surface-2 px-1.5 text-[12px]">{tray.length}</span>
          </button>
        )}
      </div>
      {desktop && (
        <aside className="flex w-[250px] shrink-0 flex-col gap-2 border-s border-line-in bg-surface-2/50 px-4 py-5">
          <b className="text-[14px]">{t.hc.widgets}</b>
          <span className="mb-1 text-[12px] text-muted">{t.hc.dragIn}</span>
          {trayList}
        </aside>
      )}
      {!desktop && (
        <Sheet open={trayOpen} onOpenChange={setTrayOpen} title={t.hc.addAWidget} className="sm:max-w-[420px]">
          <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-1">
            <b className="text-[17px]">{t.hc.addAWidget}</b>
            {trayList}
          </div>
        </Sheet>
      )}
      <span className="sr-only" aria-live="polite">
        {say}
      </span>
    </div>
  );
}

function SizeMenu({ x, onChange }: { x: LayoutItem; onChange: (p: Partial<LayoutItem>) => void }) {
  const { t } = useI18n();
  const opt = (on: boolean) => cn("h-7 flex-1 rounded-md text-[12px] font-semibold", on ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink");
  return (
    <Pop>
      <PopTrigger asChild>
        <button type="button" className="flex h-[26px] shrink-0 items-center gap-0.5 rounded-[7px] border border-line bg-surface pe-1.5 ps-2 text-[11.5px] font-semibold text-ink data-[state=open]:border-ink" aria-label={t.hc.size} data-widget-size={x.id}>
          {x.w}
          {x.h === 2 ? " · 2×" : ""}
          <ChevronDown className="size-3.5" />
        </button>
      </PopTrigger>
      <PopContent align="end" className="w-[188px] p-2.5">
        <div className="mb-1 text-[12px] font-medium text-muted">{t.hc.width}</div>
        <div className="mb-2.5 flex gap-0.5 rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label={t.hc.width}>
          {(["S", "M", "L"] as Width[]).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={x.w === w} onClick={() => onChange({ w })} className={opt(x.w === w)} data-size-w={w}>
              {w}
            </button>
          ))}
        </div>
        <div className="mb-1 text-[12px] font-medium text-muted">{t.hc.height}</div>
        <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label={t.hc.height}>
          {([1, 2] as const).map((h) => (
            <button key={h} type="button" role="radio" aria-checked={x.h === h} onClick={() => onChange({ h })} className={opt(x.h === h)} data-size-h={h}>
              {h}×
            </button>
          ))}
        </div>
      </PopContent>
    </Pop>
  );
}

