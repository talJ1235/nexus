"use client";

// R18 S2 A1 — what the Supermarket screen should do when it opens: the dock's long-press menu and the app-icon shortcuts
// (`/?v=supermarket&do=…`) ask for one of these; the screen takes it once (module state + an event, no store re-render).

/** `build` = show the cold-start suggestions ("Build my list", Home's first-list card). */
export type SmIntent = "add" | "scan" | "photo" | "shop" | "build";
export const SM_INTENTS: readonly SmIntent[] = ["add", "scan", "photo", "shop", "build"];
const EVENT = "nexus:sm-intent";

let pending: SmIntent | null = null;

export function requestSm(kind: SmIntent) {
  pending = kind;
  window.dispatchEvent(new Event(EVENT));
}

/** The intent waiting for the screen (from a request or the address's `do=`), cleared as it's taken. */
export function takeSmIntent(): SmIntent | null {
  let k = pending;
  pending = null;
  try {
    const url = new URL(window.location.href);
    const d = url.searchParams.get("do");
    if (d) {
      url.searchParams.delete("do");
      window.history.replaceState(window.history.state, "", url);
      if (!k && (SM_INTENTS as readonly string[]).includes(d)) k = d as SmIntent;
    }
  } catch {}
  return k;
}

export function onSmIntent(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
