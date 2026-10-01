"use client";

import { useSyncExternalStore } from "react";
import { applyPalette, currentPalette, DEFAULT_PALETTE, type Palette } from "@/lib/palette";

const subscribe = (cb: () => void) => {
  window.addEventListener("nexus:palette", cb);
  return () => window.removeEventListener("nexus:palette", cb);
};

export function usePalette(): [Palette, (p: Palette) => void] {
  const p = useSyncExternalStore(subscribe, currentPalette, () => DEFAULT_PALETTE);
  return [p, applyPalette];
}
