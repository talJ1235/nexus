/** Hide the phone boot screen (components/boot-screen.tsx) once the app is ready. The sequence (~1.4 s, plus the
 *  start of one heartbeat) always plays to the end — Tal wants it seen, even when the app is ready sooner.
 *  Safe to call many times / on pages without it. */
const SEQUENCE_MS = 1700;
const MAX_HOLD_MS = SEQUENCE_MS;
let done = false;

export function markBooted() {
  if (done || typeof document === "undefined") return;
  done = true;
  try {
    sessionStorage.setItem("nexus.booted", "1");
  } catch {}
  const el = document.getElementById("boot");
  if (!el || getComputedStyle(el).display === "none") return;
  // Time since the animation actually started (not since navigation), from the left face's own animation clock.
  const clock = el.querySelector(".boot-left");
  const elapsed = Number(clock?.getAnimations?.()[0]?.currentTime ?? SEQUENCE_MS);
  const wait = Math.min(MAX_HOLD_MS, Math.max(0, SEQUENCE_MS - elapsed));
  setTimeout(() => {
    el.classList.add("boot-out");
    el.addEventListener("animationend", (e) => e.target === el && el.classList.add("boot-gone"));
    setTimeout(() => el.classList.add("boot-gone"), 800);
  }, wait);
}
