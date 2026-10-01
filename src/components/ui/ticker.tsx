"use client";

import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A number that rolls to its value: once from 0 on enter (`from0`), then from the previous value on every change.
 * rAF + ease-out (~700 ms); reduced motion → jumps. Interruptible: a new value continues from what is shown.
 */
export function useTicker(value: number, { from0 = true, duration = 700 }: { from0?: boolean; duration?: number } = {}) {
  const [shown, setShown] = useState(from0 ? 0 : value);
  const cur = useRef(from0 ? 0 : value);
  useEffect(() => {
    const start = cur.current;
    if (start === value) return;
    const d = reduced() ? 0 : duration;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = d ? Math.min(1, (now - t0) / d) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      cur.current = start + (value - start) * e;
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

export function Ticker({ value, format, from0 = true, duration = 700, className }: { value: number; format: (v: number) => string; from0?: boolean; duration?: number; className?: string }) {
  const shown = useTicker(value, { from0, duration });
  return <span className={className ? `tabular ${className}` : "tabular"}>{format(shown)}</span>;
}
