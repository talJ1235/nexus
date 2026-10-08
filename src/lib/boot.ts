/** Hide the opening (components/boot-screen.tsx) once the app is ready. Safe to call many times / on pages without it.
 *  - Full opening (Round 13 D1, 3.0 s): once a day — the first app open of the day (phone/PWA and desktop share the
 *    day key, localStorage "nexus.bootDay"; Tal's choice 2026-10-08, polish #7); every other open, reload and back /
 *    forward gets the small mark. When it plays, it plays to the end, even when the app is ready sooner. At 2.5 s the exit starts: the box flies into the top-bar logo (phone) or the sidebar logo
 *    (desktop), the field fades, and Home's cards rise in (`<html data-booted>` releases their paused animation);
 *    it is gone at 2.95 s.
 *  - Reduced motion: the assembled mark + word, then a 600 ms fade as soon as the app is ready.
 *  - Small loader (reloads / later loads): goes as soon as the app is ready. */
const SEQUENCE_MS = 2500;
const OUT_MS = 450;
const REDUCED_OUT_MS = 600;
let done = false;

export function markBooted() {
  if (done || typeof document === "undefined") return;
  done = true;
  const html = document.documentElement;
  const el = document.getElementById("boot");
  if (!el || getComputedStyle(el).display === "none") {
    html.setAttribute("data-booted", "");
    return;
  }
  const small = html.dataset.boot === "small";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Time since the sequence actually started (not since navigation), from the left face's own animation clock
  // (its currentTime counts from creation, delay included).
  const clock = el.querySelector(".boot-left");
  const elapsed = Number(clock?.getAnimations?.()[0]?.currentTime ?? SEQUENCE_MS);
  const wait = small || reduced ? 0 : Math.max(0, SEQUENCE_MS - elapsed);
  setTimeout(() => {
    if (!small && !reduced) aimAtLogo(el);
    html.setAttribute("data-booted", "");
    el.classList.add("boot-out");
    setTimeout(() => el.classList.add("boot-gone"), small ? 220 : reduced ? REDUCED_OUT_MS : OUT_MS);
  }, wait);
}

/** Where the boot mark should fly: the visible Box logo (phone top bar or desktop sidebar), as translate + scale. */
function aimAtLogo(el: HTMLElement) {
  const mark = el.querySelector<SVGElement>(".boot-mark");
  const target = [...document.querySelectorAll<SVGElement>("[data-topbar-logo] svg, [data-sidebar-logo] svg")].find((x) => x.getBoundingClientRect().width > 0);
  if (!mark || !target) return;
  const a = mark.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!a.width || !b.width || b.bottom < 0) return;
  mark.style.setProperty("--to-x", `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
  mark.style.setProperty("--to-y", `${b.top + b.height / 2 - (a.top + a.height / 2)}px`);
  mark.style.setProperty("--to-s", `${b.width / a.width}`);
}
