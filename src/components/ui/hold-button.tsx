"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Press and hold 2 s to confirm something that can't be undone (R17 admin delete; R18 S3 B10 Forget everything): the
 * button fills from the start side while held, letting go early cancels. A click with no press (assistive tech) calls
 * `onConfirm` instead — a second, explicit step. Kit: `.nx .hold` (settings/nx16.css).
 */
export function HoldButton({ label, aria, onDone, onConfirm, disabled, phone, data }: { label: string; aria: string; onDone: () => void; onConfirm: () => void; disabled?: boolean; phone: boolean; data?: string }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const start = () => {
    if (disabled || timer.current) return;
    pressed.current = true;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onDone();
    }, 2000);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    // The click that follows a pointer release is ignored (above); after that, a bare click means assistive tech.
    setTimeout(() => (pressed.current = false), 0);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className={`btn ${phone ? "" : "sm "}dng-o hold${holding ? " holding" : ""}`}
      style={phone ? { height: 46, width: "100%" } : undefined}
      aria-label={aria}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          stop();
        }
      }}
      onBlur={stop}
      onClick={(e) => {
        // A real press was handled above; a click with no press (detail 0, no key) comes from assistive tech.
        if (pressed.current || e.detail > 0) {
          pressed.current = false;
          return;
        }
        onConfirm();
      }}
      {...(data ? { [`data-${data}`]: "" } : {})}
    >
      <span className="fill" aria-hidden="true" />
      {label}
    </button>
  );
}
