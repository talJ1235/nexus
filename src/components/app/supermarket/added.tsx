"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useI18n } from "@/components/providers";
import { toast } from "@/lib/toast";
import { useStore } from "../store";

// R18 S4 A2 — feedback after any add: the row appears (a merged row pulses) and one short line names it with its new
// amount ("מלפפון · עכשיו 4"). One toast at a time (a fixed id: the next add replaces it, never stacks); the Add screen
// shows the line inline instead. Back on the list, an added row that is off-screen gets a small "Added · show" pill.

export const SM_ADDED = "nexus:sm-added";
export type Added = { id: string; title: string; qty: string; merged: boolean };
const TOAST_ID = "sm-add";

/** The line for one add (or a count for several). */
export function useAddedLine() {
  const { t, f } = useI18n();
  return useCallback((xs: Added[]) => (xs.length === 1 ? f(xs[0].merged ? t.sm.add.nowLine : t.sm.add.newLine, { title: xs[0].title, qty: xs[0].qty }) : f(t.sm.add.manyLine, { n: xs.length })), [t, f]);
}

/** Tell the list (pulse + pill) and, unless the caller shows its own line, put up the single add toast. */
export function announceAdded(xs: Added[], o: { line?: string; undo?: { label: string; onClick: () => void } } = {}) {
  if (!xs.length) return;
  window.dispatchEvent(new CustomEvent<Added[]>(SM_ADDED, { detail: xs }));
  if (o.line) toast(o.line, { id: TOAST_ID, ...(o.undo ? { action: o.undo } : { duration: 3000 }) });
}

/** Is a row on screen (between the top bar and the dock)? */
function onScreen(el: Element) {
  const r = el.getBoundingClientRect();
  return r.bottom > 64 && r.top < window.innerHeight - 96;
}

/**
 * The list side: added rows pulse once the overlay that added them is gone; one off-screen gets the pill (4 s, or
 * until the list scrolls it into view). `paused` = an Add screen / camera is still over the list.
 */
export function AddedPill({ paused }: { paused: boolean }) {
  const { t } = useI18n();
  const s = useStore();
  const pending = useRef<string[]>([]);
  const [pill, setPill] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const { markFresh } = s;
  useEffect(() => {
    const on = (e: Event) => {
      pending.current = [...pending.current.filter((id) => !(e as CustomEvent<Added[]>).detail.some((x) => x.id === id)), ...(e as CustomEvent<Added[]>).detail.map((x) => x.id)];
      setTick((n) => n + 1);
    };
    window.addEventListener(SM_ADDED, on);
    return () => window.removeEventListener(SM_ADDED, on);
  }, []);
  useEffect(() => {
    if (paused || !pending.current.length) return;
    const ids = pending.current;
    pending.current = [];
    // Wait a frame for the rows to render (an add from the Add screen lands as it closes).
    const raf = requestAnimationFrame(() => {
      for (const id of ids) markFresh(id, "bump");
      const last = ids[ids.length - 1];
      const el = document.querySelector(`[data-sm-row="${CSS.escape(last)}"]`);
      setPill(el && !onScreen(el) ? last : null);
    });
    return () => cancelAnimationFrame(raf);
  }, [paused, tick, markFresh]);
  useEffect(() => {
    if (!pill) return;
    const el = document.querySelector(`[data-sm-row="${CSS.escape(pill)}"]`);
    const io = el ? new IntersectionObserver(([e]) => e.isIntersecting && setPill(null), { threshold: 0.6 }) : null;
    if (el && io) io.observe(el);
    const id = setTimeout(() => setPill(null), 4000);
    return () => {
      io?.disconnect();
      clearTimeout(id);
    };
  }, [pill]);
  if (!pill) return null;
  const show = () => {
    const el = document.querySelector(`[data-sm-row="${CSS.escape(pill)}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    markFresh(pill, "bump");
    setPill(null);
  };
  return (
    <button type="button" className="sm-added-pill" onClick={show} data-sm-added-pill={pill}>
      <ArrowDown className="size-4" aria-hidden />
      {t.sm.add.show}
    </button>
  );
}
