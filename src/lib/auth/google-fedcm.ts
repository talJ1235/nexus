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

export type IdTokenResult = { token: string; nonce: string } | { fallback: string };

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
      id.prompt((n) => {
        if (n.isSkippedMoment?.()) finish({ fallback: `skipped:${n.getSkippedReason?.() ?? "?"}` });
        else if (n.isNotDisplayed?.()) finish({ fallback: `not_displayed:${n.getNotDisplayedReason?.() ?? "?"}` });
        else if (n.isDismissedMoment?.()) {
          const why = n.getDismissedReason?.() ?? "?";
          // "credential_returned": the callback above has (or is about to) run.
          if (why !== "credential_returned") finish({ fallback: `dismissed:${why}` });
        }
      });
    } catch {
      finish({ fallback: "gis_error" });
    }
  });
}
