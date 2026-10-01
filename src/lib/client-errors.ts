// Recent client-side errors (Round 8 D2/D3): a ring buffer of the last 20 — uncaught errors, unhandled rejections
// (a failed server action nobody caught) and error toasts (the app's catch blocks for failed actions). Attached to
// problem reports and given to the assistant when troubleshooting. Kept in sessionStorage so a reload doesn't lose it.
export type ClientError = { at: number; kind: "error" | "rejection" | "toast"; message: string; where?: string };
/** A request that failed: path only (no query, no body) + HTTP status (0 = network error). Round 9 D1. */
export type FailedRequest = { at: number; path: string; status: number };

const failed: FailedRequest[] = [];
export const failedRequests = (): FailedRequest[] => failed.slice();
function recordFailed(input: RequestInfo | URL, status: number) {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, window.location.href);
    // Our own app only; third-party URLs aren't ours to report.
    if (u.origin !== window.location.origin) return;
    failed.push({ at: Date.now(), path: u.pathname.slice(0, 80), status });
    if (failed.length > 10) failed.shift();
  } catch {
    // unparsable URL: ignore
  }
}

const MAX = 20;
const KEY = "nexus.errors";
let buf: ClientError[] | null = null;

const load = (): ClientError[] => {
  if (buf) return buf;
  try {
    buf = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as ClientError[];
  } catch {
    buf = [];
  }
  return buf;
};

export function recordClientError(kind: ClientError["kind"], message: unknown, where?: string) {
  if (typeof window === "undefined") return;
  const b = load();
  const text = (message instanceof Error ? message.message : String(message ?? "")).replace(/\s+/g, " ").slice(0, 300);
  if (!text) return;
  b.push({ at: Date.now(), kind, message: text, ...(where ? { where: where.slice(0, 120) } : {}) });
  if (b.length > MAX) b.splice(0, b.length - MAX);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // private mode / full: memory only
  }
}

export const clientErrors = (): ClientError[] => (typeof window === "undefined" ? [] : load().slice());

let installed = false;
/** Start listening (once per page). */
export function installClientErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    const file = e.filename ? e.filename.split("/").pop()?.split("?")[0] : "";
    recordClientError("error", e.error ?? e.message, file ? `${file}:${e.lineno}:${e.colno}` : undefined);
  });
  // Failed requests (server actions post to the page path): path + status only.
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const res = await orig(input, init);
      if (res.status >= 400) recordFailed(input, res.status);
      return res;
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") recordFailed(input, 0);
      throw e;
    }
  };
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; digest?: string } | undefined;
    recordClientError("rejection", r?.message ?? r, r?.digest ? `digest ${r.digest}` : undefined);
  });
}
