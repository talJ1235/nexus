/** Hide the phone boot screen (components/boot-screen.tsx) once the app is ready: let its first sequence (~900 ms)
 *  finish, but never hold a ready app for more than ~400 ms. Safe to call many times / on pages without it. */
const SEQUENCE_MS = 900;
const MAX_HOLD_MS = 400;
let done = false;

export function markBooted() {
  if (done || typeof document === "undefined") return;
  done = true;
  try {
    sessionStorage.setItem("nexus.booted", "1");
  } catch {}
  const el = document.getElementById("boot");
  if (!el || getComputedStyle(el).display === "none") return;
  // Time since the animation actually started (not since navigation), from the hub's own animation clock.
  const hub = el.querySelector(".boot-hub");
  const elapsed = Number(hub?.getAnimations?.()[0]?.currentTime ?? SEQUENCE_MS);
  const wait = Math.min(MAX_HOLD_MS, Math.max(0, SEQUENCE_MS - elapsed));
  setTimeout(() => {
    el.classList.add("boot-out");
    el.addEventListener("animationend", (e) => e.target === el && el.classList.add("boot-gone"));
    setTimeout(() => el.classList.add("boot-gone"), 600);
  }, wait);
}
