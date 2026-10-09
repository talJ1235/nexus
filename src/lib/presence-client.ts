"use client";

// R17 G1 — what the presence beat reads that isn't in the store: the shopping-mode count (Trip publishes it).
let shoppingLeft: number | null = null;
const listeners = new Set<() => void>();

export function setShoppingLeft(n: number | null) {
  if (n === shoppingLeft) return;
  shoppingLeft = n;
  for (const l of listeners) l();
}
export const getShoppingLeft = () => shoppingLeft;
export function onShoppingLeft(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
