"use client";

import { useRef, useState } from "react";

// R17 S3 inbox swipe, shared (R18 S3 C5: the supermarket list rows too): 1:1 follow once the gesture locks to the
// horizontal axis (a vertical scroll never swipes), rubber-band past the open width, velocity flick, release snaps on the
// drawer curve (the row's `.settle` transition). `x` is logical: + toward the inline-end, − toward the start; RTL mirrors
// the physical direction. A side opens to its width (revealing the buttons underneath on the other side); a side with
// `full` commits on a long swipe or a flick. Reduced motion: no follow — past the threshold the side just opens.

export type SwipeSide = { width: number; full?: () => void };

const reducedMotion = () => typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce");

export function useSwipe({ start, end, disabled }: { start?: SwipeSide; end?: SwipeSide; disabled?: boolean }) {
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const d = useRef<{ x0: number; y0: number; base: number; t0: number; moved: boolean; axis: "x" | "y" | null; sgn: number } | null>(null);
  const justDragged = useRef(false);
  const side = (v: number) => (v > 0 ? end : v < 0 ? start : undefined);
  const bind = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
      justDragged.current = false; // a touch drag never clicks: the flag must not swallow the next real tap
      const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
      d.current = { x0: e.clientX, y0: e.clientY, base: x, t0: performance.now(), moved: false, axis: null, sgn: rtl ? -1 : 1 };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const c = d.current;
      if (!c) return;
      const dx = (e.clientX - c.x0) * c.sgn;
      const dy = e.clientY - c.y0;
      if (!c.axis && Math.hypot(dx, dy) > 8) {
        c.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (c.axis === "x") e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (c.axis !== "x") return;
      c.moved = true;
      let v = c.base + dx;
      const s = side(v);
      if (reducedMotion()) {
        // No slide: past the threshold the side opens in place.
        if (s && Math.abs(dx) > 48) setX(Math.sign(v) * s.width);
        return;
      }
      const a = Math.abs(v);
      if (!s) v *= 0.25;
      else {
        const stop = s.full ? 240 : s.width;
        if (a > stop) v = Math.sign(v) * (stop + (a - stop) * 0.3);
      }
      setDrag(true);
      setX(v);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const c = d.current;
      d.current = null;
      setDrag(false);
      if (!c || !c.moved) return;
      justDragged.current = true;
      if (reducedMotion()) return;
      const vel = ((e.clientX - c.x0) * c.sgn) / Math.max(1, performance.now() - c.t0);
      const s = side(x);
      if (!s) return setX(0);
      const dir = Math.sign(x);
      const toward = vel * dir; // + = flicked further toward the open side
      if (s.full && (Math.abs(x) > 200 || (toward > 0.6 && Math.abs(x) > 40))) return s.full();
      setX(Math.abs(x) > s.width / 2 || toward > 0.3 ? dir * s.width : 0);
    },
    onPointerCancel: () => {
      d.current = null;
      setDrag(false);
      setX(0);
    },
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
      // A drag that ended on the row is not a tap (a mouse drag still clicks: swallowed, the row stays as released); a
      // tap on an open row closes it first.
      if (justDragged.current) {
        e.stopPropagation();
        e.preventDefault();
        justDragged.current = false;
      } else if (x !== 0) {
        e.stopPropagation();
        e.preventDefault();
        setX(0);
      }
    },
  };
  /** The row's physical offset (px) — mirrored in RTL. */
  const offset = (dir: "rtl" | "ltr" | null) => x * (dir === "rtl" ? -1 : 1);
  return { x, setX, drag, bind, offset };
}
