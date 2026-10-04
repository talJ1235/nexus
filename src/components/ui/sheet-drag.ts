"use client";

import { useCallback, useEffect, useRef } from "react";
import { sheetRelease, velocity } from "@/lib/gestures";

const PHONE = "(max-width: 639px)";
const NO_DRAG = "button, a, input, textarea, select, [contenteditable=true], [role=slider], [data-no-sheet-drag]";

/**
 * Swipe-down-to-close for every bottom sheet on the phone (Round 12 #1) — one implementation, used by `Sheet`, `Modal`
 * and the quick-action sheet. Returns a ref for the dialog element. The sheet follows the finger from its grip
 * (`[data-sheet-grip]`: the handle and the header) or from anywhere in its content while that content is scrolled to
 * the top; released past 30 % of its height or with a downward fling it slides away and closes, otherwise it springs
 * back. The scrim fades with the drag. Desktop (≥ 640 px) is untouched.
 */
export function useSheetDrag(onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((el: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;

    let g: { y0: number; x0: number; dy: number; on: boolean; samples: { t: number; v: number }[]; pointer: number | null } | null = null;
    const scrim = () => {
      const prev = el.previousElementSibling as HTMLElement | null;
      return prev?.hasAttribute("data-sheet-scrim") ? prev : null;
    };
    const phone = () => window.matchMedia(PHONE).matches;
    const begin = (x: number, y: number, pointer: number | null) => {
      g = { x0: x, y0: y, dy: 0, on: false, samples: [{ t: performance.now(), v: 0 }], pointer };
    };
    const move = (y: number) => {
      if (!g) return;
      g.dy = Math.max(0, y - g.y0);
      g.samples.push({ t: performance.now(), v: g.dy });
      if (g.samples.length > 8) g.samples.shift();
      // The open animation (fill-mode both on some sheets) would override an inline transform.
      el.style.animation = "none";
      el.style.transition = "none";
      el.style.transform = `translate3d(0, ${g.dy}px, 0)`;
      const s = scrim();
      if (s) {
        s.style.animation = "none";
        s.style.transition = "none";
        s.style.opacity = String(Math.max(0.15, 1 - g.dy / Math.max(1, el.offsetHeight)));
      }
    };
    const end = () => {
      const d = g;
      g = null;
      if (!d || !d.on) return;
      // A drag that started on a row/button is not a tap on it.
      const eat = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 400);
      const h = el.offsetHeight;
      const s = scrim();
      d.samples.push({ t: performance.now(), v: d.dy }); // a finger that stopped before lifting is not a fling
      if (sheetRelease(d.dy, h, velocity(d.samples)) === "close") {
        el.style.transition = "transform 220ms cubic-bezier(0.3, 0, 0.8, 0.15)";
        el.style.transform = "translate3d(0, 100%, 0)";
        if (s) {
          s.style.transition = "opacity 220ms ease-out";
          s.style.opacity = "0";
        }
        setTimeout(() => {
          close.current();
          // Still mounted (closing was refused or the surface stays): put it back.
          setTimeout(() => {
            if (!el.isConnected) return;
            el.style.transition = el.style.transform = "";
            if (s) s.style.opacity = s.style.transition = "";
          }, 60);
        }, 200);
      } else {
        el.style.transition = "transform 420ms var(--ease-spring)";
        el.style.transform = "";
        if (s) {
          s.style.transition = "opacity 300ms ease-out";
          s.style.opacity = "";
        }
      }
    };

    // Grip (handle + header): pointer events, any pointer type, touch-action: none on the grip itself.
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!phone() || e.button > 0 || !t.closest("[data-sheet-grip]") || t.closest(NO_DRAG)) return;
      begin(e.clientX, e.clientY, e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!g || g.pointer !== e.pointerId) return;
      if (!g.on) {
        if (Math.abs(e.clientY - g.y0) < 4) return;
        g.on = true;
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      }
      move(e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (g && g.pointer === e.pointerId) end();
    };

    // Content: a downward pull while the scroll area under the finger is at its top. Touch events, so the pull can
    // claim the gesture before the browser starts its own (overscroll) pan.
    const scrollTopOf = (t: HTMLElement) => {
      for (let n: HTMLElement | null = t; n && n !== el.parentElement; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n.scrollTop;
      }
      return 0;
    };
    const onTouchStart = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      if (e.touches.length !== 1 || !phone() || t.closest("[data-sheet-grip]") || t.closest("input, textarea, select, [contenteditable=true], [role=slider], [data-no-sheet-drag]")) return;
      if (scrollTopOf(t) > 0) return;
      begin(e.touches[0].clientX, e.touches[0].clientY, null);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!g || g.pointer !== null) return;
      const p = e.touches[0];
      const dy = p.clientY - g.y0;
      const dx = p.clientX - g.x0;
      if (!g.on) {
        if (dy < 0 || Math.abs(dx) > Math.abs(dy) + 4) return void (g = null); // scrolling up / sideways: not ours
        if (e.cancelable) e.preventDefault(); // at the top a downward pan has nothing to scroll — keep the gesture
        if (dy < 8) return;
        g.on = true;
      }
      if (e.cancelable) e.preventDefault();
      move(p.clientY);
    };
    const onTouchEnd = () => {
      if (g && g.pointer === null) end();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    cleanup.current = () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);
}

// ---------- Back gesture ----------

/**
 * Back gesture / browser Back closes the top phone surface (Round 12 #1): each open surface pushes one history entry;
 * one shared popstate listener closes only the top of the stack. Closing any other way removes the entry again
 * (a `history.back()` the listener knows to skip), so the history never fills up with dead entries.
 */
const backStack: { close: () => void; popped: boolean }[] = [];
let skipPops = 0;
let listening = false;
const onPop = () => {
  if (skipPops > 0) {
    skipPops--;
    return;
  }
  const top = backStack.pop();
  if (!top) return;
  top.popped = true;
  top.close();
};

export function useBackClose(open: boolean, onClose: () => void, media = PHONE) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open || !window.matchMedia(media).matches) return;
    if (!listening) {
      window.addEventListener("popstate", onPop);
      listening = true;
    }
    const entry = { close: () => close.current(), popped: false };
    backStack.push(entry);
    history.pushState({ ...(history.state ?? {}), nxSheet: backStack.length }, "");
    return () => {
      const i = backStack.indexOf(entry);
      if (i < 0) return;
      backStack.splice(i, 1);
      if (!entry.popped && history.state?.nxSheet) {
        skipPops++;
        history.back();
      }
    };
  }, [open, media]);
}
