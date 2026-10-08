"use client";

// Hotfix 2026-10-07 — Google sign-in without leaving the page: Google Identity Services' prompt over FedCM (the
// browser's own account sheet). In an installed Android app the redirect goes through a Custom Tab, and coming back
// left Chrome with a desktop-width layout; the sheet never leaves the app. The result is Google's ID token, bound to a
// nonce our server issued (POST /api/auth/google/nonce → signed httpOnly cookie); the server verifies both.
// Anything short of a token (no FedCM, iOS, script blocked, sheet skipped or dismissed) → the caller uses the redirect.

type Notification = {
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  isNotDisplayed?: () => boolean;
  getSkippedReason?: () => string;
  getDismissedReason?: () => string;
  getNotDisplayedReason?: () => string;
};
type Gis = {
  initialize: (o: Record<string, unknown>) => void;
  prompt: (cb?: (n: Notification) => void) => void;
  cancel: () => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: Gis } };
  }
}

const SRC = "https://accounts.google.com/gsi/client";
const gis = () => window.google?.accounts?.id;

/** FedCM exists here and it isn't iOS / iPadOS (WebKit has no FedCM; never try there). */
export function fedcmAvailable() {
  if (typeof window === "undefined" || !("IdentityCredential" in window)) return false;
  const ua = navigator.userAgent;
  return !/iPhone|iPad|iPod/.test(ua) && !(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

let loading: Promise<boolean> | null = null;
/** The GIS script, once per page (true = ready). A failure lets a later tap try again. */
export function loadGis(timeoutMs = 5000): Promise<boolean> {
  if (gis()) return Promise.resolve(true);
  if (!loading) {
    loading = new Promise<boolean>((resolve) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.onload = () => resolve(!!gis());
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    }).then((ok) => {
      if (!ok) loading = null;
      return ok;
    });
  }
  const p = loading;
  return Promise.race([p, new Promise<boolean>((r) => window.setTimeout(() => r(false), timeoutMs))]);
}

/** token = signed in; cancelled = the person closed the sheet (stay on the login screen); fallback = use the redirect. */
export type IdTokenResult = { token: string; nonce: string } | { cancelled: string } | { fallback: string };

/** Hotfix.3: the person closing the sheet themselves. GIS names it (user_cancel / tap_outside); over FedCM it often gives
 *  no reason at all — then a skip that comes after the sheet had time to show counts as closed by the person, while an
 *  immediate one (FedCM cooldown after an earlier close, no Google session, origin not allowed) still means "couldn't
 *  show" → the redirect, so a tap never does nothing. */
export const SHOWN_MS = 1000;
const USER_CLOSED = new Set(["user_cancel", "tap_outside"]);
const NOT_USER = new Set(["auto_cancel", "issuing_failed"]);
const safe = (f?: () => string) => {
  try {
    return f?.() ?? "";
  } catch {
    return "";
  }
};
export function closedByPerson(reason: string, elapsedMs: number) {
  if (USER_CLOSED.has(reason)) return true;
  if (NOT_USER.has(reason)) return false;
  return (reason === "" || reason === "unknown_reason") && elapsedMs >= SHOWN_MS;
}

/** Ask for an account through the sheet. Resolves with the token, or with why the redirect should be used instead. */
export async function googleIdToken(opts: { clientId: string; hint?: string; signal: AbortSignal }): Promise<IdTokenResult> {
  const [ready, nonce] = await Promise.all([
    loadGis(),
    fetch("/api/auth/google/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: opts.signal })
      .then((r): Promise<{ nonce?: string }> | { nonce?: string } => (r.ok ? r.json() : {}))
      .then((j) => j.nonce ?? null)
      .catch(() => null),
  ]);
  if (opts.signal.aborted) return { fallback: "aborted" };
  const id = gis();
  if (!ready || !id) return { fallback: "script" };
  if (!nonce) return { fallback: "nonce" };
  return new Promise<IdTokenResult>((resolve) => {
    let done = false;
    const finish = (r: IdTokenResult) => {
      if (done) return;
      done = true;
      opts.signal.removeEventListener("abort", onAbort);
      resolve(r);
    };
    const onAbort = () => {
      try {
        id.cancel();
      } catch {
        // already closed
      }
      finish({ fallback: "aborted" });
    };
    opts.signal.addEventListener("abort", onAbort);
    try {
      id.initialize({
        client_id: opts.clientId,
        nonce,
        context: "signin",
        use_fedcm_for_prompt: true,
        auto_select: false,
        cancel_on_tap_outside: false,
        itp_support: true,
        ...(opts.hint ? { login_hint: opts.hint } : {}),
        callback: (r: { credential?: string }) => (r.credential ? finish({ token: r.credential, nonce }) : finish({ fallback: "no_credential" })),
      });
      const t0 = performance.now();
      id.prompt((n) => {
        if (n.isSkippedMoment?.()) {
          const why = safe(n.getSkippedReason);
          finish(closedByPerson(why, performance.now() - t0) ? { cancelled: why || "closed" } : { fallback: `skipped:${why || "?"}` });
        }
        else if (n.isNotDisplayed?.()) finish({ fallback: `not_displayed:${safe(n.getNotDisplayedReason) || "?"}` });
        else if (n.isDismissedMoment?.()) {
          const why = safe(n.getDismissedReason) || "?";
          // "credential_returned": the callback above has (or is about to) run.
          if (why !== "credential_returned") finish({ fallback: `dismissed:${why}` });
        }
      });
    } catch {
      finish({ fallback: "gis_error" });
    }
  });
}
