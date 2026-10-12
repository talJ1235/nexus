"use client";

import { useSyncExternalStore } from "react";

/** Live `matchMedia(query)`; false on the server and during hydration. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Narrow width (Tailwind's `max-sm`) — sizing only; "is this the phone UI" = useDevice() (R17 S7). */
export const PHONE = "(max-width: 639px)";
