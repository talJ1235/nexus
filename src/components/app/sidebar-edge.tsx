"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/components/providers";
import { cn } from "@/lib/utils";
import { useStore } from "./store";

export const SIDEBAR_MIN = 68;
export const SIDEBAR_MAX = 224;
/** Release snaps to the nearer state: past 40 % of the way from where the drag started, it switches. */
export function snapCollapsed(width: number, startCollapsed: boolean) {
  const span = SIDEBAR_MAX - SIDEBAR_MIN;
  return startCollapsed ? width < SIDEBAR_MIN + span * 0.4 : width < SIDEBAR_MAX - span * 0.4;
}

/**
 * The desktop sidebar's end edge (Round 13 C2): a 9 px hit area with a grip pill on hover. Dragging it moves the
 * sidebar's width with the pointer (68–224 px); on release it snaps to collapsed / open. Double-click toggles;
 * Enter / Space on the focused grip too; Ctrl+B anywhere. In Hebrew the edge is on the left and the drag mirrors.
 * `onLive(w)` streams the width while dragging (null when done) so the grid follows without a transition.
 */
export function SidebarEdge({ onLive }: { onLive: (w: number | null) => void }) {
  const s = useStore();
  const { t, dir } = useI18n();
  const drag = useRef<{ id: number; start: number; startW: number; moved: boolean; w: number } | null>(null);
  const collapsed = s.sidebarCollapsed;
  const toggle = () => s.setSidebarCollapsed(!collapsed);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b" || e.altKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      e.preventDefault();
      s.setSidebarCollapsed(!s.sidebarCollapsed);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [s]);

  const sign = dir === "rtl" ? -1 : 1;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={collapsed ? t.shell.expand : t.shell.collapse}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={collapsed ? SIDEBAR_MIN : SIDEBAR_MAX}
      tabIndex={0}
      title={collapsed ? t.shell.expand : t.shell.collapse}
      className="group absolute inset-y-6 -end-[5px] z-10 flex w-[9px] cursor-col-resize touch-none select-none justify-center outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const w = collapsed ? SIDEBAR_MIN : SIDEBAR_MAX;
        drag.current = { id: e.pointerId, start: e.clientX, startW: w, moved: false, w };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = (e.clientX - d.start) * sign;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        d.w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, d.startW + dx));
        onLive(d.w);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.id !== e.pointerId) return;
        onLive(null);
        if (d.moved) s.setSidebarCollapsed(snapCollapsed(d.w, d.startW === SIDEBAR_MIN));
      }}
      onPointerCancel={() => {
        drag.current = null;
        onLive(null);
      }}
      onDoubleClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      data-sidebar-edge
    >
      <span className={cn("my-auto h-10 w-[5px] rounded-full bg-line-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100")} aria-hidden />
    </div>
  );
}
