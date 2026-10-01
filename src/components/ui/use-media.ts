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

/** Phone width (matches Tailwind's `max-sm`). */
export const PHONE = "(max-width: 639px)";
