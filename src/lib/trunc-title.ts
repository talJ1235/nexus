"use client";

import { useEffect } from "react";

// R17 A6: any text cut with an ellipsis or a line clamp can be read in full — hovering it (or focusing it, or its row)
// gives it a `title` with the whole text, once, when it is actually cut. One document-level listener instead of a
// title on every truncated label. On phones the truncated text sits in rows / cards that open the full item
// (scripts/test-clip.mjs checks both).

const MARK = "data-trunc-title";

function cut(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
  if (cs.textOverflow !== "ellipsis" && !clamp) return false;
  // Strict: a label 1 px over its box already shows an ellipsis.
  return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
}

function label(from: EventTarget | null) {
  if (!(from instanceof Element)) return;
  // The hovered element, its ancestors (a row's title), and for a row/button its own truncated children.
  const seen = new Set<HTMLElement>();
  for (let n: Element | null = from, k = 0; n && k < 6; n = n.parentElement, k++) if (n instanceof HTMLElement) seen.add(n);
  if (from instanceof HTMLElement && from.childElementCount < 40) for (const c of from.querySelectorAll<HTMLElement>("*")) seen.add(c);
  for (const el of seen) {
    if (el.title || el.hasAttribute(MARK) || !cut(el)) continue;
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    el.title = text;
    el.setAttribute(MARK, "");
  }
}

/** Mounted once (the app shell). */
export function useTruncationTitles() {
  useEffect(() => {
    const on = (e: Event) => label(e.target);
    document.addEventListener("pointerover", on, { passive: true });
    document.addEventListener("focusin", on);
    return () => {
      document.removeEventListener("pointerover", on);
      document.removeEventListener("focusin", on);
    };
  }, []);
}
