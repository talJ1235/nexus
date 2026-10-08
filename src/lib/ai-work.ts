"use client";

import { useEffect } from "react";

// Polish #17 (Tal 2026-10-08): the ambient loops — the paste capsule's flowing border, the Suggests card's sheen and
// twinkle — play one cycle when they mount, then rest; they loop again only while the AI is working (a link being
// read, the assistant answering, suggestions loading). The CSS keeps them `infinite`; at each cycle boundary
// (`animationiteration`, where a seamless loop is back at its start pose) this pauses any loop while no AI work is in
// flight, and work starting resumes them all. Reduced motion (OS or Settings → Motion): the CSS removes them.
const LOOPS = new Set(["flow-border", "r13-sheen", "r13-twinkle"]);
let working = 0;

const loops = () => document.getAnimations().filter((a): a is CSSAnimation => LOOPS.has((a as CSSAnimation).animationName));

function onIteration(e: AnimationEvent) {
  if (working > 0 || !LOOPS.has(e.animationName)) return;
  const pseudo = e.pseudoElement || null;
  for (const a of loops()) {
    const fx = a.effect as KeyframeEffect | null;
    if (a.animationName !== e.animationName || fx?.target !== e.target || (fx?.pseudoElement ?? null) !== pseudo) continue;
    const d = Number(fx.getTiming().duration) || 0;
    a.pause();
    if (d) a.currentTime = Math.round(Number(a.currentTime ?? 0) / d) * d; // exactly on the boundary: the start pose
  }
}
if (typeof document !== "undefined") document.addEventListener("animationiteration", onIteration, true);

/** Mark AI work as started; call the returned function when it ends (any order, any number at once). */
export function aiWorkStart(): () => void {
  if (typeof document === "undefined") return () => {};
  if (working++ === 0) {
    document.documentElement.setAttribute("data-ai-busy", "");
    for (const a of loops()) if (a.playState === "paused") a.play();
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    // The running cycles finish; the next boundary rests them.
    if (--working === 0) document.documentElement.removeAttribute("data-ai-busy");
  };
}

/** AI work for as long as `active` is true. */
export function useAiWork(active: boolean) {
  useEffect(() => (active ? aiWorkStart() : undefined), [active]);
}

/** AI work until the promise settles. */
export function trackAiWork<T>(p: Promise<T>): Promise<T> {
  const end = aiWorkStart();
  return p.finally(end);
}
