"use client";

import { useEffect } from "react";

// Polish #17 (Tal 2026-10-08): the ambient loops — the paste capsule's flowing border, the Suggests card's sheen and
// twinkle — play one cycle when they mount, then rest; they loop again only while the AI is working (a link being
// read, the assistant answering, suggestions loading). The CSS keeps them `infinite`; at each cycle boundary
// (`animationiteration`) this rests any loop while no AI work is in flight, and work starting resumes them all.
// R17 A1: a moving border layer (`::before` of .flow-border / .r13-sug) doesn't freeze on a frame — it keeps sliding
// while it fades out over the still border underneath (`data-loop-rest` on its element, a 600 ms opacity transition in
// globals.css), and pauses once invisible. The twinkle has no fade: its boundary is its start pose, so it just stops.
// Reduced motion (OS or Settings → Motion): the CSS removes them.
const LOOPS = new Set(["flow-border", "r13-sheen", "r13-twinkle"]);
const FADING = new Set(["flow-border", "r13-sheen"]);
const FADE_MS = 600;
let working = 0;
const resting = new Map<Element, ReturnType<typeof setTimeout>>();

const loops = () => document.getAnimations().filter((a): a is CSSAnimation => LOOPS.has((a as CSSAnimation).animationName));

const loopsOf = (target: EventTarget | null, name: string, pseudo: string | null) =>
  loops().filter((a) => {
    const fx = a.effect as KeyframeEffect | null;
    return a.animationName === name && fx?.target === target && (fx?.pseudoElement ?? null) === pseudo;
  });

function onIteration(e: AnimationEvent) {
  if (working > 0 || !LOOPS.has(e.animationName)) return;
  const pseudo = e.pseudoElement || null;
  const el = e.target as Element;
  if (FADING.has(e.animationName)) {
    if (resting.has(el)) return;
    el.setAttribute("data-loop-rest", "");
    resting.set(
      el,
      setTimeout(() => {
        resting.delete(el);
        if (working === 0) for (const a of loopsOf(el, e.animationName, pseudo)) a.pause();
      }, FADE_MS + 50),
    );
    return;
  }
  for (const a of loopsOf(el, e.animationName, pseudo)) {
    const d = Number((a.effect as KeyframeEffect).getTiming().duration) || 0;
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
    for (const [el, t] of resting) {
      clearTimeout(t);
      resting.delete(el);
    }
    for (const el of document.querySelectorAll("[data-loop-rest]")) el.removeAttribute("data-loop-rest"); // fades back in
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
