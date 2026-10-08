"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Polish #23: an amount that never gets an ellipsis. It shows the full figure while its line fits, and compact notation
 * (₪49.9M) when it doesn't — measured on its own line (the parent box) with a ResizeObserver, never by digit count.
 * The full figure stays in `title`, in the screen-reader text, and a long-press on touch shows it.
 */
export function FitMoney({ full, short, className }: { full: string; short: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [small, setSmall] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box || full === short) return;
    const check = () => {
      const t = text.current;
      if (!t) return;
      // Put the full figure in for one synchronous layout read: does the line overflow its box with it?
      const was = t.textContent;
      t.textContent = full;
      const over = box.scrollWidth > box.clientWidth + 0.5;
      t.textContent = was;
      setSmall(over);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(box);
    return () => ro.disconnect();
  }, [full, short]);
  const press = useRef<number | undefined>(undefined);
  const shown = small ? short : full;
  return (
    <span
      ref={ref}
      title={full}
      className={cn("whitespace-nowrap", className)}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch" || !small) return;
        press.current = window.setTimeout(() => toast(full, { id: "fit-money" }), 450);
      }}
      onPointerUp={() => window.clearTimeout(press.current)}
      onPointerCancel={() => window.clearTimeout(press.current)}
      onContextMenu={(e) => small && e.preventDefault()}
      data-fit-money={small ? "short" : "full"}
    >
      <span ref={text} aria-hidden>
        {shown}
      </span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
