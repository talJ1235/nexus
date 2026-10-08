// Polish #28: the motion curves for JS (WAAPI `easing` can't read CSS variables). Mirrors the tokens in globals.css
// (:root --ease-out / --ease-in-out / --ease-drawer) — change both together.
/** Entering, leaving, settling: strong ease-out. */
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
/** Moving between two on-screen places. */
export const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";
/** Sheets and drawers (iOS-like). */
export const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";
