/** Hide the phone boot screen (components/boot-screen.tsx) once the app is ready. Safe to call many times / on pages
 *  without it.
 *  - Full intro (app opened): the sequence (~2.3 s) always plays to the end — Tal wants it seen, even when the app is
 *    ready sooner — then the mark flies into the top-bar logo while the field fades (≤ 480 ms).
 *  - Small loader (reload / later load in the session): goes as soon as the app is ready. */
const SEQUENCE_MS = 2300;
const MAX_HOLD_MS = SEQUENCE_MS;
const OUT_MS = 520;
let done = false;

export function markBooted() {
  if (done || typeof document === "undefined") return;
  done = true;
  const el = document.getElementById("boot");
  if (!el || getComputedStyle(el).display === "none") return;
  const small = document.documentElement.dataset.boot === "small";
  // Time since the animation actually started (not since navigation), from the left face's own animation clock.
  const clock = el.querySelector(".boot-left");
  const elapsed = Number(clock?.getAnimations?.()[0]?.currentTime ?? SEQUENCE_MS);
  const wait = small ? 0 : Math.min(MAX_HOLD_MS, Math.max(0, SEQUENCE_MS - elapsed));
  setTimeout(() => {
    if (!small) aimAtLogo(el);
    el.classList.add("boot-out");
    setTimeout(() => el.classList.add("boot-gone"), small ? 220 : OUT_MS);
  }, wait);
}

/** Where the boot mark should fly: the top bar's Box mark (phone shell), as a translate + scale from its own box. */
function aimAtLogo(el: HTMLElement) {
  const mark = el.querySelector<SVGElement>(".boot-mark");
  const target = document.querySelector("[data-topbar-logo] svg");
  if (!mark || !target) return;
  const a = mark.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!a.width || !b.width || b.bottom < 0) return;
  mark.style.setProperty("--to-x", `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
  mark.style.setProperty("--to-y", `${b.top + b.height / 2 - (a.top + a.height / 2)}px`);
  mark.style.setProperty("--to-s", `${b.width / a.width}`);
}
