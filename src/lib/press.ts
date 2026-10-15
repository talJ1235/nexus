// R18 S4 B1 — tap vs long-press as a small state machine on pointer events only (no click), so the dock "+" is the
// camera on every tap: a long-press needs the finger down ≥ 450 ms without moving > 10 px; the release of a long-press
// is never also a tap; a second finger or a cancel ends the press with nothing. Pure (times come in) — `test:dock`
// runs it with synthetic timings, the dock drives it with real pointer events and one timer.

export const LONG_MS = 450;
export const SLOP_PX = 10;

export type PressState = { id: number; x: number; y: number; at: number; long: boolean; dead: boolean } | null;
export type PressEvent =
  | { type: "down"; id: number; x: number; y: number; at: number }
  | { type: "move"; id: number; x: number; y: number }
  | { type: "timer"; at: number }
  | { type: "up"; id: number; at: number }
  | { type: "cancel" };
export type PressOut = "tap" | "long" | null;

export function press(st: PressState, e: PressEvent): [PressState, PressOut] {
  switch (e.type) {
    case "down":
      // A second finger while one is down: nothing happens for this press.
      if (st) return [{ ...st, dead: true }, null];
      return [{ id: e.id, x: e.x, y: e.y, at: e.at, long: false, dead: false }, null];
    case "move":
      if (!st || st.id !== e.id || st.long) return [st, null];
      return Math.hypot(e.x - st.x, e.y - st.y) > SLOP_PX ? [{ ...st, dead: true }, null] : [st, null];
    case "timer":
      if (!st || st.dead || st.long || e.at - st.at < LONG_MS) return [st, null];
      return [{ ...st, long: true }, "long"];
    case "up": {
      if (!st || st.id !== e.id) return [st, null];
      if (st.dead || st.long) return [null, null];
      // The timer may be late (a busy main thread): a release past the threshold is still a long-press, never a tap.
      return [null, e.at - st.at >= LONG_MS ? "long" : "tap"];
    }
    case "cancel":
      return [null, null];
  }
}
