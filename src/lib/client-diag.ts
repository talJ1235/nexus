// What the client can tell about itself (Round 8 D2/D3, extended in Round 9 D1): sent with help questions and
// attached to problem reports. Never secrets, never personal data or item prices — view names, counts, versions.
import { clientErrors, failedRequests, type ClientError, type FailedRequest } from "./client-errors";
import { currentPalette } from "./palette";

export type ClientDiag = {
  view: string;
  device: "phone" | "desktop";
  viewport: string;
  palette: string;
  mode: "light" | "dark";
  locale: string;
  online: boolean;
  extension: string | null;
  version: string;
  errors: ClientError[];
  // Round 9 D1 (all optional — older clients/reports don't have them):
  /** The last 10 views visited (names only). */
  nav?: string[];
  /** How many items the visible view shows. */
  viewCount?: number;
  /** Connection type / data saver (Network Information API, where available). */
  network?: { type?: string; saveData?: boolean };
  /** Recent failed requests: path + status only. */
  failed?: FailedRequest[];
  /** The service worker build that controls the page. */
  sw?: string | null;
  /** Rough device class (deviceMemory GB, CPU cores). */
  hw?: { memory?: number; cores?: number };
};

// The last 10 views visited on this page (Round 9 D1).
const nav: string[] = [];
export function recordNav(view: string) {
  if (nav[nav.length - 1] === view) return;
  nav.push(view.slice(0, 40));
  if (nav.length > 10) nav.shift();
}

type Nav = Navigator & { connection?: { effectiveType?: string; saveData?: boolean }; deviceMemory?: number };

export function collectDiag(view: string, locale: string, extension: string | null, viewCount?: number): ClientDiag {
  const n = navigator as Nav;
  const sw = navigator.serviceWorker?.controller?.scriptURL ?? null;
  return {
    view,
    device: window.matchMedia("(max-width: 1023px)").matches ? "phone" : "desktop",
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    palette: currentPalette(),
    mode: document.documentElement.classList.contains("dark") ? "dark" : "light",
    locale,
    online: navigator.onLine,
    extension,
    version: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
    errors: clientErrors(),
    nav: nav.slice(),
    ...(viewCount != null ? { viewCount } : {}),
    network: n.connection ? { type: n.connection.effectiveType, saveData: n.connection.saveData } : undefined,
    failed: failedRequests(),
    sw: sw ? (new URL(sw).searchParams.get("v") ?? "active") : null,
    hw: { memory: n.deviceMemory, cores: navigator.hardwareConcurrency },
  };
}

// The last question/answer with the assistant on this page, attached to a report sent from the menu too.
let lastExchange: { question: string; answer: string } | null = null;
export const setLastExchange = (question: string, answer: string) => {
  lastExchange = { question: question.slice(0, 4000), answer: answer.slice(0, 4000) };
};
export const getLastExchange = () => lastExchange;
